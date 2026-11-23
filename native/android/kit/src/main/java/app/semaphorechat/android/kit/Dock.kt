// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import app.semaphorechat.android.design.Tokens

/**
 * The Lounge's dock (the web kit's `Dock`): a pill in the surface colour, `layout.dock` tall,
 * with fixed [start] and [end] pieces and the items between them scrolling sideways. On a phone
 * it is the bottom bar.
 */
@Composable
fun Dock(
    label: String,
    modifier: Modifier = Modifier,
    start: (@Composable RowScope.() -> Unit)? = null,
    end: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val palette = Kit.palette
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(Tokens.Layout.Dock)
            .clip(CircleShape)
            .background(palette.surface)
            .padding(horizontal = Tokens.Space.Sm)
            .semantics { paneTitle = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
    ) {
        CompositionLocalProvider(
            LocalKitSurface provides KitSurface.Surface,
            LocalContentColor provides palette.text,
        ) {
            start?.invoke(this)
            Row(
                modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
                content = content,
            )
            end?.invoke(this)
        }
    }
}

/** A hairline between the dock's groups (the web kit's `DockDivider`). */
@Composable
fun DockDivider(modifier: Modifier = Modifier) {
    Box(
        modifier
            .clearAndSetSemantics { }
            .width(Tokens.Border.Hairline)
            .height(Tokens.Icon.Xl)
            .background(Kit.palette.hairline),
    )
}

/** What a dock item's accessible name says, as the web's DockItem builds it. */
fun dockItemLabel(name: String, current: Boolean, mentions: Int, newMessages: Boolean): String =
    listOfNotNull(
        name,
        if (current) "current" else null,
        when {
            mentions == 1 -> "1 mention"
            mentions > 1 -> "$mentions mentions"
            else -> null
        },
        if (newMessages && mentions <= 0) "new messages" else null,
    ).joinToString(", ")

/**
 * One community in the dock (the web kit's `DockItem`): its avatar in a ring that is accent
 * when [current] (always there, so nothing moves), a danger count of [mentions], or an accent
 * dot for [newMessages] without mentions.
 */
@Composable
fun DockItem(
    name: String,
    colourId: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    current: Boolean = false,
    mentions: Int = 0,
    newMessages: Boolean = false,
) {
    val palette = Kit.palette
    val ring = Tokens.Border.Selected
    val interaction = remember { MutableInteractionSource() }
    val description = dockItemLabel(name, current, mentions, newMessages)
    Box(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .clearAndSetSemantics {
                contentDescription = description
                role = Role.Button
                selected = current
                onClick { onClick(); true }
            }
            .clickable(interaction, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(Tokens.Avatar.Md + ring * 4)
                .border(ring, if (current) palette.accent else Color.Transparent, CircleShape)
                .padding(ring * 2),
            contentAlignment = Alignment.Center,
        ) {
            val pressed = pressedColour(interaction, Color.Transparent, Tokens.State.Pressed)
            Avatar(name, colour = personColour(colourId), size = AvatarSize.Md, decorative = true)
            if (pressed != Color.Transparent) {
                Box(Modifier.size(Tokens.Avatar.Md).clip(CircleShape).background(palette.text.copy(alpha = Tokens.State.Pressed)))
            }
        }
        when {
            mentions > 0 -> Badge(
                label = "",
                count = mentions,
                tone = BadgeTone.Danger,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = Tokens.Space.Xs, y = -Tokens.Space.TwoXs),
            )
            newMessages -> Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = Tokens.Space.TwoXs, y = Tokens.Space.TwoXs)
                    .size(Tokens.Space.Sm + ring * 2)
                    .clip(CircleShape)
                    .background(palette.surface),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(Tokens.Space.Sm).clip(CircleShape).background(palette.accent))
            }
        }
    }
}
