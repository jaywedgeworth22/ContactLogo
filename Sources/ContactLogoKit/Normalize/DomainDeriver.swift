import Foundation

/// MATCHING-ENGINE §4 (junk domains) / ENGINE-CONTRACT R1–R3: derive a usable
/// brand domain from a contact's URLs and email addresses — or conclude there
/// isn't one.  `reduce` accepts a raw field value (any scheme, path, userinfo
/// and port included); shells do not have to pre-clean it.
public enum DomainDeriver {

    /// R2 — consumer mail hosts and their common typo-squats.
    static let freemail: Set<String> = [
        "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
        "me.com", "mac.com", "aol.com", "live.com", "msn.com", "qq.com",
        "163.com", "126.com", "foxmail.com", "protonmail.com", "proton.me",
        "pm.me", "gmx.com", "mail.com", "comcast.net", "verizon.net", "att.net",
        "sbcglobal.net", "ymail.com", "googlemail.com", "hey.com", "fastmail.com",
        "zoho.com", "yandex.com", "mail.ru", "gnail.com", "hoymail.com"
    ]

    /// R3.1 — profile/social hosts.  A linkedin.com URL must never yield a
    /// LinkedIn logo, and (R3.2) neither must an @facebook.com email address.
    static let social: Set<String> = [
        "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
        "youtube.com", "crunchbase.com", "wikipedia.org", "yelp.com",
        "tripadvisor.com", "glassdoor.com", "tiktok.com", "pinterest.com",
        "reddit.com", "bloomberg.com", "vimeo.com", "medium.com", "github.com",
        "foursquare.com", "weibo.com", "fb.com", "apple.news"
    ]

    /// R3.3 — site builders, tenant hosts, link-in-bio and shorteners.  Every
    /// tenant shares one favicon, so the mark would be the platform's.
    static let platform: Set<String> = [
        "wixsite.com", "wix.com", "weebly.com", "squarespace.com",
        "godaddysites.com", "business.site", "square.site", "sites.google.com",
        "wordpress.com", "blogspot.com", "myshopify.com", "linktr.ee",
        "about.me", "carrd.co", "notion.site", "webflow.io", "netlify.app",
        "vercel.app", "github.io", "pages.dev", "herokuapp.com", "wa.me",
        "goo.gl", "bit.ly", "tinyurl.com"
    ]

    /// R3.4 — domains that now redirect to a successor brand.  Still the right
    /// domain for the company, so capped at medium rather than dropped.
    public static let mergedDomains: Set<String> = ["ntb.com"]

    /// The result of R1 applied to one raw field value.
    public struct HostDerivation: Sendable, Equatable {
        /// Full host after scheme/path/userinfo/port/`www.` removal (R1.1–R1.8).
        public let host: String
        /// Registrable domain (R1.9–R1.11).
        public let domain: String
        public let userinfoStripped: Bool
        /// A non-`www` label was discarded (R1 note).
        public let subdomainReduced: Bool
    }

    /// An RFC 3986 scheme name, minus the dot the grammar allows: without that
    /// exclusion `costco.com:8080` reads as a scheme named `costco.com`.
    private static func isSchemeName(_ value: String) -> Bool {
        guard let first = value.first, first.isLetter else { return false }
        return value.allSatisfy { $0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" }
    }

    /// R1 — `registrableDomain(input)`.
    public static func reduce(_ input: String) -> HostDerivation? {
        var s = input.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }

        // R1.2 — the colon form has to be rejected as well as `scheme://`:
        // `mailto:sales@costco.com` in a URL field otherwise reaches userinfo
        // stripping and resolves as the business's own website.
        if let colon = s.firstIndex(of: ":") {
            let proto = String(s[s.startIndex..<colon])
            if Self.isSchemeName(proto) {
                guard proto == "http" || proto == "https" else { return nil }
                s = String(s[s.index(after: colon)...])
                if s.hasPrefix("//") { s = String(s.dropFirst(2)) }
            }
        }
        if let cut = s.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) {
            s = String(s[s.startIndex..<cut])
        }
        var userinfoStripped = false
        if let at = s.lastIndex(of: "@") {
            s = String(s[s.index(after: at)...])
            userinfoStripped = true
        }
        s = s.replacingOccurrences(of: #":\d+$"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"%[0-9a-f]{2}"#, with: "", options: .regularExpression)
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        if s.hasPrefix("www.") { s.removeFirst(4) }

        let parts = s.split(separator: ".").map(String.init).filter { !$0.isEmpty }
        guard parts.count >= 2 else { return nil }
        var keep = 2
        if parts.count >= 3 {
            let last2 = parts.suffix(2).joined(separator: ".")
            if last2.range(of: #"^(com|co|org|net|gov|edu|ac)\.[a-z]{2}$"#, options: .regularExpression) != nil {
                keep = 3
            }
        }
        return HostDerivation(
            host: parts.joined(separator: "."),
            domain: parts.suffix(keep).joined(separator: "."),
            userinfoStripped: userinfoStripped,
            subdomainReduced: parts.count > keep
        )
    }

    /// Registrable domain of one raw field value, or nil.
    public static func registrableDomain(of host: String) -> String? {
        reduce(host)?.domain
    }

    /// R3 — the host is a profile/directory page, not the business itself.
    public static func isSocial(_ d: HostDerivation) -> Bool {
        social.contains(d.domain) || social.contains(d.host)
    }

    /// R3.3 — tested against the full host *and* the registrable domain,
    /// because `sites.google.com` reduces to `google.com`.
    public static func isPlatform(_ d: HostDerivation) -> Bool {
        platform.contains(d.domain) || platform.contains(d.host)
    }

    /// Priority: first usable website host, then first non-freemail,
    /// non-social email domain.  `IdentityResolver` uses the flag-emitting
    /// walk instead; this stays for callers that only want the domain.
    public static func derive(websiteHosts: [String], emailDomains: [String]) -> String? {
        for host in websiteHosts {
            guard let d = reduce(host), !freemail.contains(d.domain),
                  !isSocial(d), !isPlatform(d) else { continue }
            return d.domain
        }
        for host in emailDomains {
            guard let d = reduce(emailHost(host)), !freemail.contains(d.domain), !isSocial(d) else { continue }
            return d.domain
        }
        return nil
    }

    /// Accepts either a bare domain or a full address.
    static func emailHost(_ value: String) -> String {
        guard let at = value.lastIndex(of: "@") else { return value }
        return String(value[value.index(after: at)...])
    }
}
