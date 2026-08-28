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

    private let defaults: UserDefaults
    private var isLoading = true

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
        brandfetchAPIKey = store.string(forKey: Key.apiKey) ?? ""
        skipContactsWithExistingPhoto = (store.object(forKey: Key.skipExistingPhoto) as? Bool) ?? false
        isLoading = false
    }

    /// Idempotent; shells that batch edits can call it once at the end.
    public func save() {
        defaults.set(brandfetchClientID, forKey: Key.clientID)
        defaults.set(brandfetchAPIKey, forKey: Key.apiKey)
        defaults.set(skipContactsWithExistingPhoto, forKey: Key.skipExistingPhoto)
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
