import Foundation

/// MATCHING-ENGINE §1 (non-brand) + §4 (generic nouns, devices, services);
/// ENGINE-CONTRACT R4.  A wrong logo is worse than none — these never reach a
/// logo source.  All three sets are keyed on `companyKey` (R4.2), so
/// "Apple Inc" gets the same homonym cap as "Apple".
public enum GenericBlocklist {

    /// R4.3 — exact keys that are never brands.
    static let genericExact: Set<String> = [
        "hospital", "gift card", "manager", "market manager", "medico", "jerry",
        "verification", "verification code", "verification codes", "candy",
        "link", "cash", "info", "office", "reception", "front desk",
        "support", "customer service", "voicemail", "suspected spam",
        "emergency", "spam risk", "nice", "meme"
    ]

    /// R4.4 — patterns that mark devices/services rather than brands.
    static let nonBrandPatterns: [String] = [
        #"(?i)\bprinter\b"#,                 // "Printer at Farm (WF-2950)"
        #"(?i)\bWF-\d{4}\b"#,                // printer model numbers
        #"(?i)\bverification\b"#,
        #"(?i)\bpassword\b|\bpasscode\b"#
    ]

    /// R4.5 — known brand, but wrong-category matches are common.
    /// Capped at MEDIUM unless contact-owned evidence agrees (R10.2).
    static let homonymRisk: Set<String> = [
        "ibc", "mercury", "delta", "apple", "amazon", "carnival", "empower",
        "link", "jerry", "candy", "pioneer", "united", "premier"
    ]

    /// R4.1 / R7.1 — GENERIC (keyed on `companyKey`) or a NON_BRAND pattern
    /// (matched against the cleaned name).
    public static func isNonBrand(_ name: String) -> Bool {
        let cleaned = NameNormalizer.clean(name)
        guard !cleaned.isEmpty else { return false }
        if nonBrandPatterns.contains(where: { cleaned.range(of: $0, options: .regularExpression) != nil }) {
            return true
        }
        return genericExact.contains(NameNormalizer.companyKey(cleaned))
    }

    /// Historical spelling of `isNonBrand`, kept for call sites and tests.
    public static func isGeneric(_ name: String) -> Bool { isNonBrand(name) }

    public static func isHomonymRisk(_ name: String) -> Bool {
        homonymRisk.contains(NameNormalizer.companyKey(name))
    }
}
