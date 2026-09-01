package com.contactlogo.engine

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.io.path.createTempDirectory

class UndoLogTest {
    private lateinit var dir: File
    private lateinit var log: UndoLog

    @Before
    fun setUp() {
        dir = createTempDirectory("contactlogo-undo").toFile()
        log = UndoLog(dir)
    }

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    @Test
    fun recordBatchPersistsPreviousBytesAndHadNoneMarkers() {
        val previous = byteArrayOf(1, 2, 3, 4)
        val batch = log.recordBatch(
            listOf(
                UndoLog.Record("10", previous),
                UndoLog.Record("11", null)
            ),
            createdAt = 1_700_000_000.0
        )
        assertTrue(File(batch, "meta.json").isFile)
        assertTrue(File(batch, "previous-0.img").isFile)
        assertArrayEquals(previous, File(batch, "previous-0.img").readBytes())
        assertTrue(!File(batch, "previous-1.img").exists())

        val ops = log.loadRestoreOps(batch.name)
        assertEquals(2, ops.size)
        assertEquals("10", ops[0].contactId)
        assertArrayEquals(previous, ops[0].previousBytes)
        assertEquals("11", ops[1].contactId)
        assertNull(ops[1].previousBytes)
    }

    @Test
    fun listBatchSummariesIsNewestFirstAndKeepsHistory() {
        log.recordBatch(listOf(UndoLog.Record("1", byteArrayOf(1))), createdAt = 10.0)
        log.recordBatch(listOf(UndoLog.Record("2", byteArrayOf(2)), UndoLog.Record("3", null)), createdAt = 20.0)
        val summaries = log.listBatchSummaries()
        assertEquals(2, summaries.size)
        assertEquals(20.0, summaries[0].createdAt, 0.0)
        assertEquals(2, summaries[0].contactCount)
        assertEquals(10.0, summaries[1].createdAt, 0.0)
        assertEquals(1, summaries[1].contactCount)
    }

    @Test
    fun loadRestoreOpsDoesNotDeleteTheBatch() {
        val batch = log.recordBatch(listOf(UndoLog.Record("1", byteArrayOf(9))), createdAt = 1.0)
        log.loadRestoreOps(batch.name)
        assertTrue(File(batch, "meta.json").isFile)
        assertEquals(1, log.listBatchSummaries().size)
    }

    @Test
    fun missingPreviousFileThrowsSoCallersCannotClearTheLog() {
        val batch = log.recordBatch(listOf(UndoLog.Record("1", byteArrayOf(9))), createdAt = 1.0)
        File(batch, "previous-0.img").delete()
        try {
            log.loadRestoreOps(batch.name)
            fail("expected missing previous image to throw")
        } catch (e: UndoLog.UndoException) {
            assertTrue(e.message!!.contains("missing previous image"))
        }
        assertTrue("failed restore must leave the batch on disk", File(batch, "meta.json").isFile)
    }

    @Test
    fun unsafePreviousImageNameThrowsInsteadOfSkipping() {
        val batch = log.recordBatch(listOf(UndoLog.Record("1", null)), createdAt = 1.0)
        File(batch, "meta.json").writeText(
            """{"createdAt":1.0,"entries":[{"contactID":"1","previousImageFile":"../secret.img"}]}"""
        )
        try {
            log.loadRestoreOps(batch.name)
            fail("expected unsafe name to throw")
        } catch (e: UndoLog.UndoException) {
            assertTrue(e.message!!.contains("unsafe"))
        }
    }

    @Test
    fun corruptMetaIsSkippedNotThrown() {
        log.recordBatch(listOf(UndoLog.Record("1", byteArrayOf(1))), createdAt = 5.0)
        val bad = File(dir, "not-a-uuid-but-long-enough")
        bad.mkdirs()
        File(bad, "meta.json").writeText("not-json")
        val summaries = log.listBatchSummaries()
        assertEquals(1, summaries.size)
        assertEquals(5.0, summaries[0].createdAt, 0.0)
    }

    @Test
    fun pruneKeepsTheNewestBatches() {
        log.recordBatch(listOf(UndoLog.Record("a", null)), createdAt = 1.0)
        log.recordBatch(listOf(UndoLog.Record("b", null)), createdAt = 2.0)
        log.recordBatch(listOf(UndoLog.Record("c", null)), createdAt = 3.0)
        log.prune(keeping = 2)
        val remaining = log.listBatchSummaries()
        assertEquals(2, remaining.size)
        assertEquals(3.0, remaining[0].createdAt, 0.0)
        assertEquals(2.0, remaining[1].createdAt, 0.0)
    }

    @Test
    fun safeComponentRejectsTraversal() {
        assertNull(UndoLog.safeComponent("../../etc/passwd"))
        assertNull(UndoLog.safeComponent(".."))
        assertNull(UndoLog.safeComponent(".hidden"))
        assertNull(UndoLog.safeComponent("a/b.img"))
        assertEquals("previous-0.img", UndoLog.safeComponent("previous-0.img"))
    }

    @Test
    fun jsonRoundTripEscapesContactIds() {
        val meta = UndoLog.BatchMeta(
            12.5,
            listOf(UndoLog.MetaEntry("id\"with\\slash", "previous-0.img"))
        )
        val decoded = UndoLog.decodeMeta(UndoLog.encodeMeta(meta))
        assertEquals(12.5, decoded.createdAt, 0.000001)
        assertEquals("id\"with\\slash", decoded.entries[0].contactID)
        assertEquals("previous-0.img", decoded.entries[0].previousImageFile)
    }
}
