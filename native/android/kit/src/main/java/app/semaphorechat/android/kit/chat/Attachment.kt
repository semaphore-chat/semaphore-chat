// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.ButtonSize
import app.semaphorechat.android.kit.Icon
import app.semaphorechat.android.kit.IconButton
import app.semaphorechat.android.kit.IconSize
import app.semaphorechat.android.kit.Kit
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant
import app.semaphorechat.android.kit.mix
import app.semaphorechat.android.kit.standOutFill
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** The attachment pieces' texts (`semaphore_design::chat`'s names), shared with the tests. */
object AttachmentText {
    const val PLAY = "Play"
    const val ATTACH = "Attach files"
    fun open(name: String) = "Open ${displayName(name)}"
    fun remove(name: String) = "Remove ${displayName(name)}"
    fun uploading(name: String) = "Uploading ${displayName(name)}"
    fun retry(name: String) = "Retry uploading ${displayName(name)}"
}

/**
 * A file name as it may be drawn and read aloud: without the bidi controls that can make
 * `exe.txt` read as `txt.exe` (`strip_bidi` in `semaphore_design::chat`, and Rust's rules for
 * messages). Names come from whoever sent the file.
 */
fun displayName(name: String): String = buildString(name.length) {
    name.forEach { if (!isBidiControl(it)) append(it) }
}

private fun isBidiControl(c: Char): Boolean =
    c == '\u061C' || c == '\u200E' || c == '\u200F' || c in '\u202A'..'\u202E' || c in '\u2066'..'\u2069'

/** A picture on its way from the server, ready, or one that won't be drawn (the file row stands in). */
sealed interface ImageLoad {
    data object Loading : ImageLoad
    data class Ready(val image: ImageBitmap) : ImageLoad
    data object Failed : ImageLoad
}

/**
 * Where tiles get their pictures: the app's loader over core's `file`, or the stories' fixtures.
 * [sizeBytes] is what the message says the file is (null when unknown), so a tile never fetches a
 * file the loader would refuse to decode.
 */
fun interface AttachmentImages {
    fun image(fileId: String, thumbnail: Boolean, sizeBytes: Long?): StateFlow<ImageLoad>
}

private val NO_IMAGES = AttachmentImages { _, _, _ -> MutableStateFlow(ImageLoad.Failed) }

/** The tiles' pictures, provided around the chat. Without one every picture falls back to its file row. */
val LocalAttachmentImages = staticCompositionLocalOf { NO_IMAGES }

/**
 * An image, or a video's still with Play (the web kit's `AttachmentTile`), drawn in its
 * [width]×[height] box. The picture is the server's small copy when [thumbnail], else the file.
 * While it loads the box is the stand-out fill; a picture that won't load, or a video without a
 * still, draws [FileTile] instead. A tap opens it ([onOpen]).
 */
@Composable
fun MediaTile(
    fileId: String,
    name: String,
    size: String,
    width: Dp,
    height: Dp,
    video: Boolean,
    thumbnail: Boolean,
    onOpen: () -> Unit,
    /** What the message says the file is, so a picture too big to decode is never fetched. */
    sizeBytes: Long? = null,
    modifier: Modifier = Modifier,
) {
    val images = LocalAttachmentImages.current
    // A video has only the server's still: without one there is nothing to fetch.
    val flow = remember(images, fileId, thumbnail, video, sizeBytes) {
        if (video && !thumbnail) {
            MutableStateFlow(ImageLoad.Failed)
        } else {
            images.image(fileId, thumbnail, sizeBytes)
        }
    }
    val load by flow.collectAsState()
    if (load == ImageLoad.Failed) {
        FileTile(name, size, if (video) Icons.Video else Icons.Image, onOpen, modifier)
        return
    }
    val palette = Kit.palette
    val shape = RoundedCornerShape(Tokens.Radius.Md)
    Box(
        // As wide as its box, or the row when that is narrower, keeping the box's shape.
        modifier
            .width(width)
            .aspectRatio(width / height)
            .clip(shape)
            .background(palette.standOutFill(Kit.surface))
            .clickable(role = Role.Button, onClickLabel = AttachmentText.open(name), onClick = onOpen)
            .semantics { contentDescription = displayName(name) },
        contentAlignment = Alignment.Center,
    ) {
        (load as? ImageLoad.Ready)?.let {
            Image(it.image, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        }
        if (video) {
            Box(
                Modifier.size(Kit.density.controlLg).clip(CircleShape).background(mix(palette.scrim, palette.surface, 0.7f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Play, size = IconSize.Md, colour = palette.text, label = AttachmentText.PLAY)
            }
        }
    }
}

/** A file as a row (the web kit's file tile): its icon, name and size. A tap opens it. */
@Composable
fun FileTile(
    name: String,
    size: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    TileFrame(modifier.clickable(role = Role.Button, onClickLabel = AttachmentText.open(name), onClick = onOpen)) {
        Icon(icon, size = IconSize.Md, colour = Kit.palette.textSecondary)
        NameAndSize(name, size, Modifier.weight(1f))
    }
}

/**
 * A file on its way: queued in the composer's tray ([progress] null) or uploading under its
 * message (a bar), or [failed] with why, and Retry ([onRetry]). Remove ([onRemove]) takes it off.
 */
@Composable
fun UploadTile(
    name: String,
    size: String,
    modifier: Modifier = Modifier,
    progress: Float? = null,
    failed: String? = null,
    onRetry: (() -> Unit)? = null,
    onRemove: (() -> Unit)? = null,
) {
    val palette = Kit.palette
    TileFrame(modifier) {
        Icon(if (failed != null) Icons.CircleAlert else Icons.Paperclip, size = IconSize.Md, colour = if (failed != null) palette.danger else palette.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.TwoXs)) {
            NameAndSize(name, size)
            when {
                failed != null -> Text(failed, variant = TextVariant.Small, tone = TextTone.Danger)
                progress != null -> ProgressBar(progress, AttachmentText.uploading(name))
            }
        }
        if (failed != null && onRetry != null) {
            app.semaphorechat.android.kit.Button(
                ChatKitText.RETRY,
                onClick = onRetry,
                variant = app.semaphorechat.android.kit.ButtonVariant.Text,
                size = ButtonSize.Sm,
                modifier = Modifier.semantics { contentDescription = AttachmentText.retry(name) },
            )
        }
        onRemove?.let { IconButton(Icons.X, label = AttachmentText.remove(name), onClick = it, size = ButtonSize.Sm) }
    }
}

@Composable
private fun TileFrame(modifier: Modifier, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val palette = Kit.palette
    val shape = RoundedCornerShape(Tokens.Radius.Md)
    Row(
        modifier
            .widthIn(max = Tokens.Space.Md * 25)
            .fillMaxWidth()
            .heightIn(min = Kit.density.controlLg)
            .clip(shape)
            .background(palette.standOutFill(Kit.surface))
            .border(Tokens.Border.Hairline, palette.hairline, shape)
            .padding(horizontal = Tokens.Space.Md, vertical = Tokens.Space.Sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
        content = content,
    )
}

@Composable
private fun NameAndSize(name: String, size: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(displayName(name), variant = TextVariant.Body, truncate = true)
        Text(size, variant = TextVariant.Small, tone = TextTone.Dim)
    }
}

/** A thin determinate bar, [fraction] of the way, named for accessibility. */
@Composable
private fun ProgressBar(fraction: Float, label: String) {
    val palette = Kit.palette
    val shown = fraction.coerceIn(0f, 1f)
    Box(
        Modifier.fillMaxWidth().height(Tokens.Space.Xs).clip(CircleShape).background(palette.hairline)
            .clearAndSetSemantics { contentDescription = label },
    ) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(shown).background(palette.accent))
    }
}
