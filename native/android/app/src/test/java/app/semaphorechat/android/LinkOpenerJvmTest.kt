// Semaphore Chat's Android client. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android

import app.semaphorechat.android.kit.chat.PieceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import uniffi.semaphore.SegKind
import uniffi.semaphore.TextSeg
import uniffi.semaphore.TextStyle
import uniffi.semaphore.messagePieces

/**
 * Links, through the real FFI (a host build of libsemaphore_mobile.so): the opener only ever hands
 * on `check_link`'s address, and a link it refuses is neither opened nor drawn as pressable.
 */
class LinkOpenerJvmTest {
    @Before
    fun needsTheLibrary() {
        assumeTrue("needs semaphore.hostLibDir (native/scripts/android.sh)", System.getProperty("semaphore.hostLibDir") != null)
    }

    private val opened = mutableListOf<String>()
    private val opener = LinkOpener(launch = { opened += it })

    @Test
    fun opensOnlyTheCheckedAddress() {
        assertTrue(opener.open("https://аpple.com/login"))
        assertTrue(opener.open("HTTP://Example.COM:80/a b?q=1#frag"))
        assertTrue(opener.open("https://x.example/a\\b?c\\d"))
        assertEquals(
            listOf("https://xn--pple-43d.com/login", "http://example.com/a%20b?q=1#frag", "https://x.example/a/b?c%5Cd"),
            opened,
        )
    }

    @Test
    fun refusesEverythingCheckLinkRefuses() {
        for (href in listOf(
            "javascript:alert(1)",
            "intent://scan/#Intent;scheme=zxing;end",
            "file:///sdcard/secret",
            "content://contacts/people",
            "https://bank.example@evil.example/",
            "https://user:pass@x.example/",
            "ftp://files.example/",
            "not a url",
            "",
        )) {
            assertFalse(href, opener.open(href))
        }
        assertEquals(emptyList<String>(), opened)
    }

    @Test
    fun theOpenerNeverFallsBackToTheRawHref() {
        val raw = mutableListOf<String>()
        val refusing = LinkOpener(launch = { raw += it }, check = { null })
        assertFalse(refusing.open("https://example.com/"))
        assertEquals(emptyList<String>(), raw)
    }

    private val plain = TextStyle(bold = false, italic = false, strikethrough = false, code = false)

    @Test
    fun aRefusedLinkIsPlainTextAndACheckedOneDrawsItsLabel() {
        val display = "go javascript:alert(1) or https://аpple.com 😀"
        val bad = display.indexOf("javascript")
        val badEnd = bad + "javascript:alert(1)".length
        val good = display.indexOf("https")
        val goodEnd = good + "https://аpple.com".length
        fun bytes(index: Int) = display.substring(0, index).toByteArray(Charsets.UTF_8).size.toUInt()
        val pieces = messagePieces(
            display,
            listOf(
                TextSeg(bytes(bad), SegKind.Text, plain),
                TextSeg(bytes(badEnd), SegKind.Link("javascript:alert(1)"), plain),
                TextSeg(bytes(good), SegKind.Text, plain),
                TextSeg(bytes(goodEnd), SegKind.Link("https://аpple.com"), plain),
                TextSeg(bytes(display.length), SegKind.Text, plain),
            ),
        ).map { chatPiece(it, null) }
        assertEquals(listOf("go ", "javascript:alert(1)", " or ", "https://xn--pple-43d.com/", " 😀"), pieces.map { it.text })
        assertEquals(PieceKind.Text, pieces[1].kind)
        assertEquals(PieceKind.Link("https://xn--pple-43d.com/"), pieces[3].kind)
        // What a tap on the drawn link hands the opener is the checked address, which it opens as is.
        assertTrue(opener.open((pieces[3].kind as PieceKind.Link).href))
        assertEquals(listOf("https://xn--pple-43d.com/"), opened)
    }
}
