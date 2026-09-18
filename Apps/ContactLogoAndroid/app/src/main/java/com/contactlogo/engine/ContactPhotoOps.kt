package com.contactlogo.engine

/**
 * The platform calls `ContactsRepository` needs for a photo write/delete: find
 * the raw contact id backing an aggregate contact, then read, write, or delete
 * the photo row for it.
 *
 * Framework-free by design (see `PhotoGeometry`'s doc comment: "`ContactsRepository`
 * cannot be loaded by the JVM unit suite").  Robolectric and a mocking
 * framework are both absent from this module (see `PhotoGeometryTest`,
 * `UndoLogTest`), so the platform boundary is pulled out behind this interface
 * instead of mocked, letting [ContactPhotoOps] — the write/delete control flow,
 * guard clauses, and error handling `ContactsRepository` delegates to — run
 * under plain JUnit against a hand-written fake.
 */
interface ContactPhotoPlatform {
    /** The raw contact id backing the aggregate [contactId], or null if there is none. */
    fun rawContactId(contactId: String): Long?

    /** The contact's current photo bytes, or null if it has none. */
    fun readPhoto(contactId: String): ByteArray?

    /** Deletes any existing photo row and inserts [bytes] as the new one. Returns success. */
    fun writePhoto(rawContactId: Long, bytes: ByteArray): Boolean

    /** Deletes the photo row for [rawContactId], leaving the contact photo-less. Returns success. */
    fun deletePhoto(rawContactId: Long): Boolean
}

/**
 * The photo write/delete control flow, pulled out of `ContactsRepository` so it
 * can be unit tested (see the interface doc above).
 *
 * Every entry point resolves the raw contact id first and bails out — without
 * touching the platform's write/delete calls — when it is missing: a bad or
 * stale aggregate id, or a permission the caller does not hold, both surface
 * as [ContactPhotoPlatform.rawContactId] returning null, not as a thrown
 * exception.  Whatever the platform *does* throw (a `SecurityException` for a
 * revoked permission, a provider error) is caught here too, so one contact's
 * failure during a batch apply never crashes the run; the caller sees `false`
 * and moves on to the next contact, exactly as `ContactsRepository` did before
 * this was extracted.
 */
class ContactPhotoOps(private val platform: ContactPhotoPlatform) {

    /**
     * Prior photo bytes for the undo log's "previous" capture, or null when the
     * contact had none.  Called before an apply overwrites a photo, so its
     * result becomes `UndoLog.Record(contactId, previousBytes)`.
     */
    fun readExistingPhoto(contactId: String): ByteArray? = try {
        platform.readPhoto(contactId)
    } catch (_: Exception) {
        null
    }

    /** Writes [bytes] as the contact's photo. False on a missing contact, permission denial, or provider error. */
    fun write(contactId: String, bytes: ByteArray): Boolean = try {
        val rawContactId = platform.rawContactId(contactId)
        if (rawContactId == null) false else platform.writePhoto(rawContactId, bytes)
    } catch (_: Exception) {
        false
    }

    /** Removes the contact's photo, leaving it photo-less. False on a missing contact or provider error. */
    fun remove(contactId: String): Boolean = try {
        val rawContactId = platform.rawContactId(contactId)
        if (rawContactId == null) false else platform.deletePhoto(rawContactId)
    } catch (_: Exception) {
        false
    }
}
