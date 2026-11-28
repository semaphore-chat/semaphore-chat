// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import app.semaphorechat.android.screens.BlockedKind
import app.semaphorechat.android.screens.ComposerAccess
import app.semaphorechat.android.screens.ComposerModel
import app.semaphorechat.android.screens.MentionSuggestion
import app.semaphorechat.android.screens.SuggestionKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import uniffi.semaphore.ChannelKind
import uniffi.semaphore.ChannelPermissions
import uniffi.semaphore.Conversation
import uniffi.semaphore.CoreException
import uniffi.semaphore.DraftMention
import uniffi.semaphore.MentionCandidate
import uniffi.semaphore.MentionKind
import uniffi.semaphore.MessageDraft
import uniffi.semaphore.SemaphoreCore

/**
 * "Started typing" goes out at most this often while keys arrive: the web's `TYPING_DEBOUNCE_MS`
 * and desktop's `TYPING_EVERY`.
 */
const val TYPING_EVERY_MS = 3_000L

/** How many listed candidates a composer remembers for names typed out in full. */
private const val SEEN_MAX = 500

/** At most this many suggestions are listed; the list shows [ComposerCaps.SUGGESTIONS_SHOWN] then scrolls. */
const val SUGGESTIONS_MAX = 25

// ---- The composer's text rules, in UTF-16 units (Kotlin's), with the byte offsets core wants. ----

/** A mention being typed: `@sa` or `#de` with the caret at its end. [start] is at the `@` or `#`. */
data class TypedMention(val trigger: Char, val query: String, val start: Int, val end: Int)

/** `[\w-]` as the web's `\w` is: ASCII only, so any other character ends a name. */
private fun isNameChar(c: Char): Boolean =
    c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '_' || c == '-'

/**
 * The mention the caret at [cursor] is at the end of (core's `get_current_mention`, the web's
 * `getCurrentMention`): back from the caret over name characters to an `@` or `#`.
 */
fun currentMention(text: String, cursor: Int): TypedMention? {
    if (cursor < 0 || cursor > text.length) return null
    var start = cursor
    while (start > 0) {
        val c = text[start - 1]
        when {
            c == '@' || c == '#' -> return TypedMention(c, text.substring(start, cursor), start - 1, cursor)
            isNameChar(c) -> start--
            else -> return null
        }
    }
    return null
}

/**
 * Replaces the mention being typed at [cursor] with [insertText] and a space (core's
 * `insert_mention`), or inserts them at the caret. Returns the text and the caret after the space.
 */
fun insertMention(text: String, cursor: Int, insertText: String): Pair<String, Int> {
    val at = cursor.coerceIn(0, text.length)
    // Never between the halves of a surrogate pair.
    val caret = if (at in 1 until text.length && text[at - 1].isHighSurrogate() && text[at].isLowSurrogate()) at - 1 else at
    val insert = (if (insertText.startsWith('@') || insertText.startsWith('#')) insertText else "@$insertText") + " "
    val typed = currentMention(text, caret)
    val from = typed?.start ?: caret
    val to = typed?.end ?: caret
    return (text.substring(0, from) + insert + text.substring(to)) to from + insert.length
}

/**
 * [text] with every unpaired surrogate replaced by U+FFFD. The FFI's encoder refuses malformed
 * UTF-16 (it throws), and a keyboard that deletes half an emoji, or a paste cut mid-pair, can leave
 * one, so anything sent goes through this first.
 */
fun wellFormed(text: String): String {
    if (text.none { it.isSurrogate() }) return text
    val out = StringBuilder(text.length)
    var i = 0
    while (i < text.length) {
        val c = text[i]
        when {
            c.isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate() -> {
                out.append(c).append(text[i + 1])
                i += 2
                continue
            }
            c.isSurrogate() -> out.append('\uFFFD')
            else -> out.append(c)
        }
        i++
    }
    return out.toString()
}

/**
 * How many UTF-8 bytes the first [index] UTF-16 units of [text] are, as core counts them: a
 * surrogate pair is 4 bytes. [text] is [wellFormed] (a lone surrogate counts 3, as the U+FFFD it
 * becomes). An [index] between a pair's halves counts up to the pair.
 */
fun utf8Offset(text: String, index: Int): Int {
    val end = index.coerceIn(0, text.length)
    var bytes = 0
    var i = 0
    while (i < end) {
        val c = text[i]
        when {
            c.isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate() -> {
                if (i + 1 >= end) return bytes
                bytes += 4
                i += 2
                continue
            }
            c.code < 0x80 -> bytes += 1
            c.code < 0x800 -> bytes += 2
            else -> bytes += 3
        }
        i++
    }
    return bytes
}

/** A mention found in outgoing text: UTF-16 [start] and [end], and what it names. */
data class FoundMention(val start: Int, val end: Int, val suggestion: MentionSuggestion)

/**
 * The mentions in [text] (desktop's `resolve_mentions`): at each `@` or `#` that starts a token,
 * the longest picked insert text that is there whole, or else the token typed out in full if
 * [lookup] knows it (a member's `@username`, a `#channel`). Text changed after picking simply no
 * longer matches, so ranges aren't tracked through edits.
 */
fun findMentions(
    text: String,
    picked: List<MentionSuggestion>,
    lookup: (String) -> MentionSuggestion? = { null },
): List<FoundMention> {
    val found = mutableListOf<FoundMention>()
    var at = 0
    while (at < text.length) {
        val c = text[at]
        val starts = (c == '@' || c == '#') && (at == 0 || !(isNameChar(text[at - 1]) || text[at - 1] == '.'))
        if (!starts) {
            at++
            continue
        }
        val pick = picked
            .filter { text.startsWith(it.insertText, at) && text.getOrNull(at + it.insertText.length)?.let(::isNameChar) != true }
            .maxByOrNull { it.insertText.length }
        var end = at + 1
        while (end < text.length && isNameChar(text[end])) end++
        val typed = if (pick == null && end > at + 1) lookup(text.substring(at, end))?.takeIf { it.insertText == text.substring(at, end) } else null
        val mention = pick ?: typed
        if (mention != null) {
            found += FoundMention(at, at + mention.insertText.length, mention)
            at += mention.insertText.length
        } else {
            at = end
        }
    }
    return found
}

/** The mentions of [text] as core takes them: byte ranges into the UTF-8 text. */
fun draftMentions(
    text: String,
    picked: List<MentionSuggestion>,
    lookup: (String) -> MentionSuggestion? = { null },
): List<DraftMention> =
    findMentions(text, picked, lookup).map { found ->
        DraftMention(
            start = utf8Offset(text, found.start).toUInt(),
            end = utf8Offset(text, found.end).toUInt(),
            kind = when (found.suggestion.kind) {
                SuggestionKind.User -> MentionKind.USER
                SuggestionKind.Special -> MentionKind.SPECIAL
                SuggestionKind.Alias -> MentionKind.ALIAS
                SuggestionKind.Channel -> MentionKind.CHANNEL
                SuggestionKind.Community -> MentionKind.COMMUNITY
                SuggestionKind.Emoji -> MentionKind.EMOJI
            },
            id = found.suggestion.id,
        )
    }

fun suggestionOf(candidate: MentionCandidate) = MentionSuggestion(
    kind = when (candidate.kind) {
        MentionKind.USER -> SuggestionKind.User
        MentionKind.SPECIAL -> SuggestionKind.Special
        MentionKind.ALIAS -> SuggestionKind.Alias
        MentionKind.CHANNEL -> SuggestionKind.Channel
        MentionKind.COMMUNITY -> SuggestionKind.Community
        MentionKind.EMOJI -> SuggestionKind.Emoji
    },
    id = candidate.id,
    label = candidate.label,
    insertText = candidate.insertText,
)

/** `formatTimeLeft`: "42 s", "12 min", "2 h 5 min". Rounded up, so it never reads "0". */
fun timeLeftText(leftMs: Long): String {
    val seconds = ((leftMs.coerceAtLeast(0) + 999) / 1000).coerceAtLeast(1)
    if (seconds < 60) return "$seconds s"
    val minutes = (seconds + 59) / 60
    if (minutes < 60) return "$minutes min"
    val hours = minutes / 60
    val rest = minutes % 60
    return if (rest == 0L) "$hours h" else "$hours h $rest min"
}

/** "Moderator, Admin and Owner". */
fun roleList(roles: List<String>): String = when (roles.size) {
    0 -> ""
    1 -> roles[0]
    else -> roles.dropLast(1).joinToString(", ") + " and " + roles.last()
}

/**
 * Whether the reader may post here (desktop's `availability_for`, the web's
 * `useComposerAvailability`): a timeout still running wins, then no post permission (read-only
 * when some roles can post). Permissions not known yet leave the composer open.
 */
fun composerAccess(permissions: ChannelPermissions?, channelName: String, nowMs: Long): ComposerAccess {
    permissions ?: return ComposerAccess.Open
    val until = permissions.timedOutUntilMs
    if (until != null && until > nowMs) {
        return ComposerAccess.Blocked("Timed out, ${timeLeftText(until - nowMs)} left", BlockedKind.TimedOut)
    }
    if (!permissions.post) {
        val where = if (channelName.isEmpty()) "this channel" else "#$channelName"
        return if (permissions.postingRoleNames.isEmpty()) {
            ComposerAccess.Blocked("You can't send messages in $where", BlockedKind.NoPermission)
        } else {
            val subject = if (channelName.isEmpty()) "This channel" else "#$channelName"
            ComposerAccess.Blocked("$subject is read-only. Only ${roleList(permissions.postingRoleNames)} can post.", BlockedKind.ReadOnly)
        }
    }
    return ComposerAccess.Open
}

/**
 * One channel's composer: its unsent draft (kept in memory while the app runs, per channel), the
 * mention suggestions for what is being typed, typing signals out, and sending. CoreStore holds
 * one per conversation and calls [refresh] from its collector after each burst of core's events,
 * and [mentionablesChanged] when core says the community's mention candidates changed.
 */
class ComposerStore(
    val conversation: Conversation,
    private val communityId: String,
    private val channelId: String,
    private val core: SemaphoreCore,
    private val scope: CoroutineScope,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    /** The field's text and caret. Compose state, so the field it drives stays in step as keys arrive. */
    var draft by mutableStateOf(TextFieldValue())
        private set

    private val lock = Any()
    private val picked = mutableListOf<MentionSuggestion>()
    private var query: String? = null
    private var access: ComposerAccess = ComposerAccess.Open
    private var lastStartedMs: Long? = null
    private var tick: Job? = null
    /** On screen with the app resumed: only then does a timeout count down. */
    private var shown = false
    private var closed = false
    /**
     * Every candidate listed while typing, by its insert text: a name typed out in full and sent at
     * once is still known when core's search for that exact name hasn't come back yet.
     */
    private val seen = LinkedHashMap<String, MentionSuggestion>()
    private val stateFlow = MutableStateFlow(ComposerModel())
    val state: StateFlow<ComposerModel> = stateFlow

    /** Typing signals, sent one after another in the order they were made. */
    private val typingOut = Channel<Boolean>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (started in typingOut) {
                try {
                    core.sendTyping(conversation, started)
                } catch (_: CoreException) {
                    // Offline: the signal would be stale by the time the socket is back.
                }
            }
        }
        refresh()
    }

    /** The field changed: the text (a typing signal), the caret (the mention typed at it), or both. */
    fun onDraftChange(value: TextFieldValue) {
        val textChanged = value.text != draft.text
        draft = value
        if (textChanged) typed(value.text)
        synchronized(lock) {
            query = if (value.selection.collapsed) {
                currentMention(value.text, value.selection.end)?.let { value.text.substring(it.start, it.end) }
            } else {
                null
            }
            publish()
        }
    }

    private fun typed(text: String) {
        if (text.isEmpty()) {
            stopTyping()
            return
        }
        val now = nowMs()
        val last = lastStartedMs
        if (last == null || now - last >= TYPING_EVERY_MS) {
            lastStartedMs = now
            typingOut.trySend(true)
        }
    }

    private fun stopTyping() {
        if (lastStartedMs == null) return
        lastStartedMs = null
        typingOut.trySend(false)
    }

    /** A suggestion was tapped: its text replaces the mention typed, and it is recorded for sending. */
    fun pick(suggestion: MentionSuggestion) {
        val (text, caret) = insertMention(draft.text, draft.selection.end, suggestion.insertText)
        synchronized(lock) {
            if (picked.none { it == suggestion }) picked += suggestion
        }
        onDraftChange(TextFieldValue(text, TextRange(caret)))
    }

    /** A token typed out in full (`@sam`, `#design`): what core or the list while typing knows it as. */
    private fun lookup(token: String): MentionSuggestion? =
        core.mentionCandidates(communityId, token).firstOrNull { it.insertText == token }?.let(::suggestionOf)
            ?: synchronized(lock) { seen[token] }
            // A #channel: the community's text channels are loaded already, mentionables or not.
            ?: token.takeIf { it.startsWith('#') }?.let { name ->
                core.channels(communityId).firstOrNull { it.kind == ChannelKind.TEXT && "#${it.name}" == name }
                    ?.let { MentionSuggestion(SuggestionKind.Channel, it.id, it.name, name) }
            }

    /**
     * Sends the draft, trimmed, as the web and desktop do: the field clears at once, and the pending
     * row carries the text from then on. From history the list goes back to the newest first. Core
     * sends nothing unless that row shows (`send_message_with_row`), so if it can't (the list isn't
     * loaded, the jump failed) or anything else goes wrong, the text and its mentions come back.
     */
    fun send() {
        val raw = draft.text
        val text = wellFormed(raw).trim()
        if (text.isEmpty()) return
        val picks = synchronized(lock) { picked.toList().also { picked.clear() } }
        stopTyping()
        onDraftChange(TextFieldValue())
        scope.launch {
            try {
                val mentions = draftMentions(text, picks, ::lookup)
                if (!core.atLiveEdge(conversation)) core.jumpToPresent(conversation)
                core.sendMessageWithRow(conversation, MessageDraft(text, mentions, null, emptyList()))
            } catch (cancelled: CancellationException) {
                restore(raw, picks)
                throw cancelled
            } catch (_: Exception) {
                // Not only CoreException: nothing that goes wrong here may end the process or the text.
                restore(raw, picks)
            }
        }
    }

    /** Puts an unsent draft back: alone if the field is still empty, else before what was typed since. */
    private fun restore(text: String, picks: List<MentionSuggestion>) {
        synchronized(lock) { picks.filter { it !in picked }.forEach { picked += it } }
        // Snapshot state may be written from any thread; the field picks it up next frame.
        val now = draft.text
        val back = if (now.isEmpty()) text else "$text\n$now"
        draft = TextFieldValue(back, TextRange(back.length))
    }

    /** On screen with the app resumed, or not: a timeout's countdown runs only while shown. */
    fun setShown(shown: Boolean) {
        synchronized(lock) { this.shown = shown }
        if (shown) refresh() else synchronized(lock) { tick?.cancel(); tick = null }
    }

    /** A timeout's countdown is running (for the tests). */
    val countingDown: Boolean get() = synchronized(lock) { tick?.isActive == true }

    /** The session ended: stop the typing sender and the countdown. */
    fun close(): Unit = synchronized(lock) {
        closed = true
        tick?.cancel()
        tick = null
        typingOut.close()
        Unit
    }

    /** Re-reads who may post (on CoreStore's collector, after each burst). */
    fun refresh(): Unit = synchronized(lock) {
        val channel = core.channels(communityId).firstOrNull { it.id == channelId }
        val now = composerAccess(channel?.permissions, channel?.name.orEmpty(), nowMs())
        // Only a change re-reads the suggestions: reading them can itself make core send events.
        if (now != access || stateFlow.value.access != now) {
            access = now
            publish()
        }
        // A timeout counts down while shown: read again each second until it is over.
        val timedOut = (access as? ComposerAccess.Blocked)?.kind == BlockedKind.TimedOut
        if (timedOut && shown && !closed && tick?.isActive != true) {
            tick = scope.launch {
                delay(1_000)
                synchronized(lock) { tick = null }
                refresh()
            }
        }
    }

    /** Core's mention candidates for the community changed (members found, channels loaded). */
    fun mentionablesChanged(): Unit = synchronized(lock) { publish() }

    /** Under [lock]. */
    private fun publish() {
        val typed = query
        val suggestions = if (typed != null && access == ComposerAccess.Open) {
            core.mentionCandidates(communityId, typed).take(SUGGESTIONS_MAX).map(::suggestionOf).onEach {
                seen[it.insertText] = it
                if (seen.size > SEEN_MAX) seen.remove(seen.keys.first())
            }
        } else {
            emptyList()
        }
        stateFlow.value = ComposerModel(access, suggestions)
    }

    /** The community this composer's channel is in (for routing core's mentionables changes). */
    val community: String get() = communityId
}
