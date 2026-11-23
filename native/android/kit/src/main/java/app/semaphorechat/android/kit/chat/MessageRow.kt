// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Avatar
import app.semaphorechat.android.kit.AvatarSize
import app.semaphorechat.android.kit.Icon
import app.semaphorechat.android.kit.IconSize
import app.semaphorechat.android.kit.Kit
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant
import app.semaphorechat.android.kit.mix
import app.semaphorechat.android.kit.personColour
import app.semaphorechat.android.kit.tintBase

/** Where a row is on its way to the server (the web kit's `MessageState`). */
sealed interface RowState {
    data object Sent : RowState
    data object Pending : RowState
    /** Not sent; [reason] in place of "Not sent" when there is one. */
    data class Failed(val reason: String?) : RowState
}

/** The texts the chat pieces say, shared with the tests. */
object ChatKitText {
    const val SENDING = "Sending…"
    const val NOT_SENT = "Not sent"
    const val EDITED = "(edited)"
    const val REMOVED = "Message removed"
    fun replies(count: Int) = if (count == 1) "1 reply" else "$count replies"
}

/**
 * One message in a compact list (the web kit's `MessageRow`, principles §4): the author's avatar,
 * name and time on one line, the words under them. A [continued] row (same author, close in time)
 * drops the avatar and the header. [mentioned] tints it and draws the mention rail. A pending row
 * is dimmed and says "Sending…"; a failed one says why it wasn't sent. [extras] are lines for
 * what this build does not draw yet.
 */
@Composable
fun MessageRow(
    author: String,
    authorColourId: String,
    time: String,
    pieces: List<ChatPiece>,
    modifier: Modifier = Modifier,
    continued: Boolean = false,
    mentioned: Boolean = false,
    edited: Boolean = false,
    removed: Boolean = false,
    state: RowState = RowState.Sent,
    quote: MessageQuoteItem? = null,
    replyCount: Int = 0,
    extras: List<String> = emptyList(),
    onLink: (String) -> Unit = {},
    onMention: (MentionTarget) -> Unit = {},
) {
    val palette = Kit.palette
    val under = palette.tintBase(Kit.surface)
    val rail = palette.accent
    val railWidth = Tokens.Border.Selected
    val background = if (mentioned) mix(palette.accent, under, Tokens.State.Pressed) else under
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(background, RoundedCornerShape(Tokens.Radius.Md))
            .then(
                if (mentioned) {
                    Modifier.drawBehind {
                        drawRect(rail, Offset.Zero, Size(railWidth.toPx(), size.height))
                    }
                } else {
                    Modifier
                },
            )
            .padding(
                start = Tokens.Space.Md,
                end = Tokens.Space.Md,
                top = if (continued) Tokens.Space.TwoXs else Tokens.Space.Sm,
                bottom = Tokens.Space.TwoXs,
            ),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
    ) {
        Box(Modifier.width(Tokens.Avatar.Md)) {
            if (!continued) Avatar(author, colour = personColour(authorColourId), size = AvatarSize.Md, decorative = true)
        }
        Column(
            Modifier.weight(1f).alpha(if (state == RowState.Pending) Tokens.State.Disabled else 1f),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.TwoXs),
        ) {
            val marks = listOfNotNull(
                ChatKitText.EDITED.takeIf { edited },
                ChatKitText.SENDING.takeIf { state == RowState.Pending },
            )
            if (!continued) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    Box(Modifier.weight(1f, fill = false).semantics { heading() }) {
                        Text(author, variant = TextVariant.Name, truncate = true)
                    }
                    Text(time, variant = TextVariant.Small, tone = TextTone.Dim)
                    marks.forEach { Text(it, variant = TextVariant.Small, tone = TextTone.Dim) }
                }
            } else if (marks.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    marks.forEach { Text(it, variant = TextVariant.Small, tone = TextTone.Dim) }
                }
            }
            quote?.let { MessageQuote(it) }
            if (removed) {
                Text(ChatKitText.REMOVED, tone = TextTone.Dim)
            } else {
                MessageText(pieces, onLink = onLink, onMention = onMention)
                extras.forEach { Text(it, variant = TextVariant.Meta, tone = TextTone.Secondary) }
            }
            if (replyCount > 0) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                    Icon(Icons.MessageSquare, size = IconSize.Xs)
                    Text(ChatKitText.replies(replyCount), variant = TextVariant.Small, tone = TextTone.Accent)
                }
            }
            if (state is RowState.Failed) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                    Icon(Icons.CircleAlert, size = IconSize.Xs, colour = palette.danger)
                    Text(state.reason ?: ChatKitText.NOT_SENT, variant = TextVariant.Small, tone = TextTone.Danger)
                }
            }
        }
    }
}

/** The message a reply answers (the web kit's `MessageQuote`). */
data class MessageQuoteItem(val author: String, val text: String, val deleted: Boolean = false)

@Composable
fun MessageQuote(quote: MessageQuoteItem, modifier: Modifier = Modifier) {
    val palette = Kit.palette
    val rail = palette.hairline
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind { drawRect(rail, Offset.Zero, Size(Tokens.Border.Selected.toPx(), size.height)) }
            .padding(start = Tokens.Space.Sm),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Reply, size = IconSize.Xs)
        if (quote.deleted) {
            Text("Original message was deleted", variant = TextVariant.Small, tone = TextTone.Dim, truncate = true)
        } else {
            // The name gets up to 40% of the line, the words the rest.
            Text(quote.author, variant = TextVariant.Small, tone = TextTone.Secondary, truncate = true, modifier = Modifier.weight(0.4f, fill = false))
            Text(quote.text, variant = TextVariant.Small, tone = TextTone.Dim, truncate = true, modifier = Modifier.weight(1f))
        }
    }
}

/** A day's separator in the list: a hairline with the day in the middle. */
@Composable
fun DayDivider(label: String, modifier: Modifier = Modifier) {
    val hairline = Kit.palette.hairline
    Row(
        modifier.fillMaxWidth().padding(horizontal = Tokens.Space.Md, vertical = Tokens.Space.Sm).semantics { heading() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
    ) {
        Box(Modifier.weight(1f).height(Tokens.Border.Hairline).background(hairline))
        Text(label, variant = TextVariant.Small, tone = TextTone.Secondary)
        Box(Modifier.weight(1f).height(Tokens.Border.Hairline).background(hairline))
    }
}
