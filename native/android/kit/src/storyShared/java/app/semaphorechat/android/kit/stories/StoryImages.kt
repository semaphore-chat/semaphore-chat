// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.stories

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import app.semaphorechat.android.kit.Kit
import app.semaphorechat.android.kit.chat.AttachmentImages
import app.semaphorechat.android.kit.chat.ImageLoad
import app.semaphorechat.android.kit.chat.LocalAttachmentImages
import kotlinx.coroutines.flow.MutableStateFlow

/** A picture for the stories: bands of the palette's colours, [width]×[height] pixels. */
fun storyImage(width: Int, height: Int, a: Color, b: Color): ImageBitmap {
    val image = ImageBitmap(width, height)
    val canvas = Canvas(image)
    val bands = 6
    repeat(bands) { i ->
        val paint = Paint().apply { color = if (i % 2 == 0) a else b }
        canvas.drawRect(Rect(0f, height * i / bands.toFloat(), width.toFloat(), height * (i + 1) / bands.toFloat()), paint)
    }
    return image
}

/** Pictures by file id: `img-*` load, `slow-*` stay loading, anything else fails (the file row). */
@Composable
fun WithImages(content: @Composable () -> Unit) {
    val palette = Kit.palette
    val images = remember(palette) {
        val wide = storyImage(640, 360, palette.accent, palette.surface)
        val tall = storyImage(270, 480, palette.positive, palette.surface)
        AttachmentImages { id, _ ->
            MutableStateFlow(
                when {
                    id.startsWith("img-tall") -> ImageLoad.Ready(tall)
                    id.startsWith("img") -> ImageLoad.Ready(wide)
                    id.startsWith("slow") -> ImageLoad.Loading
                    else -> ImageLoad.Failed
                },
            )
        }
    }
    CompositionLocalProvider(LocalAttachmentImages provides images, content = content)
}
