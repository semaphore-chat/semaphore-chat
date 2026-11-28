// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import app.semaphorechat.android.kit.chat.MentionTarget
import app.semaphorechat.android.kit.chat.PieceKind
import app.semaphorechat.android.screens.ChatConnection
import app.semaphorechat.android.screens.BlockedKind
import app.semaphorechat.android.screens.ChatMessage
import app.semaphorechat.android.screens.ComposerAccess
import app.semaphorechat.android.screens.MessageState
import app.semaphorechat.android.screens.SuggestionKind
import app.semaphorechat.android.screens.ChatFace
import app.semaphorechat.android.screens.ComposerCaps
import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.Conversation
import uniffi.semaphore.SessionState
import uniffi.semaphore.WallClock
import uniffi.semaphore_mobile.MobileConfig
import uniffi.semaphore_mobile.SecretStore
import uniffi.semaphore_mobile.start

/**
 * The chat's read side (CoreStore and ConversationStore over the generated bindings and a host
 * build of libsemaphore_mobile.so) against semaphore-fake-server: opening a channel, paging back
 * to its start, a live message, "N new" while away, the typing line, and a message posted while
 * the socket was down arriving after the reconnect. native/scripts/android.sh passes the server.
 */
class ChatFlowJvmTest {
    private val server: String? = System.getProperty("semaphore.fakeServer")
    private val channelId: String? = System.getProperty("semaphore.channelId")
    private val authorId: String? = System.getProperty("semaphore.authorId")

    private class MemorySecrets : SecretStore {
        val values = ConcurrentHashMap<String, String>()
        override fun load(key: String): String? = values[key]
        override fun save(key: String, value: String) {
            values[key] = value
        }
        override fun delete(key: String) {
            values.remove(key)
        }
    }

    private object Clock : WallClock {
        override fun nowMs(): ULong = System.currentTimeMillis().toULong()
    }

    private fun until(what: String, timeoutMs: Long = 15_000, condition: () -> Boolean) {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        while (!condition()) {
            check(System.nanoTime() < deadline) { "timed out waiting for $what" }
            Thread.sleep(10)
        }
    }

    private fun control(name: String, body: String) {
        val connection = URI("$server/__control/$name").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(body.toByteArray()) }
        assertEquals("$name answered", 200, connection.responseCode)
        connection.disconnect()
    }

    /**
     * Another member posts. The fake server's clock stands still, and messages at one instant sort
     * by id (random UUIDs in the showcase), so it moves on a millisecond first: posts keep their order.
     */
    private fun postAs(text: String, broadcast: Boolean = true) {
        control("advance_clock", """{"ms":1}""")
        control("post_as", """{"channelId":"$channelId","authorId":"$authorId","text":"$text","broadcast":$broadcast}""")
    }

    /** The `lastReadMessageId` of every `markAsRead` the fake server has seen for the channel, in order. */
    private fun readMarks(): List<String> {
        val connection = URI("$server/__control/requests").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.outputStream.use { it.write("{}".toByteArray()) }
        val body = connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        connection.disconnect()
        return Regex("\\{[^{}]*\"event\":\"markAsRead\"[^{}]*\"payload\":\\{([^{}]*)\\}")
            .findAll(body)
            .map { it.groupValues[1] }
            .filter { "\"$channelId\"" in it }
            .mapNotNull { Regex("\"lastReadMessageId\":\"([^\"]+)\"").find(it)?.groupValues?.get(1) }
            .toList()
    }

    /** The socket events of [name] the fake server has seen from clients for the channel. */
    private fun clientEvents(name: String): Int {
        val connection = URI("$server/__control/requests").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.outputStream.use { it.write("{}".toByteArray()) }
        val body = connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        connection.disconnect()
        return Regex("\\{[^{}]*\"event\":\"$name\"[^{}]*\"payload\":\\{([^{}]*)\\}")
            .findAll(body)
            .count { "\"$channelId\"" in it.groupValues[1] }
    }

    private fun startCore(pipe: EventPipe) = runBlocking {
        start(
            MobileConfig(
                dataDir = Files.createTempDirectory("semaphore-chat").toFile().path,
                userAgent = "Semaphore-Android/0.0.0 (JVM test)",
                deviceName = "JVM chat test",
                appVersion = "0.0.0",
            ),
            MemorySecrets(),
            Clock,
            pipe,
        )
    }

    private fun words(message: ChatMessage) = message.pieces.joinToString("") { it.text }

    /** Everything clients sent the fake server, as one string (`/__control/requests`). */
    private fun requestLog(): String {
        val connection = URI("$server/__control/requests").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.outputStream.use { it.write("{}".toByteArray()) }
        val body = connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        connection.disconnect()
        return body
    }

    /** How many sends with this client nonce the server has seen. */
    private fun sendsOf(nonce: String): Int = Regex(Regex.escape("\"clientNonce\":\"$nonce\"")).findAll(requestLog()).count()

    /** A file whose bytes come from memory, counting how often they were read. */
    private class MemoryFile(name: String, val bytes: ByteArray, mime: String = "text/plain", reads: IntArray = IntArray(1)) {
        val picked = PickedFile(name, bytes.size.toLong(), mime) { reads[0]++; bytes }
    }

    @Test
    fun sendsFilesFetchesThemAndRetriesAndRemovesFailedUploads() {
        assumeTrue("android.sh passes the fake server", server != null && channelId != null && authorId != null)
        val pipe = EventPipe()
        val host = startCore(pipe)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val core = host.core()
            val store = CoreStore(core, scope, pipe.events)
            runBlocking { core.signIn(server!!, "me", "pw") }
            until("sign-in and the socket") {
                core.session() is SessionState.SignedIn && core.connection() == ConnectionState.CONNECTED
            }
            until("the channel listed") { core.communities().any { c -> core.channels(c.id).any { it.id == channelId } } }
            val communityId = core.communities().first { c -> core.channels(c.id).any { it.id == channelId } }.id
            val chat = store.conversation(Conversation.Channel(channelId!!))
            val composer = store.composer(communityId, channelId)
            fun last() = chat.state.value.messages.lastOrNull()
            chat.open()
            until("the first page") { chat.state.value.face == ChatFace.Ready }

            // Two files with words: picked files cost nothing until sent, then go with the message.
            val reads = IntArray(1)
            val notes = MemoryFile("notes.txt", "first file".toByteArray(), reads = reads)
            val data = MemoryFile("data.bin", ByteArray(70_000) { (it % 251).toByte() }, "application/octet-stream", reads)
            composer.attach(listOf(notes.picked, data.picked))
            assertEquals(listOf("notes.txt", "data.bin"), composer.state.value.files.map { it.name })
            assertEquals(0, reads[0])
            composer.onDraftChange(TextFieldValue("two files", TextRange(9)))
            composer.send()
            assertTrue("the tray clears at once", composer.state.value.files.isEmpty())
            until("the message with both files") {
                last()?.let { words(it) == "two files" && it.state == MessageState.Sent && it.attachments.size == 2 && it.uploads.isEmpty() } == true
            }
            assertEquals("each file read once", 2, reads[0])
            val sent = last()!!.attachments
            assertEquals(setOf("notes.txt", "data.bin"), sent.map { it.name }.toSet())
            // Fetched back through core's file, with the session's auth.
            sent.forEach { file ->
                val expected = if (file.name == "notes.txt") notes.bytes else data.bytes
                assertTrue(file.name, expected.contentEquals(runBlocking { core.file(file.fileId, false) }))
                assertEquals(expected.size.toLong(), file.sizeBytes)
            }

            // A file alone, no words, is a message too.
            composer.attach(listOf(MemoryFile("alone.txt", "x".toByteArray()).picked))
            composer.send()
            until("the file-only message") { last()?.attachments?.singleOrNull()?.name == "alone.txt" }

            // Past the limits: the whole pick is refused and the tray says why.
            composer.attach(List(11) { MemoryFile("f$it", ByteArray(1)).picked })
            assertTrue(composer.state.value.files.isEmpty())
            assertEquals("Maximum 10 files per message", composer.state.value.fileProblem)
            composer.attach(listOf(PickedFile("huge.iso", ComposerCaps.MAX_FILE_BYTES + 1, "application/octet-stream") { ByteArray(0) }))
            assertEquals("File \"huge.iso\" exceeds the 10 MB size limit", composer.state.value.fileProblem)
            assertTrue(composer.state.value.files.isEmpty())

            // A file that can't be read when sent: nothing goes, and text and file come back.
            composer.attach(listOf(PickedFile("gone.txt", 3, "text/plain") { throw UnreadableFile("gone.txt") }))
            composer.onDraftChange(TextFieldValue("with a lost file", TextRange(16)))
            composer.send()
            until("the draft back") { composer.draft.text == "with a lost file" }
            assertEquals(listOf("gone.txt"), composer.state.value.files.map { it.name })
            assertEquals("Couldn't read \"gone.txt\"", composer.state.value.fileProblem)
            assertFalse("nothing sent", "with a lost file" in requestLog())
            composer.removeFile(0)
            composer.onDraftChange(TextFieldValue())
            assertTrue(composer.state.value.files.isEmpty())

            // An upload that fails stays on its row with why; Retry sends it again.
            control("fail_route", """{"operationId":"FileUploadController_uploadFile","status":500,"code":"INTERNAL"}""")
            composer.attach(listOf(MemoryFile("retry.txt", "again".toByteArray()).picked))
            composer.onDraftChange(TextFieldValue("upload fails", TextRange(12)))
            composer.send()
            until("the failed upload") { last()?.let { words(it) == "upload fails" && it.uploads.singleOrNull()?.failed != null } == true }
            chat.retryUpload(last()!!.clientNonce!!, 0)
            until("the retried file attached") {
                last()?.let { words(it) == "upload fails" && it.uploads.isEmpty() && it.attachments.singleOrNull()?.name == "retry.txt" } == true
            }

            // Removed instead: the message settles with no file.
            control("fail_route", """{"operationId":"FileUploadController_uploadFile","status":500,"code":"INTERNAL"}""")
            composer.attach(listOf(MemoryFile("drop.txt", "never".toByteArray()).picked))
            composer.onDraftChange(TextFieldValue("upload dropped", TextRange(14)))
            composer.send()
            until("the second failed upload") { last()?.let { words(it) == "upload dropped" && it.uploads.singleOrNull()?.failed != null } == true }
            chat.removeUpload(last()!!.clientNonce!!, 0)
            until("the upload gone") { last()?.let { words(it) == "upload dropped" && it.uploads.isEmpty() && it.attachments.isEmpty() } == true }
        } finally {
            pipe.close()
            scope.cancel()
            host.shutdown()
        }
    }

    @Test
    fun sendsRetriesDeletesSignalsTypingMentionsAndKeepsDraftsPerChannel() {
        assumeTrue("android.sh passes the fake server", server != null && channelId != null && authorId != null)
        val pipe = EventPipe()
        val host = startCore(pipe)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val core = host.core()
            val store = CoreStore(core, scope, pipe.events)
            runBlocking { core.signIn(server!!, "me", "pw") }
            until("sign-in and the socket") {
                core.session() is SessionState.SignedIn && core.connection() == ConnectionState.CONNECTED
            }
            until("the channel listed") { core.communities().any { c -> core.channels(c.id).any { it.id == channelId } } }
            val communityId = core.communities().first { c -> core.channels(c.id).any { it.id == channelId } }.id
            val meId = (core.session() as SessionState.SignedIn).me.id
            val chat = store.conversation(Conversation.Channel(channelId!!))
            val composer = store.composer(communityId, channelId)
            fun last() = chat.state.value.messages.lastOrNull()

            // Sent before the first page is there: core refuses it (no row could carry the text), so
            // the text comes back and nothing reaches the server.
            control("delay_route", """{"operationId":"MessagesController_findAllForChannel","ms":3000}""")
            control("fail_next_send", """{"code":"RATE_LIMITED"}""")
            chat.open()
            composer.onDraftChange(TextFieldValue("early words", TextRange(11)))
            composer.send()
            until("the text back") { composer.draft.text == "early words" }
            assertEquals("still loading", ChatFace.Loading, chat.state.value.face)
            assertFalse("nothing sent", "early words" in requestLog())
            control("delay_route", """{"operationId":"MessagesController_findAllForChannel","ms":0}""")
            until("the first page") { chat.state.value.face == ChatFace.Ready }
            assertEquals(ComposerAccess.Open, composer.state.value.access)

            // Now it goes, and fails (the fault armed above): the failed row keeps the text. Retry
            // sends it again with the same nonce, once, however often it is pressed.
            composer.send()
            assertEquals("the field clears at once", "", composer.draft.text)
            until("the failed row") { last()?.let { words(it) == "early words" && it.state is MessageState.Failed } == true }
            val failed = last()!!
            val nonce = failed.clientNonce!!
            assertTrue((failed.state as MessageState.Failed).reason.isNotBlank())
            assertEquals(1, sendsOf(nonce))
            chat.retrySend(nonce)
            chat.retrySend(nonce)
            until("the retried row confirmed") { last()?.let { words(it) == "early words" && it.state == MessageState.Sent } == true }
            assertEquals("the same nonce", nonce, last()!!.clientNonce)
            assertEquals("sent twice in all: the failed try and one retry", 2, sendsOf(nonce))
            assertEquals("one row for the message", 1, chat.state.value.messages.count { words(it) == "early words" })

            // Typing out: "started" once while keys arrive within the interval, "stopped" on send.
            val startedBefore = clientEvents("typingStart")
            val stoppedBefore = clientEvents("typingStop")
            composer.onDraftChange(TextFieldValue("h", TextRange(1)))
            composer.onDraftChange(TextFieldValue("hello from the composer", TextRange(23)))
            until("the typing signal") { clientEvents("typingStart") == startedBefore + 1 }
            composer.send()
            until("the sent row") { last()?.let(::words) == "hello from the composer" }
            until("the stop signal") { clientEvents("typingStop") == stoppedBefore + 1 }
            until("confirmed") { last()!!.state == MessageState.Sent }
            assertEquals("only one start", startedBefore + 1, clientEvents("typingStart"))
            // Cleared by hand: "stopped" too.
            composer.onDraftChange(TextFieldValue("x", TextRange(1)))
            composer.onDraftChange(TextFieldValue(""))
            until("the stop on clearing") { clientEvents("typingStop") == stoppedBefore + 2 }

            // The interval, on the composer's own clock: a second "started" only 3 s on.
            var now = 1_000_000L
            val timed = ComposerStore(Conversation.Channel(channelId), communityId, channelId, core, scope) { now }
            val base = clientEvents("typingStart")
            timed.onDraftChange(TextFieldValue("a", TextRange(1)))
            until("the first start") { clientEvents("typingStart") == base + 1 }
            now += TYPING_EVERY_MS - 1
            timed.onDraftChange(TextFieldValue("ab", TextRange(2)))
            now += 1
            timed.onDraftChange(TextFieldValue("abc", TextRange(3)))
            until("the start 3 s on") { clientEvents("typingStart") == base + 2 }
            timed.onDraftChange(TextFieldValue(""))
            timed.close()
            assertEquals("none inside the interval", base + 2, clientEvents("typingStart"))

            // A blank draft sends nothing; padding is trimmed, as the web and desktop do.
            composer.onDraftChange(TextFieldValue("   \n  "))
            composer.send()
            assertEquals("   \n  ", composer.draft.text)
            composer.onDraftChange(TextFieldValue("\n  padded words  \n\n"))
            composer.send()
            until("the trimmed row") { last()?.let { words(it) == "padded words" && it.state == MessageState.Sent } == true }

            // A lone surrogate (half an emoji) is sent as U+FFFD, through the real FFI, not a crash.
            composer.onDraftChange(TextFieldValue("lone \uD83D half"))
            composer.send()
            until("the lone surrogate row") { last()?.let { words(it) == "lone � half" && it.state == MessageState.Sent } == true }

            // Delete throws a failed one away.
            control("fail_next_send", """{"code":"RATE_LIMITED"}""")
            composer.onDraftChange(TextFieldValue("throw me away", TextRange(13)))
            composer.send()
            until("the second failed row") { last()?.let { words(it) == "throw me away" && it.state is MessageState.Failed } == true }
            chat.discardSend(last()!!.clientNonce!!)
            until("the row gone") { chat.state.value.messages.none { words(it) == "throw me away" } }

            // Mentions: "@" lists members; picking one after an emoji sends a user mention whose
            // byte range core reads back as that member's name.
            composer.onDraftChange(TextFieldValue("👩‍👩‍👧 hi @", TextRange("👩‍👩‍👧 hi @".length)))
            until("member suggestions") { composer.state.value.suggestions.any { it.kind == SuggestionKind.User && it.id != meId } }
            val member = composer.state.value.suggestions.first { it.kind == SuggestionKind.User && it.id != meId }
            composer.pick(member)
            assertEquals("👩‍👩‍👧 hi ${member.insertText} ", composer.draft.text)
            assertEquals(composer.draft.text.length, composer.draft.selection.end)
            assertTrue("picking closes the list", composer.state.value.suggestions.isEmpty())
            composer.onDraftChange(composer.draft.copy(text = composer.draft.text + "😀 look"))
            composer.send()
            until("the mention confirmed") { last()?.let { it.state == MessageState.Sent && words(it).startsWith("👩‍👩‍👧 hi") } == true }
            val mention = last()!!.pieces.single { it.kind is PieceKind.Mention }
            assertEquals(MentionTarget.User(member.id), (mention.kind as PieceKind.Mention).target)
            assertTrue("the mention's text is the member: ${mention.text}", mention.text == member.insertText || mention.text == "@${member.label}")

            // Typed out in full and sent at once, while core's search for that exact name is still
            // on its way: the name listed while typing makes it a mention anyway. A typed #channel too.
            val channelName = core.channels(communityId).first { it.id == channelId }.name
            fun channelMentionsSent() = Regex("\\{[^{}]*\"CHANNEL_MENTION\"[^{}]*\\}").findAll(requestLog()).count { "\"$channelId\"" in it.value }
            val channelMentionsBefore = channelMentionsSent()
            control("delay_route", """{"operationId":"MembershipController_searchCommunityMembers","ms":5000}""")
            var typed = "ping "
            for (c in member.insertText + " in #" + channelName) {
                typed += c
                composer.onDraftChange(TextFieldValue(typed, TextRange(typed.length)))
            }
            composer.send()
            until("the typed mentions confirmed") { last()?.let { it.state == MessageState.Sent && words(it).startsWith("ping") } == true }
            control("delay_route", """{"operationId":"MembershipController_searchCommunityMembers","ms":0}""")
            val targets = last()!!.pieces.mapNotNull { (it.kind as? PieceKind.Mention)?.target }
            assertEquals(listOf(MentionTarget.User(member.id)), targets)
            // The #channel went as a channel mention (core draws a name-less channel mention as
            // nothing yet: a reader-side gap, filed separately), so check what the server got.
            assertEquals(channelMentionsBefore + 1, channelMentionsSent())
            // "#" lists channels.
            composer.onDraftChange(TextFieldValue("#", TextRange(1)))
            until("channel suggestions") { composer.state.value.suggestions.any { it.kind == SuggestionKind.Channel } }
            composer.onDraftChange(TextFieldValue(""))
            assertTrue(composer.state.value.suggestions.isEmpty())

            // A timeout replaces the composer and counts down on the composer's clock, while shown.
            control("time_out", """{"communityId":"$communityId","userId":"$meId","seconds":600}""")
            fun timedOutUntil() = core.channels(communityId).first { it.id == channelId }.permissions?.timedOutUntilMs
            until("the timeout in core") { timedOutUntil() != null }
            val untilMs = timedOutUntil()!!
            var clock = untilMs - 90_000
            val counted = ComposerStore(Conversation.Channel(channelId), communityId, channelId, core, scope) { clock }
            counted.setShown(true)
            assertEquals(ComposerAccess.Blocked("Timed out, 2 min left", BlockedKind.TimedOut), counted.state.value.access)
            clock = untilMs - 30_000
            until("the countdown in seconds") { counted.state.value.access == ComposerAccess.Blocked("Timed out, 30 s left", BlockedKind.TimedOut) }
            counted.setShown(false)
            clock = untilMs
            assertFalse("no countdown runs while not shown", counted.countingDown)
            assertEquals("no countdown while not shown", ComposerAccess.Blocked("Timed out, 30 s left", BlockedKind.TimedOut), counted.state.value.access)
            counted.setShown(true)
            assertEquals("over: the composer is back", ComposerAccess.Open, counted.state.value.access)
            counted.close()
            control("time_out", """{"communityId":"$communityId","userId":"$meId","seconds":0}""")

            // Drafts are per channel and stay while the app runs.
            composer.onDraftChange(TextFieldValue("half a thought", TextRange(14)))
            val other = store.composer(communityId, "another-channel")
            assertEquals("", other.draft.text)
            other.onDraftChange(TextFieldValue("elsewhere", TextRange(9)))
            assertTrue(store.composer(communityId, channelId) === composer)
            assertEquals("half a thought", store.composer(communityId, channelId).draft.text)
            assertEquals("elsewhere", store.composer(communityId, "another-channel").draft.text)

            // Signing out drops the drafts with the lists.
            runBlocking { core.signOut() }
            until("the drafts dropped") { store.composer(communityId, channelId) !== composer }
        } finally {
            pipe.close()
            scope.cancel()
            host.shutdown()
        }
    }

    @Test
    fun readsPagesHearsTypesAndCatchesUpAfterAReconnect() {
        assumeTrue("android.sh passes the fake server", server != null && channelId != null && authorId != null)
        val pipe = EventPipe()
        val host = runBlocking {
            start(
                MobileConfig(
                    dataDir = Files.createTempDirectory("semaphore-chat").toFile().path,
                    userAgent = "Semaphore-Android/0.0.0 (JVM test)",
                    deviceName = "JVM chat test",
                    appVersion = "0.0.0",
                ),
                MemorySecrets(),
                Clock,
                pipe,
            )
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val core = host.core()
            val store = CoreStore(core, scope, pipe.events)
            // More than a page, so the first page stops short of the start.
            repeat(40) { postAs("filler $it", broadcast = false) }
            runBlocking { core.signIn(server!!, "me", "pw") }
            until("sign-in and the socket") {
                core.session() is SessionState.SignedIn && core.connection() == ConnectionState.CONNECTED
            }

            val chat = store.conversation(Conversation.Channel(channelId!!))
            assertEquals(ChatFace.Loading, chat.state.value.face)
            chat.open()
            until("the first page") { chat.state.value.face == ChatFace.Ready && chat.state.value.messages.isNotEmpty() }
            val first = chat.state.value
            assertEquals("filler 39", first.messages.last().pieces.joinToString("") { it.text })
            assertTrue(first.atLiveEdge)
            assertFalse("a page of 25 stops short of the start", first.atStart)
            assertNull(first.jump)

            // Paging back: each older page lands above, keeping every row already there. A page's
            // "loaded" is published after its rows (ConversationStore runs it behind core's events).
            var pages = 0
            while (!chat.state.value.atStart) {
                val before = chat.state.value.messages.map { it.key }
                chat.loadOlder()
                until("an older page") { !chat.state.value.loadingOlder }
                val after = chat.state.value.messages.map { it.key }
                assertEquals("the rows read stay, in order", before, after.takeLast(before.size))
                assertTrue(++pages < 10)
            }
            // The 14 messages the scenario has and the 40 posted (more, if other tests posted here).
            until("every row back to the start") { chat.state.value.atStart && chat.state.value.messages.size >= 54 }
            val all = chat.state.value.messages
            assertTrue("every row: ${all.size}", all.size >= 54)
            assertEquals(all.map { it.key }.sorted(), all.map { it.key })
            assertEquals(all.size, all.map { it.key }.toSet().size)
            assertTrue(chat.state.value.atStart)

            // A live message, seen at the bottom: no "new" count.
            postAs("live one")
            until("the live message") { chat.state.value.messages.last().pieces.joinToString("") { it.text } == "live one" }
            assertNull(chat.state.value.jump)

            // Read marks: none while the chat isn't shown (the app not resumed); shown at the
            // bottom, the newest row once; scrolled away, none; a resume marks what arrived.
            fun newestId() = chat.state.value.messages.last().id!!
            val earlier = readMarks().size
            fun marks() = readMarks().drop(earlier)
            chat.markSeen()
            assertEquals("not shown: no read mark", emptyList<String>(), marks())
            chat.setShown(true)
            until("the read mark") { marks() == listOf(newestId()) }
            chat.markSeen()
            chat.setAway(true)
            postAs("read later")
            until("the next live message") { chat.state.value.messages.last().pieces.joinToString("") { it.text } == "read later" }
            chat.markSeen()
            chat.setAway(false)
            chat.setShown(false)
            chat.markSeen()
            assertEquals("once, and nothing while away or not shown", 1, marks().size)
            chat.setShown(true)
            until("the mark on resume") { marks().lastOrNull() == newestId() }
            assertEquals(2, marks().size)

            // Scrolled away: the next ones count as new, and coming back clears them.
            chat.setAway(true)
            assertEquals("Jump to latest", chat.state.value.jump?.text)
            postAs("while away 1")
            postAs("while away 2")
            until("two new") { chat.state.value.jump?.text == "2 new" }
            assertEquals("Jump to latest, 2 new messages", chat.state.value.jump?.name)
            chat.setAway(false)
            assertNull(chat.state.value.jump)

            // Typing from another member shows, by name.
            control("emit", """{"event":"userTyping","payload":{"channelId":"$channelId","userId":"$authorId","isTyping":true}}""")
            until("the typing line") { chat.state.value.typing.endsWith("is typing…") }
            // No stop event: the line clears when core's typing timeout passes (8 s), by the re-read.
            until("the typing line clears by itself", timeoutMs = 20_000) { chat.state.value.typing.isEmpty() }

            // The socket goes and stays down; a message posted meanwhile arrives with the reconnect.
            control("refuse_connections", """{"refuse":true}""")
            control("drop_connections", "{}")
            until("the connection line") { chat.state.value.connection == ChatConnection.Reconnecting }
            postAs("posted during the gap")
            control("refuse_connections", """{"refuse":false}""")
            until("the reconnect", timeoutMs = 60_000) { chat.state.value.connection == ChatConnection.Live }
            until("the missed message", timeoutMs = 30_000) {
                chat.state.value.messages.any { m -> m.pieces.joinToString("") { it.text } == "posted during the gap" }
            }
            assertNotNull(chat.state.value.messages.lastOrNull())

            // Leaving the chat: core counts the channel's new messages as unread again.
            fun unread() = core.communities().flatMap { core.channels(it.id) }.firstOrNull { it.id == channelId }?.unreadCount ?: 0u
            until("the channel listed") { core.communities().any { c -> core.channels(c.id).any { it.id == channelId } } }
            until("read up to the newest") { unread() == 0u }
            chat.leave()
            postAs("after leaving")
            until("the unread count") { unread() > 0u }
            // And opening it again reads it.
            chat.open()
            chat.setShown(true)
            until("the reopened list") { chat.state.value.messages.last().pieces.joinToString("") { it.text } == "after leaving" }
            chat.markSeen()
            until("read again") { unread() == 0u }

            // Only the lists of the conversations opened last are kept.
            (1..KEPT_CONVERSATIONS + 2).forEach { store.conversation(Conversation.Channel("elsewhere-$it")) }
            assertEquals(KEPT_CONVERSATIONS, store.keptConversations)
            assertTrue(store.conversation(Conversation.Channel(channelId)) !== chat)

            // Signing out drops the lists: they belong to the account.
            runBlocking { core.signOut() }
            until("the signed-out store") { store.session.value !is SessionState.SignedIn }
            until("the lists dropped") { store.keptConversations == 0 }
        } finally {
            pipe.close()
            scope.cancel()
            host.shutdown()
        }
    }
}
