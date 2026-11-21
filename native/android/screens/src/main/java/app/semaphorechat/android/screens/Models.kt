// Semaphore Chat's Android screens. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

/**
 * What the screens draw, as plain Kotlin: the app's CoreStore builds these from core's views,
 * and the stories build them by hand.
 */

/** A list that may not have arrived yet (core's `LoadState` with the value). */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Failed(val message: String) : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
}

/** A server that answered a probe: what sign-in shows about it. */
data class ServerSummary(
    /** The URL as core normalised it. */
    val url: String,
    /** The instance's name, if it has one. */
    val name: String?,
    /** Registration isn't closed: "Create an account" goes to the web. */
    val canRegister: Boolean,
    /** The server sends reset mails: "Forgot password?" goes to the web. */
    val passwordReset: Boolean,
) {
    /** Plain `http://`: passwords and messages cross the network readable. */
    val insecure: Boolean get() = url.startsWith("http://", ignoreCase = true)
}

/** Why the connect screen can't go on to sign-in. */
sealed interface ConnectFailure {
    /** Nothing answered at that address. */
    data object Unreachable : ConnectFailure
    /** The TLS handshake failed: an untrusted certificate, or not TLS at all. */
    data object TlsRefused : ConnectFailure
    /** Something answered, but not a Semaphore server. */
    data object NotSemaphore : ConnectFailure
    /** The server has no users yet: it is set up in a browser first. */
    data class NeedsSetup(val url: String) : ConnectFailure
    /** Not an address at all. */
    data object Invalid : ConnectFailure
    /** The server answered with an error. */
    data class Failed(val message: String) : ConnectFailure
}

/** The connect screen: the address typed, and how the last try went. */
data class ConnectState(
    val url: String = "",
    val probing: Boolean = false,
    val failure: ConnectFailure? = null,
    /**
     * A plain-`http://` server answered: the warning shows and the button continues to sign-in,
     * since a `https://` one goes on by itself.
     */
    val insecure: ServerSummary? = null,
    /** Said above the form: why the session ended ("Your session ended. Sign in again."). */
    val notice: String? = null,
)

/** The sign-in screen. */
data class SignInState(
    val server: ServerSummary,
    val username: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

/** Starting and restoring the session. */
sealed interface StartState {
    data object Starting : StartState
    /** The core itself didn't start. */
    data class StartFailed(val message: String) : StartState
    data class Restoring(val server: String) : StartState
    /** The server didn't answer; the stored session is kept, to try again. */
    data class Unreachable(val server: String, val message: String) : StartState
}

/** A community in the dock and the "All communities" sheet. */
data class CommunitySummary(
    val id: String,
    val name: String,
    val mentions: Int = 0,
    val unread: Boolean = false,
)

/** The leading icon of a text channel row. */
enum class ChannelIcon { Hash, Lock, Megaphone }

data class TextChannelItem(
    val id: String,
    val name: String,
    val icon: ChannelIcon = ChannelIcon.Hash,
    val unread: Boolean = false,
    val mentions: Int = 0,
)

data class PersonItem(val id: String, val name: String, val speaking: Boolean = false)

data class VoiceRoomItem(val id: String, val name: String, val people: List<PersonItem> = emptyList())

/** A community's channels, in the two sections the web's community home shows. */
data class CommunityChannels(val text: List<TextChannelItem>, val voice: List<VoiceRoomItem>)

/** The community home: the community, and its channels as far as they've loaded. */
data class CommunityHomeModel(val community: CommunitySummary, val channels: Load<CommunityChannels>)

/** The second line of a community in the "All communities" sheet (the web's `communitiesModel`). */
fun communityStateLine(community: CommunitySummary): String = when {
    community.mentions == 1 -> "1 mention"
    community.mentions > 1 -> "${community.mentions} mentions"
    community.unread -> "New messages"
    else -> "Quiet"
}
