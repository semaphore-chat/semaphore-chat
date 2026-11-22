// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Button
import app.semaphorechat.android.kit.ButtonSize
import app.semaphorechat.android.kit.ButtonVariant
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant

/** The room the list keeps under its last row for the typing line (`TYPING_LINE_HEIGHT`). */
val TypingLineHeight = Tokens.Space.TwoXl

/**
 * Who is typing (the web kit's `TypingLine`): [text] is the FFI's `typing_text`, empty for nobody.
 * Always as tall, so the list above doesn't jump when someone starts or stops. Announced politely.
 */
@Composable
fun TypingLine(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier.fillMaxWidth().height(TypingLineHeight).padding(horizontal = Tokens.Space.Md),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (text.isNotEmpty()) {
            Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                Text(text, variant = TextVariant.Small, tone = TextTone.Secondary, truncate = true)
            }
        }
    }
}

/**
 * "Jump to latest" (the web kit's `JumpToLatest`): [text] and [name] are the FFI's `jump_text`.
 * With a count of new messages it is drawn in the accent.
 */
@Composable
fun JumpToLatest(text: String, name: String, counted: Boolean, onJump: () -> Unit, modifier: Modifier = Modifier) {
    Button(
        text,
        onClick = onJump,
        modifier = modifier.semantics { contentDescription = name },
        variant = if (counted) ButtonVariant.Primary else ButtonVariant.Soft,
        size = ButtonSize.Sm,
        startIcon = Icons.ChevronDown,
    )
}
