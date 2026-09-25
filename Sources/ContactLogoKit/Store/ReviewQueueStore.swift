import Foundation
#if canImport(Contacts)
import Contacts
#endif

/// One dropped contact from the last scan, with the reason the engine skipped
/// it.  Top-level (not nested in `ReviewSession`) so the persisted snapshot can
/// carry it on platforms without Combine; `ReviewSession.SampleDroppedContact`
/// is a typealias for this type.  `contactID` is the CNContact identifier and
/// doubles as the SwiftUI `ForEach` ID, so duplicate "John Smith / no org"
/// rows stay distinct.
public struct DroppedContactSample: Codable, Sendable, Equatable, Hashable, Identifiable {
    public let contactID: String
    public let displayName: String
    public let reason: String
    public let givenName: String?
    public let familyName: String?
    public let organization: String?
    public var id: String { contactID }
    public init(contactID: String, displayName: String, reason: String, givenName: String?, familyName: String?, organization: String?) {
        self.contactID = contactID
        self.displayName = displayName
        self.reason = reason
        self.givenName = givenName
        self.familyName = familyName
        self.organization = organization
    }
}

/// On-disk snapshot of a completed match run (issue #32).
///
/// Written to Application Support so an iOS `BGProcessingTask` can persist
/// the review queue *before* it posts "your queue is ready" and before the
/// process is killed.  Candidate URLs only — photo bytes are stripped on
/// write.  Display names travel with the contact identifiers so the review
/// UI can re-open without a second Contacts pass.
public struct PersistedReviewQueue: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 2

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
    public var totalScannedCount: Int?
    public var protectedPersonCount: Int?
    public var businessTargetsCount: Int?
    public var affiliatedTargetsCount: Int?
    /// 2026-09-20 audit — preserve the `.limited` Contacts authorization
    /// status across app restarts so the banner that explains the small
    /// restored queue is shown, not hidden, when the user re-launches.
    public var limitedAccessGranted: Bool?
    /// PR #102 review — the Diagnostic screen's dropped-contact sample.
    /// Persisted so a queue restored after the process dies (the normal
    /// background-scan flow) still explains what was skipped.  Optional so
    /// older payloads decode cleanly.
    public var sampleDroppedContacts: [DroppedContactSample]?

    public init(schemaVersion: Int = PersistedReviewQueue.currentSchemaVersion,
                scannedAt: Date,
                contactStoreChangeToken: Data?,
                results: [MatchResult],
                selected: [String],
                chosenIndex: [String: Int],
                names: [String: String],
                totalScannedCount: Int? = nil,
                protectedPersonCount: Int? = nil,
                businessTargetsCount: Int? = nil,
                affiliatedTargetsCount: Int? = nil,
                limitedAccessGranted: Bool? = nil,
                sampleDroppedContacts: [DroppedContactSample]? = nil) {
        self.schemaVersion = schemaVersion
        self.scannedAt = scannedAt
        self.contactStoreChangeToken = contactStoreChangeToken
        self.results = results
        self.selected = selected
        self.chosenIndex = chosenIndex
        self.names = names
        self.totalScannedCount = totalScannedCount
        self.protectedPersonCount = protectedPersonCount
        self.businessTargetsCount = businessTargetsCount
        self.affiliatedTargetsCount = affiliatedTargetsCount
        self.limitedAccessGranted = limitedAccessGranted
        self.sampleDroppedContacts = sampleDroppedContacts
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

    /// Production read: returns a non-empty snapshot whose change token
    /// still matches.  2026-09-20 audit: a schema-version bump alone does
    /// not discard the snapshot — older payloads decode cleanly because
    /// new fields are optional.  Only an undecodable file or a stale
    /// change token clears the queue; the previous "schema mismatch
    /// deletes everything" policy was silently dropping user review work
    /// across a routine persistence bump.
    public func loadFresh() throws -> PersistedReviewQueue? {
        guard let snapshot = try load() else { return nil }
        let usable = !snapshot.results.isEmpty
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
