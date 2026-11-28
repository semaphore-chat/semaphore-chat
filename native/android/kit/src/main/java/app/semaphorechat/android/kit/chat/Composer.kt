// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Avatar
import app.semaphorechat.android.kit.AvatarSize
import app.semaphorechat.android.kit.ButtonSize
import app.semaphorechat.android.kit.Icon
import app.semaphorechat.android.kit.IconButton
import app.semaphorechat.android.kit.IconButtonVariant
import app.semaphorechat.android.kit.IconSize
import app.semaphorechat.android.kit.Kit
import app.semaphorechat.android.kit.ListRow
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant
import app.semaphorechat.android.kit.kitTextStyle
import app.semaphorechat.android.kit.personColour
import app.semaphorechat.android.kit.standOutFill

/** The composer's texts, shared with the tests. */
object ComposerText {
    /** `semaphore_design::chat::submit_label(Send)`. */
    const val SEND = "Send message"
    const val FIELD_TAG = "composer-field"
    fun placeholder(channel: String) = if (channel.isEmpty()) "Message" else "Message #$channel"
}

/**
 * The message field (the web kit's `Composer` at phone width): a rounded box in the stand-out
 * fill that grows with its lines up to [maxLines], then scrolls, with Send at its end. Enter adds a
 * new line, as on a phone keyboard; Send is enabled while [canSend].
 */
@Composable
fun ComposerField(
    value: TextFieldValue,
    onValueChange: (TextFieldValue) -> Unit,
    placeholder: String,
    maxLines: Int,
    canSend: Boolean,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = Kit.palette
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Tokens.Radius.Field)
    val text = kitTextStyle(TextVariant.Body)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = Kit.density.controlLg)
            .clip(shape)
            .background(palette.standOutFill(Kit.surface))
            .border(Tokens.Border.Selected, if (focused) palette.focus else Color.Transparent, shape)
            .padding(start = Tokens.Space.Lg, end = Tokens.Space.Xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
    ) {
        Box(Modifier.weight(1f).padding(vertical = Tokens.Space.Sm)) {
            if (value.text.isEmpty()) {
                // A long channel name ends in an ellipsis rather than wrapping out of sight.
                BasicText(text = placeholder, style = text.copy(color = palette.textDim), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = false,
                minLines = 1,
                maxLines = maxLines.coerceAtLeast(1),
                textStyle = text.copy(color = palette.text),
                cursorBrush = SolidColor(palette.accent),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = ImeAction.Default,
                ),
                interactionSource = interaction,
                modifier = Modifier.fillMaxWidth().testTag(ComposerText.FIELD_TAG).semantics { contentDescription = placeholder },
            )
        }
        IconButton(
            Icons.Send,
            label = ComposerText.SEND,
            onClick = onSend,
            variant = if (canSend) IconButtonVariant.Primary else IconButtonVariant.Ghost,
            enabled = canSend,
        )
    }
}

/**
 * Stands in for the composer when the reader can't post here (`ComposerUnavailableNotice`): why,
 * and the moderator's [reason] when there is one. Announced politely, at about the field's height.
 */
@Composable
fun ComposerNotice(text: String, icon: ImageVector, modifier: Modifier = Modifier, reason: String? = null) {
    val label = if (reason != null) "$text. Reason: $reason" else text
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = Kit.density.controlLg)
            .clip(RoundedCornerShape(Tokens.Radius.Field))
            .background(Kit.palette.standOutFill(Kit.surface))
            .padding(horizontal = Tokens.Space.Lg, vertical = Tokens.Space.Sm)
            .semantics(mergeDescendants = true) {
                contentDescription = label
                liveRegion = LiveRegionMode.Polite
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
    ) {
        Icon(icon, size = IconSize.Sm)
        Column(Modifier.weight(1f)) {
            Text(text, variant = TextVariant.Small, tone = TextTone.Secondary)
            reason?.let { Text("Reason: $it", variant = TextVariant.Small, tone = TextTone.Dim) }
        }
    }
}

/** What a suggestion is, for its leading picture. */
sealed interface SuggestionLook {
    /** A member: their avatar, in their colour. */
    data class Person(val colourId: String) : SuggestionLook
    data object Channel : SuggestionLook
    /** @here, @channel, a mention group. */
    data object Group : SuggestionLook
}

data class SuggestionItem(val label: String, val detail: String?, val look: SuggestionLook)

/**
 * The mention suggestions above the composer (the web's `SuggestionList`): a [heading], then the
 * [items], [shown] rows tall before it scrolls. Tapping one picks it.
 */
@Composable
fun SuggestionList(
    heading: String,
    items: List<SuggestionItem>,
    shown: Int,
    onPick: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (items.isEmpty()) return
    val row = Kit.density.controlLg
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tokens.Radius.Md))
            .background(Kit.palette.standOutFill(Kit.surface))
            .padding(vertical = Tokens.Space.Xs),
    ) {
        Box(Modifier.padding(horizontal = Tokens.Space.Md, vertical = Tokens.Space.Xs).semantics { heading() }) {
            Text(heading, variant = TextVariant.Small, tone = TextTone.Secondary)
        }
        // Each row is at least the large control's height: [shown] of them, and a little of the next.
        val max = with(LocalDensity.current) { (row.toPx() * (shown.coerceAtLeast(1) + 0.5f)).toDp() }
        // Fewer rows when the space it is given is short (the keyboard is up): it scrolls.
        LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false).heightIn(max = max.coerceAtLeast(48.dp))) {
            itemsIndexed(items) { index, item ->
                ListRow(
                    primary = item.label,
                    secondary = item.detail,
                    leading = {
                        when (val look = item.look) {
                            is SuggestionLook.Person -> Avatar(item.label, colour = personColour(look.colourId), size = AvatarSize.Sm, decorative = true)
                            SuggestionLook.Channel -> Icon(Icons.Hash, size = IconSize.Md)
                            SuggestionLook.Group -> Icon(Icons.AtSign, size = IconSize.Md)
                        }
                    },
                    onClick = { onPick(index) },
                )
            }
        }
    }
}

/** The Retry and Delete of a failed row, under why it wasn't sent. */
@Composable
internal fun FailedActions(retrying: Boolean, onRetry: (() -> Unit)?, onDelete: (() -> Unit)?) {
    if (onRetry == null && onDelete == null) return
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs), verticalAlignment = Alignment.CenterVertically) {
        onRetry?.let {
            app.semaphorechat.android.kit.Button(
                ChatKitText.RETRY,
                onClick = it,
                variant = app.semaphorechat.android.kit.ButtonVariant.Text,
                size = ButtonSize.Sm,
                loading = retrying,
            )
        }
        onDelete?.let {
            app.semaphorechat.android.kit.Button(
                ChatKitText.DELETE,
                onClick = it,
                variant = app.semaphorechat.android.kit.ButtonVariant.QuietDanger,
                size = ButtonSize.Sm,
                enabled = !retrying,
            )
        }
    }
}
