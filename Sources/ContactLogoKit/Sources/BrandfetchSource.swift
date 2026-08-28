import Foundation

/// Brandfetch: Brand API (name → domain, rate-limited) + Logo Link CDN
/// (domain → asset; free client ID; needs a real Referer header).
/// Honors MATCHING-ENGINE §3.1: icon > wordmark, light theme, fallback-tile
/// detection, 429 backoff (ENGINE-CONTRACT R11.6).
public struct BrandfetchSource: LogoSource, Sendable {
    public let kind = SourceKind.brandfetch
    private let brandAPIKey: String?   // Bearer for api.brandfetch.io (search)
    private let logoClientID: String   // c= param for cdn.brandfetch.io
    private let session: URLSession

    public init(brandAPIKey: String? = nil, logoClientID: String,
                session: URLSession = .shared) {
        self.brandAPIKey = brandAPIKey
        self.logoClientID = logoClientID
        self.session = session
    }

    private struct SearchResult: Decodable {
        let name: String?
        let domain: String?
    }

    public func candidates(forBrandName name: String) async throws -> [LogoCandidate] {
        guard let key = brandAPIKey else { throw LogoSourceError.misconfigured("brand API key missing") }
        let q = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        guard let url = URL(string: "https://api.brandfetch.io/v2/search/\(q)") else { return [] }
        let data = try await HTTPRetry.withRateLimitRetry {
            try await self.get(url, bearer: key)
        }
        let hits = try JSONDecoder().decode([SearchResult].self, from: data)
        var out: [LogoCandidate] = []
        for hit in hits.prefix(3) {
            guard let domain = hit.domain,
                  NameNormalizer.passesSimilarity(query: name, brandName: hit.name ?? "") else { continue }
            out.append(contentsOf: try await candidates(forDomain: domain))
        }
        return out
    }

    private struct Brand: Decodable {
        struct Logo: Decodable {
            struct Format: Decodable { let src: String; let format: String? }
            let type: String?
            let theme: String?
            let formats: [Format]?
        }
        let logos: [Logo]?
        /// Brandfetch marks generated letter tiles (ENGINE-CONTRACT R11.5.1).
        let fallback: Bool?
    }

    public func candidates(forDomain domain: String) async throws -> [LogoCandidate] {
        // Brand API gives typed assets (icon vs wordmark); fall back to the
        // bare CDN logo when only the client ID is configured.
        if let key = brandAPIKey, let url = URL(string: "https://api.brandfetch.io/v2/brands/\(domain)") {
            let data: Data?
            do {
                data = try await HTTPRetry.withRateLimitRetry { try await self.get(url, bearer: key) }
            } catch let error as LogoSourceError where error == .notFound {
                data = nil
            }
            if let data, let brand = try? JSONDecoder().decode(Brand.self, from: data) {
                // A "fallback" brand is Brandfetch's generated letter tile, not
                // a logo: treated as not found rather than offered to the user.
                if brand.fallback == true { return [] }
                let assets = (brand.logos ?? []).flatMap { logo -> [LogoCandidate] in
                    (logo.formats ?? [])
                        .filter { $0.format == "png" }
                        .compactMap { format in
                            guard let assetURL = URL(string: format.src) else { return nil }
                            return LogoCandidate(source: .brandfetch, imageURL: assetURL,
                                                 assetType: logo.type, altText: domain)
                        }
                }
                if !assets.isEmpty { return assets }
            }
        }
        guard let url = URL(string: "https://cdn.brandfetch.io/\(domain)?c=\(logoClientID)") else { return [] }
        return [LogoCandidate(source: .brandfetch, imageURL: url, altText: domain)]
    }

    /// One authenticated GET, translating HTTP status into `LogoSourceError`
    /// so the retry policy can see a 429 instead of a decode failure.
    private func get(_ url: URL, bearer: String) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse {
            if http.statusCode == 429 {
                throw LogoSourceError.rateLimited(
                    retryAfter: HTTPRetry.retryAfterSeconds(http.value(forHTTPHeaderField: "Retry-After"))
                )
            }
            guard (200...299).contains(http.statusCode) else { throw LogoSourceError.notFound }
        }
        return data
    }

    /// An honest, identifying User-Agent.  We used to send a spoofed Chrome UA
    /// and a forged `Referer: https://www.google.com/` to every third-party
    /// host we fetched an image from; MATCHING-ENGINE §3 only ever asked for a
    /// *real* referer that is not example.com, which this is.
    public static let userAgent = "ContactLogo/1.0 (+https://contactlogo.com)"
    public static let referer = "https://contactlogo.com/"

    /// Image request used for every candidate fetch, not just Brandfetch's.
    public static func imageRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(referer, forHTTPHeaderField: "Referer")
        request.setValue("image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5", forHTTPHeaderField: "Accept")
        return request
    }

    /// Historical name for `imageRequest(url:)`.
    public static func cdnRequest(url: URL) -> URLRequest { imageRequest(url: url) }
}
