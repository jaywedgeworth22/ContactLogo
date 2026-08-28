#if canImport(Combine)
import Combine
import Foundation

/// A user-facing failure from an apply or undo operation. Kept small and
/// enum-shaped so shells can switch over it for copy without string-matching.
public enum ReviewSessionError: Error, Equatable, Sendable {
    /// One or more contacts failed to write; the batch that *did* succeed
    /// (if any) is still recorded and undoable via `lastBatchID`.
    case applyFailed(succeeded: Int, failed: Int, underlying: String)
    /// Nothing was selected, or every selected row had no usable image.
    case nothingToApply
    /// `undoLast()` was called but the batch could not be restored.
    /// `lastBatchID` is left set so the shell can offer Retry.
    case undoFailed(batchID: String, underlying: String)
    /// `undoLast()` was called with no recorded batch.
    case noBatchToUndo
}

/// Shared scan → match → review → apply session for macOS and iOS.
/// High-confidence rows start selected; guessed domains never do.
@MainActor
public final class ReviewSession: ObservableObject {
    public enum Stage: Equatable { case idle, scanning, matching(done: Int, total: Int), review, applying }
    public enum Bucket { case auto, review, notFound }

    @Published public var stage: Stage = .idle
    @Published public var bucket: Bucket = .auto
    @Published public var results: [MatchResult] = []
    @Published public var selected: Set<String> = []
    @Published public var chosenIndex: [String: Int] = [:]
    @Published public var names: [String: String] = [:]
    /// The most recent undoable batch. Derived from `undoHistory`; the kit
    /// keeps it in sync, shells only read it.
    @Published public var lastBatchID: String?
    /// Non-nil exactly when the most recent apply or undo ended in failure.
    /// Cleared at the start of the next apply, undo or scan.
    @Published public private(set) var lastError: ReviewSessionError?
    /// Every batch still on disk, newest first — undo survives relaunch.
    @Published public private(set) var undoHistory: [UndoLog.BatchSummary] = []

    public var autoAccepted: [MatchResult] { results.filter { $0.confidence == .high } }
    public var needsReview: [MatchResult] { results.filter { $0.confidence == .medium || $0.confidence == .low } }
    public var notFound: [MatchResult] { results.filter { $0.confidence == .skip } }
    /// Rows whose search was cut short by a failing source. ENGINE-CONTRACT
    /// R11.6: these are not "no logo exists", they are "we do not know yet",
    /// and a shell should mark them retryable rather than final. They stay in
    /// `notFound` as well so no row can disappear from every bucket.
    public var needsRetry: [MatchResult] { results.filter { $0.isRetryable } }
    /// Sources that failed at least once during the last scan.
    public var sourceFailures: [SourceFailure] {
        var seen: [SourceFailure] = []
        for result in results {
            for failure in result.sourceErrors where !seen.contains(failure) { seen.append(failure) }
        }
        return seen
    }

    private let settings: SettingsStore?
    private var cancelRequested = false

    /// `settings` is injected by the shell; when it carries Brandfetch
    /// credentials the scan uses them, otherwise the process environment is
    /// used exactly as before (CLI and CI behaviour unchanged).
    public init(settings: SettingsStore? = nil) {
        self.settings = settings
        undoHistory = (try? UndoLog().listBatchSummaries()) ?? []
        lastBatchID = undoHistory.first?.id
    }

    public func displayName(for id: String) -> String { names[id] ?? id }

    public func setSelected(_ id: String, _ on: Bool) {
        if on { selected.insert(id) } else { selected.remove(id) }
    }

    public func selectHigh(_ on: Bool) {
        let ids = autoAccepted.map(\.contactID)
        if on { selected.formUnion(ids) } else { selected.subtract(ids) }
    }

    public func chosenCandidate(for result: MatchResult) -> LogoCandidate? {
        let idx = chosenIndex[result.contactID] ?? 0
        guard result.candidates.indices.contains(idx) else { return result.candidates.first }
        return result.candidates[idx]
    }

    public func cycleCandidate(_ id: String) {
        guard let result = results.first(where: { $0.contactID == id }) else { return }
        let count = result.candidates.count
        guard count > 1 else { return }
        chosenIndex[id] = ((chosenIndex[id] ?? 0) + 1) % count
        selected.insert(id)
    }

    public func setChosenIndex(_ id: String, _ index: Int) {
        chosenIndex[id] = index
        selected.insert(id)
    }

    // MARK: - Manual override (VISION unsure-queue promise)

    /// Injects a user-supplied image as the new top choice for `id` and selects
    /// it. The bytes are squared and padded here, so callers hand over whatever
    /// the picker gave them.
    public func setManualCandidate(for id: String, imageData: Data) throws {
        let prepared = try ImagePreparer.squarePNG(from: imageData)
        guard let url = ImagePreparer.dataURL(png: prepared.data) else {
            throw ImagePreparer.Error.renderFailed
        }
        guard let index = results.firstIndex(where: { $0.contactID == id }) else { return }
        let candidate = LogoCandidate(source: .manual, imageURL: url,
                                      pixelWidth: prepared.width, pixelHeight: prepared.height,
                                      assetType: "icon", altText: displayName(for: id), hasAlpha: true)
        results[index].candidates.insert(candidate, at: 0)
        chosenIndex[id] = 0
        selected.insert(id)
    }

    /// Same, for a URL the shell already resolved (a pasted link, a search hit).
    public func setManualCandidate(for id: String, imageURL: URL) async throws {
        let raw = try await Self.fetchImage(imageURL)
        try setManualCandidate(for: id, imageData: raw)
    }

    // MARK: - Pipeline

    public static func makePipeline() -> MatchPipeline {
        DefaultSources.makePipeline()
    }

    private func configuredPipeline() -> MatchPipeline {
        guard let settings else { return Self.makePipeline() }
        let clientID = settings.resolvedBrandfetchClientID
        let apiKey = settings.resolvedBrandfetchAPIKey
        guard clientID != nil || apiKey != nil else { return Self.makePipeline() }
        return DefaultSources.makePipeline(
            brandfetchClientID: clientID ?? DefaultSources.env("CONTACTLOGO_BRANDFETCH_CLIENT_ID"),
            brandfetchAPIKey: apiKey ?? DefaultSources.env("CONTACTLOGO_BRANDFETCH_API_KEY")
        )
    }

    /// Cooperative cancellation for background runs — checked between
    /// contacts, so a cancelled scan stops promptly and publishes nothing.
    public func requestCancel() { cancelRequested = true }

    /// Returns true when matching ran to completion, false when it was
    /// cancelled (no partial results are published in that case).
    @discardableResult
    public func scanAndMatch() async -> Bool {
        lastError = nil
        cancelRequested = false
        #if canImport(Contacts)
        stage = .scanning
        let provider = CNContactsProvider()
        do {
            guard try await provider.requestAccess() else {
                stage = .idle
                return false
            }
            let contacts = try await provider.fetchCandidates()
            names = Dictionary(uniqueKeysWithValues: contacts.map { ($0.id, $0.displayName) })
            let pipeline = configuredPipeline()
            // Default off: a business card with a photo stays in the queue as
            // `replace-existing` (MATCHING-ENGINE section 1, CONTACTLOGO.md:53).
            let skipPhotos = settings?.skipContactsWithExistingPhoto ?? false
            // R7.6: person and non-brand contacts are never looked up at all.
            let targets = contacts.filter {
                pipeline.classify($0) == .businessCard && !(skipPhotos && $0.hasImage)
            }
            stage = .matching(done: 0, total: targets.count)
            var out: [MatchResult] = []
            for (i, contact) in targets.enumerated() {
                if cancelRequested || Task.isCancelled {
                    stage = .idle
                    return false
                }
                out.append(await pipeline.match(contact))
                // Re-checked *after* the await, not only before it.  A
                // BGProcessingTask can expire while this contact is matching —
                // including the last one, or the only one — and MatchPipeline
                // absorbs cancellation as source failures and returns normally.
                // Without this the loop would fall through, publish, and report
                // success for an expired task, posting "your queue is ready".
                if cancelRequested || Task.isCancelled {
                    stage = .idle
                    return false
                }
                stage = .matching(done: i + 1, total: targets.count)
            }
            results = out
            chosenIndex = [:]
            selected = Set(out.filter { $0.confidence == .high }.map(\.contactID))
            stage = .review
            return true
        } catch {
            stage = .idle
            return false
        }
        #else
        stage = .idle
        return false
        #endif
    }

    // MARK: - Apply / undo

    public func applySelected() async {
        lastError = nil
        #if canImport(Contacts)
        stage = .applying
        let provider = CNContactsProvider()
        var entries: [ChangeSet.Entry] = []
        for result in results where selected.contains(result.contactID) {
            // A candidate that will not rasterize is treated exactly like one
            // with no fetchable image: excluded from the batch, not an error.
            guard let url = chosenCandidate(for: result)?.imageURL,
                  let raw = try? await Self.fetchImage(url),
                  let prepared = try? ImagePreparer.squarePNG(from: raw) else { continue }
            let previous = try? await provider.imageData(forContactID: result.contactID)
            entries.append(.init(contactID: result.contactID,
                                 newImageData: prepared.data,
                                 previousImageData: previous))
        }
        guard !entries.isEmpty else {
            lastError = .nothingToApply
            stage = .review
            return
        }

        let log = UndoLog()
        let batchDirectory: URL
        do {
            batchDirectory = try log.recordBatch(entries)
        } catch {
            // Nothing was written, so the previous batch is still the one to undo.
            lastError = .applyFailed(succeeded: 0, failed: entries.count,
                                     underlying: error.localizedDescription)
            stage = .review
            return
        }
        // Set before the first write: the batch on disk is a true record of
        // what was attempted, and stays undoable even if writes fail.
        lastBatchID = batchDirectory.lastPathComponent

        var succeeded = 0
        var failureReason: String?
        var failed = 0
        for entry in entries {
            do {
                try await provider.setImage(entry.newImageData, forContactID: entry.contactID)
                succeeded += 1
                selected.remove(entry.contactID)
            } catch {
                failed += 1
                if failureReason == nil { failureReason = error.localizedDescription }
            }
        }
        if let failureReason {
            // Failed rows stay selected so Apply retries them with one tap.
            lastError = .applyFailed(succeeded: succeeded, failed: failed, underlying: failureReason)
        }
        try? log.prune()
        refreshUndoHistory()
        stage = .review
        #endif
    }

    public func undoLast() async {
        lastError = nil
        guard let id = lastBatchID else {
            lastError = .noBatchToUndo
            return
        }
        await undo(batchID: id)
    }

    /// Restores a specific batch. On failure `lastBatchID` is left alone so the
    /// shell can offer Retry instead of losing the batch.
    public func undo(batchID: String) async {
        lastError = nil
        #if canImport(Contacts)
        let log = UndoLog()
        do {
            try await log.restore(batchID: batchID, using: CNContactsProvider())
        } catch {
            lastError = .undoFailed(batchID: batchID, underlying: error.localizedDescription)
            return
        }
        // Restoring an older batch over a newer one is not supported, so the
        // restored batch and anything newer leave the history.
        if let index = undoHistory.firstIndex(where: { $0.id == batchID }) {
            for summary in undoHistory[...index] { try? log.deleteBatch(summary.id) }
        } else {
            try? log.deleteBatch(batchID)
        }
        refreshUndoHistory()
        #endif
    }

    public func refreshUndoHistory() {
        undoHistory = (try? UndoLog().listBatchSummaries()) ?? []
        lastBatchID = undoHistory.first?.id
    }

    public static func fetchImage(_ url: URL) async throws -> Data {
        try await DefaultSources.fetchImage(url)
    }
}
#endif
