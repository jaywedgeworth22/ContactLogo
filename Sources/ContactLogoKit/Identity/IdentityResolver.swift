import Foundation

/// How a brand domain was obtained. Ported from vendor/crest identity (`via`) and
/// kept as review-UI context — guessed domains never auto-apply.
public enum IdentityVia: String, Sendable {
    case website, email, catalog, phone, guess
}

public struct ResolvedIdentity: Sendable, Equatable {
    public let domain: String
    public let via: IdentityVia

    public init(domain: String, via: IdentityVia) {
        self.domain = domain
        self.via = via
    }
}

/// ENGINE-CONTRACT R8: website → work email → company catalog → phone →
/// `{slug}.com` guess.  The order is load-bearing; the first step that yields a
/// domain wins and names the `via`.
public enum IdentityResolver {

    /// An identity plus the static flags the walk produced (R12.1).
    public struct Outcome: Sendable {
        public let identity: ResolvedIdentity?
        public let flags: [String]
    }

    public static func resolve(_ c: ContactIdentity, brandName: String, isBrandTail: Bool = false) -> ResolvedIdentity? {
        resolveDetailed(c, brandName: brandName, isBrandTail: isBrandTail).identity
    }

    /// `isBrandTail` — true when the query carries the `brand-tail` flag (R6.2),
    /// which R6.2's own scope restricts to a card with no given/family name —
    /// wires in the R8.1b brand-tail catalog preference (§2b amendment, issue
    /// #36) below.
    public static func resolveDetailed(_ c: ContactIdentity, brandName: String, isBrandTail: Bool = false) -> Outcome {
        var flags: [String] = []

        func note(_ flag: String) {
            if !flags.contains(flag) { flags.append(flag) }
        }

        // R8.1 — website fields, in contact order.
        for raw in c.websiteHosts {
            guard let d = DomainDeriver.reduce(raw) else { continue }
            if DomainDeriver.freemail.contains(d.domain) { continue }
            if DomainDeriver.isSocial(d) { note("social-url-ignored"); continue }
            if DomainDeriver.isPlatform(d) { note("platform-host-ignored"); continue }
            if d.userinfoStripped { note("userinfo-stripped") }
            if d.subdomainReduced { note("subdomain-reduced") }
            note("via-website")
            return Outcome(identity: ResolvedIdentity(domain: d.domain, via: .website), flags: flags)
        }

        // R8.2 — work email.  R3.2: a social host is no better here.  Computed
        // ahead of the R8.1b check below (rather than returned immediately) so
        // the domain it would select can be compared against a catalog hit for
        // the tail before either is committed; every rejection along the way
        // still lands on `flags`, exactly as if this were the terminal step.
        var emailWinner: String?
        for raw in c.emailDomains {
            guard let d = DomainDeriver.reduce(DomainDeriver.emailHost(raw)) else { continue }
            if DomainDeriver.freemail.contains(d.domain) { continue }
            if DomainDeriver.isSocial(d) { note("social-url-ignored"); continue }
            if d.subdomainReduced { note("subdomain-reduced") }
            emailWinner = d.domain
            break
        }

        // R8.1b — §2b brand-tail exception (issue #36).  An org-only card's
        // brand-tail query is what the card claims to be (R6.2): "Front Office -
        // Root Insurance" claims to be Root Insurance, not whatever domain
        // happens to sit behind a work email on the card.  When the tail has a
        // catalog domain and the email R8.2 would otherwise select shares no
        // token with the query, the catalog domain wins instead — the tail
        // names the brand, the unrelated inbox does not.  R10.3 already caps
        // every brand-tail card at MEDIUM regardless of `via`, so this changes
        // which domain (and `via`) is reported, never the confidence tier.  No
        // catalog hit for the tail, or an email that *does* share a token with
        // the query (the two sources already agree), leaves R8.2 in charge
        // exactly as before: the email domain wins, capped at medium and
        // flagged `email-domain-unrelated` when it disagrees.
        if isBrandTail, let tailCatalog = CompanyCatalog.domain(forName: brandName) {
            let emailAgrees = emailWinner.map { NameNormalizer.passesSimilarity(query: brandName, brandName: Self.domainLabel($0)) } ?? false
            if !emailAgrees {
                note("via-catalog")
                return Outcome(identity: ResolvedIdentity(domain: tailCatalog, via: .catalog), flags: flags)
            }
        }

        if let emailWinner {
            note("via-email")
            return Outcome(identity: ResolvedIdentity(domain: emailWinner, via: .email), flags: flags)
        }

        // R8.3 — offline catalog.
        let organization = c.organization.flatMap { $0.isEmpty ? nil : $0 }
        if let catalog = CompanyCatalog.domain(forName: brandName)
            ?? organization.flatMap(CompanyCatalog.domain(forName:))
            ?? CompanyCatalog.domain(forName: c.displayName) {
            note("via-catalog")
            return Outcome(identity: ResolvedIdentity(domain: catalog, via: .catalog), flags: flags)
        }

        // R8.4 — published customer-service numbers.
        for phone in c.phoneNumbers {
            if let d = PhoneDirectory.domain(forPhone: phone) {
                note("via-phone")
                return Outcome(identity: ResolvedIdentity(domain: d, via: .phone), flags: flags)
            }
        }

        // R8.5 — last-resort guess, never contact-owned evidence.
        if let slug = NameNormalizer.guessSlug(brandName) {
            note("via-guess")
            note("guessed-domain")
            return Outcome(identity: ResolvedIdentity(domain: "\(slug).com", via: .guess), flags: flags)
        }
        note("no-identity")
        return Outcome(identity: nil, flags: flags)
    }

    /// The domain a bare brand name resolves to with no contact context:
    /// catalog first, then the `{slug}.com` guess.  Used by the employee guard
    /// (R7.3.b) and by shells that only have a name.
    public static func guessDomain(_ name: String) -> String? {
        if let known = CompanyCatalog.domain(forName: name) { return known }
        guard let slug = NameNormalizer.guessSlug(name) else { return nil }
        return "\(slug).com"
    }

    /// R10.1b — the registrable domain minus its final label, for the R8.1b
    /// relatedness check ("bluebonnetdental.com" -> "bluebonnetdental").  Kept
    /// identical to `MatchPipeline.domainLabel` and the TypeScript/Kotlin
    /// engines.
    static func domainLabel(_ domain: String) -> String {
        guard let dot = domain.lastIndex(of: ".") else { return domain }
        return String(domain[domain.startIndex..<dot])
    }
}
