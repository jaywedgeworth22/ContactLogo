package com.contactlogo.engine

/**
 * R8.3 — offline name -> official domain catalog, plus the CATALOG_TAIL_OK
 * sub-brand reduction ("H-E-B Pharmacy" -> heb.com, "Kroger Marketplace Cypress"
 * -> kroger.com) without folding trade-word tails onto the wrong parent
 * ("Delta Dental" MUST NOT reduce to delta.com).
 */
object CompanyCatalog {

    private val domains: Map<String, String> = mapOf(
        "apple" to "apple.com", "apple inc" to "apple.com",
        "google" to "google.com", "alphabet" to "google.com",
        "microsoft" to "microsoft.com", "amazon" to "amazon.com",
        "meta" to "meta.com", "facebook" to "facebook.com", "instagram" to "instagram.com",
        "netflix" to "netflix.com", "spotify" to "spotify.com", "uber" to "uber.com",
        "lyft" to "lyft.com", "airbnb" to "airbnb.com", "door dash" to "doordash.com",
        "doordash" to "doordash.com", "instacart" to "instacart.com",
        "walmart" to "walmart.com", "target" to "target.com", "costco" to "costco.com",
        "home depot" to "homedepot.com", "the home depot" to "homedepot.com",
        "lowes" to "lowes.com", "lowe's" to "lowes.com",
        "starbucks" to "starbucks.com", "mcdonalds" to "mcdonalds.com",
        "mcdonald's" to "mcdonalds.com", "chick fil a" to "chick-fil-a.com",
        "chick-fil-a" to "chick-fil-a.com", "chipotle" to "chipotle.com",
        "delta" to "delta.com", "delta air lines" to "delta.com",
        "united" to "united.com", "united airlines" to "united.com",
        "american airlines" to "aa.com", "southwest" to "southwest.com",
        "southwest airlines" to "southwest.com",
        "chase" to "chase.com", "jpmorgan" to "jpmorganchase.com",
        "bank of america" to "bankofamerica.com", "bofa" to "bankofamerica.com",
        "wells fargo" to "wellsfargo.com", "citi" to "citi.com", "citibank" to "citi.com",
        "american express" to "americanexpress.com", "amex" to "americanexpress.com",
        "capital one" to "capitalone.com", "discover" to "discover.com",
        "charles schwab" to "schwab.com", "schwab" to "schwab.com",
        "fidelity" to "fidelity.com", "vanguard" to "vanguard.com",
        "progressive" to "progressive.com", "geico" to "geico.com",
        "state farm" to "statefarm.com", "allstate" to "allstate.com",
        "at&t" to "att.com", "att" to "att.com", "verizon" to "verizon.com",
        "t-mobile" to "t-mobile.com", "tmobile" to "t-mobile.com",
        "comcast" to "xfinity.com", "xfinity" to "xfinity.com", "spectrum" to "spectrum.com",
        "fedex" to "fedex.com", "ups" to "ups.com", "usps" to "usps.com",
        "heb" to "heb.com", "h-e-b" to "heb.com", "kroger" to "kroger.com",
        "publix" to "publix.com", "walgreens" to "walgreens.com", "cvs" to "cvs.com",
        "trader joes" to "traderjoes.com", "trader joe's" to "traderjoes.com",
        "aldi" to "aldi.us", "whole foods" to "wholefoodsmarket.com",
        "kaiser" to "kp.org", "kaiser permanente" to "kp.org",
        "quest" to "questdiagnostics.com", "quest diagnostics" to "questdiagnostics.com",
        "labcorp" to "labcorp.com", "enterprise" to "enterprise.com",
        "hertz" to "hertz.com", "avis" to "avis.com",
        "shell" to "shell.com", "chevron" to "chevron.com",
        "exxon" to "exxon.com", "exxonmobil" to "exxonmobil.com",
        "bp" to "bp.com", "7-eleven" to "7-eleven.com",
        "wawa" to "wawa.com", "buc-ees" to "buc-ees.com",
        "h&r block" to "hrblock.com",
        "cisco" to "cisco.com",
        // MATCHING-ENGINE §2 rule 4 alias map.
        "txt" to "texasbytexas.com", "gcx" to "raise.com"
    )

    /** R8.3 CATALOG_TAIL_OK = GEO_WORDS (R6.6) union SUBBRAND_TAIL, tested word by word. */
    private val subbrandTailWords: Set<String> = setOf(
        "pharmacy", "deli", "bakery", "fuel", "gas", "market", "marketplace", "optical", "photo",
        "curbside", "drive", "thru", "corporate", "hq", "distribution", "warehouse"
    )
    private val tailOkWords: Set<String> = Normalize.GEO_WORDS_LITERAL + subbrandTailWords
    private val tailOkNumeric = listOf(Regex("""^#\d*$"""), Regex("""^\d{2,5}$"""))

    private fun isTailOkWord(w: String): Boolean {
        if (w.lowercase() in tailOkWords) return true
        return tailOkNumeric.any { it.matches(w) }
    }

    /**
     * R8.3 — may this tail be dropped, leaving the head brand?
     *
     * Two conditions, and both are needed.  Requiring only that *some* word be
     * tail-ok reduced "Delta Dental Center" to delta.com on the strength of
     * `center` alone — an airline's logo on a dental practice.  Requiring that
     * *every* word be tail-ok instead rejected "Walgreens Mason Rd", because a
     * street name is not on any list and never can be.
     *
     * So: something must positively mark the tail as a place or department, and
     * nothing in it may name a different trade.  An unrecognised word ("mason")
     * is tolerated as part of an address; an ORG_SIGNAL word ("dental") is not,
     * since it makes the tail a business of its own.  SUBBRAND_TAIL wins where
     * the two lists overlap — "pharmacy" and "bakery" are H-E-B departments.
     */
    fun isCatalogTailOK(tail: List<String>): Boolean {
        if (tail.isEmpty()) return false
        if (tail.none { isTailOkWord(it) }) return false
        return tail.all { isTailOkWord(it) || !Normalize.isOrgSignalWord(it) }
    }

    /**
     * R8.3: `DOMAINS[companyKey(raw)]`, else the space-collapsed key, else the
     * longest-head / sub-brand-tail reduction, else null.
     */
    fun domainForName(name: String): String? {
        val k = Normalize.companyKey(name)
        if (k.isEmpty()) return null
        domains[k]?.let { return it }

        val nospace = k.replace(" ", "")
        domains[nospace]?.let { return it }

        val words = k.split(" ")
        for (i in words.size - 1 downTo 1) {
            val head = words.subList(0, i).joinToString(" ")
            val tailWords = words.subList(i, words.size)
            val dom = domains[head] ?: domains[head.replace(" ", "")]
            if (dom != null && isCatalogTailOK(tailWords)) return dom
        }
        return null
    }
}
