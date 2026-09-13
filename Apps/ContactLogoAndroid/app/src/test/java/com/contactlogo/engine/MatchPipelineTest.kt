package com.contactlogo.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MatchPipelineTest {

    @Test
    fun employeesStayPeopleEvenWithCompanyOrgAndPhoto() {
        val employee = ContactIdentity(
            id = "1",
            displayName = "Maya Chen",
            givenName = "Maya",
            familyName = "Chen",
            organization = "Apple",
            emailAddresses = listOf("maya@hey.com"),
            hasCustomPhoto = true
        )
        val result = MatchPipeline.match(employee)
        assertTrue(MatchPipeline.isPerson(employee))
        assertEquals(Confidence.SKIP, result.confidence)
        assertFalse(result.approved)
        assertTrue(result.candidates.isEmpty())
    }

    @Test
    fun loneFirmGivenNameIsABusinessCard() {
        // FedEx still has a live Simple Icons slug.  Walgreens was dropped when
        // cdn.simpleicons.org started 404ing that mark (2026-09-01).
        val lone = ContactIdentity(
            id = "2",
            displayName = "FedEx",
            givenName = "FedEx",
            organization = ""
        )
        assertEquals("FedEx", MatchPipeline.inferCompanyFromLoneName(lone))
        assertFalse(MatchPipeline.isPerson(lone))
        val result = MatchPipeline.match(lone)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
        assertEquals("fedex.com", result.matchedDomain)
    }

    @Test
    fun existingBusinessPhotoStaysInReview() {
        val fedex = ContactIdentity(
            id = "3",
            displayName = "FedEx",
            organization = "FedEx",
            hasCustomPhoto = true
        )
        val result = MatchPipeline.match(fedex)
        assertFalse(MatchPipeline.isPerson(fedex))
        assertEquals(Confidence.MEDIUM, result.confidence)
        assertFalse(result.approved)
        assertNotEquals(Confidence.HIGH, result.confidence)
    }

    @Test
    fun catalogBusinessWithoutPhotoIsReady() {
        // FedEx reaches HIGH for the right reason under ENGINE-CONTRACT R10/R11:
        // the static ceiling is high (catalog identity, no caps), AND the winning
        // candidate is a real curated Simple Icons glyph (R13), not a favicon.
        // Before the CL-04 fix, confidence was HIGH purely from catalog membership
        // — see catalogHitWithoutCuratedAssetStaysInReview below for the case that
        // exposed the bug: a catalog hit with no Simple Icons entry.
        val fedex = ContactIdentity(
            id = "4",
            displayName = "FedEx",
            organization = "FedEx"
        )
        val result = MatchPipeline.match(fedex)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
        assertEquals("fedex.com", result.matchedDomain)
        assertEquals("catalog", result.via)
        assertEquals("simpleIcons", result.selectedLogo?.source)
    }

    @Test
    fun catalogHitWithoutCuratedAssetStaysInReview() {
        // ENGINE-CONTRACT R11.4 (CL-04b): a non-curated winner is NEVER high, however
        // confident the static ceiling is.  Exxon's static ceiling is high (a clean
        // catalog hit, no caps) but this pipeline has no Simple Icons entry for
        // exxon.com, so candidates fall through to first-party cache and favicons —
        // confidence must be capped at medium and the contact must not be auto-approved.
        val exxon = ContactIdentity(
            id = "6",
            displayName = "Exxon",
            organization = "Exxon"
        )
        val result = MatchPipeline.match(exxon)
        assertEquals("exxon.com", result.matchedDomain)
        assertEquals(Confidence.MEDIUM, result.confidence)
        assertFalse(result.approved)
        assertEquals("contactLogoCache", result.selectedLogo?.source)
    }

    @Test
    fun firstPartyLogoCacheCandidateEmittedPriorToFavicons() {
        val fedex = ContactIdentity(
            id = "4",
            displayName = "FedEx",
            organization = "FedEx"
        )
        val result = MatchPipeline.match(fedex)
        val sources = result.candidates.map { it.source }
        assertEquals(listOf("simpleIcons", "contactLogoCache", "favicon", "favicon"), sources)
        assertEquals("https://contactlogo.com/api/logo/fedex.com", result.candidates[1].url)
    }

    @Test
    fun unstructuredPersonNameIsNotInferredAsAFirm() {
        assertNull(
            MatchPipeline.inferCompanyFromLoneName(
                ContactIdentity(id = "5", displayName = "Maya Chen")
            )
        )
    }
}
