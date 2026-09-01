import Foundation

/// Undo log (WRITE POLICY §7): every apply batch first persists the contacts'
/// prior images (or "had none" markers), so any batch is one-tap restorable —
/// including after a relaunch, which is what `listBatchSummaries()` is for.
public struct UndoLog: Sendable {
    public let directory: URL

    public init(directory: URL? = nil) {
        if let directory {
            self.directory = directory
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            self.directory = base.appendingPathComponent("ContactLogo/Undo", isDirectory: true)
        }
    }

    /// One batch as the review UI sees it: newest first, ordered by the
    /// recorded timestamp rather than by the batch's random UUID.
    public struct BatchSummary: Sendable, Identifiable, Equatable {
        public let id: String
        public let createdAt: Date
        public let contactCount: Int

        public init(id: String, createdAt: Date, contactCount: Int) {
            self.id = id
            self.createdAt = createdAt
            self.contactCount = contactCount
        }
    }

    /// meta.json is written and read by us alone. Dates carry sub-second
    /// precision so batches recorded in the same second still sort.
    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { source in
            let container = try source.singleValueContainer()
            if let seconds = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: seconds)
            }
            // Batches written by earlier builds used an ISO-8601 string.
            let text = try container.decode(String.self)
            if let date = ISO8601DateFormatter().date(from: text) { return date }
            throw DecodingError.dataCorruptedError(in: container,
                                                   debugDescription: "unreadable batch timestamp")
        }
        return decoder
    }

    struct BatchMeta: Codable {
        struct Entry: Codable {
            let contactID: String
            let previousImageFile: String? // nil → previously no image
        }
        let createdAt: Date
        let entries: [Entry]
    }

    /// A file name is written by us and read back from disk, so both ends are
    /// validated: one path component, no separators, no traversal, no dot
    /// files.  Contact identifiers are never used as file names.
    static func safeComponent(_ raw: String) -> String? {
        guard !raw.isEmpty, raw.count <= 255, raw != ".", raw != ".." else { return nil }
        guard !raw.hasPrefix("."), !raw.contains("/"), !raw.contains("\\"), !raw.contains("\0"),
              !raw.contains("..") else { return nil }
        return raw
    }

    /// Call BEFORE applying. Returns the batch directory.
    @discardableResult
    public func recordBatch(_ entries: [ChangeSet.Entry]) throws -> URL {
        let batchID = UUID().uuidString
        let dir = directory.appendingPathComponent(batchID, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var meta: [BatchMeta.Entry] = []
        for (index, entry) in entries.enumerated() {
            var file: String? = nil
            if let previous = entry.previousImageData {
                let name = "previous-\(index).img"
                try previous.write(to: dir.appendingPathComponent(name))
                file = name
            }
            meta.append(.init(contactID: entry.contactID, previousImageFile: file))
        }
        try Self.makeEncoder().encode(BatchMeta(createdAt: Date(), entries: meta))
            .write(to: dir.appendingPathComponent("meta.json"))
        return dir
    }

    /// Chronologically ordered (newest first). A batch whose meta.json is
    /// missing or corrupt is skipped, not thrown.
    public func listBatchSummaries() throws -> [BatchSummary] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        let decoder = Self.makeDecoder()
        var out: [BatchSummary] = []
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        where url.hasDirectoryPath {
            guard let id = Self.safeComponent(url.lastPathComponent),
                  let data = try? Data(contentsOf: url.appendingPathComponent("meta.json")),
                  let meta = try? decoder.decode(BatchMeta.self, from: data) else { continue }
            out.append(BatchSummary(id: id, createdAt: meta.createdAt, contactCount: meta.entries.count))
        }
        // Stable: newest first, id as the tie-break so the order is total.
        return out.sorted { a, b in
            a.createdAt == b.createdAt ? a.id < b.id : a.createdAt > b.createdAt
        }
    }

    /// Batch directories, newest first.
    public func listBatches() throws -> [URL] {
        try listBatchSummaries().map { directory.appendingPathComponent($0.id, isDirectory: true) }
    }

    /// Deletes batches beyond the `keeping` most recent, and any batch older
    /// than `olderThan`. Called opportunistically after a successful apply so
    /// prior contact images do not accumulate in Application Support forever.
    public func prune(keeping: Int = 20, olderThan: Date? = nil) throws {
        let summaries = try listBatchSummaries()
        for (index, summary) in summaries.enumerated() {
            let tooMany = index >= max(0, keeping)
            let tooOld = olderThan.map { summary.createdAt < $0 } ?? false
            guard tooMany || tooOld else { continue }
            try? deleteBatch(summary.id)
        }
    }

    /// Permanently removes one batch directory.
    public func deleteBatch(_ batchID: String) throws {
        guard let id = Self.safeComponent(batchID) else { return }
        let dir = directory.appendingPathComponent(id, isDirectory: true)
        guard FileManager.default.fileExists(atPath: dir.path) else { return }
        try FileManager.default.removeItem(at: dir)
    }

    /// Restore a batch: puts previous images back (or removes applied ones).
    public func restore(batchID: String, using provider: any ContactsProvider) async throws {
        guard let id = Self.safeComponent(batchID) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let dir = directory.appendingPathComponent(id, isDirectory: true)
        let metaData = try Data(contentsOf: dir.appendingPathComponent("meta.json"))
        let meta = try Self.makeDecoder().decode(BatchMeta.self, from: metaData)
        for entry in meta.entries {
            if let file = entry.previousImageFile {
                // meta.json is on disk, so its file names are untrusted input.
                guard let name = Self.safeComponent(file) else { continue }
                let data = try Data(contentsOf: dir.appendingPathComponent(name))
                try await provider.setImage(data, forContactID: entry.contactID)
            } else {
                try await provider.removeImage(forContactID: entry.contactID)
            }
        }
    }
}
