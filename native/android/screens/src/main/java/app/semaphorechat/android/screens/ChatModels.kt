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
    /** Not sent: [reason] is the line to show, already through [errorText]. [retrying] while Retry runs. */
    data class Failed(val reason: String, val retrying: Boolean = false) : MessageState
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
    /** A send from this device (core's `client_nonce`): what Retry and Delete of a failed one name. */
    val clientNonce: String? = null,
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

/** The composer's shared numbers: `semaphore_design::chat` (the app's tests check they agree). */
object ComposerCaps {
    /** Lines the field grows to on a phone, then it scrolls (`cap_rows(Phone)`). */
    const val PHONE_ROWS = 4
    /** The same with the on-screen keyboard up (`cap_rows(Keyboard)`). */
    const val KEYBOARD_ROWS = 2
    /** Suggestion rows shown before the list scrolls (`SUGGESTIONS_SHOWN`). */
    const val SUGGESTIONS_SHOWN = 6
}

/** Why the reader can't post: which picture goes with the line. */
enum class BlockedKind { NoPermission, ReadOnly, TimedOut }

/** Whether the composer shows, or the line that stands in for it. */
sealed interface ComposerAccess {
    data object Open : ComposerAccess
    /** [text] says why ("You can't send messages in #design"); [reason] is a moderator's. */
    data class Blocked(val text: String, val kind: BlockedKind, val reason: String? = null) : ComposerAccess
}

/** What a mention suggestion names (core's `MentionKind`). */
enum class SuggestionKind { User, Special, Alias, Channel, Community, Emoji }

/** One of core's `mention_candidates`: [insertText] carries its own `@` or `#`. */
data class MentionSuggestion(
    val kind: SuggestionKind,
    val id: String,
    val label: String,
    val insertText: String,
)

/** The composer beside its text: who may post, and the suggestions for the mention being typed. */
data class ComposerModel(
    val access: ComposerAccess = ComposerAccess.Open,
    val suggestions: List<MentionSuggestion> = emptyList(),
)

/** The suggestion list's heading (`MentionDropdown`): what all of them are, or "Suggestions". */
fun suggestionHeading(suggestions: List<MentionSuggestion>): String {
    val kind = suggestions.firstOrNull()?.kind ?: return "Suggestions"
    if (suggestions.any { it.kind != kind }) return "Suggestions"
    return when (kind) {
        SuggestionKind.User -> "Members"
        SuggestionKind.Alias -> "Mention Groups"
        SuggestionKind.Special -> "Special Mentions"
        SuggestionKind.Channel -> "Channels"
        SuggestionKind.Community -> "Communities"
        SuggestionKind.Emoji -> "Emoji"
    }
}
