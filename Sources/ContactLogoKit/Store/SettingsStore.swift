#if canImport(Combine)
import Combine
import Foundation

/// Persisted user settings.
///
/// Brandfetch used to activate only from `CONTACTLOGO_BRANDFETCH_CLIENT_ID` in
/// the process environment, which an app launched from Finder or Springboard
/// never has — so the best source in the stack was dead in every shipping
/// build (CL-19).  Credentials now live here; the process environment stays as
/// the fallback so the CLI and CI keep working unchanged.
@MainActor
public final class SettingsStore: ObservableObject {

    private enum Key {
        static let clientID = "contactlogo.brandfetch.clientID"
        static let apiKey = "contactlogo.brandfetch.apiKey"
        static let skipExistingPhoto = "contactlogo.skipContactsWithExistingPhoto"
    }

    private enum Credential {
        static let service = "com.contactlogo.credentials"
        static let brandfetchAPIKey = "brandfetch.apiKey"
    }

    private let defaults: UserDefaults
    private var isLoading = true

    /// True when the API key could not be written to the Keychain, so it is
    /// live for this launch but will not survive it.
    ///
    /// It is deliberately **not** written to `UserDefaults` instead: falling
    /// back would reinstate the plaintext exposure this replaced.  No shell
    /// surfaces this yet; showing it in both settings screens is the follow-up.
    @Published public private(set) var credentialStorageFailed = false

    @Published public var brandfetchClientID: String = "" { didSet { autosave() } }
    @Published public var brandfetchAPIKey: String = "" { didSet { autosave() } }
    /// Opt-in, and off by default.
    ///
    /// It was on, described as mirroring a web toggle and the MATCHING-ENGINE
    /// photo-protection policy.  Neither holds.  The web has no such toggle, and
    /// photo protection is about *people*: MATCHING-ENGINE section 1 says a
    /// business card allows a logo "even if a photo exists, but only via review
    /// (`replace-existing` caps at medium)", and CONTACTLOGO.md line 53 says the
    /// same.  On by default, a fresh install silently dropped every business card
    /// with a photo before matching, so no existing logo could be reviewed or
    /// replaced unless the user found this switch.  The medium cap is what keeps
    /// those cards from being auto-applied; the queue is where they belong.
    ///
    /// People are excluded regardless — `scanAndMatch` only matches business
    /// cards, so this cannot expose a person's photo to replacement.
    @Published public var skipContactsWithExistingPhoto: Bool = false { didSet { autosave() } }

    /// `suiteName` is the shell's concern (an App Group id when one is
    /// configured); nil uses `.standard`.
    public init(suiteName: String? = nil) {
        let store = suiteName.flatMap { UserDefaults(suiteName: $0) } ?? UserDefaults.standard
        defaults = store
        brandfetchClientID = store.string(forKey: Key.clientID) ?? ""
        skipContactsWithExistingPhoto = (store.object(forKey: Key.skipExistingPhoto) as? Bool) ?? false

        #if canImport(Security)
        if let stored = KeychainStore.read(account: Credential.brandfetchAPIKey, service: Credential.service) {
            brandfetchAPIKey = stored
        } else if let legacy = store.string(forKey: Key.apiKey), !legacy.isEmpty {
            // An install that predates the move still has the key sitting in
            // its preferences plist.  Carry it across and take it out of there
            // — leaving the plaintext behind would make the fix cosmetic.
            brandfetchAPIKey = legacy
            if KeychainStore.write(legacy, account: Credential.brandfetchAPIKey, service: Credential.service) {
                store.removeObject(forKey: Key.apiKey)
            } else {
                credentialStorageFailed = true
            }
        }
        #else
        brandfetchAPIKey = store.string(forKey: Key.apiKey) ?? ""
        #endif

        isLoading = false
    }

    /// Idempotent; shells that batch edits can call it once at the end.
    public func save() {
        defaults.set(brandfetchClientID, forKey: Key.clientID)
        defaults.set(skipContactsWithExistingPhoto, forKey: Key.skipExistingPhoto)
        #if canImport(Security)
        // Assigned only on a real change: `save()` runs from `didSet` on the
        // published properties, and republishing on every keystroke provokes
        // SwiftUI's "publishing changes from within view updates" warning.
        let stored = KeychainStore.write(
            brandfetchAPIKey.trimmingCharacters(in: .whitespacesAndNewlines),
            account: Credential.brandfetchAPIKey,
            service: Credential.service
        )
        if credentialStorageFailed != !stored { credentialStorageFailed = !stored }
        // Never `defaults.set(brandfetchAPIKey, …)` as a fallback: an
        // unwritable Keychain is a worse reason to put a credential in the
        // preferences plist than the one that put it there originally.
        defaults.removeObject(forKey: Key.apiKey)
        #else
        defaults.set(brandfetchAPIKey, forKey: Key.apiKey)
        #endif
    }

    /// Non-empty client id, or nil so the caller falls back to the environment.
    public var resolvedBrandfetchClientID: String? {
        let value = brandfetchClientID.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    public var resolvedBrandfetchAPIKey: String? {
        let value = brandfetchAPIKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func autosave() {
        guard !isLoading else { return }
        save()
    }
}
#endif
