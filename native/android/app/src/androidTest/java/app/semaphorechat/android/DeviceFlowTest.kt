// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.semaphorechat.android.screens.ConnectText
import app.semaphorechat.android.screens.INSECURE_WARNING
import app.semaphorechat.android.screens.LoungeText
import app.semaphorechat.android.screens.SignInText
import android.view.View
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The whole first-run flow on the emulator, through the real activity, the real screens and the
 * networked core (Keystore-sealed secrets included), against the fake server that
 * native/scripts/android-device-test.sh runs: connect (a plain-http server, so the warning and
 * Continue), sign in, the first community, another from the dock, a channel and Back, the sheet
 * and Back; then the core shut down as the process ending would, and a new start that restores
 * the session into the community opened last, where the channel opened before is read.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class DeviceFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    /** A list row the kit marks unread (its spoken state, as the web's name carries ", unread"). */
    private val unread = SemanticsMatcher("is unread") {
        it.config.getOrNull(SemanticsProperties.StateDescription)?.split(", ")?.contains("unread") == true
    }

    /** The permission prompt would cover the screens this drives: it counts as asked already. */
    @Before
    fun noNotificationPrompt() {
        context.getSharedPreferences(NotificationPermission.PREFS, android.content.Context.MODE_PRIVATE)
            .edit().putBoolean(NotificationPermission.ASKED, true).commit()
    }

    private fun waitFor(matcher: SemanticsMatcher, timeoutMs: Long = 30_000) {
        compose.waitUntilAtLeastOneExists(matcher, timeoutMs)
    }

    private fun back(scenario: ActivityScenario<MainActivity>) {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    /**
     * Closes the activity and returns only once its window has been detached, which is when its
     * composition is disposed and leaves the compose rule's roots. `ActivityScenario.close()`
     * returns at the lifecycle's DESTROYED, which is before the window manager removes the view
     * (ActivityThread removes it after `onDestroy`), so on a slow emulator the next Espresso idle
     * check could still reach the old, detached LayoutNode ("LayoutNode should be attached to an
     * owner"). The decor view's detach listener fires after its children (the compose view) detach.
     */
    private fun closeAndAwaitDetach(scenario: ActivityScenario<MainActivity>) {
        val detached = CountDownLatch(1)
        scenario.onActivity { activity ->
            val decor = activity.window.decorView
            decor.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v: View) = Unit
                override fun onViewDetachedFromWindow(v: View) = detached.countDown()
            })
        }
        scenario.close()
        check(detached.await(30, TimeUnit.SECONDS)) { "the closed activity's window was never detached" }
    }

    @Test
    fun connectSignInBrowseAndRestoreOnTheNextStart() {
        val server = InstrumentationRegistry.getArguments().getString("server")
        assumeTrue("native/scripts/android-device-test.sh passes -e server", server != null)

        // A first run: no core, nothing remembered.
        runBlocking { SemaphoreHost.shutdownForTest() }
        listOf("core", "secrets", "last-community").forEach { File(context.noBackupFilesDir, it).deleteRecursively() }

        var scenario = ActivityScenario.launch(MainActivity::class.java)
        waitFor(hasText(ConnectText.TITLE))
        compose.onNode(hasSetTextAction()).performTextInput(server!!)
        compose.onNode(hasText(ConnectText.CONNECT) and hasClickAction()).performClick()
        waitFor(hasText(INSECURE_WARNING))
        compose.onNode(hasText(ConnectText.CONTINUE) and hasClickAction()).performClick()

        waitFor(hasText(SignInText.USERNAME))
        val fields = compose.onAllNodes(hasSetTextAction())
        fields[0].performTextInput("me")
        fields[1].performTextInput("pw")
        compose.onNode(hasText(SignInText.SIGN_IN) and hasClickAction()).performClick()

        // The Lounge, on the first community; then Lumen Studio from the dock, with its mention.
        waitFor(hasText("Couch Co-op"))
        waitFor(hasText(LoungeText.CHANNELS))
        compose.onNode(hasContentDescription("Lumen Studio", substring = true) and hasClickAction()).performClick()
        waitFor(hasText("design") and hasContentDescription("1 mention", substring = true))

        compose.onNode(hasText("design") and hasClickAction()).performClick()
        waitFor(hasContentDescription(LoungeText.BACK))
        // Its messages on screen, the newest at the bottom: that is what marks it read.
        waitFor(hasText("Palette exploration", substring = true))
        back(scenario)
        waitFor(hasText("design") and hasClickAction())

        compose.onNode(hasContentDescription(LoungeText.ALL) and hasClickAction()).performClick()
        waitFor(hasText(LoungeText.FIND))
        back(scenario)
        compose.waitUntilDoesNotExist(hasText(LoungeText.FIND), 10_000)
        waitFor(hasText("Lumen Studio"))

        // The process ends; the next start restores the session into Lumen Studio.
        closeAndAwaitDetach(scenario)
        runBlocking { SemaphoreHost.shutdownForTest() }
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitFor(hasText("design") and hasClickAction())
        waitFor(hasText("Lumen Studio"))
        // The counts have loaded: #general, never opened here, is still unread.
        waitFor(hasText("general") and unread)
        // Opening #design showed its newest message, which marked it read: its mention is gone.
        assertTrue(
            "#design still shows its mention after it was read",
            compose.onAllNodes(hasText("design") and hasContentDescription("1 mention", substring = true)).fetchSemanticsNodes().isEmpty(),
        )
        assertTrue(compose.onAllNodes(hasText("design") and unread).fetchSemanticsNodes().isEmpty())
        closeAndAwaitDetach(scenario)
        runBlocking { SemaphoreHost.shutdownForTest() }
    }
}
