package app.semaphorechat.android

import app.semaphorechat.android.kit.chat.displayName
import app.semaphorechat.android.screens.ComposerCaps
import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** The attachment rules that need no Android runtime: limits, reading, names and image checks. */
class AttachmentRulesTest {
    private fun file(name: String, size: Long?) = PickedFile(name, size, "application/octet-stream") { ByteArray(0) }

    @Test
    fun theLimitsAreTheDesignCrates() {
        assumeTrue("needs semaphore.hostLibDir (native/scripts/android.sh)", System.getProperty("semaphore.hostLibDir") != null)
        val limits = uniffi.semaphore.attachmentLimits()
        assertEquals(ComposerCaps.MAX_FILES, limits.maxFiles.toInt())
        assertEquals(ComposerCaps.MAX_FILE_BYTES, limits.maxFileBytes.toLong())
        val box = uniffi.semaphore.imageBox(4000u, 10u)
        assertEquals(320f to 48f, box.width to box.height)
    }

    @Test
    fun aPickIsRefusedWholeAsDesktopRefusesIt() {
        val ten = List(10) { file("f$it.txt", 1) }
        assertNull(attachProblem(0, ten, canAttach = true, channelName = "general"))
        assertEquals("Maximum 10 files per message", attachProblem(0, ten + file("x", 1), true, "general"))
        assertEquals("Maximum 10 files per message", attachProblem(9, List(2) { file("f", 1) }, true, "general"))
        assertNull(attachProblem(9, listOf(file("f", 1)), true, "general"))
        // Exactly 10 MB is allowed; one byte more is not, and the size problem comes first.
        assertNull(attachProblem(0, listOf(file("big.bin", ComposerCaps.MAX_FILE_BYTES)), true, "general"))
        assertEquals(
            "File \"big.bin\" exceeds the 10 MB size limit",
            attachProblem(5, listOf(file("ok", 1), file("big.bin", ComposerCaps.MAX_FILE_BYTES + 1)) + ten, true, "general"),
        )
        // A size the picker didn't give passes here; reading still caps it.
        assertNull(attachProblem(0, listOf(file("unknown", null)), true, "general"))
        assertEquals("Attaching files is turned off in #general", attachProblem(0, listOf(file("a", 1)), false, "general"))
        assertEquals("Attaching files is turned off in this channel", attachProblem(0, listOf(file("a", 1)), false, ""))
    }

    @Test
    fun readingStopsPastTheLimitWhateverThePickerSaid() {
        val bytes = ByteArray(200_000) { it.toByte() }
        assertArrayEquals(bytes, readCapped(ByteArrayInputStream(bytes), 200_000, "a"))
        assertArrayEquals(ByteArray(0), readCapped(ByteArrayInputStream(ByteArray(0)), 10, "empty"))
        val refused = assertThrows(UnreadableFile::class.java) { readCapped(ByteArrayInputStream(bytes), 199_999, "secret.txt") }
        assertEquals("secret.txt", refused.name)
        // The message never carries the name or the contents (it may be logged).
        assertFalse(refused.message!!.contains("secret"))
    }

    @Test
    fun namesAreSafeToWriteUnderOurDirectory() {
        assertEquals("report.pdf", safeFileName("report.pdf"))
        assertEquals("_etc_passwd", safeFileName("/etc/passwd"))
        assertEquals("_.._.._x", safeFileName("\\..\\..\\x"))
        assertEquals("file", safeFileName(".."))
        assertEquals("file", safeFileName("   "))
        assertEquals("hidden", safeFileName(".hidden"))
        assertEquals("a_b", safeFileName("a\u0000b"))
        assertEquals("a_b", safeFileName("a\nb"))
        assertEquals("C_x", safeFileName("C:x"))
        // A right-to-left override is dropped, so "exe" can't be made to read as "txt" (and the
        // name is what the provider, the tray and the viewer all show).
        assertEquals("photogpj.exe", safeFileName("photo‮gpj.exe"))
        assertEquals("photogpj.exe", displayName("photo‮gpj.exe"))
        assertEquals("名前 😀.png", safeFileName("名前 😀.png"))
        // The 255-byte filesystem limit, with room for the directory: 200 bytes, not characters.
        val long = safeFileName("a".repeat(300) + ".tar.gz")
        assertEquals(200, long.length)
        assertTrue(long.endsWith(".gz"))
        assertEquals(200, safeFileName("b".repeat(300)).length)
        assertEquals(200, safeFileName("😀".repeat(100)).toByteArray(Charsets.UTF_8).size)
        val emoji = safeFileName("😀".repeat(100) + ".png")
        assertEquals(200, emoji.toByteArray(Charsets.UTF_8).size)
        assertTrue(emoji.endsWith(".png"))
        // An "extension" that is really a sentence is not kept.
        assertEquals(200, safeFileName("a".repeat(300) + "." + "b".repeat(40)).length)
    }

    @Test
    fun imagesAreDecodedOnlyWithinDesktopsLimits() {
        assertTrue(imageDecodable(1000, 4000, 3000, "image/png"))
        assertTrue(imageDecodable(MAX_IMAGE_BYTES, 8000, 8000, "image/jpeg"))
        assertFalse(imageDecodable(MAX_IMAGE_BYTES + 1, 10, 10, "image/png"))
        assertFalse(imageDecodable(1000, 8001, 8000, "image/jpeg"))
        assertTrue(imageDecodable(1000, 2000, 2000, "image/gif"))
        assertFalse(imageDecodable(1000, 2001, 2000, "image/gif"))
        assertFalse(imageDecodable(1000, 2001, 2000, "image/webp"))
        // Not an image: the header gave no size.
        assertFalse(imageDecodable(1000, -1, -1, null))
        assertFalse(imageDecodable(1000, 0, 10, "image/png"))
        // Huge sides don't overflow.
        assertFalse(imageDecodable(1000, Int.MAX_VALUE, Int.MAX_VALUE, "image/png"))
    }

    @Test
    fun samplingHalvesUntilTheLongerSideFits() {
        assertEquals(1, sampleSize(320, 240, 640))
        assertEquals(1, sampleSize(1279, 100, 640))
        assertEquals(2, sampleSize(1280, 100, 640))
        assertEquals(4, sampleSize(100, 4000, 640))
        assertEquals(1, sampleSize(0, 0, 640))
    }
}
