// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens

/**
 * A bottom sheet over the screen (the web kit's `Sheet` below the phone breakpoint): the scrim,
 * then a surface panel with rounded top corners, a title and a close button. While [open], the
 * system Back closes it before anything under it (design/behaviour/overlay-stack, rule 20); so
 * do a tap on the scrim and the close button. Draw it last inside the screen's root box, so it
 * covers the rest.
 */
@Composable
fun Sheet(
    open: Boolean,
    onClose: () -> Unit,
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    // Registered while open, after the screen's own handlers: the topmost layer takes the Back.
    BackHandler(enabled = open, onBack = onClose)
    if (!open) return
    val palette = Kit.palette
    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val maxSheet = maxHeight * 0.85f
        Box(
            Modifier
                .fillMaxSize()
                .background(palette.scrim)
                .clearAndSetSemantics { }
                .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        )
        val shape = RoundedCornerShape(topStart = Tokens.Radius.Island, topEnd = Tokens.Radius.Island)
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .heightIn(max = maxSheet)
                .clip(shape)
                .background(palette.surface)
                // Swallow taps so they don't reach the scrim.
                .clickable(remember { MutableInteractionSource() }, indication = null, onClick = {})
                .semantics { paneTitle = title }
                .navigationBarsPadding()
                .padding(Tokens.Space.Lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
        ) {
            CompositionLocalProvider(
                LocalKitSurface provides KitSurface.Surface,
                LocalContentColor provides palette.text,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { Text(title, variant = TextVariant.Title, heading = true, truncate = true) }
                    IconButton(Icons.X, label = "Close", onClick = onClose)
                }
                content()
            }
        }
    }
}
