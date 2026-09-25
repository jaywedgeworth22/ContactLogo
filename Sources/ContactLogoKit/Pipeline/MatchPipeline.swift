import Foundation

/// Orchestrates classification → normalization → identity → sources → ranking.
/// Deterministic for a fixed source set (ARCHITECTURE: one engine, three shells).
///
/// The static half — class, query, identity and confidence ceiling — is
/// `staticMatch`, computable with no network and asserted by
/// `fixtures/golden-corpus.json` (ENGINE-CONTRACT R14).
public struct MatchPipeline: Sendable {
    private let sources: [any LogoSource]
    private let fetchImage: @Sendable (URL) async throws -> Data

    public init(sources: [any LogoSource],
                fetchImage: @escaping @Sendable (URL) async throws -> Data) {
        self.sources = sources
        self.fetchImage = fetchImage
    }

    /// Everything the engine can decide about a contact without the network.
    public struct StaticMatch: Sendable {
        public let contactClass: ContactClass
        /// The brand query. nil for person/nonBrand — no lookup is performed
        /// for those classes at all (R7.6).
        public let query: String?
        public let identity: ResolvedIdentity?
        /// R10 static ceiling. The final tier is min(this, assetTier).
        public let maxConfidence: Confidence
        public let flags: [String]

        public var domain: String? { identity?.domain }
        public var via: IdentityVia? { identity?.via }
    }

    /// Review-first classes, plus lone first/last that is a firm (vendor/crest).
    public func classify(_ c: ContactIdentity) -> ContactClass {
        staticMatch(c).contactClass
    }

    /// R7 classification + R6 segment selection + R8 identity + R10 ceiling.
    public func staticMatch(_ c: ContactIdentity) -> StaticMatch {
        let organization = (c.organization ?? "").trimmingCharacters(in: .whitespaces)
        let brandSource = organization.isEmpty ? c.displayName : organization
        let name = NameNormalizer.clean(brandSource)

        // R7.1 — non-brand is decided before any "head - tail" split, so
        // "Printer at Farm (WF-2950)" never becomes a query for "Farm".
        if GenericBlocklist.isNonBrand(name) { return Self.nonBrand() }

        let given = (c.givenName ?? "").trimmingCharacters(in: .whitespaces)
        let family = (c.familyName ?? "").trimmingCharacters(in: .whitespaces)
        let hasPersonName = !given.isEmpty || !family.isEmpty

        var flags: [String] = []
        var query: String

        if hasPersonName {
            // R7.3.a — §5 rule 8 is stated in terms of the display name, so
            // role junk in `organization` cannot reclassify a person.
            let segment = NameNormalizer.segment(c.displayName)
            // §1 — "Person: has given or family name.  Never a logo target.
            // Employees are not the company."  That outranks §5 rule 8: a known
            // brand tail names who this person is affiliated with, not a business
            // to badge.  "Dana At Costco" is Dana, and Costco's mark on her card
            // is the wrong-logo outcome the product exists to prevent.
            //
            // Rule 8 still applies to a card with no name fields (the `else`
            // branch below), and `inferCompanyFromLoneName` still catches a
            // company misfiled into a name field — it requires the candidate not
            // to look like a person's name.
            //
            // The tail is still what the employee check is run against, so a
            // contact who genuinely works at the tail brand is flagged as such.
            if let lone = inferCompanyFromLoneName(c) {
                flags.append("lone-firm-name")
                query = NameNormalizer.clean(lone)
            } else {
                let affiliation = segment.isBrandTail ? segment.query : name
                return Self.person(c, employee: isEmployee(c, of: affiliation))
            }
        } else {
            let segment = NameNormalizer.segment(name)
            // No name fields, but "Dana At Costco" is still a person and plenty of
            // imports carry no structured name at all, so read the head.
            if segment.isBrandTail,
               let head = NameNormalizer.splitHead(name),
               NameNormalizer.headLooksPersonal(head) {
                return Self.person(c, employee: isEmployee(c, of: segment.query))
            }
            query = segment.query
            if segment.isBrandTail { flags.append("brand-tail") }
            if segment.decorationStripped { flags.append("decoration-stripped") }
        }

        // R7.5 — the segmented query must still be a brand ("Front Desk -
        // Hospital" leaves "Hospital").
        if GenericBlocklist.isNonBrand(query) { return Self.nonBrand() }

        let homonym = GenericBlocklist.isHomonymRisk(query)
        if homonym { flags.append("homonym-risk") }

        let outcome = IdentityResolver.resolveDetailed(c, brandName: query, isBrandTail: flags.contains("brand-tail"))
        let redirectRisk = outcome.identity.map { DomainDeriver.mergedDomains.contains($0.domain) } ?? false
        if redirectRisk { flags.append("brand-redirect-risk") }
        flags.append(contentsOf: outcome.flags)
        if c.hasImage { flags.append("replace-existing") }

        guard let identity = outcome.identity else {
            return StaticMatch(contactClass: .businessCard, query: query, identity: nil,
                               maxConfidence: .skip, flags: flags)
        }

        // R10 — start at high, apply every matching cap.
        var ceiling = Confidence.high
        let contactOwned: Set<IdentityVia> = [.website, .email, .phone]
        if identity.via == .guess { ceiling = min(ceiling, .medium) }
        // R10.1b — an email domain is the contact's own data but routinely not the
        // brand's (subsidiaries, resellers, consultants on a client domain).  Cap
        // when it shares no token with the query; let an evident one through.
        if identity.via == .email,
           !NameNormalizer.passesSimilarity(query: query, brandName: Self.domainLabel(identity.domain)) {
            flags.append("email-domain-unrelated")
            ceiling = min(ceiling, .medium)
        }
        if homonym, !contactOwned.contains(identity.via) { ceiling = min(ceiling, .medium) }
        if flags.contains("brand-tail") { ceiling = min(ceiling, .medium) }
        if c.hasImage { ceiling = min(ceiling, .medium) }
        if redirectRisk { ceiling = min(ceiling, .medium) }

        return StaticMatch(contactClass: .businessCard, query: query, identity: identity,
                           maxConfidence: ceiling, flags: flags)
    }

    /// R10.1b — the registrable domain minus its final label, for the relatedness
    /// check ("bluebonnetdental.com" -> "bluebonnetdental").
    static func domainLabel(_ domain: String) -> String {
        guard let dot = domain.lastIndex(of: ".") else { return domain }
        return String(domain[domain.startIndex..<dot])
    }

    private static func nonBrand() -> StaticMatch {
        StaticMatch(contactClass: .nonBrand, query: nil, identity: nil,
                    maxConfidence: .skip, flags: ["non-brand"])
    }

    private static func person(_ c: ContactIdentity, employee: Bool) -> StaticMatch {
        var flags = [c.hasImage ? "photo-protected" : "person"]
        if employee { flags.append("employee") }
        return StaticMatch(contactClass: .person, query: nil, identity: nil,
                           maxConfidence: .skip, flags: flags)
    }

    /// R7.3.b — the contact's own email says they work at the brand named on
    /// their card, so they are a person who works there, not the business.
    public func isEmployee(_ c: ContactIdentity, of brandName: String) -> Bool {
        guard !brandName.isEmpty, let employer = IdentityResolver.guessDomain(brandName) else { return false }
        for raw in c.emailDomains {
            guard let d = DomainDeriver.reduce(DomainDeriver.emailHost(raw)),
                  !DomainDeriver.freemail.contains(d.domain) else { continue }
            if d.domain == employer { return true }
        }
        return false
    }

    /// R7.4 — a lone given or family name that is a catalog firm.
    ///
    /// Augmentations beyond the original ENGINE-CONTRACT R7.4:
    /// 1. A non-catalog multi-token candidate with an `orgSignal` word
    ///    ("Joe's Plumbing"), a business legal suffix ("Acme Roofing LLC"),
    ///    or 3+ tokens that don't all match a personal-name pattern is
    ///    inferred as a business.  Without this, only the 84-entry catalog
    ///    catches lone-name businesses and most of a real address book
    ///    falls into the "protected person" bucket (issue: only ~25 of
    ///    ~15k contacts surfaced).
    /// 2. The freemail short-circuit is removed.  A business contact can
    ///    have a personal email backup; the brand is decided by the name,
    ///    not by the inbox.
    /// 3. The personal-name shape guard (`looksLikePersonName`) is kept
    ///    so a 2-4 token name like "John Michael Smith" still reads as a
    ///    person and is not converted into a business query.
    public func inferCompanyFromLoneName(_ c: ContactIdentity) -> String? {
        let given = NameNormalizer.clean(c.givenName ?? "")
        let family = NameNormalizer.clean(c.familyName ?? "")
        let onlyGiven = !given.isEmpty && family.isEmpty
        let onlyFamily = !family.isEmpty && given.isEmpty
        let unstructured = given.isEmpty && family.isEmpty
        guard onlyGiven || onlyFamily || unstructured else { return nil }

        let candidate = NameNormalizer.clean(onlyGiven ? given : onlyFamily ? family : c.displayName)
        guard !candidate.isEmpty else { return nil }

        if CompanyCatalog.domain(forName: candidate) != nil { return candidate }
        // Catalog miss — fall through to the multi-token business heuristic.
        // A single token is not enough signal to flip from "person" to
        // "business" without a catalog hit.
        if looksLikeBusinessName(candidate) { return candidate }
        return nil
    }

    /// The mirror of `looksLikePersonName`: shape-based hint that a token
    /// is more likely a business than a person.  Used by
    /// `inferCompanyFromLoneName` to rescue multi-word lone-name contacts
    /// ("Joe's Plumbing", "Bayou City Sprinkler") that the catalog misses.
    private func looksLikeBusinessName(_ name: String) -> Bool {
        let cleaned = NameNormalizer.clean(name)
        let parts = cleaned.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard parts.count >= 2 else { return false }

        let lowerTokens = Set(parts.map { $0.lowercased().trimmingCharacters(in: .punctuationCharacters) })
        // 1. Org-signal word present ("Plumbing", "Pharmacy", "Roofing").
        if !lowerTokens.isDisjoint(with: WordLists.orgSignal) { return true }
        // 2. Legal suffix ("LLC", "Inc", "Co") — the catalog strips these
        //    before lookup, so we re-check the original cleaned candidate.
        if !lowerTokens.isDisjoint(with: WordLists.businessSuffix) { return true }
        // 3. 3+ tokens with no person-shape signal at all — "Bayou City
        //    Sprinkler", "Northwest Harris County MUD".
        if parts.count >= 3, !looksLikePersonName(cleaned) { return true }
        return false
    }

    private func domainForOrganization(_ org: String, contact: ContactIdentity) -> String? {
        if let catalogDomain = CompanyCatalog.domain(forName: org) {
            return catalogDomain
        }
        let normOrg = org.lowercased().filter { $0.isLetter || $0.isNumber }
        guard !normOrg.isEmpty else { return nil }
        for raw in contact.emailDomains + contact.websiteHosts {
            guard let d = DomainDeriver.reduce(DomainDeriver.emailHost(raw)) ?? DomainDeriver.reduce(raw) else { continue }
            if DomainDeriver.freemail.contains(d.domain) { continue }
            if DomainDeriver.isSocial(d) || DomainDeriver.isPlatform(d) { continue }
            let label = Self.domainLabel(d.domain).lowercased().filter { $0.isLetter || $0.isNumber }
            if normOrg == label || normOrg.contains(label) || label.contains(normOrg) {
                return d.domain
            }
        }
        return nil
    }

    /// Affiliated company name or domain for a named person with employer/company metadata.
    ///
    /// A lone-name business (issue surfaced on 2026-09-20 — iOS reported
    /// only ~25 of ~15k contacts) is its own affiliation.  Without this,
    /// `inferCompanyFromLoneName` returning a brand would still leave the
    /// contact unmatched (classified `.person`, then dropped here).
    public func affiliation(for c: ContactIdentity) -> (brandName: String, domain: String?)? {
        let given = (c.givenName ?? "").trimmingCharacters(in: .whitespaces)
        let family = (c.familyName ?? "").trimmingCharacters(in: .whitespaces)
        let hasPersonName = !given.isEmpty || !family.isEmpty
        guard hasPersonName else { return nil }
        if let lone = inferCompanyFromLoneName(c) {
            // The contact *is* the brand (lone-name business).  Look the
            // brand up in the catalog, then fall back to a guessed domain.
            let domain = CompanyCatalog.domain(forName: lone)
                ?? NameNormalizer.guessSlug(lone).map { "\($0).com" }
            return (lone, domain)
        }

        // An organization that names a business but can't be tied to a domain
        // ("Gulf Coast Roofing" on a phone-only card).  Used as the last-resort
        // affiliation below so the contact reaches Review instead of being
        // silently counted as a protected person.
        var unresolvedOrganization: String?

        // 1. Organization field (e.g. "Apple", "Texas Instruments", "Stripe")
        if let org = c.organization?.trimmingCharacters(in: .whitespaces), !org.isEmpty {
            let cleanOrg = NameNormalizer.clean(org)
            if !GenericBlocklist.isNonBrand(cleanOrg) {
                // Known catalog companies (e.g. "Texas Instruments", "American Airlines") contain geo tokens
                // but must resolve rather than being discarded by WordLists.isRoleOrPlace!
                if let catalogDomain = CompanyCatalog.domain(forName: cleanOrg) {
                    return (cleanOrg, catalogDomain)
                }
                let seg = NameNormalizer.segment(org)
                let orgCandidate = (seg.decorationStripped || seg.isBrandTail) ? seg.query : cleanOrg
                if let catalogDomain = CompanyCatalog.domain(forName: orgCandidate) {
                    return (orgCandidate, catalogDomain)
                }
                // Fallback candidate for step 4.  Deliberately looser than the
                // domain gate below: `isRoleOrPlace` rejects an org if ANY word
                // is a role or geo word, which drops most local businesses
                // ("Houston Roofing Co", "Cypress Auto Center").  Here only a
                // personal job title, or an org made entirely of role/place
                // words, disqualifies it.
                if !GenericBlocklist.isNonBrand(orgCandidate),
                   Self.organizationNamesABusiness(orgCandidate),
                   Self.organizationNamesABusiness(cleanOrg) {
                    unresolvedOrganization = orgCandidate
                }
                // Reject role metadata or job titles ("Director", "Hsa PTO - Asst Treasurer")
                if !GenericBlocklist.isNonBrand(orgCandidate) &&
                    !WordLists.isRoleOrPlace(cleanOrg) &&
                    !WordLists.isRoleOrPlace(orgCandidate) {
                    // Organization-derived affiliations must resolve using organization-compatible
                    // evidence (catalog or work email/website), never arbitrary contact domains or guesses.
                    if let domain = domainForOrganization(orgCandidate, contact: c) {
                        return (orgCandidate, domain)
                    }
                }
            }
        }

        // 2. Brand tail in display name ("Maya Chen - Texas Instruments")
        let segment = NameNormalizer.segment(c.displayName)
        if segment.isBrandTail, !GenericBlocklist.isNonBrand(segment.query) {
            if let catalogDomain = CompanyCatalog.domain(forName: segment.query) {
                return (segment.query, catalogDomain)
            }
            if !WordLists.isRoleOrPlace(segment.query) {
                let domain = domainForOrganization(segment.query, contact: c)
                return (segment.query, domain)
            }
        }

        // 3. Work email domain (only if domain is not a public mail provider)
        for raw in c.emailDomains {
            guard let d = DomainDeriver.reduce(DomainDeriver.emailHost(raw)) else { continue }
            if DomainDeriver.freemail.contains(d.domain) { continue }
            if DomainDeriver.isSocial(d) || DomainDeriver.isPlatform(d) { continue }
            let label = Self.domainLabel(d.domain)
            let brand = label.capitalized
            if !GenericBlocklist.isNonBrand(brand) && !WordLists.isRoleOrPlace(brand) {
                return (brand, d.domain)
            }
        }

        // 4. Organization that names a business but has no catalog entry or
        //    matching email/website.  No domain is guessed: matching runs on
        //    the name alone, and `matchAffiliated` caps it at medium (Review),
        //    never auto-selected.  Role/title and generic words were already
        //    rejected above.
        if let org = unresolvedOrganization {
            return (org, nil)
        }

        return nil
    }

    /// Job titles that describe the person, not the company.  Business words
    /// that `WordLists.roleWords` also carries ("services", "sales", "home",
    /// "office", "support") are intentionally absent.
    static let personalTitleWords: Set<String> = [
        "manager", "mgr", "gm", "asst", "assistant", "treasurer", "president",
        "vp", "director", "owner", "coordinator", "secretary", "chair",
        "chairman", "rep", "representative", "agent", "admin", "hr",
        "scheduler", "reception", "receptionist", "voicemail", "ext", "cell",
        "mobile", "fax"
    ]

    /// True when an organization string plausibly names a business: it has
    /// no personal job title and at least one word that is not a role or
    /// place word.  "Gulf Coast Roofing" and "Cypress Auto Center" pass;
    /// "Director", "Asst Treasurer", "Houston" and "Katy Home Services" do not.
    static func organizationNamesABusiness(_ org: String) -> Bool {
        let toks = WordLists.tokens(org)
        guard !toks.isEmpty else { return false }
        if toks.contains(where: { personalTitleWords.contains($0) }) { return false }
        let decoration = WordLists.roleWords.union(WordLists.geoWords)
        return toks.contains { tok in
            tok.count >= 2 && !decoration.contains(tok) && !tok.allSatisfy({ $0.isNumber })
        }
    }

    /// Matches an affiliated person against their company/organization mark.
    /// Confidence is strictly capped at .medium (never .high) and flagged "affiliated"
    /// so the contact is treated as less certain and requires explicit user opt-in.
    public func matchAffiliated(_ c: ContactIdentity) async -> MatchResult? {
        guard let aff = affiliation(for: c) else { return nil }
        let fake = ContactIdentity(
            id: c.id,
            displayName: aff.brandName,
            organization: aff.brandName,
            emailDomains: aff.domain != nil ? [aff.domain!] : [],
            websiteHosts: aff.domain != nil ? [aff.domain!] : [],
            phoneNumbers: [],
            hasImage: c.hasImage
        )
        let result = await match(fake)
        guard !result.candidates.isEmpty else {
            // Preserve failed affiliated matches if there were transient source errors
            if !result.sourceErrors.isEmpty {
                return MatchResult(
                    contactID: c.id,
                    contactClass: .person,
                    candidates: [],
                    confidence: .low,
                    flags: ["affiliated", "opt-in-review"],
                    sourceErrors: result.sourceErrors
                )
            }
            // No logo found.  Keep the row in Not found (skip, never selected)
            // so the contact stays visible and searchable and can get a manual
            // logo, instead of vanishing from every tab.
            return MatchResult(
                contactID: c.id,
                contactClass: .person,
                candidates: [],
                confidence: .skip,
                flags: ["affiliated", "opt-in-review"] + (aff.domain == nil ? ["org-name-only"] : []),
                sourceErrors: []
            )
        }
        var flags = result.flags
        if !flags.contains("affiliated") {
            flags.append("affiliated")
        }
        if !flags.contains("opt-in-review") {
            flags.append("opt-in-review")
        }
        if aff.domain == nil, !flags.contains("org-name-only") {
            flags.append("org-name-only")
        }
        let cappedConfidence = min(result.confidence, .medium)
        return MatchResult(
            contactID: c.id,
            contactClass: .person,
            candidates: result.candidates,
            confidence: cappedConfidence,
            flags: flags,
            sourceErrors: result.sourceErrors
        )
    }

    public func match(_ c: ContactIdentity) async -> MatchResult {
        let stat = staticMatch(c)
        guard stat.contactClass == .businessCard, let query = stat.query else {
            return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: [],
                               confidence: .skip, flags: stat.flags)
        }
        var flags = stat.flags
        var failures: [SourceFailure] = []
        var raw: [LogoCandidate] = []

        if let domain = stat.identity?.domain {
            for source in sources {
                if Task.isCancelled {
                    return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: [],
                                       confidence: .skip, flags: stat.flags + ["cancelled"])
                }
                do {
                    raw.append(contentsOf: try await source.candidates(forDomain: domain))
                } catch is CancellationError {
                    return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: [],
                                       confidence: .skip, flags: stat.flags + ["cancelled"])
                } catch {
                    Self.record(error, from: source.kind, into: &failures)
                }
            }
        }
        if raw.isEmpty {
            for source in sources {
                if Task.isCancelled {
                    return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: [],
                                       confidence: .skip, flags: stat.flags + ["cancelled"])
                }
                do {
                    let found = try await source.candidates(forBrandName: query)
                    // R9.2 — a name-search hit must resemble the query, or it
                    // is dropped from the ranked list (this is what kills
                    // "Cash App" → breadzine.com). Domain lookups are exempt.
                    raw.append(contentsOf: found.filter { Self.passesNameSearchGate($0, query: query) })
                } catch is CancellationError {
                    return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: [],
                                       confidence: .skip, flags: stat.flags + ["cancelled"])
                } catch {
                    Self.record(error, from: source.kind, into: &failures)
                }
            }
        }

        var measured: [LogoCandidate] = []
        var droppedTile = false
        for var candidate in raw {
            if Task.isCancelled {
                return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: [],
                                   confidence: .skip, flags: stat.flags + ["cancelled"])
            }
            if candidate.pixelWidth == nil || candidate.hasAlpha == nil {
                var data: Data? = nil
                do {
                    data = try await fetchImage(candidate.imageURL)
                } catch is CancellationError {
                    return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: [],
                                       confidence: .skip, flags: stat.flags + ["cancelled"])
                } catch let error as LogoSourceError where error == .notFound {
                    continue // 404 or a provider fallback marker: not a candidate
                } catch {
                    Self.record(error, from: candidate.source, into: &failures)
                    measured.append(candidate)
                    continue
                }
                guard let bytes = data, !ImageFlags.isTooSmall(bytes) else { continue }
                if ImageFlags.isFallbackTile(bytes) {
                    droppedTile = true
                    continue
                }
                if ImagePreparer.isVector(bytes) {
                    // R11.4 — vector marks are rasterized before measurement,
                    // otherwise they can never satisfy the square rule and the
                    // curated icons are locked out of the auto bucket (CL-06).
                    guard let prepared = try? ImagePreparer.squarePNG(from: bytes) else { continue }
                    if candidate.pixelWidth == nil {
                        candidate.pixelWidth = prepared.width
                        candidate.pixelHeight = prepared.height
                    }
                    if candidate.hasAlpha == nil { candidate.hasAlpha = true }
                } else {
                    if candidate.pixelWidth == nil, let (w, h) = ImageDimensions.read(bytes) {
                        candidate.pixelWidth = w
                        candidate.pixelHeight = h
                    }
                    if candidate.hasAlpha == nil { candidate.hasAlpha = ImageFlags.hasAlpha(bytes) }
                }
            }
            measured.append(candidate)
        }

        let ranked = CandidateRanker.rank(measured)
        let best = ranked.first
        if droppedTile { flags.append("fallback-tile") }

        // R11.2 asset tier; the homonym cap lives in the static ceiling.
        var tier = CandidateRanker.confidence(for: best, nameSimilarityPassed: true,
                                              homonymRisk: false, domainAgrees: true)
        let domainAgrees = stat.via != nil && stat.via != .guess
        // R11.3 — contact-owned website/email, or catalog/phone: a square
        // asset for that domain earns HIGH even without icon typing.
        if domainAgrees, best?.isSquareish == true, tier == .medium {
            tier = .high
            flags.append("domain-match")
        }
        // R11.4 — favicon-only hits stay in Review (last-resort marks).
        if let best, best.source == .favicon || Self.isFaviconURL(best.imageURL) {
            tier = min(tier, .medium)
            flags.append("favicon-fallback")
        }
        if let best, !best.isSquareish { flags.append("non-square") }
        if !failures.isEmpty { flags.append("source-error") }

        return MatchResult(contactID: c.id, contactClass: stat.contactClass, candidates: ranked,
                           confidence: min(stat.maxConfidence, tier), flags: flags,
                           sourceErrors: failures)
    }

    /// R9.2 — only sources searched *by name* are gated; a candidate fetched
    /// by domain is evidence in its own right (R9.3).
    static func passesNameSearchGate(_ candidate: LogoCandidate, query: String) -> Bool {
        let nameSearch: Set<SourceKind> = [.brandfetch, .wikimedia, .googleCSE, .googleScrape]
        guard nameSearch.contains(candidate.source) else { return true }
        guard let label = candidate.altText, !label.isEmpty else { return true }
        return NameNormalizer.passesSimilarity(query: query, brandName: label)
    }

    static func isFaviconURL(_ url: URL) -> Bool {
        let text = url.absoluteString.lowercased()
        return text.contains("/s2/favicons") || text.contains("icons.duckduckgo.com")
            || text.contains("faviconv2")
    }

    /// R11.6 — a source that errored is recorded, never silently dropped.
    /// "Found nothing" and "not configured" are not failures.
    static func record(_ error: Swift.Error, from kind: SourceKind, into failures: inout [SourceFailure]) {
        let failure: SourceFailure
        if let known = error as? LogoSourceError {
            guard known.isRunFailure else { return }
            switch known {
            case .rateLimited:
                failure = SourceFailure(source: kind, reason: "rate limited", rateLimited: true)
            case .serverError(let status):
                failure = SourceFailure(source: kind, reason: "server error \(status)")
            case .notFound, .misconfigured:
                return // not run failures; the guard above already returned
            }
        } else {
            failure = SourceFailure(source: kind, reason: error.localizedDescription)
        }
        // One line per source per contact: the domain and name passes can hit
        // the same wall twice.
        guard !failures.contains(failure) else { return }
        failures.append(failure)
    }

    private func looksLikePersonName(_ name: String) -> Bool {
        let cleaned = NameNormalizer.clean(name).replacingOccurrences(of: ",", with: " ")
        let parts = cleaned.split(separator: " ").map(String.init)
        guard parts.count >= 2 else { return false }
        // 2026-09-20 audit: the upper bound of 4 tokens caused long
        // real-world names ("Juan Carlos de la Cruz", "María del Carmen
        // Reyes") to fall through and be mis-promoted to .businessCard by
        // looksLikeBusinessName's ≥3-token branch.  The shape is the
        // same regardless of token count: every part is a short
        // alphabetic word, possibly with apostrophes or hyphens.
        return parts.allSatisfy { $0.range(of: #"^[A-Za-z][A-Za-z'.-]{1,30}$"#, options: .regularExpression) != nil }
    }
}
