package com.contactlogo.engine

import android.content.ContentProviderOperation
import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.ContactsContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class ContactsRepository(private val context: Context) {

    suspend fun loadContacts(): List<ContactIdentity> = withContext(Dispatchers.IO) {
        val contacts = mutableListOf<ContactIdentity>()
        val cr: ContentResolver = context.contentResolver

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

                val phones = loadPhones(cr, id)
                val emails = loadEmails(cr, id)
                val org = loadOrganization(cr, id)
                val urls = loadUrls(cr, id)
                val structured = loadStructuredName(cr, id)

                contacts.add(
                    ContactIdentity(
                        id = id,
                        displayName = name,
                        givenName = structured.first,
                        familyName = structured.second,
                        organization = org,
                        phoneNumbers = phones,
                        emailAddresses = emails,
                        urls = urls,
                        hasCustomPhoto = hasPhoto,
                        photoUri = photoUri
                    )
                )
            }
        }
        contacts
    }

    private fun loadStructuredName(cr: ContentResolver, contactId: String): Pair<String, String> {
        val cursor = cr.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME,
                ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME
            ),
            ContactsContract.Data.CONTACT_ID + " = ? AND " + ContactsContract.Data.MIMETYPE + " = ?",
            arrayOf(contactId, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE),
            null
        )
        cursor?.use {
            val givenIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME)
            val familyIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME)
            if (it.moveToFirst()) {
                val given = if (givenIdx >= 0) it.getString(givenIdx).orEmpty().trim() else ""
                val family = if (familyIdx >= 0) it.getString(familyIdx).orEmpty().trim() else ""
                return given to family
            }
        }
        return "" to ""
    }

    private fun loadPhones(cr: ContentResolver, contactId: String): List<String> {
        val list = mutableListOf<String>()
        val pCursor = cr.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " = ?",
            arrayOf(contactId),
            null
        )
        pCursor?.use {
            val idx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (it.moveToNext()) {
                val num = it.getString(idx)
                if (!num.isNullOrBlank()) list.add(num)
            }
        }
        return list
    }

    private fun loadEmails(cr: ContentResolver, contactId: String): List<String> {
        val list = mutableListOf<String>()
        val eCursor = cr.query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS),
            ContactsContract.CommonDataKinds.Email.CONTACT_ID + " = ?",
            arrayOf(contactId),
            null
        )
        eCursor?.use {
            val idx = it.getColumnIndex(ContactsContract.CommonDataKinds.Email.ADDRESS)
            while (it.moveToNext()) {
                val email = it.getString(idx)
                if (!email.isNullOrBlank()) list.add(email)
            }
        }
        return list
    }

    private fun loadOrganization(cr: ContentResolver, contactId: String): String {
        var org = ""
        val oCursor = cr.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Organization.COMPANY),
            ContactsContract.Data.CONTACT_ID + " = ? AND " + ContactsContract.Data.MIMETYPE + " = ?",
            arrayOf(contactId, ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE),
            null
        )
        oCursor?.use {
            val idx = it.getColumnIndex(ContactsContract.CommonDataKinds.Organization.COMPANY)
            if (it.moveToNext()) {
                org = it.getString(idx) ?: ""
            }
        }
        return org
    }

    private fun loadUrls(cr: ContentResolver, contactId: String): List<String> {
        val list = mutableListOf<String>()
        val uCursor = cr.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Website.URL),
            ContactsContract.Data.CONTACT_ID + " = ? AND " + ContactsContract.Data.MIMETYPE + " = ?",
            arrayOf(contactId, ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE),
            null
        )
        uCursor?.use {
            val idx = it.getColumnIndex(ContactsContract.CommonDataKinds.Website.URL)
            while (it.moveToNext()) {
                val u = it.getString(idx)
                if (!u.isNullOrBlank()) list.add(u)
            }
        }
        return list
    }

    suspend fun applyPhoto(contactId: String, photoUrl: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val bytes = downloadImage(photoUrl) ?: return@withContext false
            val cr = context.contentResolver

            // Find raw contact ID
            val rawContactId = getRawContactId(cr, contactId) ?: return@withContext false

            val ops = ArrayList<ContentProviderOperation>()
            ops.add(
                ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI)
                    .withSelection(
                        "${ContactsContract.Data.RAW_CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} = ?",
                        arrayOf(rawContactId.toString(), ContactsContract.CommonDataKinds.Photo.CONTENT_ITEM_TYPE)
                    )
                    .build()
            )
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
