package com.contactlogo.engine

import android.content.ContentProviderOperation
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.provider.ContactsContract
import androidx.core.graphics.drawable.toBitmap
import coil.ImageLoader
import coil.decode.SvgDecoder
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

class ContactsRepository(private val context: Context) {

    /** Built once: an "apply all" run calls the rasterizer per contact. */
    private val svgLoader: ImageLoader by lazy {
        ImageLoader.Builder(context)
            .components { add(SvgDecoder.Factory()) }
            .build()
    }

    private companion object {
        /** Contacts renders small; 512 matches the Swift kit and stays under the
         *  ~1 MB the provider will accept for a full-size photo. */
        const val PHOTO_PX = PhotoGeometry.SIZE_PX
    }

    private class ContactDataHolder {
        var givenName: String = ""
        var familyName: String = ""
        var organization: String = ""
        val phones = mutableListOf<String>()
        val emails = mutableListOf<String>()
        val urls = mutableListOf<String>()
    }

    suspend fun loadContacts(): List<ContactIdentity> = withContext(Dispatchers.IO) {
        val cr: ContentResolver = context.contentResolver

        // Single batch projection query over ContactsContract.Data for all relevant types
        val dataMap = mutableMapOf<String, ContactDataHolder>()
        val projection = arrayOf(
            ContactsContract.Data.CONTACT_ID,
            ContactsContract.Data.MIMETYPE,
            ContactsContract.Data.DATA1,
            ContactsContract.Data.DATA2,
            ContactsContract.Data.DATA3
        )
        val selection = "${ContactsContract.Data.MIMETYPE} IN (?, ?, ?, ?, ?)"
        val selectionArgs = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE,
            ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE,
            ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE,
            ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE,
            ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE
        )

        val dataCursor = cr.query(
            ContactsContract.Data.CONTENT_URI,
            projection,
            selection,
            selectionArgs,
            null
        )

        dataCursor?.use { dc ->
            val idIdx = dc.getColumnIndex(ContactsContract.Data.CONTACT_ID)
            val mimeIdx = dc.getColumnIndex(ContactsContract.Data.MIMETYPE)
            val data1Idx = dc.getColumnIndex(ContactsContract.Data.DATA1)
            val data2Idx = dc.getColumnIndex(ContactsContract.Data.DATA2)
            val data3Idx = dc.getColumnIndex(ContactsContract.Data.DATA3)

            while (dc.moveToNext()) {
                val contactId = if (idIdx >= 0) dc.getString(idIdx) else null
                val mime = if (mimeIdx >= 0) dc.getString(mimeIdx) else null
                if (contactId == null || mime == null) continue
                val holder = dataMap.getOrPut(contactId) { ContactDataHolder() }

                when (mime) {
                    ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE -> {
                        if (holder.givenName.isEmpty() && data2Idx >= 0) {
                            holder.givenName = dc.getString(data2Idx).orEmpty().trim()
                        }
                        if (holder.familyName.isEmpty() && data3Idx >= 0) {
                            holder.familyName = dc.getString(data3Idx).orEmpty().trim()
                        }
                    }
                    ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE -> {
                        val num = if (data1Idx >= 0) dc.getString(data1Idx) else null
                        if (!num.isNullOrBlank()) holder.phones.add(num)
                    }
                    ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE -> {
                        val email = if (data1Idx >= 0) dc.getString(data1Idx) else null
                        if (!email.isNullOrBlank()) holder.emails.add(email)
                    }
                    ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE -> {
                        val org = if (data1Idx >= 0) dc.getString(data1Idx) else null
                        if (!org.isNullOrBlank() && holder.organization.isEmpty()) {
                            holder.organization = org
                        }
                    }
                    ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE -> {
                        val u = if (data1Idx >= 0) dc.getString(data1Idx) else null
                        if (!u.isNullOrBlank()) holder.urls.add(u)
                    }
                }
            }
        }

        val contacts = mutableListOf<ContactIdentity>()
        val cursor: Cursor? = cr.query(
            ContactsContract.Contacts.CONTENT_URI,
            arrayOf(
                ContactsContract.Contacts._ID,
                ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
                ContactsContract.Contacts.PHOTO_URI,
                ContactsContract.Contacts.PHOTO_ID
            ),
            null,
            null,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " ASC"
        )

        cursor?.use { c ->
            val idIdx = c.getColumnIndex(ContactsContract.Contacts._ID)
            val nameIdx = c.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY)
            val photoUriIdx = c.getColumnIndex(ContactsContract.Contacts.PHOTO_URI)
            val photoIdIdx = c.getColumnIndex(ContactsContract.Contacts.PHOTO_ID)

            while (c.moveToNext()) {
                val id = c.getString(idIdx) ?: continue
                val name = c.getString(nameIdx) ?: ""
                val photoUri = if (photoUriIdx >= 0) c.getString(photoUriIdx) else null
                val hasPhoto = if (photoIdIdx >= 0) c.getLong(photoIdIdx) > 0 else false
                val data = dataMap[id] ?: ContactDataHolder()

                contacts.add(
                    ContactIdentity(
                        id = id,
                        displayName = name,
                        givenName = data.givenName,
                        familyName = data.familyName,
                        organization = data.organization,
                        phoneNumbers = data.phones,
                        emailAddresses = data.emails,
                        urls = data.urls,
                        hasCustomPhoto = hasPhoto,
                        photoUri = photoUri
                    )
                )
            }
        }
        contacts
    }

    /**
     * Prior PHOTO bytes for the undo log, or null when the contact had none.
     * Prefers the high-res display photo; falls back to the thumbnail stream.
     */
    suspend fun readPhoto(contactId: String): ByteArray? = withContext(Dispatchers.IO) {
        val id = contactId.toLongOrNull() ?: return@withContext null
        val contactUri = ContentUris.withAppendedId(ContactsContract.Contacts.CONTENT_URI, id)
        try {
            ContactsContract.Contacts.openContactPhotoInputStream(context.contentResolver, contactUri, true)
                ?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun prepareLogo(photoUrl: String): ByteArray? = withContext(Dispatchers.IO) {
        val raw = downloadImage(photoUrl) ?: return@withContext null
        rasterizeForContacts(raw, photoUrl)
    }

    suspend fun prepareLogoBytes(raw: ByteArray): ByteArray? = withContext(Dispatchers.IO) {
        rasterizeForContacts(raw, raw)
    }

    suspend fun writePhoto(contactId: String, bytes: ByteArray): Boolean = withContext(Dispatchers.IO) {
        try {
            val cr = context.contentResolver
            val rawContactId = getRawContactId(cr, contactId) ?: return@withContext false
            val ops = ArrayList<ContentProviderOperation>()
            ops.add(deletePhotoOp(rawContactId))
            ops.add(
                ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                    .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Photo.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.Photo.PHOTO, bytes)
                    .build()
            )
            cr.applyBatch(ContactsContract.AUTHORITY, ops)
            true
        } catch (_: Exception) {
            false
        }
    }

    suspend fun removePhoto(contactId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val cr = context.contentResolver
            val rawContactId = getRawContactId(cr, contactId) ?: return@withContext false
            cr.applyBatch(ContactsContract.AUTHORITY, arrayListOf(deletePhotoOp(rawContactId)))
            true
        } catch (_: Exception) {
            false
        }
    }

    suspend fun applyPhoto(contactId: String, photoUrl: String): Boolean {
        val bytes = prepareLogo(photoUrl) ?: return false
        return writePhoto(contactId, bytes)
    }

    private fun deletePhotoOp(rawContactId: Long): ContentProviderOperation =
        ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI)
            .withSelection(
                "${ContactsContract.Data.RAW_CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} = ?",
                arrayOf(rawContactId.toString(), ContactsContract.CommonDataKinds.Photo.CONTENT_ITEM_TYPE)
            )
            .build()

    private fun getRawContactId(cr: ContentResolver, contactId: String): Long? {
        val cursor = cr.query(
            ContactsContract.RawContacts.CONTENT_URI,
            arrayOf(ContactsContract.RawContacts._ID),
            "${ContactsContract.RawContacts.CONTACT_ID} = ?",
            arrayOf(contactId),
            null
        )
        cursor?.use {
            if (it.moveToFirst()) {
                val idx = it.getColumnIndex(ContactsContract.RawContacts._ID)
                return it.getLong(idx)
            }
        }
        return null
    }

    /**
     * CL-06 — returns PNG bytes Contacts can decode, or null.
     *
     * Null rather than the original bytes on purpose: a photo the platform cannot
     * decode is a blank square on the contact, which is the "wrong logo is worse
     * than none" failure with extra steps. Reporting the apply as failed lets the
     * caller leave the contact alone.
     */
    private suspend fun rasterizeForContacts(raw: ByteArray, coilData: Any): ByteArray? {
        BitmapFactory.decodeByteArray(raw, 0, raw.size)?.let { return square(it) }

        // Not raster — hand it to Coil, which already has the SVG decoder this app
        // uses to draw the same candidate in the review list.
        return try {
            val request = ImageRequest.Builder(context)
                .data(coilData)
                .size(PHOTO_PX, PHOTO_PX)
                // A hardware bitmap has no pixels to read back, so compress() fails.
                .allowHardware(false)
                .build()
            val result = svgLoader.execute(request)
            if (result !is SuccessResult) return null
            val drawable = result.drawable
            // Coil has already fitted the SVG inside PHOTO_PX, so the intrinsic
            // size preserves the mark's aspect ratio; forcing a square here would
            // stretch a wordmark. `square` letterboxes it instead.
            val w = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else PHOTO_PX
            val h = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else PHOTO_PX
            square(drawable.toBitmap(w, h, Bitmap.Config.ARGB_8888))
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Pads to a centred PHOTO_PX square inside the 15% safe margin the Swift kit
     * and the web canvas both use (ENGINE-CONTRACT R11.7).
     *
     * The margin is the whole point, and it was missing: scaling against the
     * full canvas is a no-op for a square source, and every Simple Icons mark is
     * square, so the applied photo reached all four edges and Contacts' circular
     * crop cut its corners off.  The preview, drawn by Compose, was inset and
     * looked correct.
     */
    private fun square(source: Bitmap): ByteArray? {
        return try {
            val at = PhotoGeometry.place(source.width, source.height, PHOTO_PX) ?: return null
            val canvasBitmap = Bitmap.createBitmap(PHOTO_PX, PHOTO_PX, Bitmap.Config.ARGB_8888)
            val scaled = Bitmap.createScaledBitmap(source, at.width, at.height, true)
            Canvas(canvasBitmap).drawBitmap(scaled, at.left.toFloat(), at.top.toFloat(), null)
            ByteArrayOutputStream().use { out ->
                canvasBitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                out.toByteArray()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun downloadImage(urlStr: String): ByteArray? {
        return try {
            val url = URL(urlStr)
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.inputStream.use { it.readBytes() }
        } catch (_: Exception) {
            null
        }
    }
}
