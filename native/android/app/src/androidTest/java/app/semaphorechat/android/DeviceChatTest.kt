// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.util.Log
import android.view.View
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.semaphorechat.android.kit.chat.ChatKitText
import app.semaphorechat.android.kit.chat.ComposerText
import app.semaphorechat.android.screens.ChatText
import app.semaphorechat.android.screens.ConnectText
import app.semaphorechat.android.screens.INSECURE_WARNING
import app.semaphorechat.android.screens.SignInText
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.Conversation
import uniffi.semaphore.CoreEvent
import uniffi.semaphore.CoreListener
import uniffi.semaphore.ListOp
import uniffi.semaphore.SessionState
import uniffi.semaphore.WallClock
import uniffi.semaphore_mobile.MobileConfig
import uniffi.semaphore_mobile.SecretStore
import uniffi.semaphore_mobile.start

/**
 * The chat's read side on the emulator, through the real activity and screens against the fake
 * server native/scripts/android-device-test.sh runs: a channel's newest messages, a live one, the
 * typing line, and scrolling back to the channel's start. Also times a 1000-row reset crossing the
 * FFI into the chat's state, logged under the tag [TIMING_TAG].
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class DeviceChatTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val arguments = InstrumentationRegistry.getArguments()

    @Before
    fun initNativeLib() {
        NativeLib.init(context)
    }

    private fun argument(name: String): String {
        val value = arguments.getString(name)
        assumeTrue("native/scripts/android-device-test.sh passes -e $name", value != null)
        return value!!
    }

    private fun waitFor(matcher: SemanticsMatcher, timeoutMs: Long = 30_000) {
        compose.waitUntilAtLeastOneExists(matcher, timeoutMs)
    }

    private fun until(what: String, timeoutMs: Long = 60_000, condition: () -> Boolean) {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        while (!condition()) {
            check(System.nanoTime() < deadline) { "timed out waiting for $what" }
            Thread.sleep(20)
        }
    }

    /** The fake server's control API, over a plain socket (Android's cleartext policy is the platform stacks'). */
    private fun control(server: String, name: String, json: String) {
        val url = URI(server)
        val body = json.toByteArray(Charsets.UTF_8)
        Socket().use { socket ->
            socket.connect(InetSocketAddress(url.host, url.port), 10_000)
            val head = "POST /__control/$name HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\n" +
                "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n"
            socket.getOutputStream().apply {
                write(head.toByteArray(Charsets.UTF_8))
                write(body)
                flush()
            }
            val response = socket.getInputStream().readBytes().toString(Charsets.UTF_8)
            assertTrue("the fake server refused $name: $response", response.startsWith("HTTP/1.1 200") || response.startsWith("HTTP/1.0 200"))
        }
    }

    /** Another member posts, a millisecond after the last (the fake server's clock stands still otherwise). */
    private fun postAs(server: String, channel: String, author: String, text: String, broadcast: Boolean = true) {
        control(server, "advance_clock", """{"ms":1}""")
        control(server, "post_as", """{"channelId":"$channel","authorId":"$author","text":"$text","broadcast":$broadcast}""")
    }

    private fun closeAndAwaitDetach(scenario: ActivityScenario<MainActivity>) {
        val detached = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.window.decorView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v: View) = Unit
                override fun onViewDetachedFromWindow(v: View) = detached.countDown()
            })
        }
        scenario.close()
        check(detached.await(30, TimeUnit.SECONDS)) { "the closed activity's window was never detached" }
    }

    @Test
    fun aChannelShowsItsNewestHearsLiveMessagesAndTypingAndScrollsBackToItsStart() {
        val server = argument("server")
        val channel = argument("channel")
        val author = argument("author")
        runBlocking { SemaphoreHost.shutdownForTest() }
        listOf("core", "secrets", "last-community").forEach { File(context.noBackupFilesDir, it).deleteRecursively() }
        // More than a page: the first page stops short of the channel's start.
        repeat(30) { postAs(server, channel, author, "device filler $it", broadcast = false) }

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        waitFor(hasText(ConnectText.TITLE))
        compose.onNode(hasSetTextAction()).performTextInput(server)
        compose.onNode(hasText(ConnectText.CONNECT) and hasClickAction()).performClick()
        waitFor(hasText(INSECURE_WARNING))
        compose.onNode(hasText(ConnectText.CONTINUE) and hasClickAction()).performClick()
        waitFor(hasText(SignInText.USERNAME))
        val fields = compose.onAllNodes(hasSetTextAction())
        fields[0].performTextInput("me")
        fields[1].performTextInput("pw")
        compose.onNode(hasText(SignInText.SIGN_IN) and hasClickAction()).performClick()

        // Couch Co-op opens first; its #general.
        waitFor(hasText("Couch Co-op"))
        waitFor(hasText("general") and hasClickAction())
        compose.onNode(hasText("general") and hasClickAction()).performClick()
        waitFor(hasText("device filler 29"))

        postAs(server, channel, author, "a live one from the device test")
        waitFor(hasText("a live one from the device test"))

        control(server, "emit", """{"event":"userTyping","payload":{"channelId":"$channel","userId":"$author","isTyping":true}}""")
        waitFor(hasText("is typing…", substring = true))

        // Back to the start: older pages load above as the list scrolls up.
        val start = hasText(ChatText.start("general"))
        var swipes = 0
        while (compose.onAllNodes(start).fetchSemanticsNodes().isEmpty()) {
            compose.onNode(hasTestTag(ChatText.LIST_TAG)).performTouchInput { swipeDown() }
            compose.waitForIdle()
            check(++swipes < 80) { "never reached the channel's start" }
        }
        waitFor(hasText("patch notes are up", substring = true))
        closeAndAwaitDetach(scenario)
        runBlocking { SemaphoreHost.shutdownForTest() }
    }

    @Test
    fun aSentMessageIsConfirmedAndAFailedOneSaysNotSentAndRetrySendsIt() {
        val server = argument("server")
        runBlocking { SemaphoreHost.shutdownForTest() }
        listOf("core", "secrets", "last-community").forEach { File(context.noBackupFilesDir, it).deleteRecursively() }

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        waitFor(hasText(ConnectText.TITLE))
        compose.onNode(hasSetTextAction()).performTextInput(server)
        compose.onNode(hasText(ConnectText.CONNECT) and hasClickAction()).performClick()
        waitFor(hasText(INSECURE_WARNING))
        compose.onNode(hasText(ConnectText.CONTINUE) and hasClickAction()).performClick()
        waitFor(hasText(SignInText.USERNAME))
        val fields = compose.onAllNodes(hasSetTextAction())
        fields[0].performTextInput("me")
        fields[1].performTextInput("pw")
        compose.onNode(hasText(SignInText.SIGN_IN) and hasClickAction()).performClick()
        waitFor(hasText("Couch Co-op"))
        waitFor(hasText("general") and hasClickAction())
        val field = hasTestTag(ComposerText.FIELD_TAG)
        val send = hasContentDescription(ComposerText.SEND) and hasClickAction()
        // Send stays disabled until the list's first page is there (no row could carry the text
        // yet), and a tap on it then does nothing. The first page is held back a moment so the
        // field is typed into while the list still loads, as on a slow device, every run.
        control(server, "delay_route", """{"operationId":"MessagesController_findAllForChannel","ms":2000}""")
        try {
            compose.onNode(hasText("general") and hasClickAction()).performClick()
            waitFor(field)
            compose.onNode(field).performTextInput("sent from the device")
            waitFor(send and isEnabled())
        } finally {
            control(server, "delay_route", """{"operationId":"MessagesController_findAllForChannel","ms":0}""")
        }

        // Sent: the field clears at once, and the row is confirmed (no longer "Sending…").
        compose.onNode(send).performClick()
        waitFor(hasText("sent from the device") and !field)
        compose.waitUntil(30_000) {
            compose.onAllNodes(hasText(ChatKitText.SENDING)).fetchSemanticsNodes().isEmpty() &&
                compose.onAllNodes(field and hasText("sent from the device")).fetchSemanticsNodes().isEmpty()
        }

        // Not sent: the row says so, and Retry sends it.
        control(server, "fail_next_send", """{"code":"UNKNOWN"}""")
        compose.onNode(field).performTextInput("retried from the device")
        waitFor(send and isEnabled())
        compose.onNode(send).performClick()
        waitFor(hasText(ChatKitText.NOT_SENT))
        compose.onNode(hasText(ChatKitText.RETRY) and hasClickAction()).performClick()
        compose.waitUntilDoesNotExist(hasText(ChatKitText.NOT_SENT), 30_000)
        compose.waitUntil(30_000) { compose.onAllNodes(hasText(ChatKitText.SENDING)).fetchSemanticsNodes().isEmpty() }
        compose.waitUntilExactlyOneExists(hasText("retried from the device"), 30_000)
        closeAndAwaitDetach(scenario)
        runBlocking { SemaphoreHost.shutdownForTest() }
    }

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

    /** Passes core's events on, noting when a reset of [conversation] arrives and how many rows it had. */
    private class TimedPipe(private val conversation: Conversation, val pipe: EventPipe) : CoreListener {
        val resets = CopyOnWriteArrayList<Pair<Long, ListOp.Reset>>()
        override fun onEvent(event: CoreEvent) {
            if (event is CoreEvent.MessagesChanged && event.conversation == conversation) {
                event.ops.filterIsInstance<ListOp.Reset>().forEach { resets += System.nanoTime() to it }
            }
            pipe.onEvent(event)
        }
    }

    @Test
    fun aThousandRowResetReachesTheChatStateWithinTwoSeconds() {
        val server = argument("server")
        val channel = argument("bulkChannel")
        val author = argument("author")
        // In parallel and without moving the clock: this test doesn't read the order, only the count.
        val pool = java.util.concurrent.Executors.newFixedThreadPool(16)
        try {
            (0 until 1_010).map { n ->
                pool.submit {
                    control(server, "post_as", """{"channelId":"$channel","authorId":"$author","text":"bulk $n","broadcast":false}""")
                }
            }.forEach { it.get() }
        } finally {
            pool.shutdown()
        }
        val posted = System.nanoTime()
        val conversation = Conversation.Channel(channel)
        val timed = TimedPipe(conversation, EventPipe())
        val dir = File(context.noBackupFilesDir, "device-test/bulk").apply {
            deleteRecursively()
            mkdirs()
        }
        val host = runBlocking {
            start(MobileConfig(dir.path, "Semaphore-Android/0.0.0 (Android device test)", "Android device test", "0.0.0"), MemorySecrets(), Clock, timed)
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val core = host.core()
            val store = CoreStore(core, scope, timed.pipe.events)
            runBlocking { core.signIn(server, "me", "pw") }
            until("sign-in and the socket") { core.session() is SessionState.SignedIn && core.connection() == ConnectionState.CONNECTED }
            val chat = store.conversation(conversation)
            chat.open()
            until("the first page") { chat.state.value.messages.isNotEmpty() }
            // Page back until core's window is full (1000 rows).
            until("a full window", timeoutMs = 180_000) {
                if (!chat.state.value.loadingOlder) chat.loadOlder()
                chat.state.value.messages.size >= 1_000 || chat.state.value.atStart
            }
            val rows = chat.state.value.messages.size
            Log.i(TIMING_TAG, "paged back to $rows rows in %.1f s".format((System.nanoTime() - posted) / 1e9))
            // Another channel, then back: core sends the window it kept as one reset.
            runBlocking { core.openConversation(Conversation.Channel(argument("channel"))) }
            val began = System.nanoTime()
            val seen = timed.resets.size
            chat.open()
            until("the reset") { timed.resets.drop(seen).any { it.second.rows.size >= rows } }
            val (crossed, reset) = timed.resets.drop(seen).first { it.second.rows.size >= rows }
            // The store maps it (message_pieces per changed row; unchanged rows come from its cache).
            until("the state") { chat.state.value.messages.size == rows }
            val done = System.nanoTime()
            val ffiMs = (crossed - began) / 1_000_000.0
            val totalMs = (done - began) / 1_000_000.0
            Log.i(TIMING_TAG, "reset of $rows rows: open to the Kotlin event %.1f ms, to the chat state %.1f ms".format(ffiMs, totalMs))
            // The same reset into a store with nothing cached: every row through message_pieces.
            val fresh = ConversationStore(conversation, core, scope)
            val mapStart = System.nanoTime()
            fresh.apply(listOf(reset))
            val mapped = (System.nanoTime() - mapStart) / 1_000_000.0
            Log.i(TIMING_TAG, "the same reset mapped with no cache (every row through message_pieces): %.1f ms".format(mapped))
            assertTrue("$rows rows", rows >= 1_000)
            // Generous: about 45 ms on the x86_64 emulator, and 600 ms uncached. A regression to
            // seconds (a row mapped again for every row, say) fails here.
            assertTrue("the reset took %.1f ms to reach the chat state".format(totalMs), totalMs < 2_000)
            assertTrue("mapping 1000 rows uncached took %.1f ms".format(mapped), mapped < 5_000)
        } finally {
            timed.pipe.close()
            scope.cancel()
            host.shutdown()
        }
    }

    companion object {
        const val TIMING_TAG = "SemaphoreTiming"
    }
}
