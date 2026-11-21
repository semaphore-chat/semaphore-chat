// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import app.semaphorechat.android.design.Tokens
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Blend [over] into [under] by [alpha], per 8-bit channel, rounded to nearest: the web kit's
 * `mix`. States are painted as one opaque colour, never stacked translucent layers.
 */
fun mix(over: Color, under: Color, alpha: Float): Color {
    val weight = alpha.coerceIn(0f, 1f)
    fun channel(top: Float, bottom: Float): Float {
        val t = top * 255f
        val b = bottom * 255f
        return floor(b + (t - b) * weight + 0.5f) / 255f
    }
    return Color(channel(over.red, under.red), channel(over.green, under.green), channel(over.blue, under.blue))
}

/** The fill a fill-coloured piece uses to stay visible on [on] (the web's `standOutFill`). */
fun KitPalette.standOutFill(on: KitSurface): Color = when (on) {
    KitSurface.Fill -> surface
    KitSurface.Accent -> mix(onAccent, accent, Tokens.State.PressedOnFill)
    else -> fill
}

/** What a piece with no background of its own sits on (the web's `tintBase`). */
fun KitPalette.tintBase(on: KitSurface): Color = when (on) {
    KitSurface.Ground -> ground
    KitSurface.Fill -> fill
    KitSurface.Accent -> accent
    KitSurface.Surface -> surface
}

/**
 * A pressed piece's colour: the text colour mixed over [under]. There is no hover on touch
 * (design/guide/principles.md: a touch screen never has a stuck hover).
 */
@Composable
internal fun pressedColour(interaction: MutableInteractionSource, under: Color, pressed: Float): Color {
    val isPressed by interaction.collectIsPressedAsState()
    return if (isPressed) mix(Kit.palette.text, under, pressed) else under
}

/**
 * The focus ring, shown for keyboard focus (a tap does not move focus to a button). Like the web's
 * `focusRing` it is an outline [offset] away from the edge: the default is the focus offset, outside
 * the fill (so it shows on an accent fill, where the focus colour is the fill's own). A negative
 * offset draws it inside, where an outer ring would be clipped (a list row). Put it before `clip`
 * and `background`: it draws over the content, unclipped.
 */
@Composable
internal fun Modifier.focusRing(
    interaction: MutableInteractionSource,
    shape: Shape,
    colour: Color = Kit.palette.focus,
    offset: Dp = Tokens.Border.FocusOffset,
): Modifier {
    val focused by interaction.collectIsFocusedAsState()
    if (!focused) return this
    return drawWithContent {
        drawContent()
        val width = Tokens.Border.Focus.toPx()
        // The stroke is centred on its path: half its width past the offset.
        val grow = offset.toPx() + width / 2f
        val ringSize = Size(size.width + 2f * grow, size.height + 2f * grow)
        if (ringSize.width > 0f && ringSize.height > 0f) {
            translate(-grow, -grow) {
                val stroke = Stroke(width)
                when (val outline = shape.createOutline(ringSize, layoutDirection, this)) {
                    is Outline.Rectangle -> drawRect(colour, outline.rect.topLeft, outline.rect.size, style = stroke)
                    is Outline.Rounded -> {
                        val box = outline.roundRect
                        drawRoundRect(colour, Offset(box.left, box.top), Size(box.width, box.height), box.topLeftCornerRadius, style = stroke)
                    }
                    is Outline.Generic -> drawPath(outline.path, colour, style = stroke)
                }
            }
        }
    }
}

/** WCAG contrast ratio of two opaque colours. */
internal fun contrast(a: Color, b: Color): Float {
    val la = a.luminance()
    val lb = b.luminance()
    return (max(la, lb) + 0.05f) / (min(la, lb) + 0.05f)
}
