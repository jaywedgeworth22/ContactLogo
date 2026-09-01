import Foundation

/// MATCHING-ENGINE §2 / ENGINE-CONTRACT R5–R6: turn a raw display name into a
/// search-safe brand query, and decide which half of a "head - tail" name is
/// the brand.
public enum NameNormalizer {

    /// Legal suffixes stripped before catalog lookup ("Apple Inc" → "Apple").
    ///
    /// The leading `[\s,]+` is load-bearing (ENGINE-CONTRACT R5.2): without a
    /// real separator the `co` alternative matches the tail of a word and
    /// `Costco` becomes `cost`, `Cisco` `cis`, `Medico` `medi`.
    static let legalSuffix = try! NSRegularExpression(
        pattern: #"[\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|plc|holdings|group|p\.c|llp)\.?\s*$"#,
        options: .caseInsensitive
    )

    /// R5.1 — "Walgreens (Mason Rd / Cypress)" → "Walgreens"
    public static func clean(_ raw: String) -> String {
        var s = raw
        // Drop store locations in (), [], {}
        s = s.replacingOccurrences(of: #"\s*[\(\[\{][^)\]\}]*[\)\]\}]"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: " -–—,"))
        return s
    }

    /// R5.2 — catalog/blocklist key: cleaned, legal-suffix-stripped, lowercased.
    public static func companyKey(_ raw: String) -> String {
        var s = clean(raw)
        let range = NSRange(s.startIndex..., in: s)
        s = legalSuffix.stringByReplacingMatches(in: s, options: [], range: range, withTemplate: "")
        s = s.replacingOccurrences(of: ".", with: "")
        s = s.replacingOccurrences(of: ",", with: "")
        s = s.replacingOccurrences(of: "'", with: "")
        s = s.replacingOccurrences(of: "’", with: "")
        s = s.replacingOccurrences(of: "\"", with: "")
        // "H & R Block" and "H&R Block" must produce the same key.
        s = s.replacingOccurrences(of: #"\s*&\s*"#, with: "&", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return s.lowercased().trimmingCharacters(in: .whitespaces)
    }

    /// R5.3 — the `{slug}.com` guess slug, or nil when it is not brand-shaped.
    public static func guessSlug(_ raw: String) -> String? {
        let key = companyKey(raw)
            .replacingOccurrences(of: "&", with: "and")
            .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "", options: .regularExpression)
        guard (3...24).contains(key.count) else { return nil }
        return key
    }

    /// The outcome of R6 segment selection.
    public struct Segment: Sendable, Equatable {
        public let query: String
        /// R6.2 fired — the tail is the brand (MATCHING-ENGINE §5 rule 8).
        public let isBrandTail: Bool
        /// R6.3 or R6.4 fired — one half was role/place decoration.
        public let decorationStripped: Bool

        public init(query: String, isBrandTail: Bool = false, decorationStripped: Bool = false) {
            self.query = query
            self.isBrandTail = isBrandTail
            self.decorationStripped = decorationStripped
        }
    }

    /// R6 — pick the brand half of a cleaned name. First match wins:
    /// brand tail → tail decoration → head decoration → whole name.
    public static func segment(_ name: String) -> Segment {
        let cleaned = clean(name)
        guard let parts = splitSegments(cleaned) else { return Segment(query: cleaned) }
        let head = parts.head, tail = parts.tail

        if isKnownBrandTail(tail) {
            return Segment(query: clean(tail), isBrandTail: true)
        }
        if WordLists.isRoleOrPlace(tail) || CompanyCatalog.domain(forName: head) != nil {
            return Segment(query: clean(head), decorationStripped: true)
        }
        if WordLists.isRoleOrPlace(head) || GenericBlocklist.isNonBrand(head) {
            return Segment(query: clean(tail), decorationStripped: true)
        }
        return Segment(query: cleaned)
    }

    /// The head of an R6.1 split, or nil when the name does not split.  Exposed so
    /// a card with no name fields can still be read as a person.
    public static func splitHead(_ name: String) -> String? {
        splitSegments(clean(name))?.head
    }

    /// MATCHING-ENGINE §1, applied to a card with no name fields: does the head of
    /// a "head - tail" split read as a person's name?
    ///
    /// Name-field classification alone leaves a hole — a vCard carrying only `FN`
    /// and no `N` parses with no givenName, so "Dana At Costco" would be a
    /// business and wear Costco's mark, which is the outcome the owner ruled out.
    ///
    /// Defined by exclusion, because there is no name dictionary here and the safe
    /// default for this shape is "person": a head is personal unless a word in it
    /// is one already known to mean business, department, role, place or brand.
    ///
    ///     Dana / Chris / Byron Goode Jr   personal
    ///     Pharmacy / Optical              orgSignal and subbrandTail departments
    ///     Front Office                    roleWords
    ///     Katy Auto                       "katy" is a geoWord
    public static func headLooksPersonal(_ head: String) -> Bool {
        let cleaned = clean(head)
        guard !cleaned.isEmpty else { return false }
        let parts = cleaned.replacingOccurrences(of: ",", with: " ")
            .split(whereSeparator: { $0 == " " || $0 == "\t" })
            .map(String.init)
        guard !parts.isEmpty, parts.count <= 4 else { return false }
        for part in parts {
            guard let first = part.first, first.isLetter else { return false }
            guard part.count <= 31 else { return false }
            guard part.allSatisfy({ $0.isLetter || $0 == "'" || $0 == "." || $0 == "-" }) else { return false }
        }
        if GenericBlocklist.isNonBrand(cleaned) || WordLists.isRoleOrPlace(cleaned) { return false }
        if CompanyCatalog.domain(forName: cleaned) != nil { return false }
        for part in parts {
            let lower = part.lowercased()
            if WordLists.orgSignal.contains(lower) { return false }
            if WordLists.isTailOkWord(lower) { return false }
        }
        return true
    }

    /// R6.2 — "Byron Goode Jr - Root Insurance" → "Root Insurance",
    /// "Chris At NTB" → "NTB" (MATCHING-ENGINE §5 rule 8).
    /// Returns nil when there is no tail that is recognizably a brand.
    public static func brandTail(_ raw: String) -> String? {
        let s = segment(raw)
        return s.isBrandTail ? s.query : nil
    }

    /// R6.2 — is this tail recognizably a brand rather than a role or a place?
    public static func isKnownBrandTail(_ tail: String) -> Bool {
        let t = clean(tail)
        guard !t.isEmpty, !GenericBlocklist.isNonBrand(t) else { return false }
        if CompanyCatalog.domain(forName: t) != nil { return true }
        if WordLists.matches(t, WordLists.orgSignal) { return true }
        // An all-caps acronym as written: NTB, HEB, IBC.
        if !t.contains(" "), t.range(of: #"^[A-Z&]{2,5}$"#, options: .regularExpression) != nil { return true }
        return false
    }

    /// R6.1 — split on the first dash or " at " separator, with the word-count
    /// guards.  Returns nil when there is no usable split.
    static func splitSegments(_ cleaned: String) -> (head: String, tail: String)? {
        let head: String, tail: String
        if let dash = cleaned.range(of: #"\s+[-–—]\s+"#, options: .regularExpression) {
            head = String(cleaned[cleaned.startIndex..<dash.lowerBound]).trimmingCharacters(in: .whitespaces)
            tail = String(cleaned[dash.upperBound...]).trimmingCharacters(in: .whitespaces)
            guard tail.range(of: #"\s+[-–—]\s+"#, options: .regularExpression) == nil else { return nil }
        } else if let at = cleaned.range(of: #"\s+[Aa]t\s+"#, options: .regularExpression) {
            head = String(cleaned[cleaned.startIndex..<at.lowerBound]).trimmingCharacters(in: .whitespaces)
            tail = String(cleaned[at.upperBound...]).trimmingCharacters(in: .whitespaces)
        } else {
            return nil
        }
        let headWords = head.split(separator: " ").count
        guard (1...4).contains(headWords), tail.split(separator: " ").count <= 5, !tail.isEmpty else { return nil }
        return (head, tail)
    }

    /// R9.1 similarity gate: normalized brand must share a token with the query.
    public static func passesSimilarity(query: String, brandName: String) -> Bool {
        func norm(_ s: String) -> String {
            s.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).joined()
        }
        let q = norm(query), b = norm(brandName)
        if !q.isEmpty, !b.isEmpty, q.contains(b) || b.contains(q) { return true }
        let qw = Set(query.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty })
        let bw = Set(brandName.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty })
        return !qw.isDisjoint(with: bw)
    }
}
