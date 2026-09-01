import Foundation

/// ENGINE-CONTRACT R11.6 — every source that can be rate-limited retries with
/// exponential backoff and full jitter before giving up: base 500 ms, doubling,
/// 4 attempts, cap 8 s, honouring `Retry-After` when it asks for longer.
///
/// ARCHITECTURE.md has claimed "all sources honor 429 with exponential backoff"
/// since before any of them did; this is that behaviour.
public enum HTTPRetry {

    public static let baseDelay: TimeInterval = 0.5
    public static let maxAttempts = 4
    public static let maxDelay: TimeInterval = 8

    /// Full-jitter delay before retry `attempt` (0-based).
    /// `random` is injectable so the schedule can be unit-tested.
    public static func delay(forAttempt attempt: Int,
                             retryAfter: TimeInterval? = nil,
                             random: (ClosedRange<Double>) -> Double = { Double.random(in: $0) }) -> TimeInterval {
        let ceiling = min(maxDelay, baseDelay * pow(2, Double(max(0, attempt))))
        let jittered = random(0...ceiling)
        if let retryAfter, retryAfter > jittered {
            return min(retryAfter, maxDelay * 2)
        }
        return jittered
    }

    /// Reads a `Retry-After` header value (seconds form only — the HTTP-date
    /// form is not used by any source we call).
    public static func retryAfterSeconds(_ header: String?) -> TimeInterval? {
        guard let header, let seconds = TimeInterval(header.trimmingCharacters(in: .whitespaces)) else { return nil }
        return seconds > 0 ? seconds : nil
    }

    /// Runs `operation`, retrying only `LogoSourceError.rateLimited`.  Any
    /// other error propagates immediately, and a rate limit that survives the
    /// whole budget is rethrown so the caller can record the source as failed
    /// rather than silently absent.
    public static func withRateLimitRetry<T>(attempts: Int = maxAttempts,
                                             operation: () async throws -> T) async throws -> T {
        var attempt = 0
        while true {
            do {
                return try await operation()
            } catch let error as LogoSourceError {
                guard case .rateLimited(let retryAfter) = error, attempt + 1 < attempts else { throw error }
                let seconds = delay(forAttempt: attempt, retryAfter: retryAfter)
                try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
                attempt += 1
            }
        }
    }
}
