// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.Manifest
import android.app.ActivityOptions
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.semaphorechat.android.screens.ConnectText
import app.semaphorechat.android.screens.INSECURE_WARNING
import app.semaphorechat.android.screens.Route
import app.semaphorechat.android.screens.SignInText
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.SessionState

/**
 * Notifications on the emulator, through the real activity, ConnectionService and the system's
 * NotificationManager, against the fake server android-device-test.sh runs: with the permission
 * granted, signing in starts the service; sent home, core stays connected and another member's
 * mention is posted; its tap opens the channel. Then, with the device forced into Doze, whether a
 * mention still arrives is logged under [DOZE_TAG] (reported, not asserted: D8's push is the
 * answer if it doesn't).
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class DeviceNotifyTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val arguments = InstrumentationRegistry.getArguments()
    private val manager = context.getSystemService(NotificationManager::class.java)

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

    private fun until(what: String, timeoutMs: Long = 30_000, condition: () -> Boolean) {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        while (!condition()) {
            check(System.nanoTime() < deadline) { "timed out waiting for $what" }
            Thread.sleep(50)
        }
    }

    /** Polls for up to [timeoutMs]; whether [condition] held. */
    private fun within(timeoutMs: Long, condition: () -> Boolean): Boolean {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        while (System.nanoTime() < deadline) {
            if (condition()) return true
            Thread.sleep(100)
        }
        return condition()
    }

    private fun shell(command: String): String =
        instrumentation.uiAutomation.executeShellCommand(command).let { fd ->
            android.os.ParcelFileDescriptor.AutoCloseInputStream(fd).use { it.readBytes().toString(Charsets.UTF_8) }
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

    private fun mention(server: String, channel: String, author: String, me: String, text: String) {
        control(server, "advance_clock", """{"ms":1}""")
        control(server, "post_as", """{"channelId":"$channel","authorId":"$author","text":"$text","broadcast":true,"mentionUserId":"$me"}""")
    }

    /** How many of this app's activities are in [stage] now (ActivityScenario's own state loses track of a tapped one). */
    private fun activitiesIn(stage: Stage): Int {
        var count = 0
        instrumentation.runOnMainSync { count = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage).size }
        return count
    }

    private fun posted(tag: String) = manager.activeNotifications.firstOrNull { it.tag == tag }

    @Test
    fun aMentionInTheBackgroundIsNotifiedAndItsTapOpensTheChannel() {
        val server = argument("server")
        val channel = argument("channel")
        val author = argument("author")
        val other = argument("bulkChannel")
        runBlocking { SemaphoreHost.shutdownForTest() }
        listOf("core", "secrets", "last-community").forEach { File(context.noBackupFilesDir, it).deleteRecursively() }
        manager.cancelAll()
        if (Build.VERSION.SDK_INT >= 33) {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        }
        assertTrue("notifications are allowed", manager.areNotificationsEnabled())

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
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

            // Signed in with notifications allowed: the service runs, with its ongoing notification.
            until("the connection service") { ConnectionService.running && SemaphoreHost.keepsConnected }
            until("its notification") { manager.activeNotifications.any { it.id == ConnectionService.NOTIFICATION_ID } }
            val session = checkNotNull(SemaphoreHost.current())
            val core = session.host.core()
            val me = (core.session() as SessionState.SignedIn).me.id
            val community = core.communities().first { c -> core.channels(c.id).any { it.id == channel } }.id

            // Home: the activity stops, and core stays connected.
            shell("input keyevent KEYCODE_HOME")
            until("the activity stopped") { activitiesIn(Stage.STOPPED) == 1 && activitiesIn(Stage.RESUMED) == 0 }
            assertEquals(ConnectionState.CONNECTED, core.connection())

            mention(server, channel, author, me, "a mention from the background")
            until("the mention in the shade") { posted("channel:$channel") != null }
            val shown = posted("channel:$channel")!!.notification
            assertEquals(NotifyChannels.MENTIONS, shown.channelId)
            assertEquals(android.app.Notification.VISIBILITY_PRIVATE, shown.visibility)
            assertEquals("Semaphore", shown.publicVersion.extras.getString(android.app.Notification.EXTRA_TITLE))

            // The tap: its PendingIntent, sent as the shade would (allowed to start an activity).
            instrumentation.uiAutomation.adoptShellPermissionIdentity()
            try {
                val options = ActivityOptions.makeBasic()
                if (Build.VERSION.SDK_INT >= 34) {
                    options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                }
                shown.contentIntent.send(context, 0, null, null, null, null, options.toBundle())
            } finally {
                instrumentation.uiAutomation.dropShellPermissionIdentity()
            }
            until("the activity back") { activitiesIn(Stage.RESUMED) == 1 }
            until("the channel open") { session.model.navigator.top == Route.Channel(community, channel) }
            waitFor(hasText("a mention from the background", substring = true))

            // Doze: home again, the device unplugged and forced idle, and another mention.
            shell("input keyevent KEYCODE_HOME")
            until("the activity stopped again") { activitiesIn(Stage.STOPPED) >= 1 && activitiesIn(Stage.RESUMED) == 0 }
            shell("dumpsys battery unplug")
            // The emulator's image ships with Doze off ("not enabled"): on, as a phone has it.
            shell("dumpsys deviceidle enable deep")
            val idle = shell("dumpsys deviceidle force-idle").trim()
            Log.i(DOZE_TAG, "force-idle: $idle; state ${shell("dumpsys deviceidle get deep").trim()}")
            try {
                mention(server, other, author, me, "a mention in doze")
                val arrived = within(30_000) { posted("channel:$other") != null }
                Log.i(DOZE_TAG, "a mention under forced Doze ${if (arrived) "arrived" else "did not arrive within 30 s"}; connection ${core.connection()}")
            } finally {
                shell("dumpsys deviceidle unforce")
                shell("dumpsys deviceidle disable deep")
                shell("dumpsys battery reset")
            }
        } finally {
            ConnectionService.stop(context)
            until("the service stopped") { !ConnectionService.running }
            // A tapped activity is one ActivityScenario no longer tracks: closing it may refuse.
            runCatching { scenario.close() }
            instrumentation.runOnMainSync {
                val registry = ActivityLifecycleMonitorRegistry.getInstance()
                listOf(Stage.RESUMED, Stage.PAUSED, Stage.STARTED, Stage.STOPPED, Stage.CREATED)
                    .flatMap { registry.getActivitiesInStage(it) }
                    .forEach { it.finish() }
            }
            until("every activity gone", 30_000) {
                listOf(Stage.RESUMED, Stage.PAUSED, Stage.STARTED, Stage.STOPPED, Stage.CREATED).sumOf(::activitiesIn) == 0
            }
            manager.cancelAll()
            runBlocking { SemaphoreHost.shutdownForTest() }
        }
    }

    companion object {
        const val DOZE_TAG = "SemaphoreDoze"
    }
}
