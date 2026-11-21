// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertTouchHeightIsEqualTo
import androidx.compose.ui.test.assertTouchWidthIsEqualTo
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.stories.StoryPalettes
import java.io.File
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class KitTest {
    @get:Rule
    val compose = createComposeRule()

    private val palette = StoryPalettes.palette("#8E75FF", "dark", "minimal")

    @Test
    fun rgbaColourUnpacksRrggbbaa() {
        assertEquals(0xFF8E75FF.toInt(), rgbaColour(0x8E75FFFFL).toArgb())
        assertEquals(0x99090811.toInt(), rgbaColour(0x09081199L).toArgb())
    }

    @Test
    fun paletteFromPackedKeepsTheRoleOrder() {
        // The approved default palette (design/gen/test_colour_ref.py's DEFAULT).
        assertEquals(Color(0xFF121214), palette.ground)
        assertEquals(Color(0xFF1B1B1F), palette.surface)
        assertEquals(Color(0xFF8E75FF), palette.accent)
        assertEquals(true, palette.dark)
    }

    @Test
    fun everyColourVectorBuildsAPalette() {
        val all = StoryPalettes.all()
        assertEquals(96, all.size)
        all.forEach { (base, mode, intensity) -> StoryPalettes.palette(base, mode, intensity) }
    }

    @Test
    fun personColourMatchesTheSharedVectors() {
        val cases = JSONArray(File(System.getProperty("semaphore.personVectors")!!).readText())
        check(cases.length() > 5)
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val id = case.getString("id")
            val got = personColour(id)
            if (case.isNull("colour")) {
                assertNull(id, got)
            } else {
                val want = Color(0xFF000000 or case.getString("colour").removePrefix("#").toLong(16))
                assertEquals(id, want, got)
            }
        }
    }

    @Test
    fun initialsTakeTwoWordsOrTwoLetters() {
        assertEquals("PR", initialsOf("Priya Raman"))
        assertEquals("SE", initialsOf("semaphore"))
        assertEquals("AB", initialsOf("  ann   bo  carl "))
        assertEquals("", initialsOf("   "))
        assertEquals("ÉL", initialsOf("élise lund"))
    }

    @Test
    fun mixRoundsPerChannelAsTheWebDoes() {
        // mix('#ffffff', '#000000', 0.5) is #808080 on the web (127.5 rounds up).
        assertEquals(Color(0xFF808080), mix(Color.White, Color.Black, 0.5f))
        assertEquals(Color.Black, mix(Color.White, Color.Black, 0f))
    }

    @Test
    fun touchDensityIsTheTokenValues() {
        assertEquals(40.dp, KitDensity.Touch.controlSm)
        assertEquals(48.dp, KitDensity.Touch.controlMd)
        assertEquals(56.dp, KitDensity.Touch.controlLg)
        assertEquals(56.dp, KitDensity.Touch.listRowMd)
        assertEquals(72.dp, KitDensity.Touch.listRowLg)
        assertEquals(Tokens.Density.Touch.HitArea, KitDensity.Touch.hitArea)
    }

    @Test
    fun aSmallButtonStillHasATouchSizedHitArea() {
        var clicks = 0
        compose.setContent {
            SemaphoreTheme(palette) { Button("Go", { clicks++ }, size = ButtonSize.Sm) }
        }
        // It draws 40 high (density.touch.control.sm) and takes presses over the 48 hit area.
        compose.onNodeWithText("Go")
            .assertHeightIsEqualTo(40.dp)
            .assertTouchHeightIsEqualTo(48.dp)
            .performClick()
        assertEquals(1, clicks)
    }

    @Test
    fun anIconButtonIsNamedByItsLabelAndSizedForAFinger() {
        compose.setContent {
            SemaphoreTheme(palette) { IconButton(Icons.Mic, "Mute", {}, size = ButtonSize.Sm, selected = true) }
        }
        compose.onNodeWithContentDescription("Mute")
            .assertTouchWidthIsEqualTo(48.dp)
            .assertTouchHeightIsEqualTo(48.dp)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Selected, true))
    }

    @Test
    fun aBusyButtonIgnoresPresses() {
        var clicks = 0
        compose.setContent {
            SemaphoreTheme(palette) {
                CompositionLocalProviderStill { Button("Save", { clicks++ }, loading = true) }
            }
        }
        compose.onNodeWithText("Save").performClick()
        assertEquals(0, clicks)
    }

    @Test
    fun aDisabledButtonIsNotEnabled() {
        compose.setContent { SemaphoreTheme(palette) { Button("Off", {}, enabled = false) } }
        compose.onNodeWithText("Off").assertIsNotEnabled()
    }

    @Test
    fun aTextFieldReportsItsError() {
        compose.setContent {
            SemaphoreTheme(palette) { TextField("x", {}, label = "Password", error = "Wrong password") }
        }
        compose.onNodeWithContentDescription("Password")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, "Wrong password"))
        compose.onNodeWithText("Wrong password").assertExists()
    }

    @Test
    fun aListRowIsSelectableAndAtLeastTheDensityHeight() {
        compose.setContent {
            SemaphoreTheme(palette) { ListRow("general", selected = true, onClick = {}) }
        }
        compose.onNodeWithText("general", useUnmergedTree = true).assertExists()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Selected, true))
            .assertHeightIsAtLeast(56.dp)
    }
}

@androidx.compose.runtime.Composable
private fun CompositionLocalProviderStill(content: @androidx.compose.runtime.Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(LocalKitStill provides true, content = content)
}
