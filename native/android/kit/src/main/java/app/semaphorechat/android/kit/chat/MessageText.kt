// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Kit
import app.semaphorechat.android.kit.KitPalette
import app.semaphorechat.android.kit.TextVariant
import app.semaphorechat.android.kit.kitTextStyle
import app.semaphorechat.android.kit.mix
import app.semaphorechat.android.kit.standOutFill
import app.semaphorechat.android.kit.tintBase

/** A run's formatting (core's `TextStyle`). */
data class PieceStyle(
    val bold: Boolean = false,
    val italic: Boolean = false,
    val strikethrough: Boolean = false,
    val code: Boolean = false,
)

/** What a mention points at, when a tap on it can go somewhere. */
sealed interface MentionTarget {
    data class User(val id: String) : MentionTarget
    data class Channel(val id: String) : MentionTarget
    /** @here, @everyone, a role or a community: drawn, not pressable. */
    data object None : MentionTarget
}

sealed interface PieceKind {
    data object Text : PieceKind
    /**
     * A web link. [href] is the address `check_link` gave, the only one ever opened; the piece's
     * text is its label. A link `check_link` refused is never a `Link`: it arrives as [Text].
     */
    data class Link(val href: String) : PieceKind
    /** [mine]: it names the reader, so it is drawn stronger. */
    data class Mention(val target: MentionTarget, val mine: Boolean = false) : PieceKind
    /** A custom emoji, drawn as `:name:` until pictures load (D7). */
    data class Emoji(val name: String) : PieceKind
    /** A fenced code block: laid out as a block of its own. */
    data object CodeBlock : PieceKind
}

/** One run of a message's words: the web kit's message segment. */
data class ChatPiece(val text: String, val kind: PieceKind = PieceKind.Text, val style: PieceStyle = PieceStyle())

/** A paragraph of inline runs, or one code block. */
internal sealed interface TextBlock {
    data class Inline(val pieces: List<ChatPiece>) : TextBlock
    data class Code(val text: String) : TextBlock
}

/** Code blocks on their own, everything between them one paragraph (desktop's `BlockKind`). */
internal fun blocksOf(pieces: List<ChatPiece>): List<TextBlock> {
    val blocks = mutableListOf<TextBlock>()
    val inline = mutableListOf<ChatPiece>()
    fun flush() {
        // A code block's own line breaks around it are the block's edges, not blank lines.
        val trimmed = inline.toMutableList()
        if (trimmed.isNotEmpty()) {
            trimmed[0] = trimmed[0].copy(text = trimmed[0].text.trimStart('\n'))
            trimmed[trimmed.lastIndex] = trimmed.last().copy(text = trimmed.last().text.trimEnd('\n'))
        }
        if (trimmed.any { it.text.isNotEmpty() }) blocks += TextBlock.Inline(trimmed.filter { it.text.isNotEmpty() })
        inline.clear()
    }
    for (piece in pieces) {
        if (piece.kind == PieceKind.CodeBlock) {
            flush()
            blocks += TextBlock.Code(piece.text.trim('\n'))
        } else {
            inline += piece
        }
    }
    flush()
    return blocks
}

/** The text a piece draws: a custom emoji's name between colons, anything else as it is. */
internal fun drawnText(piece: ChatPiece): String = when (val kind = piece.kind) {
    is PieceKind.Emoji -> ":${kind.name}:"
    else -> piece.text
}

private fun KitPalette.mentionBackground(mine: Boolean, under: Color): Color =
    mix(accent, under, if (mine) Tokens.State.PressedOnFill else Tokens.State.HoverOnFill)

internal fun inlineText(
    pieces: List<ChatPiece>,
    palette: KitPalette,
    under: Color,
    codeFill: Color,
    onLink: (String) -> Unit,
    onMention: (MentionTarget) -> Unit,
): AnnotatedString = buildAnnotatedString {
    for (piece in pieces) {
        val style = piece.style
        val base = SpanStyle(
            fontWeight = if (style.bold) FontWeight.W700 else null,
            fontStyle = if (style.italic) FontStyle.Italic else null,
            textDecoration = if (style.strikethrough) TextDecoration.LineThrough else null,
            fontFamily = if (style.code) FontFamily.Monospace else null,
            background = if (style.code) codeFill else Color.Unspecified,
        )
        val text = drawnText(piece)
        when (val kind = piece.kind) {
            is PieceKind.Link -> {
                val link = LinkAnnotation.Clickable(
                    tag = kind.href,
                    styles = TextLinkStyles(SpanStyle(color = palette.accentText, textDecoration = TextDecoration.Underline)),
                ) { onLink(kind.href) }
                withLink(link) { withStyle(base) { append(text) } }
            }
            is PieceKind.Mention -> {
                val look = base.merge(
                    SpanStyle(
                        color = palette.accentText,
                        fontWeight = FontWeight.W600,
                        background = palette.mentionBackground(kind.mine, under),
                    ),
                )
                if (kind.target == MentionTarget.None) {
                    withStyle(look) { append(text) }
                } else {
                    val link = LinkAnnotation.Clickable(tag = "mention", styles = TextLinkStyles(look)) { onMention(kind.target) }
                    withLink(link) { append(text) }
                }
            }
            else -> withStyle(base) { append(text) }
        }
    }
}

/**
 * A message's words, drawn from pre-cut pieces (the web kit's `MessageText`): formatting, inline
 * code and code blocks, links (their checked label), mentions and custom emoji. Pure: no parsing,
 * no data. A link calls [onLink] with its checked address; a mention of a user or a channel calls
 * [onMention].
 */
@Composable
fun MessageText(
    pieces: List<ChatPiece>,
    modifier: Modifier = Modifier,
    onLink: (String) -> Unit = {},
    onMention: (MentionTarget) -> Unit = {},
) {
    val palette = Kit.palette
    val under = palette.tintBase(Kit.surface)
    val codeFill = palette.standOutFill(Kit.surface)
    val body = kitTextStyle(TextVariant.Body).copy(color = palette.text)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
        for (block in blocksOf(pieces)) {
            when (block) {
                is TextBlock.Inline -> BasicText(
                    inlineText(block.pieces, palette, under, codeFill, onLink, onMention),
                    style = body,
                )
                is TextBlock.Code -> Box(
                    Modifier
                        .fillMaxWidth()
                        .background(codeFill, RoundedCornerShape(Tokens.Radius.Sm))
                        .horizontalScroll(rememberScrollState())
                        .padding(Tokens.Space.Sm),
                ) {
                    BasicText(
                        block.text,
                        style = kitTextStyle(TextVariant.Small).copy(color = palette.text, fontFamily = FontFamily.Monospace),
                        softWrap = false,
                    )
                }
            }
        }
    }
}
