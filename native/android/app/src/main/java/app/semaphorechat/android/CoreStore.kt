// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import app.semaphorechat.android.screens.ChannelIcon
import app.semaphorechat.android.screens.CommunityChannels
import app.semaphorechat.android.screens.CommunitySummary
import app.semaphorechat.android.screens.Load
import app.semaphorechat.android.screens.PersonItem
import app.semaphorechat.android.screens.TextChannelItem
import app.semaphorechat.android.screens.errorText
import app.semaphorechat.android.screens.VoiceRoomItem
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import uniffi.semaphore.Appearance
import uniffi.semaphore.ChannelKind
import uniffi.semaphore.ChannelPreset
import uniffi.semaphore.ChannelRow
import uniffi.semaphore.CommunityRow
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.Conversation
import uniffi.semaphore.CoreEvent
import uniffi.semaphore.CoreListener
import uniffi.semaphore.LoadState
import uniffi.semaphore.NotificationKind
import uniffi.semaphore.RemovalCause
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.SessionState
import uniffi.semaphore.ViewKey

/**
 * Core's events, handed on and nothing else: core calls [onEvent] on whatever thread changed its
 * state (a Tokio worker, often while it holds its own locks), so this never calls back into core
 * and never blocks. The channel is unbounded, so [trySend] only fails once it is closed.
 */
class EventPipe : CoreListener {
    private val channel = Channel<CoreEvent>(Channel.UNLIMITED)
    val events: ReceiveChannel<CoreEvent> = channel

    override fun onEvent(event: CoreEvent) {
        channel.trySend(event)
    }

    fun close() {
        channel.close()
    }
}

/** How many conversations' lists CoreStore keeps: core keeps 8 idle windows. */
const val KEPT_CONVERSATIONS = 8

/** Something to say once, from a core event: a community or a channel went away. */
sealed interface CoreNotice {
    data class CommunityRemoved(val communityId: String, val message: String) : CoreNotice
    data class ChannelRemoved(val communityId: String, val channelId: String) : CoreNotice
}

/**
 * Core's views as Kotlin state for Compose. One collector, on [scope], drains each burst of
 * events (and of [refresh] and [retry] requests) and then re-reads core's views: the session, the connection, the appearance and the
 * communities every time, and the channels of each community a screen [watch]es (all of them
 * unless the burst only touched some communities' channels). Core's reads are in-memory, and a
 * `MutableStateFlow` drops a value equal to the last, so a re-read that changes nothing redraws
 * nothing.
 */
class CoreStore(
    private val core: SemaphoreCore,
    private val scope: CoroutineScope,
    events: ReceiveChannel<CoreEvent>,
    /** Where core's notifications are shown and withdrawn (AndroidNotifier in the app). */
    private val notifier: Notifier = Notifier.None,
    /** A session ended: what the app keeps for it besides the lists (pictures, opened files) goes too. */
    private val onSessionEnded: () -> Unit = {},
) {
    private val sessionState = MutableStateFlow(core.session())
    private val connectionState = MutableStateFlow(core.connection())
    private val appearanceState = MutableStateFlow(core.appearance().appearance)
    private val communityState = MutableStateFlow(readCommunities())
    private val channelStates = ConcurrentHashMap<String, MutableStateFlow<Load<CommunityChannels>>>()
    private val noticeFlow = MutableSharedFlow<CoreNotice>(extraBufferCapacity = 16)
    /**
     * The lists, the most recently opened last, at most [KEPT_CONVERSATIONS]: core forgets idle
     * windows past 8 too, and a list opened again starts from core's reset. Guarded by itself.
     */
    private val conversations = object : LinkedHashMap<Conversation, ConversationStore>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Conversation, ConversationStore>) =
            size > KEPT_CONVERSATIONS
    }

    /**
     * Each channel's composer, with its unsent draft: kept while the session lasts (not bounded
     * like the lists, so no draft is lost by visiting other channels). Guarded by itself.
     */
    private val composers = HashMap<Conversation, ComposerStore>()

    val session: StateFlow<SessionState> = sessionState
    val connection: StateFlow<ConnectionState> = connectionState
    val appearance: StateFlow<Appearance> = appearanceState
    val communities: StateFlow<Load<List<CommunitySummary>>> = communityState
    val notices: SharedFlow<CoreNotice> = noticeFlow

    /** Core's events and the callers' requests: one coroutine reads and writes. */
    private sealed interface Input {
        data class Event(val event: CoreEvent) : Input
        data object Refresh : Input
        data object Retry : Input
        /** Work that must see every event core sent before it was asked for (see [onCollector]). */
        data class Run(val block: () -> Unit) : Input
    }

    private val requests = Channel<Input>(Channel.UNLIMITED)

    init {
        scope.launch {
            while (true) {
                // Events first whenever both are waiting: a request made after core sent an event
                // (a command that returned) then always runs after that event is applied.
                val first = select<Input?> {
                    events.onReceiveCatching { it.getOrNull()?.let(Input::Event) }
                    requests.onReceive { it }
                } ?: break
                val burst = mutableListOf(first)
                while (true) {
                    burst += events.tryReceive().getOrNull()?.let(Input::Event)
                        ?: requests.tryReceive().getOrNull()
                        ?: break
                }
                apply(burst)
            }
        }
    }

    /**
     * Runs [block] on the collector, after every event core has sent so far. A command's result
     * is applied this way: core sends a command's list changes before the command returns, so the
     * state built after it holds them (and core's flags, read then, agree with the rows).
     */
    private fun onCollector(block: () -> Unit) {
        requests.trySend(Input.Run(block))
    }

    /** A community's channels, read now and kept current from here on. */
    fun watch(communityId: String): StateFlow<Load<CommunityChannels>> =
        channelStates.getOrPut(communityId) { MutableStateFlow(readChannels(communityId)) }

    /**
     * A conversation's list, kept current by core's list changes from here on. Created before the
     * conversation is opened, so the reset core sends on opening lands in it.
     */
    fun conversation(conversation: Conversation): ConversationStore = synchronized(conversations) {
        conversations.getOrPut(conversation) { ConversationStore(conversation, core, scope, onCollector = ::onCollector) }
    }

    /** A channel's composer, with the draft left in it. */
    fun composer(communityId: String, channelId: String): ComposerStore {
        val conversation = Conversation.Channel(channelId)
        return synchronized(composers) {
            composers.getOrPut(conversation) { ComposerStore(conversation, communityId, channelId, core, scope) }
        }
    }

    /** How many lists are kept now (for the tests). */
    val keptConversations: Int get() = synchronized(conversations) { conversations.size }

    /**
     * Re-reads everything: at start, on resume, and after a retry. Asks the collector to, so every
     * core read and every state write is on its one coroutine; returns at once.
     */
    fun refresh() {
        requests.trySend(Input.Refresh)
    }

    /** Fetches again whatever failed to load, then re-reads (on the collector, like [refresh]). */
    fun retry() {
        requests.trySend(Input.Retry)
    }

    private fun apply(burst: List<Input>) {
        if (burst.any { it is Input.Retry }) core.retryFailed()
        val events = burst.filterIsInstance<Input.Event>().map { it.event }
        // In order: events and the work queued behind them.
        burst.forEach { input ->
            if (input is Input.Run) {
                input.block()
                return@forEach
            }
            val event = (input as? Input.Event)?.event ?: return@forEach
            when (event) {
                is CoreEvent.CommunityRemoved -> noticeFlow.tryEmit(
                    CoreNotice.CommunityRemoved(event.communityId, removalMessage(event.name, event.cause)),
                )
                is CoreEvent.ChannelRemoved -> noticeFlow.tryEmit(
                    CoreNotice.ChannelRemoved(event.communityId, event.channelId),
                )
                // In order, on this one coroutine: a reset and the inserts after it stay in order.
                is CoreEvent.MessagesChanged ->
                    synchronized(conversations) { conversations.entries.firstOrNull { it.key == event.conversation }?.value }
                        ?.apply(event.ops)
                // Core decided it is due (notify.rs::decide); the kind is its own when its list has
                // the row (primed below at sign-in), else the plan infers it.
                is CoreEvent.Notify -> notifier.show(event.notification, knownKind(event.notification.id))
                is CoreEvent.WithdrawNotifications -> notifier.withdraw(event.tag)
                else -> Unit
            }
        }
        val session = core.session()
        // A new session starts with no lists: the old one's rows are another account's.
        if (session !is SessionState.SignedIn) {
            primed = false
            if (sessionState.value is SessionState.SignedIn) {
                notifier.clearAll()
                onSessionEnded()
            }
            synchronized(conversations) { conversations.clear() }
            synchronized(composers) { composers.values.toList().also { composers.clear() } }.forEach { it.close() }
        }
        // Core's notification list, loaded once a session: a new notification's row lands in it
        // before core raises it, which is how [knownKind] tells a mention from a channel message.
        if (session is SessionState.SignedIn && !primed) {
            primed = true
            core.notifications()
        }
        sessionState.value = session
        val connection = core.connection()
        connectionState.value = connection
        // The edges, the typing line and the connection line, which change without a list change.
        synchronized(conversations) { conversations.values.toList() }.forEach { it.refresh(connection) }
        // Who may post (channel permissions, a timeout), and the mention candidates that changed.
        val composers = synchronized(composers) { composers.values.toList() }
        composers.forEach { it.refresh() }
        val mentionables = events.mapNotNull { ((it as? CoreEvent.ViewChanged)?.view as? ViewKey.Mentionables)?.communityId }.toSet()
        composers.filter { it.community in mentionables }.forEach { it.mentionablesChanged() }
        appearanceState.value = core.appearance().appearance
        communityState.value = readCommunities()
        // Only some communities' channels changed: re-read those; anything else, all of them.
        val only = events.map { event ->
            ((event as? CoreEvent.ViewChanged)?.view as? ViewKey.Channels)?.communityId
        }
        val everything = burst.any { it is Input.Refresh || it is Input.Retry } || only.any { it == null }
        val ids = if (everything) channelStates.keys.toSet() else only.filterNotNull().toSet()
        ids.forEach { id -> channelStates[id]?.let { it.value = readChannels(id) } }
    }

    /** Whether this session's notification list was asked for (only on the collector). */
    private var primed = false

    private fun knownKind(id: String): NotificationKind? = core.notifications().rows.firstOrNull { it.id == id }?.kind

    private fun readCommunities(): Load<List<CommunitySummary>> {
        if (core.session() !is SessionState.SignedIn) return Load.Loading
        val rows = core.communities()
        return when (val state = core.loadState(ViewKey.Communities)) {
            is LoadState.Failed -> if (rows.isEmpty()) Load.Failed(errorText(state.error.code, state.error.message)) else Load.Ready(rows.map(::summary))
            LoadState.Loading -> if (rows.isEmpty()) Load.Loading else Load.Ready(rows.map(::summary))
            LoadState.Ready -> Load.Ready(rows.map(::summary))
        }
    }

    private fun readChannels(communityId: String): Load<CommunityChannels> {
        if (core.session() !is SessionState.SignedIn) return Load.Loading
        val rows = core.channels(communityId)
        return when (val state = core.loadState(ViewKey.Channels(communityId))) {
            is LoadState.Failed -> if (rows.isEmpty()) Load.Failed(errorText(state.error.code, state.error.message)) else Load.Ready(channelsOf(rows))
            LoadState.Loading -> if (rows.isEmpty()) Load.Loading else Load.Ready(channelsOf(rows))
            LoadState.Ready -> Load.Ready(channelsOf(rows))
        }
    }

    companion object {
        fun summary(row: CommunityRow) = CommunitySummary(
            id = row.id,
            name = row.name,
            mentions = row.mentionCount.toInt(),
            unread = row.unreadCount > 0u,
        )

        /** Text channels, then voice rooms, each in core's order (by position). */
        fun channelsOf(rows: List<ChannelRow>): CommunityChannels = CommunityChannels(
            text = rows.filter { it.kind == ChannelKind.TEXT }.map { row ->
                TextChannelItem(
                    id = row.id,
                    name = row.name,
                    icon = when {
                        row.preset == ChannelPreset.ANNOUNCEMENT -> ChannelIcon.Megaphone
                        row.isPrivate -> ChannelIcon.Lock
                        else -> ChannelIcon.Hash
                    },
                    unread = row.unreadCount > 0u,
                    mentions = row.mentionCount.toInt(),
                )
            },
            voice = rows.filter { it.kind == ChannelKind.VOICE }.map { row ->
                VoiceRoomItem(
                    id = row.id,
                    name = row.name,
                    people = row.voiceUsers.map { PersonItem(it.id, it.displayName ?: it.username) },
                )
            },
        )

        /** "You were removed from Lumen Studio", as core's event asks a UI to say. */
        fun removalMessage(name: String, cause: RemovalCause): String {
            val community = name.ifBlank { "a community" }
            return when (cause) {
                is RemovalCause.Banned -> "You were banned from $community."
                is RemovalCause.Deleted -> if (name.isBlank()) "A community you were in was deleted." else "$name was deleted."
                else -> "You were removed from $community."
            }
        }
    }
}
