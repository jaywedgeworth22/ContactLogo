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
    val hasAlpha: Boolean = true
)

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

data class UndoEntry(
    val contactId: String,
    val previousPhotoBytes: ByteArray?,
    val timestamp: Long = System.currentTimeMillis()
)
