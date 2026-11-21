// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
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
import uniffi.semaphore_mobile.SecretStoreException
import uniffi.semaphore_mobile.start

/**
 * What the JVM test cannot reach, on an x86_64 emulator: the TLS verifier's Android half, the
 * Keystore-backed secret store, and the core over the real network with both of them in place.
 * `native/scripts/android-device-test.sh` builds this APK, starts semaphore-fake-server and the
 * emulator, and passes where everything is as `am instrument -e` arguments.
 *
 * The app talks to the fake server at `http://10.0.2.2:<port>`: inside an emulator, 10.0.2.2 is
 * the emulator process's own loopback, and the script runs the fake server next to the emulator.
 * The TLS tests use the same address for a self-signed server, and a public host for a
 * certificate the platform store trusts.
 */
@RunWith(AndroidJUnit4::class)
class DeviceCoreTest {
    private val arguments = InstrumentationRegistry.getArguments()
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

    /** The JVM test's store: the Keystore has tests of its own. */
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

    /**
     * The verifier's JVM half before anything builds a TLS client. Init is idempotent, and every
     * test here ends up needing it; a JNI failure throws here rather than in a connection.
     */
    @Before
    fun initNativeLib() {
        NativeLib.init(context)
    }

    @Test
    fun nativeLibInitialisesTheTlsVerifier() {
        // Loading the library and calling the JNI entry point is the whole check that a JVM can
        // make: it throws if the symbol or the verifier's initialisation is missing. That the
        // verifier then *works* is what the two TLS tests below show, in both directions.
        NativeLib.init(context)
        NativeLib.init(context)
    }

    @Test
    fun keystoreStoreRoundTripsSurvivesANewInstanceAndRefusesARenamedFile() {
        val dir = tempDir("keystore")
        val key = "refresh-token:http://10.0.2.2:18080"
        // Long and not ASCII: the store seals bytes, not code points.
        val value = "rt-" + "✓".repeat(700)

        val store = KeystoreSecretStore(dir)
        assertNull(store.load(key))
        store.save(key, value)
        assertEquals(value, store.load(key))

        // A new instance over the same directory: the Keystore key outlives the object, and will
        // outlive the process.
        assertEquals(value, KeystoreSecretStore(dir).load(key))

        // The secret's key is the GCM's associated data, so a file moved under another key's name
        // must not decrypt, even though the Keystore key is the same.
        store.save("second", "another secret")
        val first = sealedFile(dir, key)
        val second = sealedFile(dir, "second")
        assertTrue("$first is not a file", first.isFile)
        assertTrue("$second is not a file", second.isFile)
        Files.move(first.toPath(), second.toPath(), StandardCopyOption.REPLACE_EXISTING)
        assertThrows(SecretStoreException::class.java) {
            KeystoreSecretStore(dir).load("second")
        }

        // Delete removes the file as well as the value, and is safe to repeat.
        store.save("gone", "bye")
        assertEquals("bye", store.load("gone"))
        store.delete("gone")
        assertNull(store.load("gone"))
        assertFalse(sealedFile(dir, "gone").exists())
        store.delete("gone")
    }

    @Test
    fun coreSignsInHearsALiveMessageAndRestoresTheSessionNextStart() {
        val server = argument("server")
        val channelId = argument("channel")
        val authorId = argument("author")

        val base = tempDir("core")
        val dataDir = File(base, "data")
        val secretsDir = File(base, "secrets")

        val events = Recorder()
        val first = launch(dataDir, KeystoreSecretStore(secretsDir), events)
        val core = first.core()
        assertNull(first.lastServer())
        runBlocking { core.signIn(server, "me", "pw") }
        signedInAndConnected(core)
        until("the communities") { core.communities().isNotEmpty() }

        val channel = Conversation.Channel(channelId)
        runBlocking { core.openConversation(channel) }
        val text = "hello from the Android device"
        postAs(server, channelId, authorId, text)
        until("the live message") { events.sawRow(channel, text) }

        // Lifecycle, from the instrumentation thread, as the activity calls it.
        core.suspend()
        assertEquals(ConnectionState.SUSPENDED, core.connection())
        core.resume()
        signedInAndConnected(core)
        core.networkChanged(NetworkState.UNAVAILABLE)
        until("offline") { core.connection() == ConnectionState.OFFLINE }
        core.networkChanged(NetworkState.AVAILABLE)
        signedInAndConnected(core)

        until("the server to be remembered") { File(dataDir, "last-server").exists() }
        assertTrue(first.flush(2_000u))
        first.shutdown()

        // The refresh token is in Keystore-sealed files, readable by a store that shares nothing
        // with the first one but the directory and the Keystore key.
        val sealed = secretsDir.listFiles { file -> file.name.endsWith(".sealed") }?.toList()
        assertTrue("no sealed secret was written to $secretsDir", !sealed.isNullOrEmpty())
        assertNotNull(
            KeystoreSecretStore(secretsDir).load("refresh-token:${server.trimEnd('/')}"),
        )

        // A second start, as a new process would: same directory, a new store, the session
        // restored without a password.
        val second = launch(dataDir, KeystoreSecretStore(secretsDir), Recorder())
        assertEquals(server, second.lastServer())
        assertEquals(RestoreOutcome.SignedIn, runBlocking { second.core().restoreSession(server) })
        signedInAndConnected(second.core())
        second.shutdown()
    }

    /**
     * A self-signed certificate is refused. The permissive JSSE handshake first proves the same
     * server is up and presenting exactly the certificate the script generated: a plain connection
     * failure would otherwise look identical to a refused one.
     */
    @Test
    fun tlsVerifierRefusesACertificateTheDeviceDoesNotTrust() {
        val url = argument("tlsServer")
        val fingerprint = argument("tlsSha256")
        assertEquals(
            "the test server is not serving the generated certificate",
            fingerprint.lowercase(),
            handshake(url, trustEverything = true, verifyHostname = false),
        )

        val host = launch(tempDir("tls-untrusted"), MemorySecrets(), Recorder())
        runBlocking { host.core().signIn(url, "me", "pw") }
        val failed = host.core().session()
        assertTrue("expected the sign-in to fail, got $failed", failed is SessionState.SignInFailed)
        val message = (failed as SessionState.SignInFailed).error.message
        // reqwest reports a refused handshake as a communication error, never as an HTTP answer;
        // its text does not carry the verifier's reason, so the script checks the saved logcat
        // for the verifier's `UnknownIssuer` (native/scripts/android-device-test.sh). The
        // certificate names 10.0.2.2, so trust is the only thing left to refuse it for.
        assertTrue("not a transport failure: $message", message.contains("Communication Error"))
        assertFalse("TLS was never set up: $message", message.contains("TLS isn't initialised"))
        host.shutdown()
    }

    /**
     * A certificate the platform store trusts is accepted: the request reaches the server and
     * comes back an HTTP answer, not a communication error. JSSE with the platform trust store
     * runs first, so a missing network is reported as one instead of looking like a TLS failure.
     */
    @Test
    fun tlsVerifierAcceptsACertificateThePlatformStoreTrusts() {
        val url = argument("trustedServer")
        // JSSE with the platform trust store, first: proves the device can reach the host and
        // trusts its chain, so a failure below is about the core's TLS path and not the network.
        // Three tries, 2 s then 4 s apart: a third party's host may blip, and a bounded retry
        // is not a wait for a condition.
        val leaf = retrying(3) { handshake(url, trustEverything = false, verifyHostname = true) }
        assertTrue("a SHA-256 in lowercase hex, got '$leaf'", leaf.length == 64)

        val host = launch(tempDir("tls-trusted"), MemorySecrets(), Recorder())
        runBlocking { host.core().signIn(url, "me", "pw") }
        val failed = host.core().session()
        assertTrue("expected the sign-in to fail, got $failed", failed is SessionState.SignInFailed)
        val message = (failed as SessionState.SignInFailed).error.message
        // Nothing is asserted about the host's body: it is a third party's. What matters is that
        // the failure is not a transport one, and not one from before any handshake.
        assertFalse(
            "the handshake did not complete: $message",
            message.contains("Communication Error"),
        )
        assertFalse("TLS was never set up: $message", message.contains("TLS isn't initialised"))
        assertFalse(
            "the platform trust store was not read: $message",
            message.contains("cannot read the system's trusted certificates"),
        )
        host.shutdown()
    }

    // ----- helpers -------------------------------------------------------------

    private fun argument(name: String): String {
        val value = arguments.getString(name)
        assumeTrue("native/scripts/android-device-test.sh passes -e $name", value != null)
        return value!!
    }

    private fun tempDir(name: String): File {
        val dir = File(context.noBackupFilesDir, "device-test/$name")
        dir.deleteRecursively()
        check(dir.mkdirs()) { "cannot create $dir" }
        return dir
    }

    private fun launch(dir: File, secrets: SecretStore, events: Recorder): MobileHost =
        runBlocking {
            start(
                MobileConfig(
                    dataDir = dir.path,
                    userAgent = "Semaphore-Android/0.0.0 (Android device test)",
                    deviceName = "Android device test",
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

    private fun until(what: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + 30_000_000_000L
        while (!condition()) {
            check(System.nanoTime() < deadline) { "timed out waiting for $what" }
            Thread.sleep(20)
        }
    }

    /**
     * The fake server's control API, over a plain socket: Android's cleartext policy covers the
     * platform's HTTP stacks, and the test writes the request itself, which it does not cover.
     */
    private fun postAs(server: String, channel: String, author: String, text: String) {
        val url = URI(server)
        val body = """{"channelId":"$channel","authorId":"$author","text":"$text"}"""
            .toByteArray(Charsets.UTF_8)
        Socket().use { socket ->
            socket.connect(InetSocketAddress(url.host, url.port), 10_000)
            val head = "POST /__control/post_as HTTP/1.1\r\n" +
                "Host: ${url.host}\r\n" +
                "Content-Type: application/json\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Connection: close\r\n\r\n"
            socket.getOutputStream().apply {
                write(head.toByteArray(Charsets.UTF_8))
                write(body)
                flush()
            }
            val response = socket.getInputStream().readBytes().toString(Charsets.UTF_8)
            assertTrue(
                "the fake server refused the control request: $response",
                response.startsWith("HTTP/1.1 200") || response.startsWith("HTTP/1.0 200"),
            )
        }
    }

    /**
     * A JSSE handshake with `url`'s host, returning the SHA-256 of the leaf certificate it
     * presented as lowercase hex: the form the script's `sha256sum` prints, and the form the store
     * names its files by.
     */
    private fun <T> retrying(tries: Int, attempt: () -> T): T {
        var last: Exception? = null
        for (n in 1..tries) {
            try {
                return attempt()
            } catch (e: java.io.IOException) {
                last = e
                if (n < tries) Thread.sleep(2_000L * n)
            }
        }
        throw AssertionError("no handshake after $tries tries", last)
    }

    private fun handshake(url: String, trustEverything: Boolean, verifyHostname: Boolean): String {
        val uri = URI(url)
        val secure = if (trustEverything) {
            SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(TrustAny), null) }
        } else {
            SSLContext.getDefault()
        }
        val port = if (uri.port > 0) uri.port else 443
        (secure.socketFactory.createSocket() as SSLSocket).use { socket ->
            socket.connect(InetSocketAddress(uri.host, port), 20_000)
            if (verifyHostname) {
                socket.sslParameters = socket.sslParameters.apply {
                    endpointIdentificationAlgorithm = "HTTPS"
                }
            }
            socket.startHandshake()
            val leaf = socket.session.peerCertificates.first() as X509Certificate
            return MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
                .joinToString("") { "%02x".format(it) }
        }
    }

    /** The file a key's secret is sealed into: the SHA-256 of the key, as the store names it. */
    private fun sealedFile(dir: File, key: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
        return File(dir, digest.joinToString("") { "%02x".format(it) } + ".sealed")
    }

    /** For the self-signed server: the chain is the point of the test, not the certificate. */
    private object TrustAny : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
