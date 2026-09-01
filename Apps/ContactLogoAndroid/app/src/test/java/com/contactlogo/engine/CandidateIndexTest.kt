package com.contactlogo.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CandidateIndexTest {

    @Test
    fun nextCandidateIndexNeverWrapsPastTheLastSource() {
        assertEquals(1, nextCandidateIndex(0, 5))
        assertEquals(4, nextCandidateIndex(3, 5))
        assertNull(nextCandidateIndex(4, 5))
        assertNull(nextCandidateIndex(0, 1))
        assertNull(nextCandidateIndex(0, 0))
        // The old Android cycle used `(i + 1) % n`, which returns 0 here and
        // re-renders forever (web livelock #22).
        assertNotEquals((4 + 1) % 5, nextCandidateIndex(4, 5) ?: -1)
    }

    @Test
    fun readyChipDoesNotSelect() {
        val high = row(Confidence.HIGH, candidates = 1, approved = false)
        val medium = row(Confidence.MEDIUM, candidates = 2, approved = false)
        assertTrue(isReadyRow(high))
        assertEquals(true, matchesStatusFilter(high, StatusFilter.READY))
        assertEquals(false, matchesStatusFilter(medium, StatusFilter.READY))
        assertEquals(false, high.approved)
    }

    private fun row(confidence: Confidence, candidates: Int, approved: Boolean): MatchResult {
        val logos = (0 until candidates).map { LogoCandidate(url = "https://example.com/$it.png", source = "test") }
        return MatchResult(
            contact = ContactIdentity(id = "1", displayName = "Acme"),
            matchedDomain = "acme.com",
            confidence = confidence,
            candidates = logos,
            approved = approved
        )
    }
}
