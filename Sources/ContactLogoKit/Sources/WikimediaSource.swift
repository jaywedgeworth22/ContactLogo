import Foundation

/// Wikimedia Commons: great for major corporate wordmarks ("File:Exxon logo.svg").
/// Send a descriptive UA — upload.wikimedia.org rejects bot-y ones (§3.2).
public struct WikimediaSource: LogoSource, Sendable {
    public let kind = SourceKind.wikimedia
    private let session: URLSession
    private let userAgent: String

    public init(userAgent: String = "ContactLogo/1.0 (https://contactlogo.com)",
                session: URLSession = .shared) {
        self.userAgent = userAgent
        self.session = session
    }

    private struct SearchResponse: Decodable {
        struct Query: Decodable {
            struct Hit: Decodable { let title: String }
            let search: [Hit]
        }
        let query: Query
    }
    private struct InfoResponse: Decodable {
        struct Query: Decodable {
            struct Page: Decodable {
                struct Info: Decodable { let thumburl: String?; let url: String? }
                let imageinfo: [Info]?
            }
            let pages: [String: Page]
        }
        let query: Query
    }

    /// One GET with our descriptive UA, translating 429 into a retryable
    /// error rather than a decode failure.
    private func get(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
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

    public func candidates(forDomain domain: String) async throws -> [LogoCandidate] {
        try await candidates(forBrandName: domain.replacingOccurrences(of: ".com", with: ""))
    }

    public func candidates(forBrandName name: String) async throws -> [LogoCandidate] {
        // intitle: search — plain "Walmart logo" matches photo descriptions,
        // not file titles (dogfood lesson).
        let quoted = name.replacingOccurrences(of: "\"", with: "")
        let query = "intitle:\(quoted) intitle:logo".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
        guard let searchURL = URL(string:
            "https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=\(query)&srnamespace=6&format=json&srlimit=5") else { return [] }
        // Commons throttles rapid bursts; without backoff identical contacts
        // return different answers on different runs (ENGINE-CONTRACT R11.6).
        let data = try await HTTPRetry.withRateLimitRetry { try await self.get(searchURL) }
        let hits = try JSONDecoder().decode(SearchResponse.self, from: data).query.search

        var out: [LogoCandidate] = []
        for hit in hits.prefix(3) where hit.title.hasPrefix("File:") {
            let lower = hit.title.lowercased()
            guard lower.contains("logo") || lower.contains("icon") else { continue }
            let title = hit.title.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? hit.title
            guard let infoURL = URL(string:
                "https://commons.wikimedia.org/w/api.php?action=query&titles=\(title)&prop=imageinfo&iiprop=url&iiurlwidth=500&format=json") else { continue }
            guard let idata = try? await HTTPRetry.withRateLimitRetry(operation: { try await self.get(infoURL) }),
                  let page = try? JSONDecoder().decode(InfoResponse.self, from: idata).query.pages.values.first,
                  let info = page.imageinfo?.first,
                  let thumb = info.thumburl ?? info.url,
                  let url = URL(string: thumb) else { continue }
            out.append(LogoCandidate(source: .wikimedia, imageURL: url,
                                     assetType: lower.contains("icon") ? "icon" : "logo",
                                     altText: hit.title))
        }
        return out
    }
}
