// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens

import androidx.activity.ComponentActivity
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.kit.SemaphoreTheme
import app.semaphorechat.android.kit.chat.ChatPiece
import app.semaphorechat.android.kit.stories.STORY_THEMES
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The chat list at one call site, as the app draws every channel: what it tells the app (away,
 * seen, load older) must follow the channel shown, also after another channel was shown there
 * first (a #mention, then Back). From the review of #902.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h800dp-xhdpi")
class ChatScreenSwitchTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val now = 1_789_763_400_000L
    private val format = ChatFormat.fixed(now)

    private fun messages(base: Long, count: Int) = (0 until count).map { n ->
        ChatMessage(base + n, "m${base + n}", "u-sam", "Sam", now - (count - n) * 600_000L, listOf(ChatPiece("message $n of $base")))
    }

    private class Log {
        val lines = mutableListOf<String>()
        fun actions(name: String) = ChatActions(
            onLoadOlder = { lines += "$name loadOlder" },
            onLoadNewer = { lines += "$name loadNewer" },
            onAwayChanged = { lines += "$name away=$it" },
            onSeenNewest = { lines += "$name seenNewest" },
        )
        fun mark(step: String) {
            lines += "--- $step"
        }
        /** What was said after [step] and before the next step. */
        fun after(step: String): List<String> =
            lines.dropWhile { it != "--- $step" }.drop(1).takeWhile { !it.startsWith("---") }
    }

    /** [viaOther]: channel B shows first, then A at the same call site (Back from B to A). */
    private fun run(viaOther: Boolean): Log {
        val log = Log()
        val listA = LazyListState()
        val listB = LazyListState()
        val actionsA = log.actions("A")
        val actionsB = log.actions("B")
        var modelA by mutableStateOf(ChatModel(ChatFace.Ready, messages(1_000, 60)))
        val modelB = ChatModel(ChatFace.Ready, messages(5_000, 60))
        var showB by mutableStateOf(viaOther)
        rule.setContent {
            SemaphoreTheme(STORY_THEMES.first().palette) {
                KitRoot {
                    ChatScreen(
                        ChatHeaderModel(if (showB) "b" else "a"),
                        if (showB) modelB else modelA,
                        format,
                        if (showB) actionsB else actionsA,
                        if (showB) listB else listA,
                    )
                }
            }
        }
        rule.waitForIdle()
        showB = false
        rule.waitForIdle()
        log.mark("A shown")
        rule.runOnUiThread { runBlocking { listA.scrollToItem(20) } }
        rule.waitForIdle()
        log.mark("A scrolled up")
        modelA = modelA.copy(messages = modelA.messages + ChatMessage(9_999, "m9999", "u-priya", "Priya", now, listOf(ChatPiece("a new one"))))
        rule.waitForIdle()
        log.mark("a new message landed in A")
        rule.runOnUiThread { runBlocking { listA.scrollToItem(70) } }
        rule.waitForIdle()
        log.mark("A at the top")
        return log
    }

    private fun check(log: Log) {
        assertTrue(log.lines.toString(), "A away=true" in log.after("A shown"))
        assertFalse("not marked read while scrolled up: ${log.lines}", "A seenNewest" in log.after("A scrolled up"))
        assertTrue(log.lines.toString(), "A loadOlder" in log.after("a new message landed in A"))
        assertEquals("B is never told anything once A shows", emptyList<String>(), log.lines.dropWhile { it != "--- A shown" }.filter { it.startsWith("B ") })
    }

    @Test
    fun aChannelShownAloneFollowsItsList() = check(run(viaOther = false))

    @Test
    fun aChannelShownAfterAnotherAtTheSameCallSiteFollowsItsOwnList() = check(run(viaOther = true))
}
