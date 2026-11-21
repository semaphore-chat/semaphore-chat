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
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.Conversation
import uniffi.semaphore.CoreEvent
import uniffi.semaphore.CoreListener
import uniffi.semaphore.ListOp
import uniffi.semaphore.NetworkState
import uniffi.semaphore.RestoreOutcome
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.SessionState
import uniffi.semaphore.WallClock
import uniffi.semaphore_mobile.MobileConfig
import uniffi.semaphore_mobile.MobileHost
import uniffi.semaphore_mobile.SecretStore
import uniffi.semaphore_mobile.start

/**
 * The generated Kotlin bindings over a host build of libsemaphore_mobile.so, on the JVM, against
 * semaphore-fake-server: what the app does, minus Android. native/scripts/android.sh builds both
 * and passes where they are; run alone, the test is skipped.
 *
 * The Keystore store needs a device: `DeviceCoreTest` (`src/androidTest`) covers it on the
 * emulator. Here the store is in memory.
 */
class MobileCoreJvmTest {
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

    /** Throws what Kotlin code throws by accident: nothing the trait declares. */
    private class BrokenSecrets : SecretStore {
        override fun load(key: String): String? = throw IllegalStateException("broken load")
        override fun save(key: String, value: String) = throw IllegalStateException("broken save")
        override fun delete(key: String) = throw IllegalStateException("broken delete")
    }

    private class Recorder : CoreListener {
        val events = CopyOnWriteArrayList<CoreEvent>()
        override fun onEvent(event: CoreEvent) {
            events.add(event)
        }

        fun sawRow(conversation: Conversation, text: String): Boolean = events.any { event ->
            event is CoreEvent.MessagesChanged && event.conversation == conversation &&
                event.ops.any { op ->
                    val rows = when (op) {
                        is ListOp.Reset -> op.rows
                        is ListOp.Insert -> op.rows
                        is ListOp.Replace -> op.rows
                        else -> emptyList()
                    }
                    rows.any { it.display == text }
                }
        }
    }

    private object Clock : WallClock {
        override fun nowMs(): ULong = System.currentTimeMillis().toULong()
    }

    private fun until(what: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + 10_000_000_000L
        while (!condition()) {
            check(System.nanoTime() < deadline) { "timed out waiting for $what" }
            Thread.sleep(10)
        }
    }

    private fun launch(dir: java.io.File, secrets: SecretStore, events: Recorder): MobileHost =
        runBlocking {
            start(
                MobileConfig(
                    dataDir = dir.path,
                    userAgent = "Semaphore-Android/0.0.0 (JVM test)",
                    deviceName = "JVM test ✓",
                    appVersion = "0.0.0",
                ),
                secrets,
                Clock,
                events,
            )
        }

    private fun signedInAndConnected(core: SemaphoreCore) {
        until("sign-in") { core.session() is SessionState.SignedIn }
        until("the socket") { core.connection() == ConnectionState.CONNECTED }
    }

    private fun postAs(channel: String, author: String, text: String) {
        val connection = URI("$server/__control/post_as").toURL().openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        val body = """{"channelId":"$channel","authorId":"$author","text":"$text"}"""
        connection.outputStream.use { it.write(body.toByteArray()) }
        assertEquals(200, connection.responseCode)
        connection.disconnect()
    }

    @Test
    fun signsInHearsALiveMessageAndRestoresTheSessionNextStart() {
        assumeTrue("android.sh passes the fake server", server != null)
        val url = server!!
        val dir = Files.createTempDirectory("semaphore-jvm").toFile()
        val secrets = MemorySecrets()

        val events = Recorder()
        val first = launch(dir, secrets, events)
        val core = first.core()
        assertNull(first.lastServer())
        runBlocking { core.signIn(url, "me", "pw") }
        signedInAndConnected(core)
        until("the communities") { core.communities().isNotEmpty() }

        val channel = Conversation.Channel(channelId!!)
        runBlocking { core.openConversation(channel) }
        postAs(channelId, authorId!!, "hello from the JVM test")
        until("the live message") { events.sawRow(channel, "hello from the JVM test") }

        // Lifecycle, from a thread with no runtime, as the activity calls it.
        core.suspend()
        assertEquals(ConnectionState.SUSPENDED, core.connection())
        core.resume()
        signedInAndConnected(core)
        core.networkChanged(NetworkState.UNAVAILABLE)
        until("offline") { core.connection() == ConnectionState.OFFLINE }
        core.networkChanged(NetworkState.AVAILABLE)
        signedInAndConnected(core)

        until("the server to be remembered") { java.io.File(dir, "last-server").exists() }
        assertTrue(first.flush(2_000u))
        first.shutdown()
        assertTrue(secrets.values.keys.any { it.startsWith("refresh-token:") })

        val second = launch(dir, secrets, Recorder())
        assertEquals(url, second.lastServer())
        val outcome = runBlocking { second.core().restoreSession(url) }
        assertEquals(RestoreOutcome.SignedIn, outcome)
        signedInAndConnected(second.core())
        second.shutdown()
    }

    @Test
    fun aStoreThatThrowsCostsPersistenceNotTheSession() {
        assumeTrue("android.sh passes the fake server", server != null)
        val url = server!!
        val dir = Files.createTempDirectory("semaphore-jvm-broken").toFile()

        val first = launch(dir, BrokenSecrets(), Recorder())
        // The device id's read threw at start: reported, and the core started anyway.
        val failure = first.secretStoreFailure()
        assertNotNull(failure)
        assertTrue(failure!!, failure.contains("broken load"))
        val core = first.core()
        runBlocking { core.signIn(url, "me", "pw") }
        signedInAndConnected(core)
        until("the server to be remembered") { java.io.File(dir, "last-server").exists() }
        first.shutdown()

        val second = launch(dir, BrokenSecrets(), Recorder())
        assertEquals(url, second.lastServer())
        val outcome = runBlocking { second.core().restoreSession(url) }
        assertEquals(RestoreOutcome.NoSession, outcome)
        second.shutdown()
    }
}
