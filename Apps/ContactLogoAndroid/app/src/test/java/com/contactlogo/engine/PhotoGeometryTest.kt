package com.contactlogo.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** ENGINE-CONTRACT R11.7 — the safe margin the circular contact crop needs. */
class PhotoGeometryTest {

    /**
     * The regression this file exists for: `square()` scaled against the whole
     * canvas, which is a no-op for a square source.  Every Simple Icons mark is
     * square, so the applied photo reached all four edges and Contacts clipped
     * its corners, while the inset Compose preview looked correct.
     */
    @Test
    fun aSquareMarkIsInsetOnEveryEdge() {
        val at = PhotoGeometry.place(512, 512)!!
        assertEquals(358, at.width)
        assertEquals(358, at.height)
        assertEquals(77, at.left)
        assertEquals(77, at.top)
        assertTrue("a square source must not reach the canvas edge", at.width < PhotoGeometry.SIZE_PX)
        assertEquals("15% per edge", 0.15, (512 - at.width) / 2.0 / 512, 0.005)
    }

    /** A wordmark keeps its aspect ratio and is letterboxed, never stretched. */
    @Test
    fun aWideMarkKeepsItsAspectRatio() {
        val at = PhotoGeometry.place(1000, 250)!!
        assertEquals(358, at.width)
        assertEquals(89, at.height)
        assertEquals(77, at.left)
        assertEquals((PhotoGeometry.SIZE_PX - at.height) / 2, at.top)
        assertEquals(4.0, at.width.toDouble() / at.height, 0.05)
    }

    /** The margin must be the same number the other two engines use. */
    @Test
    fun theMarginMatchesTheOtherEngines() {
        // ImagePreparer.paddingFraction (Swift) and padAndSquareImage's default (web).
        assertEquals(0.15f, PhotoGeometry.PADDING_FRACTION, 0.0001f)
        assertEquals(512, PhotoGeometry.SIZE_PX)
    }

    @Test
    fun anUnusableSourceHasNoPlacement() {
        assertNull(PhotoGeometry.place(0, 100))
        assertNull(PhotoGeometry.place(100, 0))
        assertNull(PhotoGeometry.place(100, 100, size = 0))
    }

    /** A one-pixel source still gets a drawable rectangle rather than a zero. */
    @Test
    fun aTinySourceStillHasAtLeastOnePixel() {
        val at = PhotoGeometry.place(1, 1)!!
        assertTrue(at.width >= 1)
        assertTrue(at.height >= 1)
    }
}
