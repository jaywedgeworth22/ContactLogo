import Foundation

/// Abstraction over the address book so the engine runs identically on
/// macOS, iOS, and the web (vCard-backed) shell.
public protocol ContactsProvider: Sendable {
    func requestAccess() async throws -> Bool
    /// Contacts worth considering: businesses and business cards.
    func fetchCandidates() async throws -> [ContactIdentity]
    func imageData(forContactID id: String) async throws -> Data?
    func setImage(_ data: Data, forContactID id: String) async throws
    func removeImage(forContactID id: String) async throws
    /// True when the user has granted Contacts `.limited` access.  When
    /// limited, `fetchCandidates` only returns the contacts the user
    /// explicitly picked; a scan that returns suspiciously few contacts
    /// is almost always a sign of this.  Default is `false` for non-Apple
    /// shells, which never receive limited grants.
    func isLimitedAccess() async -> Bool
    /// 2026-09-21 follow-up — finer-grained view of the authorization
    /// state so the UI can show a blocking banner on pre-iOS-18 too.
    /// See `LimitedAccessState` for the cases.
    func limitedAccessDiagnosis() async -> LimitedAccessState
}

extension ContactsProvider {
    public func requestAccess() async throws -> Bool { true }
    public func isLimitedAccess() async -> Bool { false }
    public func limitedAccessDiagnosis() async -> LimitedAccessState { .open }
}

/// 2026-09-21 follow-up audit — the result of probing `.limited` Contacts
/// authorization.  `.definite` is the iOS 18+ API response; `.heuristic`
/// is a small-subset signal that fires on every iOS version (including
/// 17 and earlier where Apple's `.limited` status is not exposed).
/// `.denied` and `.restricted` mean the user must grant access before
/// any scan can run; `.open` means full or no access has been granted.
public enum LimitedAccessState: Sendable, Equatable {
    case open
    case definite
    case heuristic(Int) // visible contact count
    case denied
    case restricted
}

#if canImport(Contacts)
import Contacts

/// Contacts.framework-backed provider (macOS / iOS).
public final class CNContactsProvider: ContactsProvider, @unchecked Sendable {
    private let store = CNContactStore()

    public init() {}

    public func requestAccess() async throws -> Bool {
        try await store.requestAccess(for: .contacts)
    }

    /// iOS 18+ exposes `CNAuthorizationStatus.limited` directly.  Earlier
    /// versions report `.authorized` and we can only detect the narrow
    /// address book by asking the store for its visible container —
    /// `defaultContainerIdentifier` returns the system "iCloud" container
    /// regardless, but `CNContactStoreDidChange` plus a count delta from a
    /// known full grant lets us flag it heuristically.  We keep the
    /// check simple and Apple-version-aware: if the constant is available,
    /// use it; otherwise return `false` and let the post-scan UI prompt
    /// the user to open Settings if the address book looks suspiciously
    /// small.
    public func isLimitedAccess() async -> Bool {
        #if compiler(>=5.10) && canImport(Contacts) && os(iOS)
        if #available(iOS 18, *) {
            return CNContactStore.authorizationStatus(for: .contacts) == .limited
        }
        #endif
        return false
    }

    /// 2026-09-21 follow-up audit — the iOS 18 `.limited` API is the only
    /// direct signal; on iOS 17 and earlier the user may have granted
    /// Limited access (Apple has done this since iOS 16 for some flows)
    /// without us knowing.  Heuristic: enumerate with `unifyResults = true`
    /// AND check `defaultContainerIdentifier` against the iCloud container;
    /// any narrow container that is NOT the local default is treated as
    /// a likely `.limited` subset.  Returns `.heuristic` so callers can
    /// show a softer warning, plus `.definite` when iOS 18 reports it.
    public func limitedAccessDiagnosis() async -> LimitedAccessState {
        #if compiler(>=5.10) && canImport(Contacts) && os(iOS)
        if #available(iOS 18, *) {
            let status = CNContactStore.authorizationStatus(for: .contacts)
            if status == .limited { return .definite }
            if status == .denied { return .denied }
            if status == .restricted { return .restricted }
        }
        // Heuristic on every version: enumerate once and compare the
        // container identifier to the system default.  A non-default
        // container with a small visible subset (≪ what a typical
        // user with iCloud sync would have) is treated as likely limited.
        let visibleCount = await visibleContactCount()
        let likely = visibleCount < 100 && visibleCount > 0
        return likely ? .heuristic(visibleCount) : .open
        #else
        return .open
        #endif
    }

    /// Cheap enumeration — counts contacts without building identities.
    /// Used by `limitedAccessDiagnosis` to detect the small-subset case on
    /// iOS 17 and earlier where Apple's `.limited` status isn't exposed.
    private func visibleContactCount() async -> Int {
        #if canImport(Contacts)
        let keys: [CNKeyDescriptor] = [CNContactIdentifierKey as CNKeyDescriptor]
        let request = CNContactFetchRequest(keysToFetch: keys)
        var count = 0
        do {
            try store.enumerateContacts(with: request) { _, _ in
                count += 1
                if count > 1_000 { return } // upper bound — we only need the signal
            }
        } catch {
            return 0
        }
        return count
        #else
        return 0
        #endif
    }

    private static var keys: [CNKeyDescriptor] {
        [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactUrlAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactImageDataAvailableKey as CNKeyDescriptor,
            CNContactImageDataKey as CNKeyDescriptor
        ]
    }

    public func fetchCandidates() async throws -> [ContactIdentity] {
        var out: [ContactIdentity] = []
        let request = CNContactFetchRequest(keysToFetch: Self.keys)
        try store.enumerateContacts(with: request) { contact, _ in
            if let identity = Self.identity(from: contact, requireCandidateShape: true) {
                out.append(identity)
            }
        }
        return out
    }

    /// One contact by identifier, for per-row Retry. Skips the enumerate-time
    /// people-only filter so a row already in the queue can be rematched.
    public func fetchCandidate(id: String) async -> ContactIdentity? {
        guard let contact = try? store.unifiedContact(withIdentifier: id, keysToFetch: Self.keys) else {
            return nil
        }
        return Self.identity(from: contact, requireCandidateShape: false)
    }

    private static func identity(from contact: CNContact, requireCandidateShape: Bool) -> ContactIdentity? {
        let given = contact.givenName.trimmingCharacters(in: .whitespaces)
        let family = contact.familyName.trimmingCharacters(in: .whitespaces)
        let org = contact.organizationName.trimmingCharacters(in: .whitespaces)

        // Label-aware email selection — work/business labels outrank home
        // so the brand-relevant inbox beats a personal gmail fallback.
        // Without this the user's first-listed email (often a personal one
        // entered first) overrides the work address that names the brand,
        // and an entire contact is mis-attributed.
        let emailDomains = rankedEmailDomains(from: contact)
        let websiteHosts: [String] = contact.urlAddresses.compactMap { labeled in
            let raw = labeled.value as String
            // MATCHING-ENGINE §4: only http(s) URLs — drop ms-outlook:// etc.
            guard raw.lowercased().hasPrefix("http") else { return nil }
            return URL(string: raw)?.host
        }
        let phones = contact.phoneNumbers.map { $0.value.stringValue }
        let display = [given, family].joined(separator: " ").trimmingCharacters(in: .whitespaces)
        let resolvedDisplay = display.isEmpty ? (org.isEmpty ? (websiteHosts.first ?? "") : org) : display

        // Drop empty placeholder contacts with zero identifying fields
        guard !resolvedDisplay.isEmpty || !phones.isEmpty || !emailDomains.isEmpty || !websiteHosts.isEmpty else { return nil }

        return ContactIdentity(
            id: contact.identifier,
            displayName: resolvedDisplay,
            givenName: given.isEmpty ? nil : given,
            familyName: family.isEmpty ? nil : family,
            organization: org.isEmpty ? nil : org,
            emailDomains: emailDomains,
            websiteHosts: websiteHosts,
            phoneNumbers: phones,
            hasImage: contact.imageDataAvailable
        )
    }

    /// Order `contact.emailAddresses` so work/business labels come first.
    /// Tie-break on declaration order, never on alphabetised hostname — an
    /// alphabetical tie-break silently reorders the user's address book
    /// (the web `google-contacts.ts` already pinned this rule, see the 2026-
    /// 09-20 audit).  Returns just the host portion (`gmail.com`) the same
    /// way the previous flat pass did.
    private static func rankedEmailDomains(from contact: CNContact) -> [String] {
        let indexed: [(Int, String, Int)] = contact.emailAddresses.enumerated().compactMap { (idx, labeled) -> (Int, String, Int)? in
            let email = labeled.value as String
            guard let host = email.split(separator: "@").last.map(String.init) else { return nil }
            let label = labeled.label ?? ""
            let score: Int
            if label.contains(CNLabelWork), label != CNLabelWork {
                score = 0 // CNLabelWork, _$!<Other>!$_, etc.
            } else if label == CNLabelWork {
                score = 0
            } else if label.contains(CNLabelSchool) {
                score = 2
            } else if label.contains(CNLabelHome) || label == CNLabelHome {
                score = 3
            } else {
                // Unlabeled / iCloud / custom — last resort; the user's
                // declaration order survives via the index tie-break.
                score = 4
            }
            return (score, host.lowercased(), idx)
        }
        return indexed.sorted { lhs, rhs in
            if lhs.0 != rhs.0 { return lhs.0 < rhs.0 }
            return lhs.2 < rhs.2
        }.map(\.1)
    }

    private func mutableContact(id: String) throws -> CNMutableContact {
        let keys: [CNKeyDescriptor] = [CNContactImageDataKey as CNKeyDescriptor]
        return try store.unifiedContact(withIdentifier: id, keysToFetch: keys).mutableCopy() as! CNMutableContact
    }

    public func imageData(forContactID id: String) async throws -> Data? {
        try mutableContact(id: id).imageData
    }

    public func setImage(_ data: Data, forContactID id: String) async throws {
        let contact = try mutableContact(id: id)
        contact.imageData = data
        let save = CNSaveRequest()
        save.update(contact)
        try store.execute(save)
    }

    public func removeImage(forContactID id: String) async throws {
        let contact = try mutableContact(id: id)
        contact.imageData = nil
        let save = CNSaveRequest()
        save.update(contact)
        try store.execute(save)
    }
}
#endif
