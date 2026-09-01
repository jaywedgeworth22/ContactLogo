import XCTest
@testable import ContactLogoKit

/// Issue #32: the overnight notification must not outrun a durable queue, and
/// a queue built against contacts that have since changed must not be shown.
final class ReviewQueueStoreTests: XCTestCase {

    private func makeDir() throws -> URL {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ContactLogoQueue-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func sampleCandidate(url: String = "https://cdn.simpleicons.org/fedex") -> LogoCandidate {
        LogoCandidate(source: .simpleIcons, imageURL: URL(string: url)!,
                      pixelWidth: 512, pixelHeight: 512, assetType: "icon",
                      altText: "FedEx", hasAlpha: true)
    }

    private func sampleResult(id: String = "ABC:ABPerson") -> MatchResult {
        MatchResult(contactID: id, contactClass: .businessCard,
                    candidates: [sampleCandidate()],
                    confidence: .high,
                    flags: ["replace-existing"],
                    sourceErrors: [
                        SourceFailure(source: .brandfetch, reason: "429", rateLimited: true)
                    ])
    }

    private func sampleQueue(token: Data?, results: [MatchResult]? = nil) -> PersistedReviewQueue {
        let rows = results ?? [sampleResult()]
        return PersistedReviewQueue(
            scannedAt: Date(timeIntervalSince1970: 1_788_278_400),
            contactStoreChangeToken: token,
            results: rows,
            selected: rows.filter { $0.confidence == .high }.map(\.contactID),
            chosenIndex: Dictionary(uniqueKeysWithValues: rows.map { ($0.contactID, 0) }),
            names: Dictionary(uniqueKeysWithValues: rows.map { ($0.contactID, "FedEx") })
        )
    }

    func testMatchResultRoundTripPreservesMembers() throws {
        let original = sampleResult()
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(MatchResult.self, from: data)
        XCTAssertEqual(decoded, original)
        XCTAssertEqual(decoded.contactClass, .businessCard)
        XCTAssertEqual(decoded.sourceErrors.first?.rateLimited, true)
        XCTAssertEqual(decoded.candidates.first?.source, .simpleIcons)
    }

    func testRetryableRowRoundTripsWithEmptyCandidates() throws {
        let original = MatchResult(contactID: "1", contactClass: .businessCard,
                                   candidates: [], confidence: .skip,
                                   flags: ["source-error"],
                                   sourceErrors: [
                                    SourceFailure(source: .wikimedia, reason: "500",
                                                  rateLimited: false)
                                   ])
        let decoded = try JSONDecoder().decode(MatchResult.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(decoded, original)
        XCTAssertTrue(decoded.isRetryable)
        XCTAssertEqual(decoded.contactClass.rawValue, "businessCard")
        XCTAssertEqual(Confidence.high.rawValue, 3)
    }

    func testContactClassAndConfidenceRawValues() {
        XCTAssertEqual(ContactClass.person.rawValue, "person")
        XCTAssertEqual(ContactClass.nonBrand.rawValue, "nonBrand")
        XCTAssertEqual(Confidence.skip.rawValue, 0)
        XCTAssertEqual(Confidence.low.rawValue, 1)
        XCTAssertEqual(Confidence.medium.rawValue, 2)
    }

    func testMatchingTokenLoadsTheQueue() throws {
        let dir = try makeDir()
        let store = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        try store.save(sampleQueue(token: Data("A".utf8)))
        let loaded = try store.loadFresh()
        XCTAssertEqual(loaded?.results.count, 1)
        XCTAssertEqual(loaded?.names["ABC:ABPerson"], "FedEx")
        XCTAssertEqual(loaded?.selected, ["ABC:ABPerson"])
        try? FileManager.default.removeItem(at: dir)
    }

    func testStaleChangeTokenDiscardsTheFile() throws {
        let dir = try makeDir()
        let writer = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        try writer.save(sampleQueue(token: Data("A".utf8)))
        XCTAssertTrue(FileManager.default.fileExists(atPath: writer.fileURL.path))

        let reader = ReviewQueueStore(directory: dir, currentChangeToken: { Data("B".utf8) })
        XCTAssertNil(try reader.loadFresh())
        XCTAssertFalse(FileManager.default.fileExists(atPath: writer.fileURL.path))
        try? FileManager.default.removeItem(at: dir)
    }

    func testNilVersusPresentTokenIsAMismatch() throws {
        let dir = try makeDir()
        let writer = ReviewQueueStore(directory: dir, currentChangeToken: { nil })
        try writer.save(sampleQueue(token: nil))
        let reader = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        XCTAssertNil(try reader.loadFresh())
        try? FileManager.default.removeItem(at: dir)
    }

    func testBothNilTokensLoadBecauseStalenessCannotBeProved() throws {
        let dir = try makeDir()
        let store = ReviewQueueStore(directory: dir, currentChangeToken: { nil })
        try store.save(sampleQueue(token: nil))
        XCTAssertNotNil(try store.loadFresh())
        try? FileManager.default.removeItem(at: dir)
    }

    func testUnknownSchemaIsDiscarded() throws {
        let dir = try makeDir()
        let store = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        var snapshot = sampleQueue(token: Data("A".utf8))
        snapshot.schemaVersion = 99
        // save() restamps schemaVersion to current, so write raw JSON instead.
        let data = try ReviewQueueStore.makeEncoder().encode(snapshot)
        try FileManager.default.createDirectory(at: store.fileURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try data.write(to: store.fileURL)
        XCTAssertNil(try store.loadFresh())
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
        try? FileManager.default.removeItem(at: dir)
    }

    func testEmbeddedPhotoBytesAreStrippedOnSave() throws {
        let dir = try makeDir()
        let store = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        var result = sampleResult()
        result.candidates.append(LogoCandidate(
            source: .manual,
            imageURL: URL(string: "data:image/png;base64,AAAA")!))
        try store.save(sampleQueue(token: Data("A".utf8), results: [result]))
        let loaded = try store.load()
        XCTAssertEqual(loaded?.results.first?.candidates.count, 1)
        XCTAssertEqual(loaded?.results.first?.candidates.first?.source, .simpleIcons)
        XCTAssertTrue(loaded?.results.first?.candidates.allSatisfy(\.isPersistableURL) == true)
        try? FileManager.default.removeItem(at: dir)
    }

    func testEmptyPayloadIsDiscarded() throws {
        let dir = try makeDir()
        let store = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        try store.save(sampleQueue(token: Data("A".utf8)))
        XCTAssertNotNil(try store.loadFresh())
        try store.save(sampleQueue(token: Data("A".utf8), results: []))
        XCTAssertNil(try store.loadFresh())
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
        try? FileManager.default.removeItem(at: dir)
    }
}

#if canImport(Combine)
@MainActor
final class ReviewSessionQueueRestoreTests: XCTestCase {

    private func makeDir() throws -> URL {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ContactLogoQueue-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func sampleResult() -> MatchResult {
        MatchResult(contactID: "ABC:ABPerson", contactClass: .businessCard,
                    candidates: [
                        LogoCandidate(source: .simpleIcons,
                                      imageURL: URL(string: "https://cdn.simpleicons.org/fedex")!,
                                      pixelWidth: 512, pixelHeight: 512, assetType: "icon")
                    ],
                    confidence: .high, flags: [],
                    sourceErrors: [
                        SourceFailure(source: .brandfetch, reason: "429", rateLimited: true)
                    ])
    }

    func testSessionRestoresNonEmptyFreshQueueIntoReview() throws {
        let dir = try makeDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        let first = ReviewSession(queueStore: store)
        first.results = [sampleResult()]
        first.names = ["ABC:ABPerson": "FedEx"]
        first.selected = ["ABC:ABPerson"]
        first.chosenIndex = ["ABC:ABPerson": 0]
        first.scanChangeToken = Data("A".utf8)
        XCTAssertTrue(first.persistReviewQueue())

        let second = ReviewSession(queueStore: store)
        XCTAssertEqual(second.stage, .review)
        XCTAssertEqual(second.results.count, 1)
        XCTAssertEqual(second.displayName(for: "ABC:ABPerson"), "FedEx")
        XCTAssertTrue(second.selected.contains("ABC:ABPerson"))
        XCTAssertEqual(second.results[0].sourceErrors.first?.source, .brandfetch)
    }

    func testSessionDiscardsStaleQueueAndStaysIdle() throws {
        let dir = try makeDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        let first = ReviewSession(queueStore: writer)
        first.results = [sampleResult()]
        first.scanChangeToken = Data("A".utf8)
        XCTAssertTrue(first.persistReviewQueue())

        let reader = ReviewQueueStore(directory: dir, currentChangeToken: { Data("B".utf8) })
        let second = ReviewSession(queueStore: reader)
        XCTAssertEqual(second.stage, .idle)
        XCTAssertTrue(second.results.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: writer.fileURL.path))
    }

    func testEmptyPersistClearsAPreviousQueue() throws {
        let dir = try makeDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = ReviewQueueStore(directory: dir, currentChangeToken: { Data("A".utf8) })
        let first = ReviewSession(queueStore: store)
        first.results = [sampleResult()]
        first.scanChangeToken = Data("A".utf8)
        XCTAssertTrue(first.persistReviewQueue())
        first.results = []
        XCTAssertTrue(first.persistReviewQueue())

        let second = ReviewSession(queueStore: store)
        XCTAssertEqual(second.stage, .idle)
        XCTAssertTrue(second.results.isEmpty)
    }

    func testPersistFailureIsReported() {
        let store = ReviewQueueStore(
            directory: URL(fileURLWithPath: "/dev/null/not-a-dir"),
            currentChangeToken: { Data("A".utf8) })
        let session = ReviewSession(queueStore: store)
        session.results = [sampleResult()]
        XCTAssertFalse(session.persistReviewQueue())
    }
}
#endif
