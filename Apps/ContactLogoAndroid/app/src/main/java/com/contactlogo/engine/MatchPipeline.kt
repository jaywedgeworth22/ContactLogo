package com.contactlogo.engine

/**
 * ENGINE-CONTRACT R7 (classification), R8 (identity resolution), R9.1
 * (similarity — exposed via [Normalize.passesSimilarity] for callers that add a
 * name-search source), R10 (static confidence ceiling) and the static half of
 * R11 (asset-time tiering, R11.2/R11.4) for the Kotlin engine.
 *
 * [evaluate] is the pure, network-free R7/R8/R10 path — it is what
 * `fixtures/golden-corpus.json` (R14.2) exercises. [match] layers the R11
 * candidate list and asset tier on top to produce the UI-facing [MatchResult];
 * confidence there is `min(staticCeiling, assetTier)` per R11.2.
 */
object MatchPipeline {

    private val confidenceRank = mapOf(
        Confidence.SKIP to 0, Confidence.LOW to 1, Confidence.MEDIUM to 2, Confidence.HIGH to 3
    )

    private fun min(a: Confidence, b: Confidence): Confidence =
        if (confidenceRank.getValue(a) <= confidenceRank.getValue(b)) a else b

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------

    /** True when this contact classifies as a person (never a logo target). */
    fun isPerson(contact: ContactIdentity): Boolean =
        evaluate(contact).contactClass == ContactClass.PERSON

    /**
     * R7.4: a lone given/family name (or an unstructured card) that is a catalog
     * firm, with no personal email. Returns the candidate firm name, or null.
     * Kept under its original name for the existing test suite / call sites.
     */
    fun inferCompanyFromLoneName(contact: ContactIdentity): String? = inferLoneFirmName(contact)

    /** The static R7/R8/R10 evaluation — no network, no image fetch, no clock (R14.1). */
    fun evaluate(contact: ContactIdentity): EngineResult {
        val organization = contact.organization.trim()
        val displayName = contact.displayName
        val name = Normalize.clean(organization.ifBlank { displayName })

        // R7.1 — non-brand short-circuit, before any R6 split.
        if (Blocklists.isGenericOrNonBrand(name)) {
            return EngineResult(ContactClass.NON_BRAND, null, null, null, setOf("non-brand"), Confidence.SKIP)
        }

        val brandSource = organization.ifBlank { displayName }
        val given = contact.givenName.trim()
        val family = contact.familyName.trim()
        val hasPersonName = given.isNotEmpty() || family.isNotEmpty()

        var query: String? = null
        val flags = mutableSetOf<String>()

        if (hasPersonName) {
            val dispSegment = Normalize.selectSegment(Normalize.clean(displayName))
            val brandTailFired = "brand-tail" in dispSegment.flags

            // Employee guard candidates: the organization's own catalog identity, and
            // (if a brand-tail fired) the domain the tail names.  Used only to set the
            // `employee` flag now that a named contact is a person either way.
            val candidateDomains = mutableSetOf<String>()
            if (organization.isNotEmpty()) {
                CompanyCatalog.domainForName(organization)?.let { candidateDomains.add(it) }
            }
            if (brandTailFired) {
                tailBrandDomain(dispSegment.query)?.let { candidateDomains.add(it) }
            }

            val isEmployee = candidateDomains.isNotEmpty() && contact.emailAddresses.any { e ->
                val at = e.lastIndexOf('@')
                if (at < 0) return@any false
                val d = Normalize.registrableDomain(e.substring(at + 1))
                d != null && d in candidateDomains
            }

            if (isEmployee) {
                val personFlags = mutableSetOf("employee")
                personFlags.add(if (contact.hasCustomPhoto) "photo-protected" else "person")
                return EngineResult(ContactClass.PERSON, null, null, null, personFlags, Confidence.SKIP)
            }

            // MATCHING-ENGINE section 1: "Person: has given or family name. Never a
            // logo target. Employees are not the company."  That outranks section 5
            // rule 8: a known brand tail names who this person is affiliated with,
            // not a business to badge.  "Dana At Costco" is Dana.
            //
            // Rule 8 still applies to a card with no name fields — that path never
            // enters this branch — and `inferLoneFirmName` still catches a company
            // misfiled into a name field, because it requires the name not to look
            // like a person's.
            val lone = inferLoneFirmName(contact)
            if (lone != null) {
                flags.add("lone-firm-name")
            } else {
                val personFlags = setOf(if (contact.hasCustomPhoto) "photo-protected" else "person")
                return EngineResult(ContactClass.PERSON, null, null, null, personFlags, Confidence.SKIP)
            }
        }
        // Every path that falls through to here is a businessCard: either there was
        // no person name at all, a brand-tail promoted it (rule 8), or a lone firm
        // name did (R7.4). Every other path already returned above.

        // businessCard path: derive the query via R6 on clean(brandSource) unless
        // the person-path brand-tail already set it.
        if (query == null) {
            val cleanedSource = Normalize.clean(brandSource)
            val seg = Normalize.selectSegment(cleanedSource)
            // No name fields, but "Dana At Costco" is still a person and plenty of
            // imports carry no structured name at all, so read the head.
            if ("brand-tail" in seg.flags) {
                val head = Normalize.splitHead(cleanedSource)
                if (head != null && Normalize.headLooksPersonal(head)) {
                    val personFlags = setOf(if (contact.hasCustomPhoto) "photo-protected" else "person")
                    return EngineResult(ContactClass.PERSON, null, null, null, personFlags, Confidence.SKIP)
                }
            }
            query = seg.query
            flags += seg.flags
        }
        val resolvedQuery = query

        // R7.5 — re-test the derived query. Catches "Front Desk - Hospital" without
        // blocklisting "Riverbend Clinic - Voicemail".
        if (Blocklists.isGenericOrNonBrand(resolvedQuery)) {
            return EngineResult(ContactClass.NON_BRAND, null, null, null, setOf("non-brand"), Confidence.SKIP)
        }

        if (Normalize.companyKey(resolvedQuery) in Blocklists.HOMONYM) {
            flags.add("homonym-risk")
        }

        // R8 — identity resolution, strict order.
        val identity = resolveIdentity(contact, resolvedQuery, organization, displayName)
            ?: run {
                flags.add("no-identity")
                return EngineResult(ContactClass.BUSINESS_CARD, resolvedQuery, null, null, flags, Confidence.SKIP)
            }

        val (domain, via, identityFlags) = identity
        flags += identityFlags
        flags.add("via-$via")
        if (via == "guess") flags.add("guessed-domain")

        // R10 — static ceiling: start high, apply every matching cap (min wins).
        var ceiling = Confidence.HIGH
        fun cap(c: Confidence) { ceiling = min(ceiling, c) }

        if (via == "guess") cap(Confidence.MEDIUM)
        // R10.1b — an email domain is the contact's own data but routinely not the
        // brand's (subsidiaries, regional domains, resellers, consultants on a
        // client domain).  Cap when it shares no token with the query; let an
        // evident one through ("Bluebonnet Dental" at bluebonnetdental.com).
        if (via == "email" && !Normalize.passesSimilarity(resolvedQuery, domainLabel(domain))) {
            flags.add("email-domain-unrelated")
            cap(Confidence.MEDIUM)
        }
        if ("homonym-risk" in flags && via !in setOf("website", "email", "phone")) cap(Confidence.MEDIUM)
        if ("brand-tail" in flags) cap(Confidence.MEDIUM)
        if (contact.hasCustomPhoto) {
            cap(Confidence.MEDIUM)
            flags.add("replace-existing")
        }
        if (domain in Blocklists.MERGED_DOMAINS) {
            cap(Confidence.MEDIUM)
            flags.add("brand-redirect-risk")
        }

        return EngineResult(ContactClass.BUSINESS_CARD, resolvedQuery, domain, via, flags, ceiling)
    }

    /**
     * The UI-facing match: [evaluate] plus the R11 candidate list and asset-time
     * tier. Final confidence is `min(staticCeiling, assetTier)` (R11.2); a favicon
     * winner is capped at medium and can never reach high (R11.4).
     */
    fun match(contact: ContactIdentity): MatchResult {
        val result = evaluate(contact)
        val domain = result.domain
        if (result.contactClass != ContactClass.BUSINESS_CARD || domain == null) {
            return MatchResult(
                contact = contact,
                matchedDomain = null,
                confidence = Confidence.SKIP,
                query = result.query,
                via = result.via,
                flags = result.flags
            )
        }

        val candidates = generateCandidates(domain)
        val assetTier = assetTierOf(candidates.firstOrNull())
        val confidence = min(result.maxConfidence, assetTier)

        return MatchResult(
            contact = contact,
            matchedDomain = domain,
            confidence = confidence,
            candidates = candidates,
            selectedIndex = 0,
            approved = confidence == Confidence.HIGH && candidates.isNotEmpty(),
            query = result.query,
            via = result.via,
            flags = result.flags
        )
    }

    // -----------------------------------------------------------------
    // R7.4 lone firm name
    // -----------------------------------------------------------------

    private fun looksLikePersonName(n: String): Boolean {
        val parts = Normalize.clean(n).replace(",", " ").split(Regex("""\s+""")).filter { it.isNotBlank() }
        if (parts.size !in 2..4) return false
        return parts.all { it.matches(Regex("""^[A-Za-z][A-Za-z'.-]{1,30}$""")) }
    }

    /**
     * R10.1b — the registrable domain minus its public suffix, which is the part
     * that can plausibly name the brand.  Kept identical to the Swift and
     * TypeScript engines: strip the last dot-segment, nothing more.
     */
    private fun domainLabel(domain: String): String {
        val dot = domain.lastIndexOf('.')
        return if (dot < 0) domain else domain.substring(0, dot)
    }

    private fun isFreemailAddress(email: String): Boolean {
        val at = email.lastIndexOf('@')
        if (at < 0) return false
        val d = Normalize.registrableDomain(email.substring(at + 1)) ?: return false
        return d in Blocklists.FREEMAIL
    }

    private fun inferLoneFirmName(contact: ContactIdentity): String? {
        val given = Normalize.clean(contact.givenName)
        val family = Normalize.clean(contact.familyName)
        val onlyGiven = given.isNotEmpty() && family.isEmpty()
        val onlyFamily = family.isNotEmpty() && given.isEmpty()
        val unstructured = given.isEmpty() && family.isEmpty()
        if (!onlyGiven && !onlyFamily && !unstructured) return null
        if (contact.emailAddresses.any { isFreemailAddress(it) }) return null

        val candidate = when {
            onlyGiven -> given
            onlyFamily -> family
            else -> Normalize.clean(contact.displayName)
        }
        if (candidate.isEmpty() || looksLikePersonName(candidate)) return null
        if (CompanyCatalog.domainForName(candidate) != null) return candidate
        return null
    }

    // -----------------------------------------------------------------
    // R8 identity resolution
    // -----------------------------------------------------------------

    private data class Identity(val domain: String, val via: String, val flags: Set<String>)

    /**
     * R8 applied to the tail alone (R7.3.b's employee guard): R8.3 here is
     * restricted to `catalogDomain(tail)` — no organization/displayName fallback.
     */
    /**
     * R7.3.b — the domain the *brand tail* names, for the employee guard only.
     *
     * Name-derived sources exclusively.  This walked `contact.urls` and
     * `contact.emailAddresses` first, which made the guard compare the contact's
     * email against a domain taken from that same email — always a match.  Any
     * rule-8 card with an unrelated work email was therefore filed as an employee
     * and dropped from review: "Dana At Costco" with dana@consulting.com never
     * reached Costco, and neither did MATCHING-ENGINE section 5's own examples
     * "Chris At NTB" and "Byron Goode Jr - Root Insurance".
     *
     * The guard asks "does this person's email say they work at the brand on the
     * card?", so the brand's domain has to come from the brand's name and nothing
     * else.  The Swift kit already does this via `guessDomain(brandName)`.
     */
    private fun tailBrandDomain(tail: String): String? {
        CompanyCatalog.domainForName(tail)?.let { return it }
        return Normalize.guessSlug(tail)?.let { "$it.com" }
    }

    /** R8: website -> work email -> catalog -> phone -> guess. Strict order; first hit wins. */
    private fun resolveIdentity(
        contact: ContactIdentity,
        query: String,
        organization: String,
        displayName: String
    ): Identity? {
        var socialIgnored = false
        var platformIgnored = false

        // R8.1 Website
        for (u in contact.urls) {
            val fullHost = Normalize.fullHost(u)
            val d = Normalize.registrableDomain(u)
            if (d == null) continue
            if (d in Blocklists.FREEMAIL) continue
            if ((fullHost != null && fullHost in Blocklists.SOCIAL) || d in Blocklists.SOCIAL) {
                socialIgnored = true
                continue
            }
            if ((fullHost != null && fullHost in Blocklists.PLATFORM) || d in Blocklists.PLATFORM) {
                platformIgnored = true
                continue
            }
            val flags = mutableSetOf<String>()
            if (socialIgnored) flags.add("social-url-ignored")
            if (platformIgnored) flags.add("platform-host-ignored")
            if (Normalize.isSubdomainReduced(fullHost, d)) flags.add("subdomain-reduced")
            if (Normalize.hasUserinfo(u)) flags.add("userinfo-stripped")
            return Identity(d, "website", flags)
        }

        // R8.2 Work email
        for (e in contact.emailAddresses) {
            val at = e.lastIndexOf('@')
            if (at < 0) continue
            val hostPart = e.substring(at + 1)
            val fullHost = hostPart.trim().lowercase()
            val d = Normalize.registrableDomain(hostPart)
            if (d == null) continue
            if (d in Blocklists.FREEMAIL) continue
            if (d in Blocklists.SOCIAL) {
                socialIgnored = true
                continue
            }
            val flags = mutableSetOf<String>()
            if (socialIgnored) flags.add("social-url-ignored")
            if (Normalize.isSubdomainReduced(fullHost, d)) flags.add("subdomain-reduced")
            return Identity(d, "email", flags)
        }

        // R8.3 Catalog: catalogDomain(query) ?? catalogDomain(organization) ?? catalogDomain(displayName)
        for (candidate in listOf(query, organization, displayName)) {
            if (candidate.isBlank()) continue
            val d = CompanyCatalog.domainForName(candidate)
            if (d != null) {
                val flags = mutableSetOf<String>()
                if (socialIgnored) flags.add("social-url-ignored")
                if (platformIgnored) flags.add("platform-host-ignored")
                return Identity(d, "catalog", flags)
            }
        }

        // R8.4 Phone directory
        for (p in contact.phoneNumbers) {
            val d = PhoneDirectory.domainForPhone(p)
            if (d != null) {
                val flags = mutableSetOf<String>()
                if (socialIgnored) flags.add("social-url-ignored")
                if (platformIgnored) flags.add("platform-host-ignored")
                return Identity(d, "phone", flags)
            }
        }

        // R8.5 Guess: {companyKey(query)}.com, 3-24 chars, else no identity.
        val slug = Normalize.guessSlug(query)
        if (slug != null) {
            val flags = mutableSetOf<String>()
            if (socialIgnored) flags.add("social-url-ignored")
            if (platformIgnored) flags.add("platform-host-ignored")
            return Identity("$slug.com", "guess", flags)
        }
        return null
    }

    // -----------------------------------------------------------------
    // R11 (static half): candidate generation and asset tiering
    // -----------------------------------------------------------------

    /**
     * R11 candidate list. Simple Icons (a real, curated brand glyph) is offered
     * first when a slug maps to this domain; favicon fallbacks are always last
     * resort. Before this fix `google.com/s2/favicons` sat at index 0 for every
     * domain, favicon or not (CL-04b).
     */
    private fun generateCandidates(domain: String): List<LogoCandidate> {
        val candidates = mutableListOf<LogoCandidate>()

        SimpleIcons.slugFor(domain)?.let { slug ->
            candidates.add(
                LogoCandidate(
                    url = "https://cdn.simpleicons.org/$slug",
                    source = "simpleIcons",
                    width = 512,
                    height = 512,
                    isVector = true
                )
            )
        }

        // Favicon fallbacks (R3 source 7 / R11.4): last resort, never high.
        candidates.add(
            LogoCandidate(
                url = "https://www.google.com/s2/favicons?domain=$domain&sz=128",
                source = "favicon",
                width = 128,
                height = 128,
                isVector = false
            )
        )
        candidates.add(
            LogoCandidate(
                url = "https://$domain/favicon.ico",
                source = "favicon",
                width = 64,
                height = 64,
                isVector = false
            )
        )

        return candidates
    }

    /**
     * R11.2/R11.4 asset tier for the best candidate. Simple Icons glyphs are
     * curated square icon-typed assets (high-eligible); any favicon-sourced
     * candidate — a Google s2 favicon, `/favicon.ico`, or any other favicon endpoint —
     * is capped at medium and MUST NEVER read high, however confident the static
     * ceiling was. No candidate at all is `skip`.
     */
    private fun assetTierOf(best: LogoCandidate?): Confidence {
        if (best == null) return Confidence.SKIP
        return if (best.source == "favicon") Confidence.MEDIUM else Confidence.HIGH
    }
}
