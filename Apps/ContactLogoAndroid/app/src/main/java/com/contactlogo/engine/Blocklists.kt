package com.contactlogo.engine

/**
 * Canonical blocklists, the social/platform host sets, and the homonym set from
 * docs/ENGINE-CONTRACT.md R2-R4. Before this file existed there was no generic
 * blocklist anywhere in the Android tree (CL-04a): "Hospital", "Gift Card",
 * "Manager", "Verification Code (Twilio Powered)" and "Printer at Farm (WF-2950)"
 * were all treated as business cards and auto-matched.
 */
object Blocklists {

    /** R2 — consumer mail hosts and their common typo-squats (32). Never a logo domain or work email. */
    val FREEMAIL: Set<String> = setOf(
        "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "me.com", "mac.com",
        "aol.com", "live.com", "msn.com", "qq.com", "163.com", "126.com", "foxmail.com",
        "protonmail.com", "proton.me", "pm.me", "gmx.com", "mail.com", "comcast.net", "verizon.net",
        "att.net", "sbcglobal.net", "ymail.com", "googlemail.com", "hey.com", "fastmail.com",
        "zoho.com", "yandex.com", "mail.ru", "gnail.com", "hoymail.com"
    )

    /** R3.1 — profile/directory/press hosts (22). Never a logo domain, on the website or the email path (R3.2). */
    val SOCIAL: Set<String> = setOf(
        "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
        "crunchbase.com", "wikipedia.org", "yelp.com", "tripadvisor.com", "glassdoor.com",
        "tiktok.com", "pinterest.com", "reddit.com", "bloomberg.com", "vimeo.com", "medium.com",
        "github.com", "foursquare.com", "weibo.com", "fb.com", "apple.news"
    )

    /** R3.3 — site builders, tenant hosts, link-in-bio, shorteners (25). Tested against full host AND registrable domain. */
    val PLATFORM: Set<String> = setOf(
        "wixsite.com", "wix.com", "weebly.com", "squarespace.com", "godaddysites.com",
        "business.site", "square.site", "sites.google.com", "wordpress.com", "blogspot.com",
        "myshopify.com", "linktr.ee", "about.me", "carrd.co", "notion.site", "webflow.io",
        "netlify.app", "vercel.app", "github.io", "pages.dev", "herokuapp.com", "wa.me",
        "goo.gl", "bit.ly", "tinyurl.com"
    )

    /** R3.4 — domains that now redirect to a successor brand. Capped at medium (R10.5), not dropped. */
    val MERGED_DOMAINS: Set<String> = setOf("ntb.com")

    /** R4.3 — exact GENERIC blocklist (24), keyed on companyKey(name). Tested before HOMONYM (R4.1). */
    val GENERIC: Set<String> = setOf(
        "hospital", "gift card", "manager", "market manager", "medico", "jerry",
        "verification", "verification code", "verification codes", "candy",
        "link", "cash", "info", "office", "reception", "front desk",
        "support", "customer service", "voicemail", "suspected spam",
        "emergency", "spam risk", "nice", "meme"
    )

    /** R4.4 — NON_BRAND patterns (4), tested against clean(name). */
    private val nonBrandPatterns = listOf(
        Regex("""\bprinter\b""", RegexOption.IGNORE_CASE),
        Regex("""\bWF-\d{4}\b""", RegexOption.IGNORE_CASE),
        Regex("""\bverification\b""", RegexOption.IGNORE_CASE),
        Regex("""\bpassword\b|\bpasscode\b""", RegexOption.IGNORE_CASE)
    )

    /** R4.5 — real brands whose name collides across categories (13). Flagged (`homonym-risk`), not skipped. */
    val HOMONYM: Set<String> = setOf(
        "ibc", "mercury", "delta", "apple", "amazon", "carnival", "empower",
        "link", "jerry", "candy", "pioneer", "united", "premier"
    )

    fun isNonBrandPattern(cleanedName: String): Boolean =
        nonBrandPatterns.any { it.containsMatchIn(cleanedName) }

    /** R4.2 — GENERIC is exact-matched on companyKey(name), never on the raw or merely cleaned name. */
    fun isGenericExact(name: String): Boolean = Normalize.companyKey(name) in GENERIC

    /** The combined R7.1 / R7.5 non-brand test: NON_BRAND patterns, then the exact GENERIC set. */
    fun isGenericOrNonBrand(name: String): Boolean {
        val cleaned = Normalize.clean(name)
        return isNonBrandPattern(cleaned) || isGenericExact(name)
    }
}
