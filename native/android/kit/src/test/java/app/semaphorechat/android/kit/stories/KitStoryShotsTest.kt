// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.stories

import androidx.compose.runtime.CompositionLocalProvider
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.kit.LocalKitStill
import app.semaphorechat.android.kit.SemaphoreTheme
import com.github.takahirom.roborazzi.captureRoboImage
import java.io.File
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every kit story, at every phone size, in every story theme, rendered to a PNG under
 * Robolectric's native graphics: `<shotsDir>/<size>/<story>-<theme>.png`.
 *
 * native/scripts/android-ui-review.sh passes `semaphore.shotsDir` (and `semaphore.stories`, a
 * comma-separated list of globs, to render some). Without it the shots go to
 * `kit/build/outputs/stories`, so a plain test run still renders every story and fails on one
 * that throws.
 *
 * SDK 34: Robolectric's SDK 35 jars need Java 21, and the build image carries JDK 17. The kit
 * draws the same on both.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class KitStoryShotsTest(
    private val storyId: String,
    private val sizeName: String,
    private val themeName: String,
    @Suppress("unused") private val name: String,
) {
    @Test
    fun render() {
        // Plain strings in, looked up here: the runner builds the parameters outside the
        // sandbox's class loader.
        val story = (KIT_STORIES + CHAT_KIT_STORIES).single { it.id == storyId }
        val size = STORY_SIZES.single { it.name == sizeName }
        val theme = STORY_THEMES.single { it.name == themeName }
        RuntimeEnvironment.setQualifiers(size.qualifiers)
        val dir = System.getProperty("semaphore.shotsDir")?.let(::File)
            ?: File("build/outputs/stories")
        val file = File(dir, "${size.name}/${story.id}-${theme.name}.png")
        file.parentFile?.mkdirs()
        val palette = theme.palette
        captureRoboImage(file.absolutePath) {
            SemaphoreTheme(palette = palette) {
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
        fun cases(): List<Array<Any>> = (KIT_STORIES + CHAT_KIT_STORIES).filter { selected(it.id) }.flatMap { story ->
            STORY_SIZES.flatMap { size ->
                STORY_THEMES.map { theme ->
                    arrayOf<Any>(story.id, size.name, theme.name, "${size.name}/${story.id}-${theme.name}")
                }
            }
        }
    }
}
