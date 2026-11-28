// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.Conversation
import uniffi.semaphore.LoadState
import uniffi.semaphore.NotificationKind
import uniffi.semaphore.NotifyLevel
import uniffi.semaphore.OsNotification
import uniffi.semaphore.SessionState
import uniffi.semaphore.WallClock
import uniffi.semaphore_mobile.MobileConfig
import uniffi.semaphore_mobile.SecretStore
import uniffi.semaphore_mobile.start

/**
 * Core's notifications through CoreStore to a [Notifier], against semaphore-fake-server: another
 * member's mention raises one (with core's own kind), nothing is raised while that channel is on
 * screen, a read on another device withdraws it, and a muted channel raises nothing.
 */
class NotifyFlowJvmTest {
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

    /** What CoreStore handed on, in order. */
    private class FakeNotifier : Notifier {
        val shown = CopyOnWriteArrayList<Pair<OsNotification, NotificationKind?>>()
        val withdrawn = CopyOnWriteArrayList<String>()
        @Volatile var cleared = 0

        override fun show(notification: OsNotification, kind: NotificationKind?) {
            shown += notification to kind
        }
        override fun withdraw(tag: String) {
            withdrawn += tag
        }
        override fun clearAll() {
            cleared++
        }
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

    /** Another member mentions [me] in [channel]. */
    private fun mention(channel: String, me: String, text: String) {
        control("advance_clock", """{"ms":1}""")
        control(
            "post_as",
            """{"channelId":"$channel","authorId":"$authorId","text":"$text","broadcast":true,"mentionUserId":"$me"}""",
        )
    }

    @Test
    fun aMentionNotifiesUnlessShownOrMutedAndAReadElsewhereWithdrawsIt() {
        assumeTrue("android.sh passes the fake server", server != null && channelId != null && authorId != null)
        val pipe = EventPipe()
        val host = runBlocking {
            start(
                MobileConfig(
                    dataDir = Files.createTempDirectory("semaphore-notify").toFile().path,
                    userAgent = "Semaphore-Android/0.0.0 (JVM test)",
                    deviceName = "JVM notify test",
                    appVersion = "0.0.0",
                ),
                MemorySecrets(),
                Clock,
                pipe,
            )
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val notifier = FakeNotifier()
        try {
            val core = host.core()
            val store = CoreStore(core, scope, pipe.events, notifier = notifier)
            runBlocking { core.signIn(server!!, "me", "pw") }
            until("sign-in and the socket") {
                core.session() is SessionState.SignedIn && core.connection() == ConnectionState.CONNECTED
            }
            val me = (core.session() as SessionState.SignedIn).me.id
            // CoreStore asks for the notification list at sign-in, so core's rows name each kind.
            until("the notification list") { core.notifications().state == LoadState.Ready }
            until("the channels listed") { core.communities().any { c -> core.channels(c.id).any { it.id == channelId } } }
            val community = core.communities().first { c -> core.channels(c.id).any { it.id == channelId } }.id
            val memes = core.channels(community).first { it.name == "memes" }.id
            val general = channelId!!
            fun tags() = notifier.shown.map { it.first.tag }

            // On screen: #general's mention raises nothing. #memes's, after it, does: so the first
            // was decided (and refused) by then, the socket's events being in order.
            val chat = store.conversation(Conversation.Channel(general))
            chat.open()
            chat.setShown(true)
            mention(general, me, "seen as it lands")
            mention(memes, me, "the first marker")
            until("the marker's notification") { "channel:$memes" in tags() }
            assertEquals("nothing for the channel on screen", listOf("channel:$memes"), tags())

            // Left: the next mention there notifies, as a mention (core's kind, from its list).
            chat.leave()
            mention(general, me, "are you around")
            until("the mention's notification") { "channel:$general" in tags() }
            val (raised, kind) = notifier.shown.last()
            assertEquals("channel:$general", raised.tag)
            assertEquals(NotificationKind.MENTION, kind)
            assertEquals(Conversation.Channel(general), raised.link.conversation)
            assertEquals(community, raised.link.communityId)
            assertTrue(raised.title, raised.title.contains("mentioned you"))
            assertTrue(raised.body.startsWith("are you around"))
            assertEquals(NotifyChannels.MENTIONS, NotificationPlan.of(raised, kind).channel)

            // Read on another device: the server says so, and core withdraws it.
            control(
                "emit",
                """{"event":"readReceiptUpdated","payload":{"channelId":"$general","lastReadMessageId":"read-elsewhere","lastReadAt":"2026-11-28T12:00:00Z"}}""",
            )
            until("the withdrawal") { "channel:$general" in notifier.withdrawn }

            // Muted: #memes raises nothing; #general's marker after it does.
            runBlocking { core.setChannelNotifyLevel(memes, NotifyLevel.MUTED) }
            until("#memes muted") { core.channelNotifyLevel(memes).effective == NotifyLevel.MUTED }
            val before = notifier.shown.size
            mention(memes, me, "muted here")
            mention(general, me, "the second marker")
            until("the second marker") { notifier.shown.size > before && tags().last() == "channel:$general" }
            assertEquals("nothing from the muted channel", listOf("channel:$general"), tags().drop(before))
            runBlocking { core.setChannelNotifyLevel(memes, null) }

            // Signing out clears what was shown.
            runBlocking { core.signOut() }
            until("the sign-out cleared them") { notifier.cleared == 1 }
        } finally {
            scope.cancel()
            pipe.close()
            host.shutdown()
        }
    }
}
