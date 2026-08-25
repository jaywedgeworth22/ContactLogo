package com.contactlogo.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MatchPipelineTest {
    @Test
    fun personAtCatalogFirmIsSkippedEvenWithPhoto() {
        val contact = ContactIdentity(
            id = "1",
            displayName = "Maya Chen",
            givenName = "Maya",
            familyName = "Chen",
            organization = "Apple",
            hasCustomPhoto = true
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.SKIP, result.confidence)
        assertFalse(result.approved)
        assertTrue(result.candidates.isEmpty())
    }

    @Test
    fun personAtCatalogFirmWithoutStructuredNameIsSkipped() {
        val contact = ContactIdentity(
            id = "2",
            displayName = "Maya Chen",
            organization = "Apple",
            hasCustomPhoto = true
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.SKIP, result.confidence)
        assertFalse(result.approved)
    }

    @Test
    fun loneFirmCardStaysHigh() {
        val contact = ContactIdentity(
            id = "3",
            displayName = "FedEx",
            organization = "FedEx"
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
    }

    @Test
    fun loneGivenFirmNameIsBusiness() {
        val contact = ContactIdentity(
            id = "4",
            displayName = "Walgreens",
            givenName = "Walgreens"
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
    }

    @Test
    fun twoWordBrandMatchingItsOrgStaysBusiness() {
        val contact = ContactIdentity(
            id = "5",
            displayName = "Home Depot",
            organization = "Home Depot"
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
    }
}
