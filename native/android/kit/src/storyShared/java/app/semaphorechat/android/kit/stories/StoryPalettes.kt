// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.stories

import androidx.compose.runtime.Composable
import app.semaphorechat.android.kit.KitPalette
import java.io.File
import org.json.JSONArray

/**
 * The palettes the stories render with, read from the shared vectors
 * (`design/vectors/colour.json`, the same numbers the core's `derive_palette` produces), so a
 * story needs no Rust library on the JVM.
 */
object StoryPalettes {
    private val ROLES = listOf(
        "ground", "surface", "fill", "hairline", "text", "textSecondary", "textDim", "accent",
        "onAccent", "accentText", "focus", "positive", "warning", "danger", "onDanger", "scrim",
    )

    private val cases: JSONArray by lazy {
        val path = System.getProperty("semaphore.colourVectors")
            ?: error("semaphore.colourVectors is not set (kit/build.gradle.kts sets it)")
        JSONArray(File(path).readText())
    }

    /** `#rrggbb` or `#rrggbbaa` packed `0xRRGGBBAA`. */
    fun packed(hex: String): Long {
        val digits = hex.removePrefix("#")
        val value = digits.toLong(16)
        return if (digits.length == 6) (value shl 8) or 0xFF else value
    }

    /** The 16 role colours of a vector, as written there (`#rrggbb[aa]`), in role order. */
    fun vectorRoles(base: String, mode: String, intensity: String): List<String> {
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            if (case.getString("base").equals(base, ignoreCase = true) &&
                case.getString("mode") == mode &&
                case.getString("intensity") == intensity
            ) {
                val roles = case.getJSONObject("roles")
                return ROLES.map { roles.getString(it) }
            }
        }
        error("no vector for $base $mode $intensity")
    }

    /** The vectors' palette for [base] (as written there) in [mode] at [intensity]. */
    fun palette(base: String, mode: String, intensity: String): KitPalette {
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            if (case.getString("base").equals(base, ignoreCase = true) &&
                case.getString("mode") == mode &&
                case.getString("intensity") == intensity
            ) {
                val roles = case.getJSONObject("roles")
                return KitPalette.fromPacked(ROLES.map { packed(roles.getString(it)) }, dark = mode == "dark")
            }
        }
        error("no vector for $base $mode $intensity")
    }

    /** Every case, for the tests that walk them all. */
    fun all(): List<Triple<String, String, String>> = (0 until cases.length()).map {
        val case = cases.getJSONObject(it)
        Triple(case.getString("base"), case.getString("mode"), case.getString("intensity"))
    }
}

/** One theme a story renders in: a name for the file, and the palette. */
data class StoryTheme(val name: String, val base: String, val mode: String, val intensity: String) {
    val palette: KitPalette get() = StoryPalettes.palette(base, mode, intensity)
}

/**
 * Light and dark, at two base colours: the default violet at the default intensity, and amber
 * at vibrant, whose light accent puts dark ink on the accent fill.
 */
val STORY_THEMES = listOf(
    StoryTheme("dark-violet", "#8E75FF", "dark", "minimal"),
    StoryTheme("light-violet", "#8E75FF", "light", "minimal"),
    StoryTheme("dark-amber", "#f59e0b", "dark", "vibrant"),
    StoryTheme("light-amber", "#f59e0b", "light", "vibrant"),
)

/** Phone sizes: a small phone and a large one, at xhdpi. */
data class StorySize(val name: String, val widthDp: Int, val heightDp: Int) {
    val qualifiers: String get() = "w${widthDp}dp-h${heightDp}dp-xhdpi"
}

val STORY_SIZES = listOf(StorySize("phone", 360, 800), StorySize("phone-large", 412, 915))

/**
 * A story: an id (`kit-<component>`, `screen-<screen>-<state>`) and what it draws on the ground.
 * This file is shared by the kit's and the screens' story tests (src/storyShared).
 */
data class Story(val id: String, val content: @Composable () -> Unit)
