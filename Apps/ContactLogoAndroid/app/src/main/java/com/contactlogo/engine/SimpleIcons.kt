package com.contactlogo.engine

/**
 * R13 — the canonical Simple Icons slug map (domain -> slug) and the SKIP set.
 *
 * R13.2: slugs MUST NOT be derived. Before this file existed, Android derived the
 * slug by stripping the TLD (`domain.replace(Regex("\\.[a-z]{2,}$"), "")`), so
 * `delta.com` -> "delta" -> the Delta *software* company mark: a confident,
 * square, transparent, wrong logo (CL-04). Slugs are brand names, not domain
 * labels (`chase.com` -> "chase", `att.com` -> "atandt") — derivation is only
 * ever right by accident.
 */
object SimpleIcons {

    private val slugs: Map<String, String> = mapOf(
        "apple.com" to "apple", "google.com" to "google", "meta.com" to "meta",
        "facebook.com" to "facebook", "instagram.com" to "instagram",
        "tesla.com" to "tesla", "nvidia.com" to "nvidia", "netflix.com" to "netflix",
        "spotify.com" to "spotify", "salesforce.com" to "salesforce",
        "intel.com" to "intel", "cisco.com" to "cisco", "stripe.com" to "stripe",
        "paypal.com" to "paypal", "visa.com" to "visa",
        "mastercard.com" to "mastercard", "americanexpress.com" to "americanexpress",
        "chase.com" to "chase", "jpmorganchase.com" to "chase",
        "bankofamerica.com" to "bankofamerica", "wellsfargo.com" to "wellsfargo",
        "verizon.com" to "verizon", "att.com" to "atandt",
        "united.com" to "unitedairlines", "aa.com" to "americanairlines",
        "southwest.com" to "southwestairlines", "fedex.com" to "fedex",
        "ups.com" to "ups", "usps.com" to "usps", "target.com" to "target",
        "starbucks.com" to "starbucks", "mcdonalds.com" to "mcdonalds",
        "uber.com" to "uber", "lyft.com" to "lyft", "doordash.com" to "doordash",
        "airbnb.com" to "airbnb", "nike.com" to "nike", "samsung.com" to "samsung",
        "sony.com" to "sony", "ford.com" to "ford", "bmw.com" to "bmw", "x.ai" to "x",
        "x.com" to "x", "twitter.com" to "x", "squareup.com" to "square",
        "github.com" to "github", "youtube.com" to "youtube",
        "discord.com" to "discord", "zoom.us" to "zoom", "notion.so" to "notion",
        "figma.com" to "figma", "dropbox.com" to "dropbox",
        "pinterest.com" to "pinterest", "reddit.com" to "reddit",
        "tiktok.com" to "tiktok", "whatsapp.com" to "whatsapp",
        "telegram.org" to "telegram", "signal.org" to "signal", "ebay.com" to "ebay",
        "shopify.com" to "shopify", "spacex.com" to "spacex", "starlink.com" to "spacex"
    )

    /**
     * R13.3 — domains whose derived-looking slug belongs to a different company on
     * the same domain key. `delta.com` is served by the curated Delta triangle mark
     * (preferred-marks source), never by a `delta` Simple Icons glyph.
     */
    private val skip: Set<String> = setOf("delta.com")

    /** R13.2: a domain absent from the map yields no candidate — never a guessed slug. */
    fun slugFor(domain: String?): String? {
        if (domain == null || domain in skip) return null
        return slugs[domain]
    }
}
