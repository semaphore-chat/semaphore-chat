// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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

/** The focus ring, shown for keyboard focus (a tap does not move focus to a button). */
@Composable
internal fun Modifier.focusRing(interaction: MutableInteractionSource, shape: Shape): Modifier {
    val focused by interaction.collectIsFocusedAsState()
    return if (focused) border(Tokens.Border.Focus, Kit.palette.focus, shape) else this
}

/** WCAG contrast ratio of two opaque colours. */
internal fun contrast(a: Color, b: Color): Float {
    val la = a.luminance()
    val lb = b.luminance()
    return (max(la, lb) + 0.05f) / (min(la, lb) + 0.05f)
}
