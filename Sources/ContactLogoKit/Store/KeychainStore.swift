#if canImport(Security)
import Foundation
import Security

/// A generic-password item, for the one value in this app that is a credential.
///
/// The Brandfetch **API key** used to be written to `UserDefaults` alongside
/// the client id.  `SecureField` obscures the glyphs on screen and does nothing
/// whatever to the value it binds: the key landed in the app's preferences
/// plist, readable by anything running as the user and carried into device
/// backups.  The client id is not a secret and stays in `UserDefaults`.
///
/// Deliberately not using `kSecUseDataProtectionKeychain`: on macOS that
/// requires a keychain-access-group entitlement, so an unsigned local build —
/// which is how this app is run during development — would fail every write
/// with `errSecMissingEntitlement` and the setting would appear not to save.
enum KeychainStore {

    private static func baseQuery(account: String, service: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func read(account: String, service: String) -> String? {
        var query = baseQuery(account: account, service: service)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty
        else { return nil }
        return value
    }

    /// `false` when the value could not be stored — the caller must not fall
    /// back to `UserDefaults`, which is the exposure this type exists to close.
    @discardableResult
    static func write(_ value: String, account: String, service: String) -> Bool {
        guard !value.isEmpty else { return delete(account: account, service: service) }

        let query = baseQuery(account: account, service: service)
        var attributes: [String: Any] = [kSecValueData as String: Data(value.utf8)]
        #if os(iOS)
        // Available once the device has been unlocked after boot, and never
        // copied to another device by a backup.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #endif

        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { return true }
        guard updated == errSecItemNotFound else { return false }

        var insert = query
        insert.merge(attributes) { current, _ in current }
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    static func delete(account: String, service: String) -> Bool {
        let status = SecItemDelete(baseQuery(account: account, service: service) as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
#endif
