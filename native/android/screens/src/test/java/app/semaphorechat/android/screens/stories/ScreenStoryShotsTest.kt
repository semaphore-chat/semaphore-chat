// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens.stories

import androidx.compose.runtime.CompositionLocalProvider
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.kit.LocalKitStill
import app.semaphorechat.android.kit.SemaphoreTheme
import app.semaphorechat.android.kit.stories.STORY_SIZES
import app.semaphorechat.android.kit.stories.STORY_THEMES
import com.github.takahirom.roborazzi.captureRoboImage
import java.io.File
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every screen story, at every phone size, in every story theme, as the kit's
 * `KitStoryShotsTest`: `<shotsDir>/<size>/<story>-<theme>.png`. native/scripts/android-ui-review.sh
 * renders these beside the kit's.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class ScreenStoryShotsTest(
    private val storyId: String,
    private val sizeName: String,
    private val themeName: String,
    @Suppress("unused") private val name: String,
) {
    @Test
    fun render() {
        val story = SCREEN_STORIES.single { it.id == storyId }
        val size = STORY_SIZES.single { it.name == sizeName }
        val theme = STORY_THEMES.single { it.name == themeName }
        RuntimeEnvironment.setQualifiers(size.qualifiers)
        val dir = System.getProperty("semaphore.shotsDir")?.let(::File)
            ?: File("build/outputs/stories")
        val file = File(dir, "${size.name}/${story.id}-${theme.name}.png")
        file.parentFile?.mkdirs()
        captureRoboImage(file.absolutePath) {
            SemaphoreTheme(palette = theme.palette) {
                CompositionLocalProvider(LocalKitStill provides true) {
                    KitRoot { story.content() }
                }
            }
        }
        check(file.isFile && file.length() > 0) { "no render at $file" }
    }

    companion object {
        private fun selected(id: String): Boolean {
            val filter = System.getProperty("semaphore.stories")?.takeIf { it.isNotBlank() } ?: return true
            return filter.split(',').map { it.trim() }.filter { it.isNotEmpty() }.any { glob ->
                Regex(glob.split('*').joinToString(".*") { Regex.escape(it) }).matches(id)
            }
        }

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{3}")
        fun cases(): List<Array<Any>> = SCREEN_STORIES.filter { selected(it.id) }.flatMap { story ->
            STORY_SIZES.flatMap { size ->
                STORY_THEMES.map { theme ->
                    arrayOf<Any>(story.id, size.name, theme.name, "${size.name}/${story.id}-${theme.name}")
                }
            }
        }
    }
}
