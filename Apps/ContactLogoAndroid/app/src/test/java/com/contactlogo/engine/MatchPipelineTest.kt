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
        val lone = ContactIdentity(
            id = "2",
            displayName = "Walgreens",
            givenName = "Walgreens",
            organization = ""
        )
        assertEquals("Walgreens", MatchPipeline.inferCompanyFromLoneName(lone))
        assertFalse(MatchPipeline.isPerson(lone))
        val result = MatchPipeline.match(lone)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
        assertEquals("walgreens.com", result.matchedDomain)
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
        val fedex = ContactIdentity(
            id = "4",
            displayName = "FedEx",
            organization = "FedEx"
        )
        val result = MatchPipeline.match(fedex)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
        assertEquals("fedex.com", result.matchedDomain)
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
