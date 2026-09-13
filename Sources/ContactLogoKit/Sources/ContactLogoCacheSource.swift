import Foundation

/// First-party Vercel logo cache on ContactLogo.com (issue #74).
/// Queries `https://contactlogo.com/api/logo/:domain` which serves edge-cached,
/// license-tagged 512px marks prior to third-party fallback CDNs.
public struct ContactLogoCacheSource: LogoSource, Sendable {
    public let kind = SourceKind.contactLogoCache
    public let baseURL: URL

    public init(baseURL: URL = URL(string: "https://contactlogo.com/api/logo")!) {
        self.baseURL = baseURL
    }

    public static func url(for domain: String, baseURL: URL = URL(string: "https://contactlogo.com/api/logo")!) -> URL? {
        let clean = domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !clean.isEmpty else { return nil }
        guard let encoded = clean.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return baseURL.appendingPathComponent(encoded)
    }

    public func candidates(forBrandName name: String) async throws -> [LogoCandidate] {
        guard let domain = CompanyCatalog.domain(forName: name) else { return [] }
        return try await candidates(forDomain: domain)
    }

    public func candidates(forDomain domain: String) async throws -> [LogoCandidate] {
        guard let url = Self.url(for: domain, baseURL: baseURL) else { return [] }
        return [LogoCandidate(source: .contactLogoCache, imageURL: url, assetType: "icon", altText: domain)]
    }
}
