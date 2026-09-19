import XCTest
@testable import ContactLogoKit

/// Engine-contract coverage for `Sources/ContactLogoKit/Rank/CandidateRanker.swift`.
/// The ranker is pure and deterministic — same inputs always produce the same score,
/// order, and confidence — so we pin every clause of MATCHING-ENGINE §5 here.
final class CandidateRankerTests: XCTestCase {

    // MARK: - Fixture builder

    /// Build a candidate with only the fields a given test cares about.
    /// All other fields default to "no bonus" (non-square, non-pictographic,
    /// no alpha, no width, neutral source).
    private func candidate(_ source: SourceKind,
                           host: String? = nil,
                           square: Bool = false,
                           pictographic: Bool = false,
                           hasAlpha: Bool = false,
                           pixelWidth: Int? = nil,
                           pixelHeight: Int? = nil) -> LogoCandidate {
        let url = URL(string: "https://\(host ?? "example.com")/logo.png")!
        let (w, h): (Int?, Int?) = square
            // 256x256 keeps the >=256 bonus on; aspectRatio stays in the
            // squareish band (1.0 is the dead centre of 0.8...1.25).
            ? (pixelWidth ?? 256, pixelHeight ?? 256)
            : (pixelWidth, pixelHeight)
        return LogoCandidate(
            source: source,
            imageURL: url,
            pixelWidth: w,
            pixelHeight: h,
            assetType: pictographic ? "icon" : "logo",
            hasAlpha: hasAlpha ? true : nil
        )
    }

    // MARK: - score(_:)

    /// Square + pictographic + preferred + alpha + 512px → 100 + 40 + 48 + 12 + 5.
    func testScoreSquarePictographicPreferredAlpha512() {
        let c = candidate(.preferred, square: true, pictographic: true,
                          hasAlpha: true, pixelWidth: 512, pixelHeight: 512)
        XCTAssertEqual(CandidateRanker.score(c), 205)
    }

    /// Non-square + non-pictographic + .favicon → just the +8 source bonus.
    func testScoreNonSquareNonPictographicFavicon() {
        let c = candidate(.favicon, square: false, pictographic: false,
                          pixelWidth: 64, pixelHeight: 16)
        XCTAssertEqual(CandidateRanker.score(c), 8)
    }

    /// Aggregator host (`logodix.`) costs the candidate 12 points — even
    /// before source ordering. A bare .simpleIcons candidate scores 36;
    /// the same shape hosted on logodix. scores 24.
    func testScoreAggregatorHostPenalty() {
        let baseline = candidate(.simpleIcons)
        XCTAssertEqual(CandidateRanker.score(baseline), 36)

        let onLogodix = candidate(.simpleIcons, host: "logodix.com")
        XCTAssertEqual(CandidateRanker.score(onLogodix), 24,
                       "logodix. host must apply the -12 aggregator penalty")
    }

    /// pixelWidth >= 256 grants a +5 usability bonus; 255 does not.
    func testScoreHighResolutionBonus() {
        let at255 = candidate(.favicon, square: true, pictographic: true,
                              hasAlpha: true, pixelWidth: 255, pixelHeight: 255)
        let at256 = candidate(.favicon, square: true, pictographic: true,
                              hasAlpha: true, pixelWidth: 256, pixelHeight: 256)
        // favicon (8) + 100 + 40 + 12 = 160 at 255, 165 at 256.
        XCTAssertEqual(CandidateRanker.score(at255), 160)
        XCTAssertEqual(CandidateRanker.score(at256), 165)
        XCTAssertEqual(CandidateRanker.score(at256) - CandidateRanker.score(at255), 5)
    }

    /// `.manual` (+50) outranks `.preferred` (+48) on otherwise identical candidates
    /// — the user's own pick always wins a review tie.
    func testScoreManualBeatsPreferredOnTies() {
        let manual = candidate(.manual, square: true, pictographic: true,
                               hasAlpha: true, pixelWidth: 512, pixelHeight: 512)
        let preferred = candidate(.preferred, square: true, pictographic: true,
                                 hasAlpha: true, pixelWidth: 512, pixelHeight: 512)
        XCTAssertGreaterThan(CandidateRanker.score(manual), CandidateRanker.score(preferred))
    }

    // MARK: - rank(_:)

    /// `rank(_:)` caps output at `maxCandidates` (5) even when given more inputs.
    func testRankCapsAtMaxCandidates() {
        let eight = (0..<8).map { idx in
            candidate(.favicon, square: true, pictographic: true,
                      pixelWidth: 32 + idx, pixelHeight: 32 + idx)
        }
        XCTAssertEqual(CandidateRanker.rank(eight).count, CandidateRanker.maxCandidates)
        XCTAssertEqual(CandidateRanker.maxCandidates, 5)
    }

    /// On score ties the ranker preserves original index order — Google
    /// result order is itself a relevance signal and must not be reshuffled.
    func testRankIsStableOnScoreTies() {
        // All four candidates tie on score (same source, same square pixel
        // dimensions, no bonus factors). The imageURL path encodes the
        // original index so we can prove the sort did not reshuffle them.
        let fourTied: [LogoCandidate] = (0..<4).map { idx in
            LogoCandidate(
                source: .favicon,
                imageURL: URL(string: "https://example.com/logo-\(idx).png")!,
                pixelWidth: 64,
                pixelHeight: 64,
                assetType: "logo"
            )
        }
        let ranked = CandidateRanker.rank(fourTied)
        XCTAssertEqual(ranked.count, 4)
        let paths = ranked.map { $0.imageURL.lastPathComponent }
        XCTAssertEqual(paths, ["logo-0.png", "logo-1.png", "logo-2.png", "logo-3.png"],
                       "stable sort must keep original index order on score ties")
    }

    // MARK: - confidence(for:nameSimilarityPassed:homonymRisk:domainAgrees:)

    /// No winning candidate (or a similarity miss) is always `.skip`.
    func testConfidenceSkipWhenNoBest() {
        XCTAssertEqual(
            CandidateRanker.confidence(for: nil, nameSimilarityPassed: true,
                                       homonymRisk: false, domainAgrees: true),
            .skip)
        let ok = candidate(.preferred, square: true, pictographic: true)
        XCTAssertEqual(
            CandidateRanker.confidence(for: ok, nameSimilarityPassed: false,
                                       homonymRisk: false, domainAgrees: true),
            .skip)
    }

    /// Iconic source + square + pictographic = `.high`.
    func testConfidenceHighForIconicSquarePictographic() {
        let pref = candidate(.preferred, square: true, pictographic: true,
                             hasAlpha: true, pixelWidth: 512, pixelHeight: 512)
        XCTAssertEqual(
            CandidateRanker.confidence(for: pref, nameSimilarityPassed: true,
                                       homonymRisk: false, domainAgrees: true),
            .high)

        // Any entry in the iconic set behaves the same.
        let bf = candidate(.brandfetch, square: true, pictographic: true,
                           hasAlpha: true, pixelWidth: 512, pixelHeight: 512)
        XCTAssertEqual(
            CandidateRanker.confidence(for: bf, nameSimilarityPassed: true,
                                       homonymRisk: false, domainAgrees: true),
            .high)
    }

    /// A wide wordmark from an iconic source is still `.low` — the iconic
    /// set only grants `.high` when the asset is also square and pictographic.
    func testConfidenceLowForNonSquareNonPictographicEvenFromIconicSource() {
        // assetType defaults to "logo" → not pictographic; aspectRatio is wide.
        let wideWordmark = candidate(.preferred, square: false, pictographic: false,
                                     pixelWidth: 731, pixelHeight: 208)
        XCTAssertFalse(wideWordmark.isSquareish)
        XCTAssertFalse(wideWordmark.isPictographic)
        XCTAssertEqual(
            CandidateRanker.confidence(for: wideWordmark, nameSimilarityPassed: true,
                                       homonymRisk: false, domainAgrees: true),
            .low)
    }

    /// §4 homonym clause: when there is homonym risk and the domain does not
    /// agree, the tier is capped at `.medium` even if it would otherwise be `.high`.
    func testConfidenceHomonymCapsAtMedium() {
        let icon = candidate(.preferred, square: true, pictographic: true,
                             hasAlpha: true, pixelWidth: 512, pixelHeight: 512)
        // Domain agrees → no cap, still .high.
        XCTAssertEqual(
            CandidateRanker.confidence(for: icon, nameSimilarityPassed: true,
                                       homonymRisk: true, domainAgrees: true),
            .high)
        // Homonym risk + domain disagrees → capped to .medium.
        XCTAssertEqual(
            CandidateRanker.confidence(for: icon, nameSimilarityPassed: true,
                                       homonymRisk: true, domainAgrees: false),
            .medium)
        // A medium-tier candidate (square but not pictographic) cannot be
        // promoted by the homonym clause, so it stays .medium.
        let squareWordmark = candidate(.preferred, square: true, pictographic: false,
                                       pixelWidth: 256, pixelHeight: 256)
        XCTAssertEqual(
            CandidateRanker.confidence(for: squareWordmark, nameSimilarityPassed: true,
                                       homonymRisk: true, domainAgrees: false),
            .medium)
    }
}
