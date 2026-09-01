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
    /// called.  Returns true when matching completed (results are published,
    /// `stage` is `.review`, and the queue is on disk); false when it was
    /// cancelled or the queue could not be persisted — in those cases the
    /// caller must not post the "queue is ready" notification.  A cancelled
    /// run leaves the session `.idle` with no partial results, so the next
    /// foreground scan starts clean.
    @discardableResult
    public func run() async -> Bool {
        guard !cancelled else { return false }
        let completed = await session.scanAndMatch()
        guard completed else { return false }
        // Issue #32: persist BEFORE this returns, so `setTaskCompleted` and
        // the notification in the iOS shell cannot outrun the data.  A
        // failed write is an unsuccessful run — advertising an empty launch
        // is the bug this exists to close.
        return session.persistReviewQueue()
    }

    /// Cooperative cancellation, checked between contacts. Call from the
    /// task's `expirationHandler`.
    public func cancel() {
        cancelled = true
        session.requestCancel()
    }
}
#endif
