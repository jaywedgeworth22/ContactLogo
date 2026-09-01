import Foundation
#if canImport(Contacts)
import Contacts
#endif

/// On-disk snapshot of a completed match run (issue #32).
///
/// Written to Application Support so an iOS `BGProcessingTask` can persist
/// the review queue *before* it posts "your queue is ready" and before the
/// process is killed.  Candidate URLs only — photo bytes are stripped on
/// write.  Display names travel with the contact identifiers so the review
/// UI can re-open without a second Contacts pass.
public struct PersistedReviewQueue: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1

    public var schemaVersion: Int
    public var scannedAt: Date
    /// `CNContactStore.currentHistoryToken` at the moment contacts were
    /// enumerated.  A mismatch on load means the address book has changed
    /// and this queue must not be shown.
    public var contactStoreChangeToken: Data?
    public var results: [MatchResult]
    public var selected: [String]
    public var chosenIndex: [String: Int]
    public var names: [String: String]

    public init(schemaVersion: Int = PersistedReviewQueue.currentSchemaVersion,
                scannedAt: Date,
                contactStoreChangeToken: Data?,
                results: [MatchResult],
                selected: [String],
                chosenIndex: [String: Int],
                names: [String: String]) {
        self.schemaVersion = schemaVersion
        self.scannedAt = scannedAt
        self.contactStoreChangeToken = contactStoreChangeToken
        self.results = results
        self.selected = selected
        self.chosenIndex = chosenIndex
        self.names = names
    }
}

/// JSON file in Application Support.  `loadFresh()` is the production read:
/// a stale, empty, or unknown-schema payload is deleted rather than shown.
public struct ReviewQueueStore: Sendable {
    public let fileURL: URL
    private let tokenProvider: @Sendable () -> Data?

    public init(directory: URL? = nil,
                currentChangeToken: @escaping @Sendable () -> Data? = ReviewQueueStore.liveChangeToken) {
        let dir: URL
        if let directory {
            dir = directory
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            dir = base.appendingPathComponent("ContactLogo", isDirectory: true)
        }
        self.fileURL = dir.appendingPathComponent("review-queue.json")
        self.tokenProvider = currentChangeToken
    }

    public func currentChangeToken() -> Data? { tokenProvider() }

    /// Live Contacts.framework token.  Nil when the framework is absent or
    /// the store has no history yet — `loadFresh` then treats two nils as a
    /// match (cannot prove staleness) and a nil/non-nil pair as a mismatch.
    public static func liveChangeToken() -> Data? {
        #if canImport(Contacts)
        CNContactStore().currentHistoryToken
        #else
        nil
        #endif
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    static func tokensMatch(stored: Data?, current: Data?) -> Bool {
        switch (stored, current) {
        case (nil, nil): return true
        case let (stored?, current?): return stored == current
        default: return false
        }
    }

    /// Atomic replace.  Embedded photo bytes are stripped before encoding.
    public func save(_ snapshot: PersistedReviewQueue) throws {
        var snapshot = snapshot
        snapshot.schemaVersion = PersistedReviewQueue.currentSchemaVersion
        snapshot.results = snapshot.results.map { $0.withoutEmbeddedImageBytes() }
        let dir = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try Self.makeEncoder().encode(snapshot)
        try data.write(to: fileURL, options: .atomic)
    }

    /// Raw decode, including a payload `loadFresh` would discard.  Nil if the
    /// file is missing.
    public func load() throws -> PersistedReviewQueue? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let data = try Data(contentsOf: fileURL)
        return try Self.makeDecoder().decode(PersistedReviewQueue.self, from: data)
    }

    /// Production read: returns a non-empty, current-schema snapshot whose
    /// change token still matches.  Anything else is deleted.
    public func loadFresh() throws -> PersistedReviewQueue? {
        guard let snapshot = try load() else { return nil }
        let usable = snapshot.schemaVersion == PersistedReviewQueue.currentSchemaVersion
            && !snapshot.results.isEmpty
            && Self.tokensMatch(stored: snapshot.contactStoreChangeToken,
                                current: currentChangeToken())
        if usable { return snapshot }
        try clear()
        return nil
    }

    public func clear() throws {
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
    }
}
