// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens

import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.kit.SemaphoreTheme
import app.semaphorechat.android.kit.stories.STORY_THEMES
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The system Back on the Lounge: an open sheet takes it first (overlay-stack rule 20); with none
 * open it reaches the screen's own handler (rule 21), which pops the navigator.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun backClosesTheSheetFirstThenGoesBackAScreen() {
        val navigator = Navigator(Route.Community("c1"))
        navigator.push(Route.Channel("c1", "general"))
        navigator.pop()
        navigator.push(Route.Channel("c1", "general"))
        var allOpen by mutableStateOf(false)
        var opened = ""
        val communities = listOf(CommunitySummary("c1", "Lumen Studio"), CommunitySummary("c2", "Synth Club", mentions = 2))
        rule.setContent {
            SemaphoreTheme(STORY_THEMES.first().palette) {
                KitRoot {
                    BackHandler(enabled = navigator.canPop) { navigator.pop() }
                    LoungeScreen(
                        communities = Load.Ready(communities),
                        home = CommunityHomeModel(communities[0], Load.Ready(CommunityChannels(emptyList(), emptyList()))),
                        allOpen = allOpen,
                        sheetQuery = "",
                        onSheetQuery = {},
                        onOpenCommunity = { opened = it },
                        onOpenAll = { allOpen = true },
                        onCloseAll = { allOpen = false },
                        onOpenChannel = {},
                        onRetry = {},
                        onOpenWeb = {},
                    )
                }
            }
        }
        rule.onNodeWithContentDescription(LoungeText.ALL).performClick()
        rule.waitForIdle()
        assertTrue(allOpen)
        rule.onNodeWithText("2 mentions").assertExists()

        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        assertFalse("Back closed the sheet", allOpen)
        assertEquals("and nothing else", 2, navigator.stack.value.size)

        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        assertEquals(listOf<Route>(Route.Community("c1")), navigator.stack.value)

        // A tap on a community in the sheet opens it and closes the sheet.
        rule.onNodeWithContentDescription(LoungeText.ALL).performClick()
        rule.onNodeWithText("Synth Club").performClick()
        rule.waitForIdle()
        assertEquals("c2", opened)
        assertFalse(allOpen)
    }
}
