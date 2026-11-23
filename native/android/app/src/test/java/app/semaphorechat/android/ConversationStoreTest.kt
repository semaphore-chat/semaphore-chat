// Semaphore Chat's Android client. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android

import app.semaphorechat.android.kit.chat.MentionTarget
import app.semaphorechat.android.kit.chat.PieceKind
import app.semaphorechat.android.screens.JumpLabel
import app.semaphorechat.android.screens.MessageState
import app.semaphorechat.android.screens.SERVER_ERROR_FALLBACK
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.semaphore.AttachmentKind
import uniffi.semaphore.AttachmentView
import uniffi.semaphore.ErrorView
import uniffi.semaphore.ListOp
import uniffi.semaphore.MessagePiece
import uniffi.semaphore.MessageRow
import uniffi.semaphore.ReplyToView
import uniffi.semaphore.SegKind
import uniffi.semaphore.SendState
import uniffi.semaphore.TextSeg
import uniffi.semaphore.TextStyle
import uniffi.semaphore.UserView
import uniffi.semaphore.WebhookView

/** The chat's pure parts, without the native library: core's list changes and the row mapping. */
class ConversationStoreTest {
    private val plain = TextStyle(bold = false, italic = false, strikethrough = false, code = false)

    /** Cuts nothing: one piece per segment, the segment's kind, as the FFI would for ASCII. */
    private object FakeRules : ChatRules {
        override fun pieces(display: String, segs: List<TextSeg>): List<MessagePiece> {
            var from = 0
            return segs.map { seg ->
                val end = seg.end.toInt()
                MessagePiece(display.substring(from, end), seg.kind, seg.style).also { from = end }
            }
        }
        override fun typing(names: List<String>) = names.joinToString()
        override fun jump(newCount: Int) = JumpLabel("$newCount", "$newCount", newCount > 0)
    }

    private fun user(id: String, name: String? = null) = UserView(id, id, name, null)

    private fun row(
        seq: Long,
        author: String = "u-a",
        display: String = "m$seq",
        segs: List<TextSeg> = listOf(TextSeg(display.length.toUInt(), SegKind.Text, plain)),
        mine: Boolean = false,
        sendState: SendState = SendState.Sent,
        revision: ULong = 0u,
    ) = MessageRow(
        seq = seq, id = "id$seq", clientNonce = null, author = user(author), sentAtMs = seq * 1000,
        edited = false, mine = mine, editPending = false, removed = false, removedBy = null, removedReason = null,
        display = display, segs = segs, attachments = emptyList(), reactions = emptyList(), replyCount = 0u,
        lastReplyAtMs = null, replyTo = null, linkPreviews = emptyList(), gif = null, pinned = false,
        pinnedBy = null, pinnedAtMs = null, webhook = null, sendState = sendState, pendingAttachments = 0u,
        uploads = emptyList(), revision = revision,
    )

    private fun seqs(rows: List<MessageRow>) = rows.map { it.seq }

    @Test
    fun opsApplyInOrderAndClampToTheList() {
        val rows = mutableListOf<MessageRow>()
        applyOps(rows, listOf(ListOp.Reset(listOf(row(3), row(4)))))
        assertEquals(listOf(3L, 4L), seqs(rows))
        // Older rows at the top, newer at the end, a replace, a remove; an index past the end clamps.
        applyOps(
            rows,
            listOf(
                ListOp.Insert(0u, listOf(row(1), row(2))),
                ListOp.Insert(99u, listOf(row(5))),
                ListOp.Replace(1u, listOf(row(2, display = "edited"))),
                ListOp.Remove(0u, 1u),
            ),
        )
        assertEquals(listOf(2L, 3L, 4L, 5L), seqs(rows))
        assertEquals("edited", rows[0].display)
        applyOps(rows, listOf(ListOp.Remove(3u, 50u), ListOp.Remove(99u, 1u), ListOp.Replace(99u, listOf(row(9)))))
        assertEquals(listOf(2L, 3L, 4L), seqs(rows))
        applyOps(rows, listOf(ListOp.Reset(emptyList())))
        assertTrue(rows.isEmpty())
    }

    @Test
    fun onlyOthersRowsAtTheEndOfALoadedListCountAsNew() {
        val rows = mutableListOf<MessageRow>()
        assertEquals("the first page is not news", 0, applyOps(rows, listOf(ListOp.Insert(0u, listOf(row(1), row(2))))))
        assertEquals("older rows are not news", 0, applyOps(rows, listOf(ListOp.Insert(0u, listOf(row(0))))))
        assertEquals(2, applyOps(rows, listOf(ListOp.Insert(3u, listOf(row(3), row(4), row(5, mine = true))))))
        assertEquals(0, applyOps(rows, listOf(ListOp.Reset(listOf(row(9))))))
    }

    @Test
    fun aRowBecomesTheScreensMessage() {
        val display = "hi @me and @here, see https://x.example #dev"
        fun end(text: String) = (display.indexOf(text) + text.length).toUInt()
        val segs = listOf(
            TextSeg(display.indexOf("@me").toUInt(), SegKind.Text, plain),
            TextSeg(end("@me"), SegKind.UserMention("u-me"), plain),
            TextSeg(display.indexOf("@here").toUInt(), SegKind.Text, plain),
            TextSeg(end("@here"), SegKind.SpecialMention("here"), plain),
            TextSeg(display.indexOf("https").toUInt(), SegKind.Text, plain.copy(bold = true)),
            TextSeg(end("https://x.example"), SegKind.Link("https://x.example/"), plain),
            TextSeg(display.indexOf("#dev").toUInt(), SegKind.Text, plain),
            TextSeg(display.length.toUInt(), SegKind.ChannelMention("ch-dev"), plain),
        )
        val message = chatMessage(
            row(7, display = display, segs = segs).copy(
                author = UserView("u-p", "priya", "Priya Raman", null),
                replyTo = ReplyToView("m1", UserView("u-s", "sam", " ", null), "earlier", false),
                replyCount = 2u,
                attachments = listOf(AttachmentView("f", "plan.pdf", "application/pdf", 2_202_010u, AttachmentKind.DOCUMENT, false, null, null)),
            ),
            meId = "u-me",
            rules = FakeRules,
        )
        assertEquals(7L, message.key)
        assertEquals("Priya Raman", message.author)
        assertEquals("u-p", message.authorId)
        assertTrue(message.mentionsMe)
        assertEquals("sam", message.replyTo?.author)
        assertEquals(2, message.replyCount)
        assertEquals(listOf("Attachment: plan.pdf, 2.1 MB"), message.extras)
        val kinds = message.pieces.map { it.kind }
        assertEquals(PieceKind.Mention(MentionTarget.User("u-me"), mine = true), kinds[1])
        assertEquals(PieceKind.Mention(MentionTarget.None, mine = true), kinds[3])
        assertEquals(PieceKind.Link("https://x.example/"), kinds[5])
        assertEquals(PieceKind.Mention(MentionTarget.Channel("ch-dev")), kinds[7])
        assertTrue(message.pieces[4].style.bold)
    }

    @Test
    fun aMentionInTheReadersOwnMessageIsNoMentionOfThem() {
        val segs = listOf(TextSeg(3u, SegKind.UserMention("u-me"), plain))
        assertFalse(chatMessage(row(1, display = "@me", segs = segs, mine = true), "u-me", FakeRules).mentionsMe)
        assertTrue(chatMessage(row(1, display = "@me", segs = segs), "u-me", FakeRules).mentionsMe)
        assertFalse(chatMessage(row(1, display = "@me", segs = segs), "u-other", FakeRules).mentionsMe)
    }

    @Test
    fun sendStatesAndWebhooksMap() {
        assertEquals(MessageState.Pending, chatMessage(row(1, sendState = SendState.Pending), null, FakeRules).state)
        val failed = chatMessage(row(1, sendState = SendState.Failed(ErrorView("RATE_LIMITED", "Slow down.", true, null))), null, FakeRules)
        assertEquals(MessageState.Failed("Slow down."), failed.state)
        val opaque = chatMessage(row(1, sendState = SendState.Failed(ErrorView("CLIENT_HTTP", "<html>502</html>", true, null))), null, FakeRules)
        assertEquals(MessageState.Failed(SERVER_ERROR_FALLBACK), opaque.state)
        val hook = chatMessage(row(1).copy(webhook = WebhookView("w1", "Deploy bot", null)), null, FakeRules)
        assertEquals("Deploy bot", hook.author)
        assertEquals("w1", hook.authorId)
    }

    /** Counts the rows it maps, so a test can tell a cache hit from a miss. */
    private class CountingRules : ChatRules by FakeRules {
        var mapped = 0
        override fun pieces(display: String, segs: List<TextSeg>): List<MessagePiece> {
            mapped++
            return FakeRules.pieces(display, segs)
        }
    }

    @Test
    fun aWindowCoreLoadedAgainWithTheSameSeqsShowsItsOwnMessages() {
        val rules = CountingRules()
        val mapper = RowMapper(rules)
        val first = (1L..3L).map { row(it, display = "old $it", revision = it.toULong()) }
        mapper.reset(first)
        assertEquals(listOf("old 1", "old 2", "old 3"), mapper.map(first, null).map { it.pieces.single().text })
        // The same window sent again (a reopen): every row from the cache.
        mapper.reset(first)
        mapper.map(first, null)
        assertEquals(3, rules.mapped)

        // Core forgot the window and loaded it again: the same (seq, revision) pairs, other messages.
        val renumbered = (1L..3L).map { row(it, display = "new $it", revision = it.toULong()).copy(id = "other$it") }
        mapper.reset(renumbered)
        val shown = mapper.map(renumbered, null)
        assertEquals(listOf("new 1", "new 2", "new 3"), shown.map { it.pieces.single().text })
        assertEquals(listOf("other1", "other2", "other3"), shown.map { it.id })

        // Even with the same id and revision, a row that changed is mapped again.
        val edited = renumbered.mapIndexed { i, r -> if (i == 1) r.copy(display = "new 2!", segs = listOf(TextSeg(6u, SegKind.Text, plain))) else r }
        assertEquals("new 2!", mapper.map(edited, null)[1].pieces.single().text)
        // Rows gone from the list leave the cache.
        mapper.map(edited.take(1), null)
        assertEquals(1, mapper.size)
    }

    @Test
    fun sizesReadAsPeopleWriteThem() {
        assertEquals("0 B", sizeText(0))
        assertEquals("1023 B", sizeText(1023))
        assertEquals("1.0 KB", sizeText(1024))
        assertEquals("2.1 MB", sizeText(2_202_010))
        assertEquals("1.0 GB", sizeText(1L shl 30))
    }
}
