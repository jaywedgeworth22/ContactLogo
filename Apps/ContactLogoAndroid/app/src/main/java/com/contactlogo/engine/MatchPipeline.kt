package com.contactlogo.engine

import java.net.URI

object MatchPipeline {

    fun match(contact: ContactIdentity): MatchResult {
        // Same contract as ContactLogoKit / web: people are never logo targets.
        // A catalog organization must not auto-apply a brand mark over a person.
        if (isPersonContact(contact)) {
            return MatchResult(contact, null, Confidence.SKIP)
        }

        val domain = resolveDomain(contact)
        if (domain == null) {
            return MatchResult(contact, null, Confidence.SKIP)
        }

        val candidates = generateCandidates(domain, contact.organization.ifBlank { contact.displayName })
        val confidence = when {
            CompanyCatalog.domainForName(contact.organization) != null ||
            CompanyCatalog.domainForName(contact.displayName) != null -> Confidence.HIGH
            contact.phoneNumbers.any { PhoneDirectory.domainForPhone(it) != null } -> Confidence.HIGH
            candidates.isNotEmpty() -> Confidence.MEDIUM
            else -> Confidence.LOW
        }

        return MatchResult(
            contact = contact,
            matchedDomain = domain,
            confidence = confidence,
            candidates = candidates,
            selectedIndex = 0,
            approved = confidence == Confidence.HIGH
        )
    }

    private fun resolveDomain(contact: ContactIdentity): String? {
        // 1. Explicit URL
        for (u in contact.urls) {
            val d = extractRegistrableDomain(u)
            if (d != null && !isFreemailOrSocial(d)) return d
        }

        // 2. Organization Name in Catalog
        if (contact.organization.isNotBlank()) {
            CompanyCatalog.domainForName(contact.organization)?.let { return it }
        }

        // 3. Display Name in Catalog
        CompanyCatalog.domainForName(contact.displayName)?.let { return it }

        // 4. Brand tail ("Byron - Root Insurance")
        val tail = Normalize.brandTail(contact.displayName)
        if (tail != null) {
            CompanyCatalog.domainForName(tail)?.let { return it }
        }

        // 5. Phone directory
        for (p in contact.phoneNumbers) {
            PhoneDirectory.domainForPhone(p)?.let { return it }
        }

        // 6. Email domain
        for (e in contact.emailAddresses) {
            val parts = e.split("@")
            if (parts.size == 2) {
                val d = parts[1].trim().lowercase()
                if (!isFreemailOrSocial(d)) return d
            }
        }

        return null
    }

    private fun generateCandidates(domain: String, brandName: String): List<LogoCandidate> {
        val candidates = mutableListOf<LogoCandidate>()
        val baseSlug = domain.replace(Regex("""\.[a-z]{2,}$"""), "").replace(Regex("""[^a-z0-9]"""), "")

        // 1. Google Favicon high-res
        candidates.add(
            LogoCandidate(
                url = "https://www.google.com/s2/favicons?domain=$domain&sz=128",
                source = "google_favicon",
                width = 128,
                height = 128,
                isVector = false
            )
        )

        // 2. SimpleIcons SVG / PNG
        if (baseSlug.isNotBlank()) {
            candidates.add(
                LogoCandidate(
                    url = "https://cdn.simpleicons.org/$baseSlug",
                    source = "simple_icons",
                    width = 512,
                    height = 512,
                    isVector = true
                )
            )
        }

        // 3. Direct Favicon
        candidates.add(
            LogoCandidate(
                url = "https://$domain/favicon.ico",
                source = "favicon_direct",
                width = 64,
                height = 64,
                isVector = false
            )
        )

        return candidates
    }

    private fun extractRegistrableDomain(url: String): String? {
        return try {
            val normalized = if (!url.startsWith("http://") && !url.startsWith("https://")) "https://$url" else url
            val uri = URI(normalized)
            uri.host?.lowercase()?.removePrefix("www.")
        } catch (_: Exception) {
            null
        }
    }

    private fun isFreemailOrSocial(domain: String): Boolean {
        val blocked = setOf(
            "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com",
            "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com"
        )
        return blocked.contains(domain)
    }

    /** Lone first/last that is a catalog firm, matching ContactLogoKit. */
    fun inferCompanyFromLoneName(contact: ContactIdentity): String? {
        val given = Normalize.cleanName(contact.givenName)
        val family = Normalize.cleanName(contact.familyName)
        val onlyGiven = given.isNotBlank() && family.isBlank()
        val onlyFamily = family.isNotBlank() && given.isBlank()
        val unstructured = given.isBlank() && family.isBlank()
        if (!onlyGiven && !onlyFamily && !unstructured) return null
        if (contact.emailAddresses.any { email ->
                val domain = email.substringAfter("@", "").trim().lowercase()
                domain.isNotEmpty() && isFreemailOrSocial(domain)
            }
        ) {
            return null
        }
        val candidate = Normalize.cleanName(
            when {
                onlyGiven -> given
                onlyFamily -> family
                else -> contact.displayName
            }
        )
        if (candidate.isBlank() || looksLikePersonName(candidate)) return null
        return if (CompanyCatalog.domainForName(candidate) != null) candidate else null
    }

    fun isPersonContact(contact: ContactIdentity): Boolean {
        if (inferCompanyFromLoneName(contact) != null) return false
        val hasPersonName = contact.givenName.isNotBlank() || contact.familyName.isNotBlank()
        if (hasPersonName) return true
        val org = contact.organization.trim()
        return isTwoTokenPersonName(contact.displayName) &&
            org.isNotBlank() &&
            !contact.displayName.equals(org, ignoreCase = true)
    }

    private fun looksLikePersonName(name: String): Boolean {
        val parts = Normalize.cleanName(name).replace(",", " ").split(Regex("""\s+""")).filter { it.isNotBlank() }
        if (parts.size !in 2..4) return false
        return parts.all { it.matches(Regex("""^[A-Za-z][A-Za-z'.-]{1,30}$""")) }
    }

    private fun isTwoTokenPersonName(name: String): Boolean {
        val parts = name.trim().split(Regex("""\s+"""))
        return parts.size == 2 && parts.all { it.firstOrNull()?.isUpperCase() == true }
    }
}
