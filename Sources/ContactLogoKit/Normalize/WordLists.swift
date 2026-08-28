import Foundation

/// ENGINE-CONTRACT R6.6 / R8.3 word lists.  These decide which half of a
/// "head - tail" display name is the brand, so they are shared verbatim by
/// every engine — a word added here must be added to the TypeScript and Kotlin
/// ports too.
public enum WordLists {

    /// Trade words that mark a segment as an organization ("… - Root Insurance").
    public static let orgSignal: Set<String> = [
        "insurance", "agency", "realty", "realtors", "roofing", "plumbing",
        "electric", "electrical", "hvac", "tire", "tires", "auto", "motors",
        "bank", "credit", "union", "dental", "dentistry", "orthodontics",
        "medical", "clinic", "pharmacy", "law", "legal", "attorney",
        "accounting", "cpa", "construction", "contracting", "landscaping",
        "sprinkler", "irrigation", "cleaning", "janitorial", "salon", "barber",
        "bakery", "cafe", "restaurant", "grill", "pizza", "mortgage", "lending",
        "title", "escrow", "storage", "moving", "towing", "glass", "paint",
        "painting", "flooring", "pest", "exterminating", "veterinary", "vet",
        "daycare", "academy", "church", "studio", "fitness", "gym", "supply",
        "wholesale", "distributors", "logistics", "transport", "energy",
        "propane", "security", "alarm", "telecom", "wireless", "media",
        "marketing", "consulting", "partners", "associates", "enterprises",
        "industries", "systems", "technologies", "labs", "works"
    ]

    /// Job titles and contact-method junk ("… - Asst Treasurer").
    public static let roleWords: Set<String> = [
        "manager", "mgr", "gm", "asst", "assistant", "treasurer", "president",
        "vp", "director", "owner", "coordinator", "secretary", "chair",
        "chairman", "board", "rep", "representative", "agent", "sales",
        "support", "service", "services", "office", "cell", "mobile", "home",
        "work", "fax", "main", "desk", "billing", "hr", "admin", "dispatch",
        "scheduler", "emergency", "voicemail", "reception", "ext",
        "front desk", "on call", "after hours", "customer service"
    ]

    /// Street / store / place words ("… - Mason Rd", "Apple - Australia").
    public static let geoWords: Set<String> = [
        "rd", "road", "st", "street", "blvd", "ave", "avenue", "dr", "drive",
        "ln", "lane", "hwy", "fwy", "pkwy", "suite", "ste", "unit", "store",
        "shop", "plaza", "center", "centre", "mall", "near", "at", "in",
        "cypress", "houston", "dallas", "austin", "katy", "spring", "tomball",
        "tx", "texas", "usa", "us", "australia", "canada", "mexico", "uk",
        "north", "south", "east", "west", "downtown", "midtown", "uptown"
    ]

    /// Sub-brand tails a catalog brand may carry ("H-E-B Pharmacy").
    public static let subbrandTail: Set<String> = [
        "pharmacy", "deli", "bakery", "fuel", "gas", "market", "marketplace",
        "optical", "photo", "curbside", "drive thru", "corporate", "hq",
        "distribution", "warehouse"
    ]

    /// Lowercased alphanumeric tokens, in order.
    public static func tokens(_ text: String) -> [String] {
        text.lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .filter { !$0.isEmpty }
    }

    /// Whole-word (or whole-phrase) match of any entry in `set`.
    public static func matches(_ text: String, _ set: Set<String>) -> Bool {
        let toks = tokens(text)
        guard !toks.isEmpty else { return false }
        let single = Set(toks)
        for entry in set {
            if entry.contains(" ") {
                let parts = entry.split(separator: " ").map(String.init)
                if containsRun(toks, parts) { return true }
            } else if single.contains(entry) {
                return true
            }
        }
        return false
    }

    /// R6.6 `GEO_WORDS`, including the `#\d*` and `\d{2,5}` store-number forms.
    public static func isPlace(_ text: String) -> Bool {
        if matches(text, geoWords) { return true }
        if text.contains("#") { return true }
        for token in tokens(text) where token.count >= 2 && token.count <= 5 {
            if token.allSatisfy({ $0.isNumber }) { return true }
        }
        return false
    }

    /// R6.3 / R6.4 — the segment is decoration, not a brand.
    public static func isRoleOrPlace(_ text: String) -> Bool {
        matches(text, roleWords) || isPlace(text)
    }

    /// R8.3 `CATALOG_TAIL_OK` = GEO_WORDS ∪ SUBBRAND_TAIL, as single words.
    /// `subbrandTail` carries one phrase ("drive thru"); both of its words are
    /// tail-ok on their own, so the word set splits it.
    static let catalogTailWords: Set<String> = {
        var out = geoWords
        for entry in subbrandTail {
            for word in entry.split(separator: " ").map(String.init) { out.insert(word) }
        }
        return out
    }()

    static func isTailOkWord(_ word: String) -> Bool {
        if catalogTailWords.contains(word) { return true }
        // A store number.  `tokens` has already dropped the "#", so the digits
        // are all that is left of "#1234"; a bare "#" is handled by the caller.
        if word.count >= 2, word.count <= 5, word.allSatisfy({ $0.isNumber }) { return true }
        return false
    }

    /// R8.3 — may this tail be dropped, leaving the head brand?
    ///
    /// Two conditions, and both are needed.  Requiring only that *some* word be
    /// tail-ok reduced "Delta Dental Center" to delta.com on the strength of
    /// `center` alone — an airline's logo on a dental practice.  Requiring that
    /// *every* word be tail-ok instead rejected "Walgreens Mason Rd", because a
    /// street name is not on any list and never can be.
    ///
    /// So: something must positively mark the tail as a place or department, and
    /// nothing in it may name a different trade.  An unrecognised word ("mason")
    /// is tolerated as part of an address; an `orgSignal` word ("dental") is not,
    /// since it makes the tail a business of its own.  `subbrandTail` wins where
    /// the two lists overlap — "pharmacy" and "bakery" are H-E-B departments.
    public static func isCatalogTailOK(_ tail: String) -> Bool {
        let words = tokens(tail)
        guard !words.isEmpty else { return false }
        let marked = tail.contains(where: { $0 == "#" }) || words.contains(where: isTailOkWord)
        guard marked else { return false }
        return words.allSatisfy { isTailOkWord($0) || !orgSignal.contains($0) }
    }

    private static func containsRun(_ haystack: [String], _ run: [String]) -> Bool {
        guard !run.isEmpty, haystack.count >= run.count else { return false }
        for start in 0...(haystack.count - run.count) {
            var ok = true
            for offset in 0..<run.count {
                if haystack[start + offset] != run[offset] {
                    ok = false
                    break
                }
            }
            if ok { return true }
        }
        return false
    }
}
