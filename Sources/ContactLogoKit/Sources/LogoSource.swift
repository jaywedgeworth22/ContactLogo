import Foundation

/// A logo provider. Implementations must be deterministic for identical inputs
/// (same query → same candidate list, modulo provider-side changes).
public protocol LogoSource: Sendable {
    var kind: SourceKind { get }
    /// Free-form brand-name search (used for business cards without a domain).
    func candidates(forBrandName name: String) async throws -> [LogoCandidate]
    /// Direct domain lookup (used when the contact already yields a domain).
    func candidates(forDomain domain: String) async throws -> [LogoCandidate]
}

public enum LogoSourceError: Error, Equatable, Sendable {
    /// The provider asked us to slow down. Retried with backoff (R11.6); when
    /// it survives the whole budget the source is recorded as failed, never
    /// silently dropped.
    case rateLimited(retryAfter: TimeInterval?)
    /// The provider answered, and has nothing for this brand. Not a failure.
    case notFound
    /// The source is not usable in this build (no API key, say). Not a failure.
    case misconfigured(String)
    /// The provider is broken right now — a 5xx.  Distinct from `.notFound`
    /// because "answered, and has nothing" and "could not answer" must not both
    /// land the contact in terminal Not found (R11.6's determinism clause).
    case serverError(status: Int)

    /// R11.6 — what a non-2xx status means.  A 4xx is the provider answering
    /// "not this one"; a 5xx is the provider failing to answer at all.  Mapping
    /// both to `.notFound` made a whole run of 500s indistinguishable from a
    /// completed search that found nothing.
    public static func forStatus(_ status: Int) -> LogoSourceError {
        status >= 500 ? .serverError(status: status) : .notFound
    }

    /// A run-level failure the review UI must surface, as opposed to a source
    /// that simply had no answer.
    public var isRunFailure: Bool {
        switch self {
        case .rateLimited, .serverError: return true
        case .notFound, .misconfigured: return false
        }
    }

    public var isRateLimited: Bool {
        if case .rateLimited = self { return true }
        return false
    }
}

/// Minimal PNG/JPEG/WebP header dimension reader — the square rule must work
/// without rendering images (MATCHING-ENGINE §3, scrape-mode note).
public enum ImageDimensions {
    public static func read(_ data: Data) -> (Int, Int)? {
        if data.count >= 24, data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { // PNG
            func be32(_ o: Int) -> Int {
                Int(data[o]) << 24 | Int(data[o + 1]) << 16 | Int(data[o + 2]) << 8 | Int(data[o + 3])
            }
            return (be32(16), be32(20))
        }
        if data.count >= 4, data[0] == 0xFF, data[1] == 0xD8 { // JPEG
            var i = 2
            while i + 9 < data.count {
                if data[i] != 0xFF { i += 1; continue }
                let marker = data[i + 1]
                if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 {
                    let h = Int(data[i + 5]) << 8 | Int(data[i + 6])
                    let w = Int(data[i + 7]) << 8 | Int(data[i + 8])
                    return (w, h)
                }
                let len = Int(data[i + 2]) << 8 | Int(data[i + 3])
                i += 2 + max(len, 1)
            }
        }
        if data.count >= 30, data.starts(with: [0x52, 0x49, 0x46, 0x46]), // RIFF WEBP
           data[8...11] == Data("WEBP".utf8), data[12...15] == Data("VP8 ".utf8) {
            let w = Int(data[26]) | Int(data[27]) << 8
            let h = Int(data[28]) | Int(data[29]) << 8
            return (w & 0x3FFF, h & 0x3FFF)
        }
        return nil
    }
}
