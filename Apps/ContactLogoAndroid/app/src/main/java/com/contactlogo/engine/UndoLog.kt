package com.contactlogo.engine

import java.io.File
import java.util.Locale
import java.util.UUID

/**
 * Port of kit `UndoLog` (WRITE POLICY §7 / VISION.md principle 2).
 *
 * Every apply batch first persists the contacts' prior PHOTO bytes (or a
 * "had none" marker) so the batch is one-tap restorable after a relaunch.
 * Bytes live in app-private storage, not Drive.  `allowBackup` is already
 * false; callers still prefer `noBackupFilesDir` so a later backup-flag flip
 * cannot upload prior contact photos.
 *
 * Restore never deletes.  Callers must not retire a batch whose restore has
 * not succeeded — a discarded backup is the one failure that cannot be
 * walked back.
 */
class UndoLog(val directory: File) {

    data class BatchSummary(
        val id: String,
        val createdAt: Double,
        val contactCount: Int
    )

    data class Record(
        val contactId: String,
        val previousImageData: ByteArray?
    )

    data class RestoreOp(
        val contactId: String,
        val previousBytes: ByteArray?
    )

    class UndoException(message: String) : Exception(message)

    internal data class MetaEntry(val contactID: String, val previousImageFile: String?)
    internal data class BatchMeta(val createdAt: Double, val entries: List<MetaEntry>)

    /** Call BEFORE applying.  Returns the batch directory. */
    fun recordBatch(
        entries: List<Record>,
        createdAt: Double = System.currentTimeMillis() / 1000.0
    ): File {
        directory.mkdirs()
        val batchID = UUID.randomUUID().toString()
        val dir = File(directory, batchID)
        if (!dir.mkdirs() && !dir.isDirectory) {
            throw UndoException("could not create undo batch directory")
        }
        val metaEntries = ArrayList<MetaEntry>(entries.size)
        entries.forEachIndexed { index, entry ->
            var file: String? = null
            val previous = entry.previousImageData
            if (previous != null) {
                val name = "previous-$index.img"
                File(dir, name).writeBytes(previous)
                file = name
            }
            metaEntries.add(MetaEntry(entry.contactId, file))
        }
        File(dir, "meta.json").writeText(encodeMeta(BatchMeta(createdAt, metaEntries)))
        return dir
    }

    /**
     * Newest first.  A batch whose meta.json is missing or corrupt is skipped,
     * not thrown, so one bad folder cannot hide the rest of history.
     */
    fun listBatchSummaries(): List<BatchSummary> {
        if (!directory.isDirectory) return emptyList()
        val children = directory.listFiles() ?: return emptyList()
        val out = mutableListOf<BatchSummary>()
        for (child in children) {
            if (!child.isDirectory) continue
            val id = safeComponent(child.name) ?: continue
            val text = try {
                File(child, "meta.json").readText()
            } catch (_: Exception) {
                continue
            }
            val meta = try {
                decodeMeta(text)
            } catch (_: Exception) {
                continue
            }
            out.add(BatchSummary(id, meta.createdAt, meta.entries.size))
        }
        return out.sortedWith(
            compareByDescending<BatchSummary> { it.createdAt }.thenBy { it.id }
        )
    }

    fun prune(keeping: Int = 20, olderThanEpochSeconds: Double? = null) {
        val summaries = listBatchSummaries()
        summaries.forEachIndexed { index, summary ->
            val tooMany = index >= maxOf(0, keeping)
            val cutoff = olderThanEpochSeconds
            val tooOld = cutoff != null && summary.createdAt < cutoff
            if (tooMany || tooOld) {
                try {
                    deleteBatch(summary.id)
                } catch (_: Exception) {
                    // Opportunistic; a stuck folder is retried on the next apply.
                }
            }
        }
    }

    fun deleteBatch(batchID: String) {
        val id = safeComponent(batchID) ?: return
        val dir = File(directory, id)
        if (!dir.exists()) return
        if (!dir.deleteRecursively()) {
            throw UndoException("could not remove undo batch $id")
        }
    }

    /**
     * Reads prior PHOTO bytes for a batch.  Does not mutate the log — a
     * restore that cannot finish must leave this folder on disk.
     */
    fun loadRestoreOps(batchID: String): List<RestoreOp> {
        val id = safeComponent(batchID) ?: throw UndoException("invalid batch id")
        val dir = File(directory, id)
        val metaFile = File(dir, "meta.json")
        if (!metaFile.isFile) throw UndoException("missing meta.json")
        val meta = decodeMeta(metaFile.readText())
        return meta.entries.map { entry ->
            val file = entry.previousImageFile
            if (file != null) {
                // meta.json is on disk, so its file names are untrusted input.
                val name = safeComponent(file)
                    ?: throw UndoException("unsafe previous image name")
                val img = File(dir, name)
                if (!img.isFile) throw UndoException("missing previous image $name")
                RestoreOp(entry.contactID, img.readBytes())
            } else {
                RestoreOp(entry.contactID, null)
            }
        }
    }

    companion object {
        fun safeComponent(raw: String): String? {
            if (raw.isEmpty() || raw.length > 255 || raw == "." || raw == "..") return null
            if (raw.startsWith(".") ||
                raw.contains('/') ||
                raw.contains('\\') ||
                raw.contains('\u0000') ||
                raw.contains("..")
            ) return null
            return raw
        }

        internal fun encodeMeta(meta: BatchMeta): String {
            val entries = meta.entries.joinToString(",") { e ->
                val file = e.previousImageFile?.let { "\"${escapeJson(it)}\"" } ?: "null"
                """{"contactID":"${escapeJson(e.contactID)}","previousImageFile":$file}"""
            }
            return """{"createdAt":${formatEpoch(meta.createdAt)},"entries":[$entries]}"""
        }

        internal fun decodeMeta(text: String): BatchMeta {
            val created = CREATED_RE.find(text)?.groupValues?.get(1)?.toDoubleOrNull()
                ?: throw UndoException("unreadable batch timestamp")
            val entriesBlock = ENTRIES_RE.find(text)?.groupValues?.get(1).orEmpty()
            val entries = ENTRY_RE.findAll(entriesBlock).map { m ->
                val contactID = unescapeJson(m.groupValues[1])
                val file = if (m.groupValues[2] == "null") null else unescapeJson(m.groupValues[3])
                MetaEntry(contactID, file)
            }.toList()
            return BatchMeta(created, entries)
        }

        private val CREATED_RE = Regex("\"createdAt\"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)")
        private val ENTRIES_RE = Regex("\"entries\"\\s*:\\s*\\[(.*?)]", setOf(RegexOption.DOT_MATCHES_ALL))
        private val ENTRY_RE = Regex(
            "\\{\\s*\"contactID\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"\\s*,\\s*\"previousImageFile\"\\s*:\\s*(null|\"((?:\\\\.|[^\"\\\\])*)\")\\s*}"
        )

        private fun formatEpoch(value: Double): String =
            String.format(Locale.US, "%.6f", value)

        private fun escapeJson(s: String): String =
            s.replace("\\", "\\\\").replace("\"", "\\\"")

        private fun unescapeJson(s: String): String =
            s.replace("\\\"", "\"").replace("\\\\", "\\")
    }
}
