import Foundation

/// MATCHING-ENGINE §5: score and order candidates; produce the top-N list
/// the review UI offers (never just a single winner).
public enum CandidateRanker {

    public static let maxCandidates = 5

    /// Higher is better. Deterministic — same inputs, same order, every time.
    public static func score(_ c: LogoCandidate) -> Int {
        var s = 0
        // §5.1 square first (dominant term)
        if c.isSquareish { s += 100 }
        // §5.2 pictographic/icon beats wordmark
        if c.isPictographic { s += 40 }
        // §5.4 official-source bonus
        switch c.source {
        case .preferred: s += 48
        case .contactLogoCache: s += 44
        case .simpleIcons: s += 36
        case .companiesLogo: s += 32
        case .brandfetch: s += 20
        case .wikimedia: s += 18
        case .googleCSE: s += 10
        case .favicon: s += 8
        case .googleScrape: s += 6
        case .manual: s += 50 // user's own pick always wins review ties
        }
        if c.hasAlpha == true { s += 12 }
        if let host = c.imageURL.host?.lowercased() {
            let aggregators = ["logodix.", "seeklogo.", "logos-world.", "1000logos.", "stickpng."]
            if aggregators.contains(where: { host.contains($0) }) { s -= 12 }
        }
        // mild preference for usable resolution
        if let w = c.pixelWidth, w >= 256 { s += 5 }
        return s
    }

    /// Stable sort: score desc, then original order (Google result order is
    /// itself a relevance signal — preserve it on ties).
    public static func rank(_ candidates: [LogoCandidate]) -> [LogoCandidate] {
        Array(candidates
            .enumerated()
            .sorted { a, b in
                let sa = score(a.element), sb = score(b.element)
                return sa == sb ? a.offset < b.offset : sa > sb
            }
            .prefix(maxCandidates)
            .map(\.element))
    }

    /// Confidence tier from the winning candidate + context flags.
    public static func confidence(for best: LogoCandidate?,
                                  nameSimilarityPassed: Bool,
                                  homonymRisk: Bool,
                                  domainAgrees: Bool) -> Confidence {
        guard let best, nameSimilarityPassed else { return .skip }
        var tier: Confidence
        let iconic: Set<SourceKind> = [.brandfetch, .wikimedia, .manual, .preferred, .simpleIcons, .companiesLogo, .contactLogoCache]
        if best.isSquareish, best.isPictographic, iconic.contains(best.source) {
            tier = .high
        } else if best.isSquareish {
            tier = .medium
        } else {
            tier = .low
        }
        if homonymRisk, !domainAgrees { tier = min(tier, .medium) } // §4 homonyms
        return tier
    }
}
