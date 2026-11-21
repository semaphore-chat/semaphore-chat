// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.BasicText
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens

/** The web kit's list row sizes; the minimum heights are the density's. */
enum class ListRowSize { Md, Lg }

/**
 * One row of a list (the web kit's `ListRow`): [primary] text, an optional [secondary] line, a
 * [leading] avatar or icon and a [trailing] badge, pill or icon button. [selected] paints it
 * in the accent; [unread] and [strong] embolden the primary text; [muted] dims it. With
 * [onClick] it is one button; [chevron] shows that it goes somewhere. [busy] shows a spinner
 * at the end.
 */
@Composable
fun ListRow(
    primary: String,
    modifier: Modifier = Modifier,
    secondary: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    trailingLabel: String? = null,
    size: ListRowSize = ListRowSize.Md,
    selected: Boolean = false,
    unread: Boolean = false,
    strong: Boolean = false,
    muted: Boolean = false,
    chevron: Boolean = false,
    busy: Boolean = false,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    val palette = Kit.palette
    val on = Kit.surface
    val under = if (selected) palette.accent else palette.tintBase(on)
    val interaction = remember { MutableInteractionSource() }
    val pressed = pressedColour(
        interaction,
        under,
        if (selected) Tokens.State.PressedOnFill else Tokens.State.Pressed,
    )
    val background = when {
        selected -> pressed
        pressed == under -> Color.Transparent
        else -> pressed
    }
    val shape = if (size == ListRowSize.Md) CircleShape else RoundedCornerShape(Tokens.Radius.Card)
    val minHeight = if (size == ListRowSize.Md) Kit.density.listRowMd else Kit.density.listRowLg
    val ink = if (selected) palette.onAccent else palette.textSecondary
    val primaryColour = when {
        selected -> palette.onAccent
        muted -> palette.textDim
        unread || strong -> palette.text
        else -> palette.textSecondary
    }
    val secondaryColour = if (selected) palette.onAccent else if (muted) palette.textDim else palette.textDim
    val clickable = if (onClick != null) {
        Modifier.clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
    } else {
        Modifier
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                if (selected) this.selected = true
                if (busy) stateDescription = "Busy"
            }
            .then(clickable)
            .heightIn(min = minHeight)
            .focusRing(interaction, shape)
            .clip(shape)
            .background(background)
            .alpha(if (enabled) 1f else Tokens.State.Disabled)
            .padding(start = Tokens.Space.Xs, end = Tokens.Space.Md),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(
            LocalKitSurface provides if (selected) KitSurface.Accent else on,
            LocalContentColor provides ink,
        ) {
            Box(
                modifier = Modifier.widthIn(min = Tokens.Avatar.Sm).padding(start = Tokens.Space.Xs),
                contentAlignment = Alignment.Center,
            ) { leading?.invoke() }
            Column(modifier = Modifier.weight(1f).padding(vertical = Tokens.Space.Sm)) {
                val weight: FontWeight = if (unread || strong) Tokens.Text.BodyStrong.weight else Tokens.Text.Body.weight
                BasicText(
                    text = primary,
                    style = kitTextStyle(TextVariant.Body).copy(color = primaryColour, fontWeight = weight),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (secondary != null) {
                    BasicText(
                        text = secondary,
                        style = kitTextStyle(TextVariant.Meta).copy(color = secondaryColour),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (trailingLabel != null) {
                BasicText(text = trailingLabel, style = kitTextStyle(TextVariant.Meta).copy(color = secondaryColour))
            }
            if (busy) Spinner(size = SpinnerSize.Sm, colour = ink)
            trailing?.invoke()
            if (chevron) {
                Icon(Icons.ChevronRight, contentDescription = null, tint = ink, modifier = Modifier.size(Tokens.Icon.Sm))
            }
        }
    }
}
