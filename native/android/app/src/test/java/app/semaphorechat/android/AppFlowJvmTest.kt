// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import app.semaphorechat.android.screens.ChannelIcon
import app.semaphorechat.android.screens.ConnectFailure
import app.semaphorechat.android.screens.Load
import app.semaphorechat.android.screens.Route
import app.semaphorechat.android.screens.SERVER_ERROR_FALLBACK
import app.semaphorechat.android.screens.StartState
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import uniffi.semaphore.ChannelKind
import uniffi.semaphore.ChannelPermissions
import uniffi.semaphore.ChannelPreset
import uniffi.semaphore.ChannelRow
import uniffi.semaphore.CommunityRow
import uniffi.semaphore.RemovalCause
import uniffi.semaphore.SessionState
import uniffi.semaphore.UserView
import uniffi.semaphore.WallClock
import uniffi.semaphore_mobile.MobileConfig
import uniffi.semaphore_mobile.MobileHost
import uniffi.semaphore_mobile.SecretStore
import uniffi.semaphore_mobile.start

/**
 * The app's flow (AppModel over CoreStore over the generated bindings and a host build of
 * libsemaphore_mobile.so) against semaphore-fake-server, as the screens drive it: connect and
 * every probe outcome, sign in, the communities and channels with their counts, a channel and
 * Back, then a restart that restores the session into the community last opened, and one whose
 * stored session the server refuses. native/scripts/android.sh passes the fake server.
 */
class AppFlowJvmTest {
    private val server: String? = System.getProperty("semaphore.fakeServer")

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

    private class MemoryLastCommunity : LastCommunity {
        val values = ConcurrentHashMap<String, String>()
        override fun get(server: String): String? = values[server]
        override fun set(server: String, communityId: String) {
            values[server] = communityId
        }
    }

    private object Clock : WallClock {
        override fun nowMs(): ULong = System.currentTimeMillis().toULong()
    }

    /** One run of the app: the host, the store and the model, as SemaphoreHost builds them. */
    private class Run(val host: MobileHost, val model: AppModel, val scope: CoroutineScope, val pipe: EventPipe) {
        fun close() {
            assertTrue(host.flush(2_000u))
            pipe.close()
            scope.cancel()
            host.shutdown()
        }
    }

    /** A "network available" signal the test fires by hand; counts the registrations and closes. */
    private class FakeNetwork : NetworkWatch {
        val callbacks = CopyOnWriteArrayList<() -> Unit>()
        val registered = AtomicInteger()
        val closed = AtomicInteger()
        override fun watch(onAvailable: () -> Unit): AutoCloseable {
            callbacks += onAvailable
            registered.incrementAndGet()
            return AutoCloseable {
                callbacks -= onAvailable
                closed.incrementAndGet()
            }
        }
        fun available() = callbacks.forEach { it() }
    }

    /**
     * A loopback HTTP proxy to [upstream]: one request per connection, except a WebSocket upgrade,
     * which is piped through. [failLogin] answers a login with a web server's HTML 502 page. Closing
     * it frees the port, so a later [Proxy] on the same port brings the "server" back.
     */
    private class Proxy(private val upstream: URI, port: Int = 0) : AutoCloseable {
        private val listener = ServerSocket().apply {
            reuseAddress = true
            bind(InetSocketAddress("127.0.0.1", port))
        }
        @Volatile var failLogin = false
        val port: Int get() = listener.localPort
        val url: String get() = "http://127.0.0.1:$port"

        init {
            thread(isDaemon = true) {
                while (!listener.isClosed) {
                    val client = runCatching { listener.accept() }.getOrNull() ?: break
                    thread(isDaemon = true) { runCatching { client.use { serve(it) } } }
                }
            }
        }

        private fun readHead(input: InputStream): ByteArray? {
            val head = java.io.ByteArrayOutputStream()
            while (true) {
                val next = input.read()
                if (next < 0) return null
                head.write(next)
                val bytes = head.toByteArray()
                if (bytes.size >= 4 && String(bytes, bytes.size - 4, 4, Charsets.ISO_8859_1) == "\r\n\r\n") return bytes
            }
        }

        private fun serve(client: Socket) {
            val input = client.getInputStream().buffered()
            val out = client.getOutputStream()
            val head = readHead(input) ?: return
            val text = String(head, Charsets.ISO_8859_1)
            val lines = text.trimEnd().split("\r\n")
            val length = lines.firstNotNullOfOrNull {
                if (it.startsWith("content-length:", ignoreCase = true)) it.substringAfter(':').trim().toInt() else null
            } ?: 0
            val body = input.readNBytes(length)
            val upgrade = lines.any { it.startsWith("upgrade:", ignoreCase = true) }
            if (failLogin && !upgrade && lines.first().contains("/auth/login")) {
                val page = "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>"
                out.write(
                    ("HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/html\r\ncontent-length: ${page.length}\r\n" +
                        "connection: close\r\n\r\n$page").toByteArray(),
                )
                return
            }
            Socket(upstream.host, upstream.port).use { up ->
                if (upgrade) {
                    up.getOutputStream().write(head + body)
                    thread(isDaemon = true) { runCatching { up.getInputStream().copyTo(out) } }
                    input.copyTo(up.getOutputStream())
                } else {
                    val rewritten = lines.filterNot { it.startsWith("connection:", ignoreCase = true) } +
                        "Connection: close"
                    up.getOutputStream().write((rewritten.joinToString("\r\n") + "\r\n\r\n").toByteArray(Charsets.ISO_8859_1) + body)
                    up.getInputStream().copyTo(out)
                }
            }
        }

        override fun close() = listener.close()
    }

    /** Connect and sign in as the screens do, on a plain-http server. */
    private fun signInThroughModel(model: AppModel, url: String) {
        assertNull(probe(model, url))
        model.continueInsecure()
        model.onUsernameChange("me")
        model.onPasswordChange("pw")
        model.signIn()
        until("the Lounge") { (model.navigator.top as? Route.Community)?.id != null }
    }

    private fun launch(
        dir: File,
        secrets: SecretStore,
        last: LastCommunity,
        networks: NetworkWatch = NetworkWatch.None,
    ): Run {
        val pipe = EventPipe()
        val host = runBlocking {
            start(
                MobileConfig(dir.path, "Semaphore-Android/0.0.0 (JVM test)", "JVM flow test", "0.0.0"),
                secrets,
                Clock,
                pipe,
            )
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val store = CoreStore(host.core(), scope, pipe.events)
        return Run(host, AppModel(host.core(), store, scope, last, host.lastServer(), networks, networkDebounceMs = 100), scope, pipe)
    }

    private fun until(what: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + 15_000_000_000L
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
        assertEquals(200, connection.responseCode)
        connection.disconnect()
    }

    /** A port that answers every request with a web server's HTML page: not Semaphore. */
    private fun notSemaphore(): String {
        val socket = ServerSocket(0)
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val client = runCatching { socket.accept() }.getOrNull() ?: break
                thread(isDaemon = true) {
                    client.use {
                        val reader = it.getInputStream().bufferedReader()
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val page = "<html><body>It works!</body></html>"
                        it.getOutputStream().write(
                            ("HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: ${page.length}\r\n" +
                                "connection: close\r\n\r\n$page").toByteArray(),
                        )
                    }
                }
            }
        }
        return "http://127.0.0.1:${socket.localPort}"
    }

    private fun closedPort(): Int = ServerSocket(0).use { it.localPort }

    private fun probe(model: AppModel, url: String): ConnectFailure? {
        model.onUrlChange(url)
        model.connect()
        until("the probe of $url") { !model.connect.value.probing }
        return model.connect.value.failure
    }

    @Test
    fun connectSignInCommunitiesChannelsAndRestarts() {
        assumeTrue("android.sh passes the fake server", server != null)
        val url = server!!
        val dir = Files.createTempDirectory("semaphore-flow").toFile()
        val secrets = MemorySecrets()
        val last = MemoryLastCommunity()

        val first = launch(dir, secrets, last)
        val model = first.model
        assertEquals(Route.Connect, model.navigator.top)

        // Every way a connect can fail, then a plain-http server that answers.
        assertEquals(ConnectFailure.Invalid, probe(model, "not a url"))
        assertEquals(ConnectFailure.Unreachable, probe(model, "http://127.0.0.1:${closedPort()}"))
        assertEquals(ConnectFailure.TlsRefused, probe(model, url.replaceFirst("http://", "https://")))
        assertEquals(ConnectFailure.NotSemaphore, probe(model, notSemaphore()))
        control("onboarding", """{"needsSetup":true}""")
        try {
            assertEquals(ConnectFailure.NeedsSetup(url), probe(model, url))
        } finally {
            control("onboarding", """{"needsSetup":false}""")
        }
        assertNull(probe(model, url))
        val insecure = model.connect.value.insecure
        assertNotNull("an http:// server shows the warning first", insecure)
        assertEquals(Route.Connect, model.navigator.top)
        model.continueInsecure()
        assertEquals(listOf(Route.Connect, Route.SignIn), model.navigator.stack.value)
        assertTrue(model.signIn.value!!.server.insecure)

        // A refused password stays on sign-in, saying why; the right one opens the Lounge.
        model.onUsernameChange("me")
        model.onPasswordChange("wrong")
        model.signIn()
        until("the refusal") { model.signIn.value?.error != null }
        assertEquals(Route.SignIn, model.navigator.top)
        model.onPasswordChange("pw")
        model.signIn()
        until("the Lounge with a community") { (model.navigator.top as? Route.Community)?.id != null }

        val store = model.store
        until("the communities") { store.communities.value is Load.Ready }
        val communities = (store.communities.value as Load.Ready).value
        assertEquals(listOf("Couch Co-op", "Lumen Studio", "Trailheads", "Synth Club"), communities.map { it.name })
        assertEquals("the first community opens", communities[0].id, model.navigator.community)
        val lumen = communities.first { it.name == "Lumen Studio" }
        until("Lumen's counts") { (store.communities.value as Load.Ready).value.first { it.id == lumen.id }.mentions == 1 }

        model.openCommunity(lumen.id)
        assertEquals(lumen.id, last.get(url))
        val channels = store.watch(lumen.id)
        until("Lumen's channels") { channels.value is Load.Ready }
        val ready = (channels.value as Load.Ready).value
        assertEquals(listOf("announcements", "general", "dev", "design", "random"), ready.text.map { it.name })
        assertEquals(listOf("Lounge", "Standup"), ready.voice.map { it.name })
        val design = ready.text.first { it.name == "design" }
        assertEquals(1, design.mentions)
        assertTrue(design.unread)
        assertEquals(ChannelIcon.Hash, design.icon)

        model.openChannel(design.id)
        assertEquals(Route.Channel(lumen.id, design.id), model.navigator.top)
        assertTrue(model.back())
        assertEquals(Route.Community(lumen.id), model.navigator.top)
        assertTrue("the root leaves Back to the platform", !model.back())
        model.openAll()
        assertTrue(model.allOpen.value)
        model.closeAll()
        first.close()

        // A restart restores the session, into the community opened last.
        val second = launch(dir, secrets, last)
        until("the restored Lounge") { second.model.navigator.top == Route.Community(lumen.id) }
        second.close()

        // Another device signs in and ends every other session, this one's included: the next start
        // finds its stored session refused, and signs in again on the same server, saying why.
        val other = launch(Files.createTempDirectory("semaphore-flow-other").toFile(), MemorySecrets(), MemoryLastCommunity())
        runBlocking { other.host.core().signIn(url, "me", "pw") }
        until("the other device's session") { other.host.core().session() is SessionState.SignedIn }
        assertTrue(runBlocking { other.host.core().revokeOtherSessions() } >= 1u)
        other.close()
        val third = launch(dir, secrets, last)
        until("sign-in after the refusal") { third.model.navigator.top == Route.SignIn }
        assertEquals(SESSION_ENDED, third.model.signIn.value?.notice)
        assertEquals(url, third.model.signIn.value?.server?.url)
        third.close()
    }

    @Test
    fun aSessionRevokedWhileSignedInGoesBackToSignInSayingSo() {
        assumeTrue("android.sh passes the fake server", server != null)
        val url = server!!
        val run = launch(Files.createTempDirectory("semaphore-flow-revoked").toFile(), MemorySecrets(), MemoryLastCommunity())
        signInThroughModel(run.model, url)
        // Another device signs in and ends every other session, this running one's included.
        val other = launch(Files.createTempDirectory("semaphore-flow-other").toFile(), MemorySecrets(), MemoryLastCommunity())
        runBlocking { other.host.core().signIn(url, "me", "pw") }
        until("the other device's session") { other.host.core().session() is SessionState.SignedIn }
        assertTrue(runBlocking { other.host.core().revokeOtherSessions() } >= 1u)
        other.close()
        // The running app finds out on its next authenticated call.
        until("sign-in after the revoke") {
            run.model.store.retry()
            run.model.navigator.top == Route.SignIn
        }
        assertEquals(SESSION_ENDED, run.model.signIn.value?.notice)
        assertEquals(url, run.model.signIn.value?.server?.url)
        assertNull(run.model.server)
        run.close()
    }

    @Test
    fun anUnreachableServerAtLaunchKeepsTheSessionAndRetriesWhenItsBack() {
        assumeTrue("android.sh passes the fake server", server != null)
        val dir = Files.createTempDirectory("semaphore-flow-offline").toFile()
        val secrets = MemorySecrets()
        val last = MemoryLastCommunity()
        // Sign in through a proxy, so the "server" can go away and come back on the same address.
        val proxy = Proxy(URI(server!!))
        val port = proxy.port
        val first = launch(dir, secrets, last)
        runBlocking { first.host.core().signIn(proxy.url, "me", "pw") }
        until("the first session") { first.host.core().session() is SessionState.SignedIn }
        first.close()
        proxy.close()

        val network = FakeNetwork()
        val second = launch(dir, secrets, last, network)
        val state = { second.model.start.value }
        until("the unreachable start") { state() is StartState.Unreachable }
        val unreachable = state() as StartState.Unreachable
        assertEquals("http://127.0.0.1:$port", unreachable.server)
        assertEquals("CLIENT_UNREACHABLE", unreachable.code)
        assertEquals(Route.Start, second.model.navigator.top)

        // The network comes back (a burst of callbacks) while the server is still down: one retry,
        // which is unreachable again, and the watch is registered again for the next one.
        until("the network watch") { network.registered.get() == 1 }
        repeat(3) { network.available() }
        until("the failed retry's watch") { network.closed.get() >= 1 && network.registered.get() == 2 }
        assertTrue(state() is StartState.Unreachable)

        // The server is back; the next signal retries once and opens the Lounge.
        val back = Proxy(URI(server), port)
        try {
            repeat(3) { network.available() }
            until("the restored Lounge") { (second.model.navigator.top as? Route.Community)?.id != null }
            until("the watch is closed after leaving the state") { network.callbacks.isEmpty() }
        } finally {
            second.close()
            back.close()
        }
    }

    @Test
    fun retryRestoreByHandAndUseAnotherServerFromUnreachable() {
        assumeTrue("android.sh passes the fake server", server != null)
        val dir = Files.createTempDirectory("semaphore-flow-offline2").toFile()
        val secrets = MemorySecrets()
        val last = MemoryLastCommunity()
        val proxy = Proxy(URI(server!!))
        val port = proxy.port
        val first = launch(dir, secrets, last)
        runBlocking { first.host.core().signIn(proxy.url, "me", "pw") }
        until("the first session") { first.host.core().session() is SessionState.SignedIn }
        first.close()
        proxy.close()

        val network = FakeNetwork()
        val second = launch(dir, secrets, last, network)
        until("the unreachable start") { second.model.start.value is StartState.Unreachable }
        // "Try again" while it is still down stays here.
        second.model.retryRestore()
        until("the retry to fail again") { second.model.start.value is StartState.Unreachable && network.registered.get() >= 1 }
        assertEquals(Route.Start, second.model.navigator.top)
        // "Use another server": the connect screen, with the address filled in and the watch gone.
        second.model.useAnotherServer()
        assertEquals(Route.Connect, second.model.navigator.top)
        assertEquals("http://127.0.0.1:$port", second.model.connect.value.url)
        assertNull(second.model.connect.value.failure)
        until("the watch to close") { network.callbacks.isEmpty() }
        // The old server coming back no longer pulls the app away from the connect screen.
        network.available()
        Thread.sleep(400)
        assertEquals(Route.Connect, second.model.navigator.top)
        second.close()
    }

    @Test
    fun aServerErrorShowsFixedTextNeverTheResponseBody() {
        assumeTrue("android.sh passes the fake server", server != null)
        val proxy = Proxy(URI(server!!))
        val run = launch(Files.createTempDirectory("semaphore-flow-502").toFile(), MemorySecrets(), MemoryLastCommunity())
        try {
            // A server answering Semaphore's probe with an HTML 502: ConnectFailure.Failed, fixed text.
            val badGateway = badGatewayServer()
            val failure = probe(run.model, badGateway)
            assertEquals(ConnectFailure.Failed(SERVER_ERROR_FALLBACK), failure)
            assertTrue(!(failure as ConnectFailure.Failed).message.contains("<"))

            // A login answered with the same page.
            proxy.failLogin = true
            assertNull(probe(run.model, proxy.url))
            run.model.continueInsecure()
            run.model.onUsernameChange("me")
            run.model.onPasswordChange("pw")
            run.model.signIn()
            until("the sign-in error") { run.model.signIn.value?.error != null }
            assertEquals(SERVER_ERROR_FALLBACK, run.model.signIn.value?.error)
        } finally {
            run.close()
            proxy.close()
        }
    }

    /** A port that answers every request with an HTML 502 page, as a proxy in front of a dead backend. */
    private fun badGatewayServer(): String {
        val socket = ServerSocket(0)
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val client = runCatching { socket.accept() }.getOrNull() ?: break
                thread(isDaemon = true) {
                    client.use {
                        val reader = it.getInputStream().bufferedReader()
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val page = "<html><head><title>502 Bad Gateway</title></head></html>"
                        it.getOutputStream().write(
                            ("HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/html\r\ncontent-length: ${page.length}\r\n" +
                                "connection: close\r\n\r\n$page").toByteArray(),
                        )
                    }
                }
            }
        }
        return "http://127.0.0.1:${socket.localPort}"
    }

    @Test
    fun coreRowsBecomeTheScreensModels() {
        val community = CommunityRow("c", "Lumen", null, 4u, 0u)
        assertEquals(false, CoreStore.summary(community).mentions > 0)
        assertTrue(CoreStore.summary(community).unread)
        fun row(id: String, kind: ChannelKind, private: Boolean = false, preset: ChannelPreset = ChannelPreset.NORMAL) =
            ChannelRow(
                id = id, communityId = "c", name = id, kind = kind, isPrivate = private, position = 0,
                unreadCount = 0u, mentionCount = 2u,
                voiceUsers = listOf(UserView("u", "priya", "Priya", null), UserView("v", "sam", null, null)),
                slowmodeSeconds = 0u, permissions = null as ChannelPermissions?, preset = preset,
            )
        val mapped = CoreStore.channelsOf(
            listOf(
                row("news", ChannelKind.TEXT, private = true, preset = ChannelPreset.ANNOUNCEMENT),
                row("leads", ChannelKind.TEXT, private = true),
                row("odd", ChannelKind.UNKNOWN),
                row("room", ChannelKind.VOICE),
            ),
        )
        assertEquals(listOf(ChannelIcon.Megaphone, ChannelIcon.Lock), mapped.text.map { it.icon })
        assertEquals(listOf("Priya", "sam"), mapped.voice.single().people.map { it.name })
        assertEquals("You were banned from Lumen.", CoreStore.removalMessage("Lumen", RemovalCause.Banned(null, null)))
        assertEquals("A community you were in was deleted.", CoreStore.removalMessage("", RemovalCause.Deleted))
        assertEquals("https://chat.example.com", AppModel.normaliseServerUrl(" chat.example.com/ "))
        assertEquals("http://10.0.2.2:3000", AppModel.normaliseServerUrl("http://10.0.2.2:3000"))
        assertEquals("https://münchen.example", AppModel.normaliseServerUrl("münchen.example"))
        assertEquals("https://чат.рф", AppModel.normaliseServerUrl("чат.рф"))
        assertEquals("http://my_server:3000", AppModel.normaliseServerUrl("http://my_server:3000"))
        assertEquals("https://[::1]:3000", AppModel.normaliseServerUrl("[::1]:3000"))
        assertNull(AppModel.normaliseServerUrl("https://:3000"))
        assertNull(AppModel.normaliseServerUrl("https://"))
        assertNull(AppModel.normaliseServerUrl("ftp://x"))
        assertNull(AppModel.normaliseServerUrl("two words"))
    }
}
