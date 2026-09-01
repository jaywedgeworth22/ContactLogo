import Foundation

/// Abstraction over the address book so the engine runs identically on
/// macOS, iOS, and the web (vCard-backed) shell.
public protocol ContactsProvider: Sendable {
    /// Contacts worth considering: businesses and business cards.
    func fetchCandidates() async throws -> [ContactIdentity]
    func imageData(forContactID id: String) async throws -> Data?
    func setImage(_ data: Data, forContactID id: String) async throws
    func removeImage(forContactID id: String) async throws
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
        let hasPersonName = !given.isEmpty || !family.isEmpty
        // only people-with-org or business cards are candidates at all
        if requireCandidateShape {
            guard !org.isEmpty || !hasPersonName else { return nil }
        }

        let emailDomains = contact.emailAddresses.compactMap { labeled -> String? in
            let email = labeled.value as String
            return email.split(separator: "@").last.map(String.init)
        }
        let websiteHosts: [String] = contact.urlAddresses.compactMap { labeled in
            let raw = labeled.value as String
            // MATCHING-ENGINE §4: only http(s) URLs — drop ms-outlook:// etc.
            guard raw.lowercased().hasPrefix("http") else { return nil }
            return URL(string: raw)?.host
        }
        let phones = contact.phoneNumbers.map { $0.value.stringValue }
        let display = [given, family].joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return ContactIdentity(
            id: contact.identifier,
            displayName: display.isEmpty ? org : display,
            givenName: given.isEmpty ? nil : given,
            familyName: family.isEmpty ? nil : family,
            organization: org.isEmpty ? nil : org,
            emailDomains: emailDomains,
            websiteHosts: websiteHosts,
            phoneNumbers: phones,
            hasImage: contact.imageDataAvailable
        )
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
