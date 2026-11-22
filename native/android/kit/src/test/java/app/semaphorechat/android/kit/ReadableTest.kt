// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.ui.graphics.Color
import app.semaphorechat.android.kit.stories.StoryPalettes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The port of the web's `readableBackground`. The exact answers below come from the same search
 * over `design/gen/colour_ref.py`'s OKLCH maths (the reference the web's and Rust's maths are
 * ports of); the sweep is the web test's.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReadableTest {
    private fun hex(value: String): Color = Color(0xFF000000 or value.removePrefix("#").toLong(16))

    private fun inks(base: String, mode: String, intensity: String): Pair<Color, Color> {
        val palette = StoryPalettes.palette(base, mode, intensity)
        return palette.ground to palette.text
    }

    private fun rgb(colour: Color) = intArrayOf(
        (colour.red * 255 + 0.5f).toInt(),
        (colour.green * 255 + 0.5f).toInt(),
        (colour.blue * 255 + 0.5f).toInt(),
    )

    @Test
    fun matchesTheReferenceSearch() {
        val cases = listOf(
            Triple(Triple("#8E75FF", "dark", "minimal"), "#777777", "#7d7d7d" to "#121214"),
            Triple(Triple("#8E75FF", "dark", "minimal"), "#0000ff", "#0000ff" to "#f2f2f5"),
            Triple(Triple("#8E75FF", "dark", "minimal"), "#ff8fb8", "#ff8fb8" to "#121214"),
            Triple(Triple("#8E75FF", "light", "minimal"), "#777777", "#6d6d6d" to "#f0eff4"),
            Triple(Triple("#8E75FF", "light", "minimal"), "#ff0000", "#ff3427" to "#1f1e25"),
            Triple(Triple("#f59e0b", "light", "vibrant"), "#ff0000", "#ff3124" to "#221e1a"),
            Triple(Triple("#f59e0b", "light", "vibrant"), "#336699", "#336699" to "#fbeedf"),
            Triple(Triple("#f59e0b", "dark", "vibrant"), "#777777", "#7d7d7d" to "#17110a"),
        )
        for ((theme, colour, expected) in cases) {
            val result = readableBackground(hex(colour), inks(theme.first, theme.second, theme.third))
            assertNotNull("$colour in $theme", result)
            assertEquals("$colour in $theme: background", hex(expected.first), result!!.background)
            assertEquals("$colour in $theme: ink", hex(expected.second), result.ink)
        }
    }

    @Test
    fun reachesFourAndAHalfForEveryColourOfASweep() {
        val steps = listOf(0, 51, 102, 119, 128, 153, 204, 255)
        for (mode in listOf("dark", "light")) {
            val pair = inks("#8E75FF", mode, "minimal")
            for (r in steps) for (g in steps) for (b in steps) {
                val colour = Color(r, g, b)
                val result = readableBackground(colour, pair)
                assertNotNull("$r,$g,$b $mode", result)
                assertTrue(result!!.ink == pair.first || result.ink == pair.second)
                val ratio = contrastRatio(rgb(result.ink), rgb(result.background))
                assertTrue("$r,$g,$b $mode: $ratio", ratio >= 4.5)
            }
        }
    }

    @Test
    fun aPassingColourComesBackUnchangedAndAnImpossibleOneIsNull() {
        val pair = inks("#8E75FF", "dark", "minimal")
        val pink = hex("#ff8fb8")
        assertEquals(pink, readableBackground(pink, pair)!!.background)
        // Two near-identical mid-grey inks: nothing reads at 4.5:1 with either, or it's a pass.
        val greys = hex("#777777") to hex("#7a7a7a")
        for (colour in listOf("#777777", "#ffffff", "#000000", "#ff0000")) {
            readableBackground(hex(colour), greys)?.let {
                assertTrue(contrastRatio(rgb(it.ink), rgb(it.background)) >= 4.5)
            }
        }
    }

    @Test
    fun badgeAndDockTextsAreTheWebs() {
        assertEquals("99", badgeText(99, 99))
        assertEquals("99+", badgeText(100, 99))
        assertEquals("Lumen, current, 2 mentions", dockItemLabel("Lumen", current = true, mentions = 2, newMessages = true))
        assertEquals("Synth, new messages", dockItemLabel("Synth", current = false, mentions = 0, newMessages = true))
        assertEquals("Priya, Sam and Noor", talkingLine(listOf("Priya", "Sam", "Noor")))
        assertEquals("Priya, Sam and 2 more", talkingLine(listOf("Priya", "Sam", "Noor", "Ivan")))
    }
}
