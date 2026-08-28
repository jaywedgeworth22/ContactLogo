#if canImport(Combine)
import Combine
import Foundation

/// Platform-agnostic driver for a background match run.  `BGProcessingTask`
/// itself is iOS-only and stays in the app target; everything the task handler
/// needs — run to completion, or stop promptly when the system expires it —
/// lives here so both shells share one implementation.
@MainActor
public final class BackgroundMatchRunner {
    private let session: ReviewSession
    private var cancelled = false

    public init(session: ReviewSession) {
        self.session = session
    }

    /// Runs `session.scanAndMatch()` to completion or until `cancel()` is
    /// called.  Returns true when matching completed (results are published and
    /// `stage` is `.review`); false when it was cancelled — in that case the
    /// session is left `.idle` with no partial results, so the next foreground
    /// scan starts clean.
    @discardableResult
    public func run() async -> Bool {
        guard !cancelled else { return false }
        return await session.scanAndMatch()
    }

    /// Cooperative cancellation, checked between contacts. Call from the
    /// task's `expirationHandler`.
    public func cancel() {
        cancelled = true
        session.requestCancel()
    }
}
#endif
