// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import androidx.compose.foundation.lazy.LazyListState
import app.semaphorechat.android.kit.chat.ChatPiece
import app.semaphorechat.android.kit.chat.MentionTarget
import app.semaphorechat.android.kit.chat.PieceKind
import app.semaphorechat.android.kit.chat.PieceStyle
import app.semaphorechat.android.screens.ChatConnection
import app.semaphorechat.android.screens.ChatFace
import app.semaphorechat.android.screens.ChatMessage
import app.semaphorechat.android.screens.ChatModel
import app.semaphorechat.android.screens.JumpLabel
import app.semaphorechat.android.screens.MessageState
import app.semaphorechat.android.screens.QuoteItem
import app.semaphorechat.android.screens.errorText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.Conversation
import uniffi.semaphore.CoreException
import uniffi.semaphore.ListOp
import uniffi.semaphore.MessagePiece
import uniffi.semaphore.MessageRow
import uniffi.semaphore.SegKind
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.SendState
import uniffi.semaphore.SessionState
import uniffi.semaphore.TextSeg
import uniffi.semaphore.UserView

/** The chat's pure rules, from Rust through the FFI; a fake in the JVM's pure tests. */
interface ChatRules {
    fun pieces(display: String, segs: List<TextSeg>): List<MessagePiece>
    fun typing(names: List<String>): String
    fun jump(newCount: Int): JumpLabel

    /** `semaphore_design::chat` and `semaphore_core::links`, through the FFI. */
    object Native : ChatRules {
        override fun pieces(display: String, segs: List<TextSeg>) = uniffi.semaphore.messagePieces(display, segs)
        override fun typing(names: List<String>) = uniffi.semaphore.typingText(names)
        override fun jump(newCount: Int): JumpLabel =
            uniffi.semaphore.jumpText(newCount.coerceAtLeast(0).toUInt()).let { JumpLabel(it.text, it.name, it.counted) }
    }
}

/** How often the typing line is re-read while someone types: core expires names without an event. */
const val TYPING_RECHECK_MS = 1_000L

/** The special mentions that reach everyone, the reader included. */
private val EVERYONE = setOf("here", "channel", "everyone")

/**
 * Applies core's list changes, in order, to [rows]. Returns how many rows by others landed at the
 * end of a list that already had rows: the new messages a reader scrolled away has not seen.
 */
fun applyOps(rows: MutableList<MessageRow>, ops: List<ListOp>): Int {
    var arrived = 0
    for (op in ops) {
        when (op) {
            is ListOp.Reset -> {
                rows.clear()
                rows.addAll(op.rows)
            }
            is ListOp.Insert -> {
                val at = op.index.toLong().coerceAtMost(rows.size.toLong()).toInt()
                if (at == rows.size && rows.isNotEmpty()) arrived += op.rows.count { !it.mine }
                rows.addAll(at, op.rows)
            }
            is ListOp.Remove -> {
                val start = op.index.toLong().coerceAtMost(rows.size.toLong()).toInt()
                val end = (start.toLong() + op.count.toLong()).coerceAtMost(rows.size.toLong()).toInt()
                rows.subList(start, end).clear()
            }
            is ListOp.Replace -> op.rows.forEachIndexed { offset, row ->
                val at = op.index.toLong() + offset
                if (at < rows.size) rows[at.toInt()] = row
            }
        }
    }
    return arrived
}

private fun nameOf(user: UserView): String = user.displayName?.takeIf { it.isNotBlank() } ?: user.username

/** "2.1 MB": an attachment's size, for its placeholder line. */
fun sizeText(bytes: Long): String {
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble().coerceAtLeast(0.0)
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return if (unit == 0) "${value.toLong()} B" else String.format(java.util.Locale.ENGLISH, "%.1f %s", value, units[unit])
}

/** A core run as the kit draws it. A link's address is already `check_link`'s (`message_pieces`). */
fun chatPiece(piece: MessagePiece, meId: String?): ChatPiece {
    val style = PieceStyle(piece.style.bold, piece.style.italic, piece.style.strikethrough, piece.style.code)
    val kind = when (val kind = piece.kind) {
        is SegKind.Link -> PieceKind.Link(kind.url)
        is SegKind.UserMention -> PieceKind.Mention(MentionTarget.User(kind.userId), mine = kind.userId == meId)
        is SegKind.SpecialMention -> PieceKind.Mention(MentionTarget.None, mine = kind.kind in EVERYONE)
        is SegKind.ChannelMention -> PieceKind.Mention(MentionTarget.Channel(kind.channelId))
        is SegKind.CommunityMention, is SegKind.AliasMention -> PieceKind.Mention(MentionTarget.None)
        is SegKind.Emoji -> PieceKind.Emoji(kind.name)
        SegKind.CodeBlock -> PieceKind.CodeBlock
        SegKind.Text -> PieceKind.Text
    }
    return ChatPiece(piece.text, kind, style)
}

/** Core's row as the chat screen draws it. */
fun chatMessage(row: MessageRow, meId: String?, rules: ChatRules): ChatMessage {
    val mentionsMe = !row.mine && row.segs.any { seg ->
        when (val kind = seg.kind) {
            is SegKind.UserMention -> kind.userId == meId
            is SegKind.SpecialMention -> kind.kind in EVERYONE
            else -> false
        }
    }
    return ChatMessage(
        key = row.seq,
        id = row.id,
        authorId = row.webhook?.id ?: row.author.id,
        author = row.webhook?.name ?: nameOf(row.author),
        sentAtMs = row.sentAtMs,
        pieces = rules.pieces(row.display, row.segs).map { chatPiece(it, meId) },
        edited = row.edited,
        removed = row.removed,
        state = when (val state = row.sendState) {
            SendState.Sent -> MessageState.Sent
            SendState.Pending -> MessageState.Pending
            is SendState.Failed -> MessageState.Failed(errorText(state.error.code, state.error.message))
        },
        mentionsMe = mentionsMe,
        replyTo = row.replyTo?.let { QuoteItem(nameOf(it.author), it.text, it.deleted) },
        replyCount = row.replyCount.toInt(),
        extras = row.attachments.map { "Attachment: ${it.filename}, ${sizeText(it.sizeBytes.toLong())}" },
    )
}

/**
 * One conversation's list for the chat screen: core's rows, kept current by core's list changes
 * ([apply], from CoreStore's one collector), with the paging, the typing line and "Jump to
 * latest" around them, as one [state]. Commands run on [scope]; every state change is under one
 * lock and ends in one publish, so the screen sees a burst of changes as one frame.
 *
 * Kept while the app runs (CoreStore holds it), so the rows, the scroll position ([listState]) and
 * the reader's place survive leaving the channel and a rotation.
 */
class ConversationStore(
    val conversation: Conversation,
    private val core: SemaphoreCore,
    private val scope: CoroutineScope,
    private val rules: ChatRules = ChatRules.Native,
) {
    /** The list's scroll position, kept here rather than in the composition. */
    val listState = LazyListState()

    private val lock = Any()
    private val rows = ArrayList<MessageRow>()
    private var mapped: List<ChatMessage> = emptyList()
    private val cache = HashMap<Long, Pair<ULong, ChatMessage>>()
    private var face: ChatFace = ChatFace.Loading
    private var opening = false
    private var loadingOlder = false
    private var olderFailed: String? = null
    private var away = false
    private var newCount = 0
    private var connection = ConnectionState.CONNECTED
    private var marked: String? = null
    private var typingCheck: Job? = null
    private val meId: String? by lazy { (core.session() as? SessionState.SignedIn)?.me?.id }

    private val stateFlow = MutableStateFlow(ChatModel())
    val state: StateFlow<ChatModel> = stateFlow

    /** Core's list changes for this conversation. On CoreStore's collector. */
    fun apply(ops: List<ListOp>) = synchronized(lock) {
        val arrived = applyOps(rows, ops)
        if (away) newCount += arrived
        val me = meId
        val seen = HashSet<Long>(rows.size)
        mapped = rows.map { row ->
            seen += row.seq
            val cached = cache[row.seq]
            if (cached != null && cached.first == row.revision) {
                cached.second
            } else {
                chatMessage(row, me, rules).also { cache[row.seq] = row.revision to it }
            }
        }
        cache.keys.retainAll(seen)
        // Rows arriving while the first page loads mean it is there.
        if (face != ChatFace.Ready && rows.isNotEmpty()) face = ChatFace.Ready
        publish()
    }

    /** Re-reads what core keeps beside the rows: the edges, the typing line, the connection. */
    fun refresh(connection: ConnectionState) = synchronized(lock) {
        this.connection = connection
        publish()
    }

    /** Opens the conversation (core sends its rows as a reset), or opens it again on return. */
    fun open() {
        synchronized(lock) {
            if (opening) return
            opening = true
            if (face is ChatFace.Failed) face = ChatFace.Loading
            publish()
        }
        scope.launch {
            val failure = try {
                core.openConversation(conversation)
                null
            } catch (error: CoreException) {
                errorText("", error.message.orEmpty())
            }
            synchronized(lock) {
                opening = false
                face = when {
                    failure == null || rows.isNotEmpty() -> ChatFace.Ready
                    else -> ChatFace.Failed(failure)
                }
                publish()
            }
        }
    }

    /** Older rows, near the top. One page at a time; nothing at the start or after a failure. */
    fun loadOlder() {
        synchronized(lock) {
            if (loadingOlder || face != ChatFace.Ready || core.atHistoryStart(conversation)) return
            loadingOlder = true
            olderFailed = null
            publish()
        }
        scope.launch {
            val failure = try {
                core.loadOlder(conversation)
                null
            } catch (error: CoreException) {
                errorText("", error.message.orEmpty())
            }
            synchronized(lock) {
                loadingOlder = false
                olderFailed = failure
                publish()
            }
        }
    }

    /** Newer rows, near the bottom of a list that moved away from the newest. */
    fun loadNewer() {
        scope.launch { runCatching { core.loadNewer(conversation) } }
    }

    /** "Jump to latest": back to the newest rows, which a list that moved away loads again. */
    fun jump() {
        synchronized(lock) {
            newCount = 0
            publish()
        }
        scope.launch { runCatching { core.jumpToPresent(conversation) } }
    }

    /** The reader scrolled away from the newest row, or back. Back clears the "N new" count. */
    fun setAway(away: Boolean) = synchronized(lock) {
        this.away = away
        if (!away) newCount = 0
        publish()
    }

    /** The newest row is on screen in the foreground: marks it read, once per row. */
    fun markSeen() {
        val newest = synchronized(lock) {
            val id = rows.lastOrNull { it.id != null && it.sendState == SendState.Sent }?.id
            if (id == null || id == marked) return
            marked = id
            id
        }
        scope.launch { runCatching { core.markRead(conversation, newest) } }
    }

    /** Builds the state from what is held and what core says now. Under [lock]. */
    private fun publish() {
        val atLiveEdge = core.atLiveEdge(conversation)
        val typingNames = core.typingUsers(conversation).map(::nameOf)
        stateFlow.value = ChatModel(
            face = face,
            messages = mapped,
            atLiveEdge = atLiveEdge,
            atStart = core.atHistoryStart(conversation),
            loadingOlder = loadingOlder,
            olderFailed = olderFailed,
            typing = if (typingNames.isEmpty()) "" else rules.typing(typingNames),
            jump = if (away || !atLiveEdge) rules.jump(newCount) else null,
            connection = when (connection) {
                ConnectionState.OFFLINE -> ChatConnection.Offline
                ConnectionState.DISCONNECTED -> ChatConnection.Reconnecting
                else -> ChatConnection.Live
            },
        )
        // Core drops a name once its typing goes quiet, without an event: look again soon.
        if (typingNames.isNotEmpty() && typingCheck?.isActive != true) {
            typingCheck = scope.launch {
                delay(TYPING_RECHECK_MS)
                synchronized(lock) {
                    typingCheck = null
                    publish()
                }
            }
        }
    }
}
