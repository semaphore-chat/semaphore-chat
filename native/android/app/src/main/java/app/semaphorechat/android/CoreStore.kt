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
) {
    private val sessionState = MutableStateFlow(core.session())
    private val connectionState = MutableStateFlow(core.connection())
    private val appearanceState = MutableStateFlow(core.appearance().appearance)
    private val communityState = MutableStateFlow(readCommunities())
    private val channelStates = ConcurrentHashMap<String, MutableStateFlow<Load<CommunityChannels>>>()
    private val noticeFlow = MutableSharedFlow<CoreNotice>(extraBufferCapacity = 16)
    private val conversations = ConcurrentHashMap<Conversation, ConversationStore>()

    val session: StateFlow<SessionState> = sessionState
    val connection: StateFlow<ConnectionState> = connectionState
    val appearance: StateFlow<Appearance> = appearanceState
    val communities: StateFlow<Load<List<CommunitySummary>>> = communityState
    val notices: SharedFlow<CoreNotice> = noticeFlow

    /** Core's events and the callers' requests, in one queue: one coroutine reads and writes. */
    private sealed interface Input {
        data class Event(val event: CoreEvent) : Input
        data object Refresh : Input
        data object Retry : Input
    }

    private val inbox = Channel<Input>(Channel.UNLIMITED)

    init {
        scope.launch { for (event in events) inbox.send(Input.Event(event)) }
        scope.launch {
            for (first in inbox) {
                val burst = mutableListOf(first)
                while (true) burst += inbox.tryReceive().getOrNull() ?: break
                apply(burst)
            }
        }
    }

    /** A community's channels, read now and kept current from here on. */
    fun watch(communityId: String): StateFlow<Load<CommunityChannels>> =
        channelStates.getOrPut(communityId) { MutableStateFlow(readChannels(communityId)) }

    /**
     * A conversation's list, kept current by core's list changes from here on. Created before the
     * conversation is opened, so the reset core sends on opening lands in it.
     */
    fun conversation(conversation: Conversation): ConversationStore =
        conversations.getOrPut(conversation) { ConversationStore(conversation, core, scope) }

    /**
     * Re-reads everything: at start, on resume, and after a retry. Asks the collector to, so every
     * core read and every state write is on its one coroutine; returns at once.
     */
    fun refresh() {
        inbox.trySend(Input.Refresh)
    }

    /** Fetches again whatever failed to load, then re-reads (on the collector, like [refresh]). */
    fun retry() {
        inbox.trySend(Input.Retry)
    }

    private fun apply(burst: List<Input>) {
        if (burst.any { it is Input.Retry }) core.retryFailed()
        val events = burst.filterIsInstance<Input.Event>().map { it.event }
        events.forEach { event ->
            when (event) {
                is CoreEvent.CommunityRemoved -> noticeFlow.tryEmit(
                    CoreNotice.CommunityRemoved(event.communityId, removalMessage(event.name, event.cause)),
                )
                is CoreEvent.ChannelRemoved -> noticeFlow.tryEmit(
                    CoreNotice.ChannelRemoved(event.communityId, event.channelId),
                )
                // In order, on this one coroutine: a reset and the inserts after it stay in order.
                is CoreEvent.MessagesChanged -> conversations[event.conversation]?.apply(event.ops)
                else -> Unit
            }
        }
        val session = core.session()
        // A new session starts with no lists: the old one's rows are another account's.
        if (session !is SessionState.SignedIn) conversations.clear()
        sessionState.value = session
        val connection = core.connection()
        connectionState.value = connection
        // The edges, the typing line and the connection line, which change without a list change.
        conversations.values.forEach { it.refresh(connection) }
        appearanceState.value = core.appearance().appearance
        communityState.value = readCommunities()
        // Only some communities' channels changed: re-read those; anything else, all of them.
        val only = events.map { event ->
            ((event as? CoreEvent.ViewChanged)?.view as? ViewKey.Channels)?.communityId
        }
        val everything = events.size < burst.size || only.any { it == null }
        val ids = if (everything) channelStates.keys.toSet() else only.filterNotNull().toSet()
        ids.forEach { id -> channelStates[id]?.let { it.value = readChannels(id) } }
    }

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
