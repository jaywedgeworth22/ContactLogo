package com.contactlogo.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MatchPipelineTest {

    @Test
    fun employeeWithPersonalPhotoIsSkipped() {
        val contact = ContactIdentity(
            id = "1",
            displayName = "Maya Chen",
            organization = "Apple",
            hasCustomPhoto = true,
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.SKIP, result.confidence)
        assertFalse(result.approved)
        assertTrue(MatchPipeline.isPersonContact(contact))
    }

    @Test
    fun employeeWithoutPhotoIsStillSkipped() {
        val contact = ContactIdentity(
            id = "2",
            displayName = "Maya Chen",
            organization = "Apple",
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.SKIP, result.confidence)
        assertFalse(result.approved)
    }

    @Test
    fun givenAndFamilyNameArePeopleEvenWithoutDisplaySplit() {
        val contact = ContactIdentity(
            id = "3",
            displayName = "Apple",
            givenName = "Maya",
            familyName = "Chen",
            organization = "Apple",
            hasCustomPhoto = true,
        )
        assertTrue(MatchPipeline.isPersonContact(contact))
        assertEquals(Confidence.SKIP, MatchPipeline.match(contact).confidence)
    }

    @Test
    fun businessCardWithExistingPhotoIsReviewOnly() {
        val contact = ContactIdentity(
            id = "4",
            displayName = "FedEx",
            organization = "FedEx",
            hasCustomPhoto = true,
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.MEDIUM, result.confidence)
        assertFalse(result.approved)
        assertFalse(MatchPipeline.isPersonContact(contact))
    }

    @Test
    fun firmWithoutPhotoStaysHighAndApproved() {
        val contact = ContactIdentity(
            id = "5",
            displayName = "FedEx",
            organization = "FedEx",
        )
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
    }

    @Test
    fun twoWordFirmMatchingItsOrgIsNotAnEmployee() {
        val contact = ContactIdentity(
            id = "6",
            displayName = "Wells Fargo",
            organization = "Wells Fargo",
        )
        assertFalse(MatchPipeline.isPersonContact(contact))
        val result = MatchPipeline.match(contact)
        assertEquals(Confidence.HIGH, result.confidence)
        assertTrue(result.approved)
    }

    @Test
    fun photoProtectedPersonWithoutOrgStaysSkipped() {
        val contact = ContactIdentity(
            id = "7",
            displayName = "Maya Chen",
            hasCustomPhoto = true,
        )
        assertEquals(Confidence.SKIP, MatchPipeline.match(contact).confidence)
    }
}
