// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.input.TextFieldValue
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.kit.SemaphoreTheme
import app.semaphorechat.android.kit.chat.ComposerText
import app.semaphorechat.android.kit.stories.STORY_THEMES
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Send waits for the list: while the first page loads there is no row to carry the text (core's
 * `send_message_with_row` would refuse it), so Send is disabled and a tap does nothing, leaving the
 * text in the field. Once the list is there the same tap sends. DeviceChatTest taps Send only once
 * it is enabled for this reason.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h800dp-xhdpi")
class ChatScreenSendTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun sendIsDisabledWhileTheListLoadsAndSendsOnceItIsThere() {
        var sends = 0
        var face by mutableStateOf<ChatFace>(ChatFace.Loading)
        rule.setContent {
            SemaphoreTheme(STORY_THEMES.first().palette) {
                KitRoot {
                    ChatScreen(
                        ChatHeaderModel("general"),
                        ChatModel(face),
                        ChatFormat.fixed(1_789_763_400_000L),
                        ChatActions(onSend = { sends++ }),
                        draft = TextFieldValue("hello"),
                    )
                }
            }
        }
        val send = rule.onNodeWithContentDescription(ComposerText.SEND)
        send.assertIsNotEnabled()
        send.performClick()
        assertEquals("a tap while the list loads sends nothing", 0, sends)

        face = ChatFace.Ready
        rule.waitForIdle()
        send.assertIsEnabled()
        send.performClick()
        assertEquals(1, sends)
    }
}
