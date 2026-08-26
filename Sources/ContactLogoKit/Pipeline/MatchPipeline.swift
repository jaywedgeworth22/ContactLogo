import Foundation

/// Orchestrates classification → normalization → identity → sources → ranking.
/// Deterministic for a fixed source set (ARCHITECTURE: one engine, three shells).
public struct MatchPipeline: Sendable {
    private let sources: [any LogoSource]
    private let fetchImage: @Sendable (URL) async throws -> Data

    public init(sources: [any LogoSource],
                fetchImage: @escaping @Sendable (URL) async throws -> Data) {
        self.sources = sources
        self.fetchImage = fetchImage
    }

    /// Review-first classes, plus lone first/last that is a firm (vendor/crest).
    public func classify(_ c: ContactIdentity) -> ContactClass {
        let orgOrName = c.organization?.isEmpty == false ? c.organization! : c.displayName
        let cleaned = NameNormalizer.clean(orgOrName)
        if GenericBlocklist.isGeneric(cleaned) { return .nonBrand }

        let given = (c.givenName ?? "").trimmingCharacters(in: .whitespaces)
        let family = (c.familyName ?? "").trimmingCharacters(in: .whitespaces)
        let hasPersonName = !given.isEmpty || !family.isEmpty
        if hasPersonName {
            // A lone given or family name that is a known firm (and has
            // no personal email) is the company, not a person.
            if inferCompanyFromLoneName(c) != nil { return .businessCard }
            return .person
        }
        return .businessCard
    }

    /// Lone first/last that is a catalog firm.
    public func inferCompanyFromLoneName(_ c: ContactIdentity) -> String? {
        let given = NameNormalizer.clean(c.givenName ?? "")
        let family = NameNormalizer.clean(c.familyName ?? "")
        let onlyGiven = !given.isEmpty && family.isEmpty
        let onlyFamily = !family.isEmpty && given.isEmpty
        let unstructured = given.isEmpty && family.isEmpty
        guard onlyGiven || onlyFamily || unstructured else { return nil }

        let consumerEmail = c.emailDomains.contains { DomainDeriver.freemail.contains($0.lowercased()) }
        if consumerEmail { return nil }

        let candidate = NameNormalizer.clean(onlyGiven ? given : onlyFamily ? family : c.displayName)
        guard !candidate.isEmpty, !looksLikePersonName(candidate) else { return nil }
        if CompanyCatalog.domain(forName: candidate) != nil { return candidate }
        return nil
    }

    public func match(_ c: ContactIdentity) async -> MatchResult {
        let klass = classify(c)
        guard klass != .nonBrand else {
            return MatchResult(contactID: c.id, contactClass: klass, candidates: [], confidence: .skip, flags: ["non-brand"])
        }
        if klass == .person {
            let flag = c.hasImage ? "photo-protected" : "person"
            return MatchResult(contactID: c.id, contactClass: klass, candidates: [], confidence: .skip, flags: [flag])
        }

        let rawName = inferCompanyFromLoneName(c)
            ?? (c.organization?.isEmpty == false ? c.organization! : c.displayName)
        var query = NameNormalizer.clean(rawName)
        var flags: [String] = []
        if let tail = NameNormalizer.brandTail(rawName) { query = tail; flags.append("brand-tail") }
        if GenericBlocklist.isHomonymRisk(query) { flags.append("homonym-risk") }

        let identity = IdentityResolver.resolve(c, brandName: query)
        if let identity {
            flags.append("via-\(identity.via.rawValue)")
        }

        var raw: [LogoCandidate] = []
        if let domain = identity?.domain {
            for s in sources {
                if let found = try? await s.candidates(forDomain: domain) { raw.append(contentsOf: found) }
            }
        }
        if raw.isEmpty {
            for s in sources {
                if let found = try? await s.candidates(forBrandName: query) { raw.append(contentsOf: found) }
            }
        }

        var measured: [LogoCandidate] = []
        for var cand in raw {
            if cand.pixelWidth == nil || cand.hasAlpha == nil {
                guard let data = try? await fetchImage(cand.imageURL) else { continue }
                if ImageFlags.isTooSmall(data) { continue }
                if cand.pixelWidth == nil, let (w, h) = ImageDimensions.read(data) {
                    cand.pixelWidth = w; cand.pixelHeight = h
                }
                if cand.hasAlpha == nil { cand.hasAlpha = ImageFlags.hasAlpha(data) }
            }
            measured.append(cand)
        }

        let ranked = CandidateRanker.rank(measured)
        let best = ranked.first
        let similarityOK = best.map { NameNormalizer.passesSimilarity(query: query, brandName: $0.altText ?? query) } ?? false
        let domainAgrees = identity != nil && identity?.via != .guess
        var conf = CandidateRanker.confidence(for: best,
                                              nameSimilarityPassed: similarityOK,
                                              homonymRisk: flags.contains("homonym-risk"),
                                              domainAgrees: domainAgrees)
        // Contact-owned website/email, or catalog/phone: a square asset
        // for that domain earns HIGH even without icon typing.
        if domainAgrees, best?.isSquareish == true, conf == .medium {
            conf = .high
            flags.append("domain-match")
        }
        // `{name}.com` guess must never auto-apply.
        if identity?.via == .guess {
            conf = min(conf, .medium)
            flags.append("guessed-domain")
        }
        // Favicon-only hits stay in Review (last-resort marks).
        if best?.source == .favicon {
            conf = min(conf, .medium)
            flags.append("favicon-fallback")
        }
        // Business cards that already have a photo are review-only (never pre-checked).
        if c.hasImage {
            conf = min(conf, .medium)
            flags.append("replace-existing")
        }
        return MatchResult(contactID: c.id, contactClass: klass, candidates: ranked,
                           confidence: conf, flags: flags)
    }

    private func looksLikePersonName(_ name: String) -> Bool {
        let cleaned = NameNormalizer.clean(name).replacingOccurrences(of: ",", with: " ")
        let parts = cleaned.split(separator: " ").map(String.init)
        guard (2...4).contains(parts.count) else { return false }
        return parts.allSatisfy { $0.range(of: #"^[A-Za-z][A-Za-z'.-]{1,30}$"#, options: .regularExpression) != nil }
    }
}
