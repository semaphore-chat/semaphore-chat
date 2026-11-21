// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.material3.Icon
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.semaphorechat.android.design.Tokens

/** The web kit's `ButtonVariant`. */
enum class ButtonVariant { Primary, Soft, Ghost, Danger, QuietDanger, Text }

/** The web kit's `ButtonSize`; the heights are the density's (`density.touch.control`). */
enum class ButtonSize { Sm, Md, Lg }

/** A variant's paint: the resting fill, the label, and what and how much a press tints. */
internal data class ButtonLook(val background: Color, val label: Color, val under: Color, val pressed: Float)

/** The web's `buttonLook`, for a piece drawn on [on]. */
internal fun KitPalette.buttonLook(variant: ButtonVariant, on: KitSurface): ButtonLook {
    val soft = if (on == KitSurface.Accent) fill else standOutFill(on)
    val behind = tintBase(on)
    return when (variant) {
        ButtonVariant.Primary -> ButtonLook(accent, onAccent, accent, Tokens.State.PressedOnFill)
        ButtonVariant.Danger -> ButtonLook(danger, onDanger, danger, Tokens.State.PressedOnFill)
        ButtonVariant.Soft -> ButtonLook(soft, text, soft, Tokens.State.Pressed)
        ButtonVariant.QuietDanger -> ButtonLook(soft, danger, soft, Tokens.State.Pressed)
        ButtonVariant.Ghost -> ButtonLook(Color.Transparent, textSecondary, behind, Tokens.State.Pressed)
        ButtonVariant.Text -> ButtonLook(Color.Transparent, accentText, behind, Tokens.State.Pressed)
    }
}

@Composable
internal fun controlHeight(size: ButtonSize): Dp = when (size) {
    ButtonSize.Sm -> Kit.density.controlSm
    ButtonSize.Md -> Kit.density.controlMd
    ButtonSize.Lg -> Kit.density.controlLg
}

private fun sidePadding(size: ButtonSize): Dp = when (size) {
    ButtonSize.Sm -> Tokens.Space.Md
    ButtonSize.Md -> Tokens.Space.Lg
    ButtonSize.Lg -> Tokens.Space.Xl
}

/**
 * A pill button (the web kit's `Button`). While [loading] it is busy: a spinner takes the start
 * icon's place (or sits over the label), presses do nothing, and it says so to accessibility.
 * Disabled wins over loading. A small button keeps its look and still gets the density's hit
 * area.
 */
@Composable
fun Button(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Soft,
    size: ButtonSize = ButtonSize.Md,
    startIcon: ImageVector? = null,
    fullWidth: Boolean = false,
    loading: Boolean = false,
    enabled: Boolean = true,
) {
    val palette = Kit.palette
    val look = palette.buttonLook(variant, Kit.surface)
    val interaction = remember { MutableInteractionSource() }
    val busy = loading && enabled
    val background = if (look.background == Color.Transparent) {
        val pressed = pressedColour(interaction, look.under, look.pressed)
        if (pressed == look.under) Color.Transparent else pressed
    } else {
        pressedColour(interaction, look.under, look.pressed)
    }
    val type = if (size == ButtonSize.Sm) {
        kitTextStyle(TextVariant.Meta).copy(fontWeight = Tokens.Text.BodyStrong.weight)
    } else {
        kitTextStyle(TextVariant.BodyStrong)
    }
    Box(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
            .semantics { if (busy) stateDescription = "Busy" }
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled && !busy,
                role = Role.Button,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
                .height(controlHeight(size))
                .focusRing(interaction, CircleShape)
                .clip(CircleShape)
                .background(background)
                .alpha(if (enabled) 1f else Tokens.State.Disabled)
                .padding(horizontal = sidePadding(size)),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val iconSize = if (size == ButtonSize.Sm) Tokens.Icon.Sm else Tokens.Icon.Md
            if (busy) {
                Spinner(size = SpinnerSize.Sm, colour = look.label)
            } else if (startIcon != null) {
                Icon(startIcon, contentDescription = null, tint = look.label, modifier = Modifier.size(iconSize))
            }
            BasicText(
                text = label,
                style = type.copy(color = look.label),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** The web kit's `IconButtonVariant`: the button variants an icon button takes. */
enum class IconButtonVariant { Ghost, Soft, Primary, Danger }

/**
 * A round button with one icon (the web kit's `IconButton`). [label] is required: it is the
 * accessible name, since there is no visible text. [selected] makes it a toggle that is on;
 * [badge] shows a count in the corner.
 */
@Composable
fun IconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: IconButtonVariant = IconButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Md,
    selected: Boolean? = null,
    loading: Boolean = false,
    enabled: Boolean = true,
    badge: Int? = null,
) {
    val palette = Kit.palette
    val on = Kit.surface
    val look = palette.buttonLook(
        when (variant) {
            IconButtonVariant.Ghost -> ButtonVariant.Ghost
            IconButtonVariant.Soft -> ButtonVariant.Soft
            IconButtonVariant.Primary -> ButtonVariant.Primary
            IconButtonVariant.Danger -> ButtonVariant.Danger
        },
        on,
    )
    val isSelected = selected == true
    val selectedFill = if (on == KitSurface.Accent) palette.fill else palette.standOutFill(on)
    val resting = if (isSelected) selectedFill else look.background
    val under = if (isSelected) selectedFill else look.under
    val tint = if (isSelected) palette.accentText else look.label
    val interaction = remember { MutableInteractionSource() }
    val pressed = pressedColour(interaction, under, look.pressed)
    val background = if (resting == Color.Transparent && pressed == under) Color.Transparent else pressed
    val busy = loading && enabled
    val side = controlHeight(size)
    val iconSize = when (size) {
        ButtonSize.Sm -> Tokens.Icon.Sm
        ButtonSize.Md -> Tokens.Icon.Md
        ButtonSize.Lg -> Tokens.Icon.Lg
    }
    Box(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .semantics {
                contentDescription = label
                if (selected != null) this.selected = isSelected
                if (busy) stateDescription = "Busy"
            }
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled && !busy,
                role = Role.Button,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(side)
                .focusRing(interaction, CircleShape)
                .clip(CircleShape)
                .background(background)
                .alpha(if (enabled) 1f else Tokens.State.Disabled),
            contentAlignment = Alignment.Center,
        ) {
            if (busy) {
                Spinner(size = SpinnerSize.Sm, colour = tint)
            } else {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
            }
        }
        if (badge != null && badge > 0) {
            CountBadge(
                count = badge,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-2).dp, y = 2.dp),
            )
        }
    }
}

/** A small count in the danger colour, capped at 99+. */
@Composable
internal fun CountBadge(count: Int, modifier: Modifier = Modifier) {
    val palette = Kit.palette
    Box(
        modifier = modifier
            .sizeIn(minWidth = Tokens.Space.Lg, minHeight = Tokens.Space.Lg)
            .clip(CircleShape)
            .background(palette.danger)
            .padding(horizontal = Tokens.Space.Xs),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(
            text = if (count > 99) "99+" else count.toString(),
            style = kitTextStyle(TextVariant.Tag).copy(color = palette.onDanger),
        )
    }
}
