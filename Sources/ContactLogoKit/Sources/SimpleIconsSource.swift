import Foundation

/// Simple Icons CDN — preferred transparent mark after curated icons.
/// Slug map ported from `vendor/crest/src/routes/api/logo.ts` and extended to
/// the canonical table in ENGINE-CONTRACT R13.1.
public struct SimpleIconsSource: LogoSource, Sendable {
    public let kind = SourceKind.simpleIcons
    private let session: URLSession

    /// R13.3 — domains whose Simple Icons slug belongs to a different company
    /// (Delta the software company ≠ the airline).
    static let skip: Set<String> = ["delta.com"]

    static let slugs: [String: String] = [
        "apple.com": "apple", "google.com": "google", "meta.com": "meta",
        "facebook.com": "facebook", "instagram.com": "instagram", "tesla.com": "tesla",
        "nvidia.com": "nvidia", "netflix.com": "netflix", "spotify.com": "spotify",
        "salesforce.com": "salesforce", "intel.com": "intel", "cisco.com": "cisco",
        "stripe.com": "stripe", "paypal.com": "paypal", "visa.com": "visa",
        "mastercard.com": "mastercard", "americanexpress.com": "americanexpress",
        "chase.com": "chase", "jpmorganchase.com": "chase",
        "bankofamerica.com": "bankofamerica", "wellsfargo.com": "wellsfargo",
        "verizon.com": "verizon", "att.com": "atandt", "united.com": "unitedairlines",
        "aa.com": "americanairlines", "southwest.com": "southwestairlines",
        "fedex.com": "fedex", "ups.com": "ups", "usps.com": "usps",
        "target.com": "target", "starbucks.com": "starbucks",
        "mcdonalds.com": "mcdonalds", "uber.com": "uber", "lyft.com": "lyft",
        "doordash.com": "doordash", "airbnb.com": "airbnb", "nike.com": "nike",
        "samsung.com": "samsung", "sony.com": "sony", "ford.com": "ford",
        "bmw.com": "bmw", "x.ai": "x", "x.com": "x", "twitter.com": "x",
        "squareup.com": "square", "github.com": "github", "youtube.com": "youtube",
        "discord.com": "discord", "zoom.us": "zoom", "notion.so": "notion",
        "figma.com": "figma", "dropbox.com": "dropbox", "pinterest.com": "pinterest",
        "reddit.com": "reddit", "tiktok.com": "tiktok", "whatsapp.com": "whatsapp",
        "telegram.org": "telegram", "signal.org": "signal", "ebay.com": "ebay",
        "shopify.com": "shopify", "spacex.com": "spacex", "starlink.com": "spacex"
    ]

    public init(session: URLSession = .shared) {
        self.session = session
    }

    /// R13.2 — slugs are brand names, not domain labels (`chase.com` → `chase`), so a domain absent from the table produces **no** Simple
    /// Icons candidate.  Deriving one by stripping the TLD is right only by
    /// accident and gives `delta.com` the Delta *software* mark.
    public static func slug(for domain: String) -> String? {
        let host = domain.lowercased()
        guard !skip.contains(host) else { return nil }
        return slugs[host]
    }

    public static func url(for domain: String) -> URL? {
        guard let slug = slug(for: domain) else { return nil }
        let encoded = slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug
        return URL(string: "https://cdn.simpleicons.org/\(encoded)")
    }

    public func candidates(forBrandName name: String) async throws -> [LogoCandidate] {
        guard let domain = CompanyCatalog.domain(forName: name) else { return [] }
        return try await candidates(forDomain: domain)
    }

    public func candidates(forDomain domain: String) async throws -> [LogoCandidate] {
        guard let url = Self.url(for: domain.lowercased()) else { return [] }
        return [LogoCandidate(source: .simpleIcons, imageURL: url, assetType: "icon",
                              altText: domain, hasAlpha: true)]
    }
}
