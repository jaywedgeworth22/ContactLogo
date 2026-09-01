package com.contactlogo.engine

enum class Confidence {
    HIGH,
    MEDIUM,
    LOW,
    SKIP
}

/** ENGINE-CONTRACT R7 classification outcome. */
enum class ContactClass {
    PERSON,
    BUSINESS_CARD,
    NON_BRAND
}

data class ContactIdentity(
    val id: String,
    val displayName: String,
    val givenName: String = "",
    val familyName: String = "",
    val organization: String = "",
    val jobTitle: String = "",
    val phoneNumbers: List<String> = emptyList(),
    val emailAddresses: List<String> = emptyList(),
    val urls: List<String> = emptyList(),
    val hasCustomPhoto: Boolean = false,
    val photoUri: String? = null
)

data class LogoCandidate(
    val url: String,
    val source: String,
    val width: Int = 512,
    val height: Int = 512,
    val isVector: Boolean = false,
    val hasAlpha: Boolean = true,
    /** In-memory raster for a user-supplied override (upload / pasted URL). */
    val localBytes: ByteArray? = null
)

enum class StatusFilter {
    ALL,
    READY,
    REVIEW,
    SKIPPED
}

/**
 * Advance past the current candidate.  Never wrap: `(i+1)%n` plus a re-render
 * livelocks review when every remaining source is a broken favicon (web #22).
 */
fun nextCandidateIndex(current: Int, count: Int): Int? {
    if (count <= 1) return null
    val next = current + 1
    return if (next < count) next else null
}

fun isReadyRow(result: MatchResult): Boolean =
    result.confidence == Confidence.HIGH && result.candidates.isNotEmpty()

fun isReviewRow(result: MatchResult): Boolean =
    result.confidence == Confidence.MEDIUM && result.candidates.isNotEmpty()

fun isSkippedRow(result: MatchResult): Boolean =
    result.confidence == Confidence.SKIP || result.candidates.isEmpty()

fun matchesStatusFilter(result: MatchResult, filter: StatusFilter): Boolean = when (filter) {
    StatusFilter.ALL -> true
    StatusFilter.READY -> isReadyRow(result)
    StatusFilter.REVIEW -> isReviewRow(result)
    StatusFilter.SKIPPED -> isSkippedRow(result)
}

/**
 * The static, network-free R7/R8/R10 evaluation of a contact (ENGINE-CONTRACT
 * R14's conformance surface): classification, the derived query, the resolved
 * identity, and the static confidence ceiling. `maxConfidence` is an upper bound
 * — [MatchPipeline.match] combines it with the asset-time tier (R11) to produce
 * the final, possibly lower, [MatchResult.confidence].
 */
data class EngineResult(
    val contactClass: ContactClass,
    val query: String?,
    val domain: String?,
    val via: String?,
    val flags: Set<String>,
    val maxConfidence: Confidence
)

data class MatchResult(
    val contact: ContactIdentity,
    val matchedDomain: String?,
    val confidence: Confidence,
    val candidates: List<LogoCandidate> = emptyList(),
    val selectedIndex: Int = 0,
    val approved: Boolean = false,
    val query: String? = null,
    val via: String? = null,
    val flags: Set<String> = emptySet()
) {
    val selectedLogo: LogoCandidate?
        get() = candidates.getOrNull(selectedIndex) ?: candidates.firstOrNull()
}
