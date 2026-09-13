import XCTest
@testable import ContactLogoKit

final class ContactLogoCacheSourceTests: XCTestCase {
    func testUrlGeneration() {
        let defaultURL = ContactLogoCacheSource.url(for: "apple.com")
        XCTAssertEqual(defaultURL?.absoluteString, "https://contactlogo.com/api/logo/apple.com")

        let customBase = URL(string: "http://localhost:3000/api/logo")!
        let customURL = ContactLogoCacheSource.url(for: "Google.COM  ", baseURL: customBase)
        XCTAssertEqual(customURL?.absoluteString, "http://localhost:3000/api/logo/google.com")

        XCTAssertNil(ContactLogoCacheSource.url(for: "   "))
    }

    func testCandidatesForDomain() async throws {
        let source = ContactLogoCacheSource()
        let candidates = try await source.candidates(forDomain: "fedex.com")
        XCTAssertEqual(candidates.count, 1)
        let candidate = candidates[0]
        XCTAssertEqual(candidate.source, .contactLogoCache)
        XCTAssertEqual(candidate.imageURL.absoluteString, "https://contactlogo.com/api/logo/fedex.com")
        XCTAssertEqual(candidate.assetType, "icon")
        XCTAssertEqual(candidate.altText, "fedex.com")
    }

    func testCandidatesForBrandNameResolvesCatalog() async throws {
        let source = ContactLogoCacheSource()
        let candidates = try await source.candidates(forBrandName: "Apple")
        XCTAssertEqual(candidates.count, 1)
        XCTAssertEqual(candidates[0].imageURL.absoluteString, "https://contactlogo.com/api/logo/apple.com")

        let unknown = try await source.candidates(forBrandName: "Some Unknown Company XYZ 12345")
        XCTAssertTrue(unknown.isEmpty)
    }

    func testCandidateRankerScoringAndConfidence() {
        let candidate = LogoCandidate(
            source: .contactLogoCache,
            imageURL: URL(string: "https://contactlogo.com/api/logo/apple.com")!,
            pixelWidth: 512,
            pixelHeight: 512,
            assetType: "icon",
            hasAlpha: true
        )

        let score = CandidateRanker.score(candidate)
        // 100 (squareish) + 40 (pictographic) + 44 (contactLogoCache) + 12 (hasAlpha) + 5 (>=256px) = 201
        XCTAssertEqual(score, 201)

        let conf = CandidateRanker.confidence(
            for: candidate,
            nameSimilarityPassed: true,
            homonymRisk: false,
            domainAgrees: true
        )
        XCTAssertEqual(conf, .high)
    }
}
