import Foundation

/// Shared source list for the CLI, macOS, and iOS.  Order matches
/// MATCHING-ENGINE.md §3 (preferred → Simple Icons → CompaniesLogo →
/// Wikimedia → favicon; Brandfetch inserted when a client id is present).
public enum DefaultSources {
    public static func env(_ key: String) -> String? {
        let value = ProcessInfo.processInfo.environment[key]
        return (value?.isEmpty == false) ? value : nil
    }

    public static func logoSources(
        brandfetchClientID: String? = Self.env("CONTACTLOGO_BRANDFETCH_CLIENT_ID"),
        brandfetchAPIKey: String? = Self.env("CONTACTLOGO_BRANDFETCH_API_KEY")
    ) -> [any LogoSource] {
        var sources: [any LogoSource] = [
            PreferredMarksSource(),
            SimpleIconsSource(),
            CompaniesLogoSource(),
            WikimediaSource(),
            FaviconSource()
        ]
        if let id = brandfetchClientID, !id.isEmpty {
            sources.insert(
                BrandfetchSource(brandAPIKey: brandfetchAPIKey, logoClientID: id),
                at: 1
            )
        }
        return sources
    }

    /// Fetches candidate bytes with an honest, identifying User-Agent and our
    /// own referer.  Translates HTTP status into `LogoSourceError` so a 429 is
    /// retried (R11.6) and a provider letter-tile marker is treated as "not
    /// found" rather than offered to the user (R11.5.1).
    public static func fetchImage(_ url: URL) async throws -> Data {
        if url.scheme == "data" { return try Data(contentsOf: url) }
        return try await HTTPRetry.withRateLimitRetry {
            let (data, response) = try await URLSession.shared.data(for: BrandfetchSource.imageRequest(url: url))
            if let http = response as? HTTPURLResponse {
                if http.statusCode == 429 {
                    throw LogoSourceError.rateLimited(
                        retryAfter: HTTPRetry.retryAfterSeconds(http.value(forHTTPHeaderField: "Retry-After"))
                    )
                }
                guard (200...299).contains(http.statusCode) else { throw LogoSourceError.notFound }
                if ImageFlags.isProviderFallback(headerValue: http.value(forHTTPHeaderField: "x-brandfetch-fallback")) {
                    throw LogoSourceError.notFound
                }
            }
            return data
        }
    }

    public static func makePipeline(
        brandfetchClientID: String? = Self.env("CONTACTLOGO_BRANDFETCH_CLIENT_ID"),
        brandfetchAPIKey: String? = Self.env("CONTACTLOGO_BRANDFETCH_API_KEY")
    ) -> MatchPipeline {
        MatchPipeline(
            sources: logoSources(
                brandfetchClientID: brandfetchClientID,
                brandfetchAPIKey: brandfetchAPIKey
            ),
            fetchImage: fetchImage
        )
    }
}
