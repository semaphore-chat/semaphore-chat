// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import app.semaphorechat.android.screens.ChatConnection
import app.semaphorechat.android.screens.ChatFace
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

            // Paging back: each older page lands above, keeping every row already there.
            var pages = 0
            while (!chat.state.value.atStart) {
                val before = chat.state.value.messages.map { it.key }
                chat.loadOlder()
                until("an older page") { !chat.state.value.loadingOlder && chat.state.value.messages.size > before.size || chat.state.value.atStart }
                val after = chat.state.value.messages.map { it.key }
                assertEquals("the rows read stay, in order", before, after.takeLast(before.size))
                assertTrue(++pages < 10)
            }
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
