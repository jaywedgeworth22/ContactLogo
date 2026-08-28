package com.contactlogo.engine

import java.util.Locale

/**
 * Static, network-free normalization and segment-selection per
 * docs/ENGINE-CONTRACT.md R1 (registrable domain), R5 (name normalization) and
 * R6 (segment selection — which part of a name is the brand).
 *
 * This is the Kotlin half of the three-engine contract (Swift/TypeScript/Kotlin
 * must agree byte-for-byte on every observable in R14). Keep changes mirrored.
 */
object Normalize {

    // -----------------------------------------------------------------
    // R1. registrableDomain
    // -----------------------------------------------------------------

    private val cctldSecondLevel = Regex("""^(com|co|org|net|gov|edu|ac)\.[a-z]{2}$""")
    private val portRegex = Regex(""":\d+$""")
    private val escapeRegex = Regex("""%[0-9a-f]{2}""")
    private val pathBoundary = Regex("""[/?#]""")
    private val whitespaceRegex = Regex("""\s+""")

    /** Strips scheme/path/userinfo/port/escapes per R1 steps 1-7, returns null on an invalid scheme. */
    private fun authority(input: String): String? {
        var s = input.trim().lowercase(Locale.ROOT)
        if (s.isEmpty()) return null

        val schemeIdx = s.indexOf("://")
        if (schemeIdx >= 0) {
            val scheme = s.substring(0, schemeIdx)
            if (scheme != "http" && scheme != "https") return null
            s = s.substring(schemeIdx + 3)
        }

        val boundary = pathBoundary.find(s)
        if (boundary != null) s = s.substring(0, boundary.range.first)

        val lastAt = s.lastIndexOf('@')
        if (lastAt >= 0) s = s.substring(lastAt + 1)

        s = s.replace(portRegex, "")
        s = s.replace(escapeRegex, "")
        s = s.trim('.')
        return s.ifEmpty { null }
    }

    /**
     * R1: reduce a raw contact field (a URL, or the part of an email after '@') to its
     * registrable domain (public-suffix-ish + 1 label, per R1.10's deliberately simple
     * multi-part-ccTLD rule — no PSL dependency). Returns null per any R1 step failure.
     */
    fun registrableDomain(input: String): String? {
        var s = authority(input) ?: return null

        if (s.startsWith("www.")) s = s.removePrefix("www.")

        val labels = s.split(".").filter { it.isNotEmpty() }
        if (labels.size < 2) return null

        if (labels.size >= 3) {
            val lastTwo = labels.takeLast(2).joinToString(".")
            if (cctldSecondLevel.matches(lastTwo)) return labels.takeLast(3).joinToString(".")
        }
        return labels.takeLast(2).joinToString(".")
    }

    /** The full host before R1.9-R1.11 reduction (www. still stripped), for SOCIAL/PLATFORM full-host tests. */
    fun fullHost(input: String): String? = authority(input)

    /** True when the URL's authority carries userinfo ("user@host") that R1.4 strips. */
    fun hasUserinfo(input: String): Boolean {
        var s = input.trim().lowercase(Locale.ROOT)
        val schemeIdx = s.indexOf("://")
        if (schemeIdx >= 0) {
            val scheme = s.substring(0, schemeIdx)
            if (scheme != "http" && scheme != "https") return false
            s = s.substring(schemeIdx + 3)
        }
        val boundary = pathBoundary.find(s)
        if (boundary != null) s = s.substring(0, boundary.range.first)
        return s.contains('@')
    }

    /** True when reducing the full host to `reduced` dropped a label other than `www`. */
    fun isSubdomainReduced(fullHost: String?, reduced: String): Boolean {
        if (fullHost == null) return false
        val withoutWww = if (fullHost.startsWith("www.")) fullHost.removePrefix("www.") else fullHost
        return withoutWww != reduced
    }

    // -----------------------------------------------------------------
    // R5. Name normalization
    // -----------------------------------------------------------------

    private val bracketRegex = Regex("""\s*[(\[{][^)\]}]*[)\]}]""")

    /** R5.1: delete bracketed groups, collapse whitespace, trim decoration chars from both ends. */
    fun clean(raw: String?): String {
        if (raw == null) return ""
        var s = bracketRegex.replace(raw, " ")
        s = whitespaceRegex.replace(s, " ")
        return s.trim(' ', '-', '–', '—', ',')
    }

    // The leading [\s,]+ is load-bearing: it requires a real separator before the
    // suffix, so "co" cannot eat the tail of "Costco"/"Cisco" (R5.2 note).
    private val legalSuffixRegex = Regex(
        """[\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|plc|holdings|group|p\.c|llp)\.?\s*$""",
        RegexOption.IGNORE_CASE
    )
    private val punctuationRegex = Regex("""[.,'’"]""")
    private val ampersandRegex = Regex("""\s*&\s*""")

    /** R5.2: the catalog / blocklist / homonym matching key. Hyphens survive. */
    fun companyKey(raw: String?): String {
        var s = clean(raw)
        s = legalSuffixRegex.replace(s, "")
        s = punctuationRegex.replace(s, "")
        s = ampersandRegex.replace(s, "&")
        s = whitespaceRegex.replace(s, " ")
        return s.lowercase(Locale.ROOT).trim()
    }

    private val nonAlnumRegex = Regex("""[^a-z0-9]""")

    /** R5.3: `{companyKey}.com` guess slug, 3-24 chars after '&'->'and' expansion, else null. */
    fun guessSlug(raw: String?): String? {
        var s = companyKey(raw)
        s = s.replace("&", "and")
        s = nonAlnumRegex.replace(s, "")
        if (s.length !in 3..24) return null
        return s
    }

    // -----------------------------------------------------------------
    // R9.1 similarity gate
    // -----------------------------------------------------------------

    private fun normSim(s: String) = nonAlnumRegex.replace(s.lowercase(Locale.ROOT), "")
    private val simSplitRegex = Regex("""[^a-z0-9]+""")
    private fun wordsSim(s: String): Set<String> =
        simSplitRegex.split(s.lowercase(Locale.ROOT)).filter { it.isNotEmpty() }.toSet()

    /** R9.1: normalized substring match, or a shared token. */
    fun passesSimilarity(query: String, brandName: String): Boolean {
        val nq = normSim(query)
        val nb = normSim(brandName)
        if (nq.isNotEmpty() && nb.isNotEmpty() && (nq.contains(nb) || nb.contains(nq))) return true
        return wordsSim(query).intersect(wordsSim(brandName)).isNotEmpty()
    }

    // -----------------------------------------------------------------
    // R6.6 word lists
    // -----------------------------------------------------------------

    val ORG_SIGNAL: List<String> = listOf(
        "insurance", "agency", "realty", "realtors", "roofing", "plumbing", "electric", "electrical", "hvac",
        "tire", "tires", "auto", "motors", "bank", "credit union", "dental", "dentistry", "orthodontics",
        "medical", "clinic", "pharmacy", "law", "legal", "attorney", "accounting", "cpa", "construction",
        "contracting", "landscaping", "sprinkler", "irrigation", "cleaning", "janitorial", "salon", "barber",
        "bakery", "cafe", "restaurant", "grill", "pizza", "mortgage", "lending", "title", "escrow", "storage",
        "moving", "towing", "glass", "paint", "painting", "flooring", "pest", "exterminating",
        "veterinary", "vet", "daycare", "academy", "church", "studio", "fitness", "gym", "supply", "wholesale",
        "distributors", "logistics", "transport", "energy", "propane", "security", "alarm", "telecom",
        "wireless", "media", "marketing", "consulting", "partners", "associates", "enterprises",
        "industries", "systems", "technologies", "labs", "works"
    )

    /**
     * R8.3 — one word, tested whole, against the trade-word list.  The phrase
     * form searches anywhere in a segment; the catalog-tail test needs a
     * per-word answer.
     */
    fun isOrgSignalWord(word: String): Boolean = word.lowercase() in ORG_SIGNAL

    val ROLE_WORDS: List<String> = listOf(
        "manager", "mgr", "gm", "asst", "assistant", "treasurer", "president", "vp", "director", "owner",
        "coordinator", "secretary", "chair", "chairman", "board", "rep", "representative", "agent", "sales",
        "support", "service", "services", "office", "cell", "mobile", "home", "work", "fax", "main", "desk",
        "billing", "hr", "admin", "dispatch", "scheduler", "emergency", "voicemail", "reception", "ext",
        "front desk", "on call", "after hours", "customer service"
    )

    /** GEO_WORDS literal words. The two numeric fragments (`#\d*`, `\d{2,5}`) are handled separately. */
    val GEO_WORDS_LITERAL: Set<String> = setOf(
        "rd", "road", "st", "street", "blvd", "ave", "avenue", "dr", "drive", "ln", "lane", "hwy", "fwy", "pkwy",
        "suite", "ste", "unit", "store", "shop", "plaza", "center", "centre", "mall", "near", "at", "in",
        "cypress", "houston", "dallas", "austin", "katy", "spring", "tomball", "tx", "texas", "usa", "us",
        "australia", "canada", "mexico", "uk", "north", "south", "east", "west", "downtown", "midtown", "uptown"
    )

    private fun phraseRegex(words: List<String>): Regex {
        val escaped = words.sortedByDescending { it.length }.joinToString("|") { Regex.escape(it) }
        return Regex("""\b(?:$escaped)\b""", RegexOption.IGNORE_CASE)
    }

    private val orgSignalRegex = phraseRegex(ORG_SIGNAL)
    private val roleWordsRegex = phraseRegex(ROLE_WORDS)
    private val geoWordsRegex = run {
        val literal = GEO_WORDS_LITERAL.sortedByDescending { it.length }.joinToString("|") { Regex.escape(it) }
        Regex("""\b(?:$literal|#\d*|\d{2,5})\b""", RegexOption.IGNORE_CASE)
    }

    /** R6.3/R6.4: ROLE_WORDS or GEO_WORDS, whole word, case-insensitive. */
    fun isRoleOrPlace(s: String): Boolean = roleWordsRegex.containsMatchIn(s) || geoWordsRegex.containsMatchIn(s)

    // -----------------------------------------------------------------
    // R6. Segment selection
    // -----------------------------------------------------------------

    private val dashSplitRegex = Regex("""\s+[-–—]\s+""")
    private val atSplitRegex = Regex("""\s+[Aa]t\s+""")
    private val acronymRegex = Regex("""^[A-Z&]{2,5}$""")

    private data class Split(val head: String, val tail: String)

    /** R6.1: first occurrence of either the dash form or the "at" form. */
    private fun split(name: String): Split? {
        val dashMatch = dashSplitRegex.find(name)
        val atMatch = atSplitRegex.find(name)
        val matches = listOfNotNull(
            dashMatch?.let { true to it },
            atMatch?.let { false to it }
        )
        if (matches.isEmpty()) return null
        val (isDash, m) = matches.minByOrNull { it.second.range.first }!!

        val head = name.substring(0, m.range.first).trim()
        val tail = name.substring(m.range.last + 1).trim()
        if (isDash && tail.contains(" - ")) return null

        val headWords = head.split(whitespaceRegex).filter { it.isNotEmpty() }
        val tailWords = tail.split(whitespaceRegex).filter { it.isNotEmpty() }
        if (headWords.isEmpty() || headWords.size > 4) return null
        if (tailWords.size > 5) return null
        return Split(head, tail)
    }

    /** R6.2: is the tail a known brand (catalog hit, ORG_SIGNAL word, or a written acronym)? */
    private fun isKnownBrandTail(tail: String): Boolean {
        if (tail.isEmpty()) return false
        if (Blocklists.isGenericOrNonBrand(tail)) return false
        if (CompanyCatalog.domainForName(tail) != null) return true
        if (orgSignalRegex.containsMatchIn(tail)) return true
        val trimmed = tail.trim()
        if (!trimmed.contains(' ') && acronymRegex.matches(trimmed)) return true
        return false
    }

    /** Result of R6 segment selection: the derived query and the static flags it produced. */
    data class Segment(val query: String, val flags: Set<String>)

    /** R6: which part of an (already business-relevant) name is the brand. First match wins. */
    fun selectSegment(name: String): Segment {
        val s = split(name) ?: return Segment(clean(name), emptySet())
        if (isKnownBrandTail(s.tail)) {
            return Segment(clean(s.tail), setOf("brand-tail"))
        }
        if (isRoleOrPlace(s.tail) || CompanyCatalog.domainForName(s.head) != null) {
            return Segment(clean(s.head), setOf("decoration-stripped"))
        }
        if (isRoleOrPlace(s.head) || Blocklists.isGenericExact(s.head)) {
            return Segment(clean(s.tail), setOf("decoration-stripped"))
        }
        return Segment(clean(name), emptySet())
    }
}
