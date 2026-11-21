// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.LocalIndication
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import app.semaphorechat.android.design.Tokens

/**
 * One mode's 16 colour roles, as the core derives them from the appearance's base colour, mode
 * and intensity (`semaphore-design`'s `derive_palette`, through the FFI). The kit reads these
 * roles, never Material's.
 */
@Immutable
data class KitPalette(
    val ground: Color,
    val surface: Color,
    val fill: Color,
    val hairline: Color,
    val text: Color,
    val textSecondary: Color,
    val textDim: Color,
    val accent: Color,
    val onAccent: Color,
    val accentText: Color,
    val focus: Color,
    val positive: Color,
    val warning: Color,
    val danger: Color,
    val onDanger: Color,
    val scrim: Color,
    /** The palette is a dark one: the system bars and the shadows follow it. */
    val dark: Boolean,
) {
    companion object {
        /**
         * The palette from the 16 roles packed `0xRRGGBBAA` (the FFI's and the vectors' form),
         * in `design/gen/colour_ref.py`'s order: ground, surface, fill, hairline, text,
         * textSecondary, textDim, accent, onAccent, accentText, focus, positive, warning,
         * danger, onDanger, scrim.
         */
        fun fromPacked(roles: List<Long>, dark: Boolean): KitPalette {
            require(roles.size == 16) { "a palette has 16 roles, got ${roles.size}" }
            val c = roles.map(::rgbaColour)
            return KitPalette(
                ground = c[0], surface = c[1], fill = c[2], hairline = c[3],
                text = c[4], textSecondary = c[5], textDim = c[6],
                accent = c[7], onAccent = c[8], accentText = c[9], focus = c[10],
                positive = c[11], warning = c[12], danger = c[13], onDanger = c[14],
                scrim = c[15], dark = dark,
            )
        }
    }
}

/** `0xRRGGBBAA` to a Compose colour (which packs ARGB). */
fun rgbaColour(packed: Long): Color {
    val rgba = packed and 0xFFFFFFFFL
    val argb = (rgba ushr 8) or ((rgba and 0xFF) shl 24)
    return Color(argb.toInt())
}

/**
 * The control sizes and hit area for one kind of input. Android uses [Touch], the
 * `density.touch` token values: the same names as the web's `control` and list rows, sized for
 * a finger. Spacing, radii and text are the same in every density.
 */
@Immutable
data class KitDensity(
    val controlSm: Dp,
    val controlMd: Dp,
    val controlLg: Dp,
    val listRowMd: Dp,
    val listRowLg: Dp,
    /** The smallest area a press lands in, whatever a control draws. */
    val hitArea: Dp,
) {
    companion object {
        val Touch = KitDensity(
            controlSm = Tokens.Density.Touch.Control.Sm,
            controlMd = Tokens.Density.Touch.Control.Md,
            controlLg = Tokens.Density.Touch.Control.Lg,
            listRowMd = Tokens.Density.Touch.ListRow.Md,
            listRowLg = Tokens.Density.Touch.ListRow.Lg,
            hitArea = Tokens.Density.Touch.HitArea,
        )
    }
}

/**
 * Which layer a kit piece is drawn on, as the web kit's `Surface`: pieces read it to pick their
 * own colours (a soft button stands out from a card), so a caller never does.
 */
enum class KitSurface { Ground, Surface, Fill, Accent }

val LocalKitPalette = staticCompositionLocalOf<KitPalette> {
    error("no KitPalette: wrap the content in SemaphoreTheme")
}
val LocalKitDensity = staticCompositionLocalOf { KitDensity.Touch }
val LocalKitSurface = staticCompositionLocalOf { KitSurface.Ground }

/** The kit's theme values inside [SemaphoreTheme]. */
object Kit {
    val palette: KitPalette
        @Composable @ReadOnlyComposable get() = LocalKitPalette.current
    val density: KitDensity
        @Composable @ReadOnlyComposable get() = LocalKitDensity.current
    val surface: KitSurface
        @Composable @ReadOnlyComposable get() = LocalKitSurface.current
}

/**
 * The Semaphore theme: provides the derived [palette], the [density] and the fonts to the kit,
 * and maps the roles onto a Material3 colour scheme for the stock pieces only (text selection,
 * later sheets and dialogs). The kit's own components read [Kit], not [MaterialTheme].
 */
@Composable
fun SemaphoreTheme(
    palette: KitPalette,
    density: KitDensity = KitDensity.Touch,
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = palette.materialScheme(), typography = kitTypography()) {
        CompositionLocalProvider(
            LocalKitPalette provides palette,
            LocalKitDensity provides density,
            LocalKitSurface provides KitSurface.Ground,
            // Every control's press area, whatever it draws (Modifier.minimumInteractiveComponentSize).
            LocalMinimumInteractiveComponentSize provides density.hitArea,
            LocalContentColor provides palette.text,
            LocalTextStyle provides kitTextStyle(TextVariant.Body),
            LocalIndication provides ripple(color = palette.text),
            content = content,
        )
    }
}

/** The roles as far as stock Material components need them. */
internal fun KitPalette.materialScheme(): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = fill,
        onPrimaryContainer = text,
        secondary = accent,
        onSecondary = onAccent,
        background = ground,
        onBackground = text,
        surface = surface,
        onSurface = text,
        surfaceVariant = fill,
        onSurfaceVariant = textSecondary,
        surfaceContainerLowest = ground,
        surfaceContainerLow = surface,
        surfaceContainer = surface,
        surfaceContainerHigh = fill,
        surfaceContainerHighest = fill,
        outline = hairline,
        outlineVariant = hairline,
        error = danger,
        onError = onDanger,
        scrim = scrim,
    )
}
