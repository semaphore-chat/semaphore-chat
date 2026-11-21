// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import app.semaphorechat.android.design.Tokens

/** The page under everything, in the ground colour: a screen's root. */
@Composable
fun KitRoot(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val palette = Kit.palette
    Box(modifier = modifier.fillMaxSize().background(palette.ground)) {
        CompositionLocalProvider(
            LocalKitSurface provides KitSurface.Ground,
            LocalContentColor provides palette.text,
            content = content,
        )
    }
}

/** The web kit's surface padding choices. */
enum class SurfacePadding(val value: Dp) { None(Tokens.Space.None), Md(Tokens.Space.Md), Lg(Tokens.Space.Lg) }

/**
 * The Lounge's big surface (the web kit's `Island`): a rounded panel on the ground, in the
 * surface colour, with the island shadow and no border. What is inside is drawn on `surface`.
 */
@Composable
fun Island(
    modifier: Modifier = Modifier,
    padding: SurfacePadding = SurfacePadding.Lg,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = Kit.palette
    val shape = RoundedCornerShape(Tokens.Radius.Island)
    val shadow = Tokens.Shadow.Island
    val alpha = if (palette.dark) shadow.alpha else shadow.alphaLight
    Column(
        // As wide as its parent, like the web's block-level island; a caller's width comes first.
        modifier = modifier
            .fillMaxWidth()
            .shadow(
                elevation = shadow.blur / 2,
                shape = shape,
                ambientColor = Color.Black.copy(alpha = alpha),
                spotColor = Color.Black.copy(alpha = alpha),
            )
            .clip(shape)
            .background(palette.surface)
            .padding(padding.value),
    ) {
        CompositionLocalProvider(
            LocalKitSurface provides KitSurface.Surface,
            LocalContentColor provides palette.text,
        ) { content() }
    }
}

/**
 * A grouped block inside an island (the web kit's `Card`): the fill colour that stands out
 * from what it sits on, the card radius, and an accent border when [selected]. With [onClick]
 * the whole card is one button. What is inside is drawn on `fill`.
 */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    padding: SurfacePadding = SurfacePadding.Md,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = Kit.palette
    val on = Kit.surface
    val shape = RoundedCornerShape(Tokens.Radius.Card)
    val fill = palette.standOutFill(on)
    val interaction = remember { MutableInteractionSource() }
    val background = if (onClick != null) pressedColour(interaction, fill, Tokens.State.Pressed) else fill
    val clickable = if (onClick != null) {
        Modifier
            .semantics { this.selected = selected }
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick)
    } else {
        Modifier
    }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(clickable)
            .focusRing(interaction, shape)
            .clip(shape)
            .background(background)
            // Always there (transparent when unselected), so selecting never resizes the card.
            .border(Tokens.Border.Selected, if (selected) palette.accent else Color.Transparent, shape)
            .padding(padding.value),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
    ) {
        CompositionLocalProvider(
            LocalKitSurface provides if (on == KitSurface.Fill) KitSurface.Surface else KitSurface.Fill,
            LocalContentColor provides palette.text,
        ) { content() }
    }
}
