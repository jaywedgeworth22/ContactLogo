import Foundation

/// Names for the PNGs `contactlogo match` writes into `.contactlogo/candidates/`.
///
/// Two properties matter here, and neither is obvious enough to leave to
/// reading — `CandidateFileNameTests` asserts both.
///
/// 1. **One path component, no traversal.** `match-results.json` is read back
///    off disk by a later `apply`, so the file name it carries is untrusted.
///    `apply` accepts a name only when `stem(name) == name`, which is why
///    `png(for:)` is built to satisfy that by construction.
///
/// 2. **Distinct contacts get distinct files.** The stem alone does not give
///    that: it folds every character outside `[A-Za-z0-9._-]` to `-` and cuts
///    at `maxLength`, so two identifiers differing only in punctuation — or
///    only past the limit — collapse onto one name. Both matches then write to
///    the same path while both stored results point at it, and `apply` hands
///    one contact's logo to another. That is the failure VISION.md's first
///    principle exists to prevent, so the name carries a digest of the full
///    identifier as well as its readable stem.
public enum CandidateFileName {

    /// Longest name `stem` returns, and the length `apply`'s guard assumes.
    public static let maxLength = 120

    /// `raw` reduced to a single safe path component — no separators, no
    /// traversal, no leading dot.
    public static func stem(_ raw: String) -> String {
        let allowed = raw.map { character -> Character in
            character.isLetter || character.isNumber || character == "-" || character == "_" || character == "." ? character : "-"
        }
        var cleaned = String(allowed)
        while cleaned.hasPrefix(".") { cleaned.removeFirst() }
        if cleaned.contains("..") { cleaned = cleaned.replacingOccurrences(of: "..", with: "-") }
        return cleaned.isEmpty ? "contact" : String(cleaned.prefix(maxLength))
    }

    /// FNV-1a over the identifier's UTF-8, as 16 hex digits.
    ///
    /// Deliberately not `hashValue`: Swift seeds that per process, and this
    /// name has to mean the same thing to the `apply` that runs after `match`
    /// has already exited.
    public static func digest(_ raw: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in raw.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return String(format: "%016llx", hash)
    }

    /// The PNG name for `contactID`.
    ///
    /// The digest suffix is 21 characters, so the readable head is cut to
    /// `maxLength - 21` and stripped of any trailing dot — otherwise the join
    /// would produce `..`, which `stem` rewrites, and the round-trip `apply`
    /// checks would fail and silently drop the logo.
    public static func png(for contactID: String) -> String {
        let suffix = ".\(digest(contactID)).png"
        var head = String(stem(contactID).prefix(maxLength - suffix.count))
        while head.hasSuffix(".") { head.removeLast() }
        if head.isEmpty { head = "contact" }
        return head + suffix
    }
}
