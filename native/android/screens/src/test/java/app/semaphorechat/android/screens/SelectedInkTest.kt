// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.kit.SemaphoreTheme
import app.semaphorechat.android.kit.stories.STORY_THEMES
import com.github.takahirom.roborazzi.captureRoboImage
import java.io.File
import android.graphics.BitmapFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The selected community in the "All communities" sheet sits on the accent fill, so its name and
 * state line must be drawn in the palette's on-accent ink (the kit's selected ListRow), never the
 * text colour: on violet dark and amber light the text colour reads at about 3:1. Checked on the
 * rendered pixels of the row's text area, in every story theme.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h800dp-xhdpi")
class SelectedInkTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private fun close(a: Color, b: Color) =
        maxOf(kotlin.math.abs(a.red - b.red), kotlin.math.abs(a.green - b.green), kotlin.math.abs(a.blue - b.blue)) < 0.02f

    @Test
    fun theSelectedSheetRowDrawsItsTextInTheOnAccentInk() {
        var theme by mutableStateOf(STORY_THEMES.first())
        val communities = listOf(
            CommunitySummary("c-couch", "Couch Co-op", unread = true),
            CommunitySummary("c-lumen", "Lumen Studio", mentions = 1, unread = true),
        )
        rule.setContent {
            SemaphoreTheme(theme.palette) {
                KitRoot {
                    LoungeScreen(
                        communities = Load.Ready(communities),
                        home = CommunityHomeModel(communities[1], Load.Loading),
                        allOpen = true,
                        sheetQuery = "",
                        onSheetQuery = {}, onOpenCommunity = {}, onOpenAll = {}, onCloseAll = {},
                        onOpenChannel = {}, onRetry = {}, onOpenWeb = {},
                    )
                }
            }
        }
        for (each in STORY_THEMES) {
            theme = each
            rule.waitForIdle()
            val palette = each.palette
            // Roborazzi's capture: Compose's own captureToImage waits for a redraw Robolectric never makes.
            val file = File("build/outputs/selected-ink/${each.name}.png").apply { parentFile?.mkdirs() }
            rule.onNode(hasText("Lumen Studio") and hasClickAction() and isSelected()).captureRoboImage(file.path)
            val image = BitmapFactory.decodeFile(file.path)
            // The text area: right of the avatar, left of the badge.
            val colours = buildList {
                for (x in image.width / 4 until image.width * 3 / 4) for (y in 0 until image.height) add(Color(image.getPixel(x, y)))
            }
            val ink = colours.filterNot { close(it, palette.accent) }
            assertTrue("${each.name}: the row has text", ink.size > 50)
            val main = ink.groupingBy { it }.eachCount().maxBy { it.value }.key
            assertTrue("${each.name}: text ink $main is the on-accent role ${palette.onAccent}", close(main, palette.onAccent))
            // Where the text colour is light (dark mode), not one pixel of it: anti-aliased edges of
            // the dark on-accent ink never come near it. (In light mode both are dark, and the edges
            // of one pass near the other; the main-ink check above tells them apart there.)
            if (palette.dark) {
                assertEquals("${each.name}: no pixel in the text colour", 0, ink.count { close(it, palette.text) })
            }
        }
    }
}
