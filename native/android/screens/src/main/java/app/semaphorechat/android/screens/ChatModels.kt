// Semaphore Chat's Android screens. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

import app.semaphorechat.android.kit.chat.ChatPiece

/**
 * What the chat screen draws, as plain Kotlin: the app's ConversationStore builds it from core's
 * rows (cutting each message's words with the FFI's `message_pieces`), and the stories build it by
 * hand.
 */

/** Where a message is on its way to the server. */
sealed interface MessageState {
    data object Sent : MessageState
    /** On its way: dimmed, "Sending…". */
    data object Pending : MessageState
    /** Not sent: [reason] is the line to show, already through [errorText]. */
    data class Failed(val reason: String) : MessageState
}

/** The message a reply answers, shown above its words. */
data class QuoteItem(val author: String, val text: String, val deleted: Boolean = false)

data class ChatMessage(
    /** Core's `seq`: the row's key, stable for as long as the row is in the list. */
    val key: Long,
    val id: String?,
    val authorId: String,
    val author: String,
    val sentAtMs: Long,
    val pieces: List<ChatPiece>,
    val edited: Boolean = false,
    /** Removed by a moderator or its author: [pieces] are not drawn. */
    val removed: Boolean = false,
    val state: MessageState = MessageState.Sent,
    /** It mentions the reader (by name, or @here, @channel, @everyone): drawn with the mention rail. */
    val mentionsMe: Boolean = false,
    val replyTo: QuoteItem? = null,
    val replyCount: Int = 0,
    /**
     * One line for each thing this build does not draw yet (attachments, a GIF, link previews: D7),
     * so nothing in a message is silently missing.
     */
    val extras: List<String> = emptyList(),
)

/** The words and the accessible name of the "Jump to latest" control (the FFI's `jump_text`). */
data class JumpLabel(val text: String, val name: String, val counted: Boolean)

/** How the first page went. */
sealed interface ChatFace {
    data object Loading : ChatFace
    data class Failed(val message: String) : ChatFace
    data object Ready : ChatFace
}

/** The connection line under the header, when the socket is not up. */
enum class ChatConnection { Live, Reconnecting, Offline }

data class ChatModel(
    val face: ChatFace = ChatFace.Loading,
    /** Oldest first. */
    val messages: List<ChatMessage> = emptyList(),
    /** The newest rows loaded are the newest there are. */
    val atLiveEdge: Boolean = true,
    /** The oldest row loaded is the conversation's first. */
    val atStart: Boolean = false,
    val loadingOlder: Boolean = false,
    /** Loading older rows failed: the top of the list offers a retry. */
    val olderFailed: String? = null,
    /** "Ava is typing…", or empty. */
    val typing: String = "",
    /** The jump control, when it shows: the reader is away from the newest, or the list is. */
    val jump: JumpLabel? = null,
    val connection: ChatConnection = ChatConnection.Live,
)

/** The channel screen's header. */
data class ChatHeaderModel(val name: String, val icon: ChannelIcon = ChannelIcon.Hash, val community: String = "")
