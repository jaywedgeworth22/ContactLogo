package com.contactlogo.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `ContactsRepository` is the only class that writes or deletes a real contact
 * photo, and it "cannot be loaded by the JVM unit suite" (see
 * `PhotoGeometry`'s doc comment) — this module has neither Robolectric nor a
 * mocking framework configured (see `PhotoGeometryTest`, `UndoLogTest`).  So
 * these tests exercise `ContactPhotoOps` — the write/delete control flow
 * `ContactsRepository` delegates to — against a hand-written fake
 * [ContactPhotoPlatform], never against a real `ContentResolver`.
 */
class ContactPhotoOpsTest {

    /** Records every call it receives; lets a test script exactly what the platform does. */
    private class FakePlatform(
        private val rawIds: Map<String, Long> = emptyMap(),
        private val photos: Map<String, ByteArray> = emptyMap(),
        private val writeResult: Boolean = true,
        private val deleteResult: Boolean = true,
        private val throwOnRawContactId: Boolean = false,
        private val throwOnWrite: Boolean = false,
        private val throwOnDelete: Boolean = false,
        private val throwOnRead: Boolean = false,
    ) : ContactPhotoPlatform {
        var writeCalls = mutableListOf<Pair<Long, ByteArray>>()
        var deleteCalls = mutableListOf<Long>()
        var rawContactIdCalls = mutableListOf<String>()
        var readCalls = mutableListOf<String>()

        override fun rawContactId(contactId: String): Long? {
            rawContactIdCalls.add(contactId)
            if (throwOnRawContactId) throw SecurityException("no CONTACTS permission")
            return rawIds[contactId]
        }

        override fun readPhoto(contactId: String): ByteArray? {
            readCalls.add(contactId)
            if (throwOnRead) throw SecurityException("no CONTACTS permission")
            return photos[contactId]
        }

        override fun writePhoto(rawContactId: Long, bytes: ByteArray): Boolean {
            writeCalls.add(rawContactId to bytes)
            if (throwOnWrite) throw RuntimeException("provider rejected the batch")
            return writeResult
        }

        override fun deletePhoto(rawContactId: Long): Boolean {
            deleteCalls.add(rawContactId)
            if (throwOnDelete) throw RuntimeException("provider rejected the batch")
            return deleteResult
        }
    }

    // -----------------------------------------------------------------
    // Photo write path
    // -----------------------------------------------------------------

    @Test
    fun writeResolvesTheRawContactIdThenWritesTheBytes() {
        val platform = FakePlatform(rawIds = mapOf("42" to 7L))
        val ops = ContactPhotoOps(platform)
        val bytes = byteArrayOf(1, 2, 3)

        assertTrue(ops.write("42", bytes))
        assertEquals(listOf("42"), platform.rawContactIdCalls)
        assertEquals(1, platform.writeCalls.size)
        assertEquals(7L, platform.writeCalls[0].first)
        assertEquals(bytes, platform.writeCalls[0].second)
    }

    @Test
    fun writePropagatesAFalseResultFromThePlatform() {
        val platform = FakePlatform(rawIds = mapOf("42" to 7L), writeResult = false)
        val ops = ContactPhotoOps(platform)

        assertFalse(ops.write("42", byteArrayOf(1)))
    }

    // -----------------------------------------------------------------
    // Photo delete path
    // -----------------------------------------------------------------

    @Test
    fun removeResolvesTheRawContactIdThenDeletesThePhotoRow() {
        val platform = FakePlatform(rawIds = mapOf("42" to 7L))
        val ops = ContactPhotoOps(platform)

        assertTrue(ops.remove("42"))
        assertEquals(listOf("42"), platform.rawContactIdCalls)
        assertEquals(listOf(7L), platform.deleteCalls)
    }

    @Test
    fun removePropagatesAFalseResultFromThePlatform() {
        val platform = FakePlatform(rawIds = mapOf("42" to 7L), deleteResult = false)
        val ops = ContactPhotoOps(platform)

        assertFalse(ops.remove("42"))
    }

    // -----------------------------------------------------------------
    // Permission / error handling
    // -----------------------------------------------------------------

    @Test
    fun writeIsFalseWithoutTouchingThePlatformWhenTheContactHasNoRawId() {
        // A missing raw contact id models a bad/stale aggregate id or a
        // permission the caller does not hold: ContactPhotoPlatform reports it
        // by returning null, not by throwing.
        val platform = FakePlatform(rawIds = emptyMap())
        val ops = ContactPhotoOps(platform)

        assertFalse(ops.write("999", byteArrayOf(1)))
        assertEquals(listOf("999"), platform.rawContactIdCalls)
        assertTrue("writePhoto must never be called once rawContactId is null", platform.writeCalls.isEmpty())
    }

    @Test
    fun removeIsFalseWithoutTouchingThePlatformWhenTheContactHasNoRawId() {
        val platform = FakePlatform(rawIds = emptyMap())
        val ops = ContactPhotoOps(platform)

        assertFalse(ops.remove("999"))
        assertEquals(listOf("999"), platform.rawContactIdCalls)
        assertTrue("deletePhoto must never be called once rawContactId is null", platform.deleteCalls.isEmpty())
    }

    @Test
    fun writeCatchesAnExceptionResolvingTheRawContactId() {
        // e.g. a revoked READ_CONTACTS/WRITE_CONTACTS permission surfacing as a
        // thrown SecurityException rather than a null return.
        val platform = FakePlatform(throwOnRawContactId = true)
        val ops = ContactPhotoOps(platform)

        assertFalse(ops.write("42", byteArrayOf(1)))
    }

    @Test
    fun writeCatchesAnExceptionFromTheProviderItself() {
        val platform = FakePlatform(rawIds = mapOf("42" to 7L), throwOnWrite = true)
        val ops = ContactPhotoOps(platform)

        assertFalse(ops.write("42", byteArrayOf(1)))
    }

    @Test
    fun removeCatchesAnExceptionFromTheProviderItself() {
        val platform = FakePlatform(rawIds = mapOf("42" to 7L), throwOnDelete = true)
        val ops = ContactPhotoOps(platform)

        assertFalse(ops.remove("42"))
    }

    @Test
    fun aFailedContactDoesNotStopABatchOfOthers() {
        // The reason write()/remove() swallow the platform's exception rather
        // than letting it propagate: one bad contact in an "apply all" batch
        // must not crash the run for every other contact in it.
        val platform = FakePlatform(rawIds = mapOf("1" to 1L, "2" to 2L), throwOnWrite = false)
        val flaky = object : ContactPhotoPlatform by platform {
            override fun writePhoto(rawContactId: Long, bytes: ByteArray): Boolean {
                if (rawContactId == 1L) throw RuntimeException("transient provider error")
                return platform.writePhoto(rawContactId, bytes)
            }
        }
        val ops = ContactPhotoOps(flaky)

        assertFalse(ops.write("1", byteArrayOf(1)))
        assertTrue(ops.write("2", byteArrayOf(2)))
    }

    // -----------------------------------------------------------------
    // Undo-related behavior: capturing "previous" bytes before an overwrite
    // -----------------------------------------------------------------

    @Test
    fun readExistingPhotoReturnsThePriorBytesForTheUndoLog() {
        // This is exactly what feeds `UndoLog.Record(contactId, previousBytes)`
        // before an apply overwrites a contact's photo.
        val previous = byteArrayOf(9, 9, 9)
        val platform = FakePlatform(photos = mapOf("42" to previous))
        val ops = ContactPhotoOps(platform)

        assertEquals(previous, ops.readExistingPhoto("42"))
        assertEquals(listOf("42"), platform.readCalls)
    }

    @Test
    fun readExistingPhotoIsNullForAPhotolessContact() {
        // The undo log's own "had none" marker (UndoLog.Record with a null
        // previousImageData) depends on this returning null, not throwing or
        // returning an empty array, when the contact simply has no photo.
        val platform = FakePlatform(photos = emptyMap())
        val ops = ContactPhotoOps(platform)

        assertNull(ops.readExistingPhoto("42"))
    }

    @Test
    fun readExistingPhotoIsNullRatherThanThrowingWhenThePlatformFails() {
        // A contact deleted mid-read, or a permission revoked between the
        // review list load and the apply, must not crash the undo capture.
        val platform = FakePlatform(throwOnRead = true)
        val ops = ContactPhotoOps(platform)

        assertNull(ops.readExistingPhoto("42"))
    }
}
