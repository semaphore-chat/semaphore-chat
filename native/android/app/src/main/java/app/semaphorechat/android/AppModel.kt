// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import app.semaphorechat.android.screens.CommunitySummary
import app.semaphorechat.android.screens.ConnectFailure
import app.semaphorechat.android.screens.ConnectState
import app.semaphorechat.android.screens.Load
import app.semaphorechat.android.screens.Navigator
import app.semaphorechat.android.screens.Route
import app.semaphorechat.android.screens.ServerSummary
import app.semaphorechat.android.screens.SignInState
import app.semaphorechat.android.screens.StartState
import app.semaphorechat.android.screens.errorText
import java.net.URI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.semaphore.Conversation
import uniffi.semaphore.CoreException
import uniffi.semaphore.MessageLink
import uniffi.semaphore.ProbeOutcome
import uniffi.semaphore.RegistrationMode
import uniffi.semaphore.RestoreOutcome
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.ServerInfo
import uniffi.semaphore.SessionState

/** The last community opened on each server, so a cold start opens it again (as Discord does). */
interface LastCommunity {
    fun get(server: String): String?
    fun set(server: String, communityId: String)
}

/** The notice a refused or ended session leaves on the sign-in screen. */
const val SESSION_ENDED = "Your session ended. Sign in again."

/**
 * Tells the model when the device gets a network, for as long as the handle it returns is open.
 * The platform part is thin (a `ConnectivityManager` callback); the model's logic stays JVM-testable.
 */
fun interface NetworkWatch {
    fun watch(onAvailable: () -> Unit): AutoCloseable

    companion object {
        val None = NetworkWatch { AutoCloseable { } }
    }
}

/** A burst of "network available" callbacks gives one retry, this long after the last. */
const val NETWORK_RETRY_DEBOUNCE_MS = 750L

/**
 * The app's state between core and the screens: which screen ([navigator]), the signed-out
 * screens' forms, and the Lounge's sheet. Core's session decides the top of the stack: signing in
 * opens the Lounge, losing the session goes back to sign-in. Plain Kotlin over [store], so the JVM
 * test drives it against the fake server without Android.
 */
class AppModel(
    private val core: SemaphoreCore,
    val store: CoreStore,
    private val scope: CoroutineScope,
    private val lastCommunity: LastCommunity,
    /** The server the last session was on (semaphore-mobile remembers it), or null. */
    private val lastServer: String?,
    private val networks: NetworkWatch = NetworkWatch.None,
    private val networkDebounceMs: Long = NETWORK_RETRY_DEBOUNCE_MS,
) {
    val navigator = Navigator(Route.Start)

    private val startState = MutableStateFlow<StartState>(StartState.Starting)
    private val connectState = MutableStateFlow(ConnectState(url = lastServer.orEmpty()))
    private val signInState = MutableStateFlow<SignInState?>(null)
    private val allOpenState = MutableStateFlow(false)
    private val sheetQueryState = MutableStateFlow("")

    val start: StateFlow<StartState> = startState
    val connect: StateFlow<ConnectState> = connectState
    val signIn: StateFlow<SignInState?> = signInState
    val allOpen: StateFlow<Boolean> = allOpenState
    val sheetQuery: StateFlow<String> = sheetQueryState

    /** The server signed in to, while signed in. */
    @Volatile
    var server: String? = null
        private set

    private var wasSignedIn = false

    /** Guards [wasSignedIn] against [pendingLink], so a tap made while signing in is opened once. */
    private val linkLock = Any()

    /** A notification tapped before the session was signed in: opened once it is. */
    private var pendingLink: MessageLink? = null

    private val networkLock = Any()
    private var networkHandle: AutoCloseable? = null
    private var networkRetry: Job? = null

    init {
        // While the restore can't reach the server, a returning network retries it.
        scope.launch { startState.collect { watchNetwork(it is StartState.Unreachable) } }
        scope.launch { store.session.collect(::onSession) }
        scope.launch { store.communities.collect(::onCommunities) }
        scope.launch {
            store.notices.collect { notice ->
                if (notice is CoreNotice.ChannelRemoved) {
                    val top = navigator.top
                    if (top is Route.Channel && top.channelId == notice.channelId) navigator.pop()
                }
            }
        }
        if (lastServer == null) {
            navigator.reset(Route.Connect)
        } else {
            restore(lastServer)
        }
    }

    // ----- start ---------------------------------------------------------------------------

    private fun restore(server: String) {
        startState.value = StartState.Restoring(server)
        navigator.reset(Route.Start)
        scope.launch {
            val outcome = try {
                core.restoreSession(server)
            } catch (failure: CoreException) {
                RestoreOutcome.Unreachable(uniffi.semaphore.ErrorView("", failure.message.orEmpty(), true, null))
            }
            when (outcome) {
                RestoreOutcome.SignedIn -> Unit // onSession opens the Lounge.
                RestoreOutcome.NoSession -> toConnect(server, notice = null)
                RestoreOutcome.Refused -> refused(server)
                is RestoreOutcome.Unreachable -> startState.value = StartState.Unreachable(
                    server,
                    outcome.error.code,
                    errorText(outcome.error.code, outcome.error.message),
                )
            }
        }
    }

    /** The stored session was refused: sign in again on the same server, saying why. */
    private suspend fun refused(server: String) {
        val info = (runCatching { core.probeServer(server) }.getOrNull() as? ProbeOutcome.Ok)?.info
        if (info == null || info.needsSetup) {
            toConnect(server, SESSION_ENDED)
        } else {
            toSignIn(summaryOf(info), SESSION_ENDED)
        }
    }

    fun retryRestore() {
        lastServer?.let(::restore)
    }

    private fun watchNetwork(on: Boolean) = synchronized(networkLock) {
        if (on) {
            if (networkHandle == null) networkHandle = networks.watch(::onNetworkAvailable)
        } else {
            networkHandle?.close()
            networkHandle = null
            networkRetry?.cancel()
            networkRetry = null
        }
    }

    private fun onNetworkAvailable() = synchronized(networkLock) {
        networkRetry?.cancel()
        networkRetry = scope.launch {
            delay(networkDebounceMs)
            if (startState.value is StartState.Unreachable) retryRestore()
        }
    }

    fun useAnotherServer() = toConnect(lastServer.orEmpty(), notice = null)

    private fun toConnect(url: String, notice: String?) {
        connectState.value = ConnectState(url = url, notice = notice)
        signInState.value = null
        startState.value = StartState.Starting
        navigator.reset(Route.Connect)
    }

    // ----- connect -------------------------------------------------------------------------

    fun onUrlChange(url: String) {
        connectState.update { it.copy(url = url, failure = null, insecure = null) }
    }

    fun connect() {
        val typed = connectState.value.url
        val url = normaliseServerUrl(typed)
        if (url == null) {
            connectState.update { it.copy(failure = ConnectFailure.Invalid) }
            return
        }
        connectState.update { it.copy(probing = true, failure = null, insecure = null) }
        scope.launch {
            val outcome = try {
                core.probeServer(url)
            } catch (failure: CoreException) {
                ProbeOutcome.Failed(uniffi.semaphore.ErrorView("", failure.message.orEmpty(), false, null))
            }
            // The address changed while the probe ran: this answer is for another one.
            if (connectState.value.url != typed) return@launch
            when (outcome) {
                is ProbeOutcome.Ok -> {
                    val info = outcome.info
                    val summary = summaryOf(info)
                    when {
                        info.needsSetup -> connectState.update {
                            it.copy(probing = false, failure = ConnectFailure.NeedsSetup(info.url))
                        }
                        summary.insecure -> connectState.update { it.copy(probing = false, insecure = summary) }
                        else -> {
                            connectState.update { it.copy(probing = false) }
                            toSignIn(summary, notice = null)
                        }
                    }
                }
                is ProbeOutcome.Unreachable -> fail(ConnectFailure.Unreachable)
                is ProbeOutcome.TlsRefused -> fail(ConnectFailure.TlsRefused)
                ProbeOutcome.NotSemaphore -> fail(ConnectFailure.NotSemaphore)
                is ProbeOutcome.Failed -> fail(ConnectFailure.Failed(errorText(outcome.error.code, outcome.error.message)))
            }
        }
    }

    private fun fail(failure: ConnectFailure) {
        connectState.update { it.copy(probing = false, failure = failure) }
    }

    /** Continue past the plain-`http://` warning. */
    fun continueInsecure() {
        connectState.value.insecure?.let { toSignIn(it, notice = null) }
    }

    private fun toSignIn(server: ServerSummary, notice: String?) {
        val previous = signInState.value
        signInState.value = SignInState(
            server = server,
            username = if (previous?.server?.url == server.url) previous.username else "",
            notice = notice,
        )
        navigator.reset(Route.Connect)
        navigator.push(Route.SignIn)
    }

    // ----- sign in -------------------------------------------------------------------------

    fun onUsernameChange(value: String) = signInState.update { it?.copy(username = value, error = null) }

    fun onPasswordChange(value: String) = signInState.update { it?.copy(password = value, error = null) }

    fun signIn() {
        val state = signInState.value ?: return
        if (state.busy) return
        signInState.value = state.copy(busy = true, error = null)
        scope.launch {
            val error = try {
                core.signIn(state.server.url, state.username.trim(), state.password)
                (core.session() as? SessionState.SignInFailed)?.error?.let { errorText(it.code, it.message) }
            } catch (failure: CoreException) {
                failure.message ?: "Sign-in failed"
            }
            // Success clears the form when the session opens the Lounge (onSession).
            if (error != null) signInState.update { it?.copy(busy = false, password = "", error = error) }
        }
    }

    fun changeServer() {
        if (!navigator.pop()) navigator.reset(Route.Connect)
    }

    // ----- the session ---------------------------------------------------------------------

    private fun onSession(session: SessionState) {
        when (session) {
            is SessionState.SignedIn -> if (!wasSignedIn) {
                server = signInState.value?.server?.url ?: lastServer ?: connectState.value.url
                signInState.value = null
                startState.value = StartState.Starting
                navigator.reset(Route.Community(null))
                onCommunities(store.communities.value)
                val tapped = synchronized(linkLock) {
                    wasSignedIn = true
                    pendingLink.also { pendingLink = null }
                }
                tapped?.let(::go)
            }
            SessionState.SignedOut -> if (wasSignedIn) {
                // Revoked, expired, or signed out elsewhere: back to sign-in, saying so.
                synchronized(linkLock) {
                    wasSignedIn = false
                    pendingLink = null
                }
                val url = server
                server = null
                allOpenState.value = false
                if (url == null) toConnect("", SESSION_ENDED) else scope.launch { refused(url) }
            }
            else -> Unit
        }
    }

    /**
     * The Lounge opened before the communities had: pick the one last opened here, else the
     * first. A community that went away goes back to picking.
     */
    private fun onCommunities(communities: Load<List<CommunitySummary>>) {
        val list = (communities as? Load.Ready)?.value ?: return
        val shown = navigator.community
        val top = navigator.top
        if (top is Route.Community && top.id == null || shown != null && list.none { it.id == shown }) {
            val remembered = server?.let(lastCommunity::get)
            val pick = list.firstOrNull { it.id == remembered } ?: list.firstOrNull()
            navigator.reset(Route.Community(pick?.id))
        }
    }

    // ----- the Lounge ----------------------------------------------------------------------

    fun openCommunity(id: String) {
        navigator.openCommunity(id)
        server?.let { lastCommunity.set(it, id) }
    }

    fun openChannel(id: String) {
        val community = navigator.community ?: return
        navigator.push(Route.Channel(community, id))
    }

    /** A text channel's chat: its list, kept for as long as the session. */
    fun chat(channelId: String): ConversationStore = store.conversation(Conversation.Channel(channelId))

    /** A text channel's composer, with its unsent draft. */
    fun composer(communityId: String, channelId: String): ComposerStore = store.composer(communityId, channelId)

    /** A tapped #channel mention: opens it when it is a text channel of the community shown. */
    fun openMentionedChannel(channelId: String) {
        val community = navigator.community ?: return
        val channels = (store.watch(community).value as? Load.Ready)?.value ?: return
        if (channels.text.any { it.id == channelId }) openChannel(channelId)
    }

    fun openAll() {
        sheetQueryState.value = ""
        allOpenState.value = true
    }

    fun closeAll() {
        allOpenState.value = false
    }

    fun onSheetQuery(query: String) {
        sheetQueryState.value = query
    }

    /**
     * A tapped notification: its channel, over its community's home (Back goes there). A DM opens
     * the Lounge's home (no DM screen before D10); a thread reply's link is its channel. Waits for
     * the session when it isn't signed in yet (a tap that started the app).
     */
    fun openLink(link: MessageLink) {
        val now = synchronized(linkLock) {
            if (!wasSignedIn) pendingLink = link
            wasSignedIn
        }
        if (now) go(link)
    }

    private fun go(link: MessageLink) {
        val channel = link.conversation as? Conversation.Channel
        val community = link.communityId
        if (channel == null || community == null) {
            if (navigator.top !is Route.Community) navigator.reset(Route.Community(navigator.community))
            return
        }
        navigator.reset(Route.Community(community))
        server?.let { lastCommunity.set(it, community) }
        navigator.push(Route.Channel(community, channel.id))
    }

    /** The system Back with no overlay open: one screen back, or `false` for the platform's. */
    fun back(): Boolean = navigator.pop()

    companion object {
        /** A typed address as a server URL: `https://` unless it says otherwise; null if no host. */
        fun normaliseServerUrl(typed: String): String? {
            val trimmed = typed.trim().trimEnd('/')
            if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null
            val url = if (trimmed.contains("://")) trimmed else "https://$trimmed"
            val parsed = runCatching { URI(url) }.getOrNull() ?: return null
            if (parsed.scheme?.lowercase() !in setOf("http", "https")) return null
            // `host` is null for a name that isn't ASCII letters, digits, dots and dashes (an
            // internationalised one, or an underscore); core converts those, so only an empty
            // host is refused here.
            val authority = parsed.rawAuthority?.substringAfterLast('@').orEmpty()
            val host = if (authority.startsWith("[")) authority else authority.substringBefore(':')
            if (host.isEmpty()) return null
            return url
        }

        fun summaryOf(info: ServerInfo) = ServerSummary(
            url = info.url,
            name = info.name,
            canRegister = info.registration != RegistrationMode.CLOSED,
            passwordReset = info.passwordReset,
        )
    }
}
