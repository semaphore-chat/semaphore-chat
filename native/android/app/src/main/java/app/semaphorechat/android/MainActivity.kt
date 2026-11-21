// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Alert
import app.semaphorechat.android.kit.AlertSeverity
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.screens.ChannelScreen
import app.semaphorechat.android.screens.CommunityHomeModel
import app.semaphorechat.android.screens.ConnectScreen
import app.semaphorechat.android.screens.Load
import app.semaphorechat.android.screens.LoungeScreen
import app.semaphorechat.android.screens.Route
import app.semaphorechat.android.screens.SignInScreen
import app.semaphorechat.android.screens.StartScreen
import app.semaphorechat.android.screens.StartState
import uniffi.semaphore.Appearance

/**
 * The app's one activity. The screens come from the `screens` module, fed by [AppModel] over the
 * networked core; which one shows is the navigator's top, and the session decides that.
 *
 * Lifecycle: going to the background suspends the core (the socket closes) and waits briefly for
 * its secrets to be written, since Android may end the process there without another word; coming
 * back resumes it. Both are recorded even before the core has started (SemaphoreHost).
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // TLS is initialised by SemaphoreApp.onCreate, before any component of this process starts.
        setContent { AppRoot() }
    }

    override fun onStart() {
        super.onStart()
        SemaphoreHost.foregrounded()
    }

    override fun onStop() {
        super.onStop()
        // A rotation stops and starts the activity at once: not a trip to the background.
        if (isChangingConfigurations) return
        SemaphoreHost.backgroundedNow()
    }
}

/**
 * What the core's `Appearance::default()` is (semaphore-core's `model/account.rs`: dark, the
 * server's default accent purple, minimal, base `DEFAULT_BASE` #8e75ff, no match-system), which
 * `appearance()` returns while signed out. The first frames use it too, so a cold start does not
 * change theme when the core arrives.
 */
private val DEFAULT_APPEARANCE = Appearance(
    mode = uniffi.semaphore.ThemeMode.DARK,
    accent = uniffi.semaphore.AccentColor.PURPLE,
    intensity = uniffi.semaphore.ThemeIntensity.MINIMAL,
    base = uniffi.semaphore.Rgb(0x8Eu, 0x75u, 0xFFu),
    matchSystem = false,
    newDesign = false,
    baseColourSettings = true,
)

/** Opens a server page in the browser: setup, registration and password reset live there. */
private fun openWeb(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        // No browser on the device: nothing to open it in.
    }
}

@Composable
private fun AppRoot() {
    val context = LocalContext.current
    var session by remember { mutableStateOf(SemaphoreHost.current()) }
    var startError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        if (session == null) {
            runCatching { SemaphoreHost.get(context) }
                .onSuccess { session = it }
                .onFailure { startError = it.message ?: it.javaClass.name }
        }
    }
    val loaded = session
    if (loaded == null) {
        CoreTheme(DEFAULT_APPEARANCE) {
            KitRoot {
                StartScreen(
                    startError?.let { StartState.StartFailed(it) } ?: StartState.Starting,
                    onRetry = {},
                    onOtherServer = {},
                )
            }
        }
        return
    }
    val model = loaded.model
    val appearance by model.store.appearance.collectAsState()
    CoreTheme(appearance) {
        KitRoot { Screens(model) { openWeb(context, it) } }
    }
}

@Composable
private fun Screens(model: AppModel, openWeb: (String) -> Unit) {
    val stack by model.navigator.stack.collectAsState()
    // Back with no overlay open goes one screen back; at the root, to the platform (the activity
    // finishes). Registered before the screens', so an open sheet takes the Back first.
    BackHandler(enabled = stack.size > 1) { model.back() }
    var notice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(model) {
        model.store.notices.collect { if (it is CoreNotice.CommunityRemoved) notice = it.message }
    }

    Box {
        when (val route = stack.last()) {
            Route.Start -> {
                val start by model.start.collectAsState()
                StartScreen(start, onRetry = model::retryRestore, onOtherServer = model::useAnotherServer)
            }
            Route.Connect -> {
                val state by model.connect.collectAsState()
                ConnectScreen(
                    state,
                    onUrlChange = model::onUrlChange,
                    onConnect = model::connect,
                    onContinue = model::continueInsecure,
                    onOpenWeb = openWeb,
                )
            }
            Route.SignIn -> {
                val state by model.signIn.collectAsState()
                state?.let {
                    SignInScreen(
                        it,
                        onUsernameChange = model::onUsernameChange,
                        onPasswordChange = model::onPasswordChange,
                        onSignIn = model::signIn,
                        onChangeServer = model::changeServer,
                        onOpenWeb = openWeb,
                    )
                }
            }
            is Route.Community -> {
                val communities by model.store.communities.collectAsState()
                val allOpen by model.allOpen.collectAsState()
                val query by model.sheetQuery.collectAsState()
                val community = route.id?.let { id -> (communities as? Load.Ready)?.value?.firstOrNull { it.id == id } }
                val home = community?.let {
                    val channels by remember(it.id) { model.store.watch(it.id) }.collectAsState()
                    CommunityHomeModel(it, channels)
                }
                LoungeScreen(
                    communities = communities,
                    home = home,
                    allOpen = allOpen,
                    sheetQuery = query,
                    onSheetQuery = model::onSheetQuery,
                    onOpenCommunity = model::openCommunity,
                    onOpenAll = model::openAll,
                    onCloseAll = model::closeAll,
                    onOpenChannel = model::openChannel,
                    onRetry = model.store::retry,
                    onOpenWeb = { model.server?.let(openWeb) },
                )
            }
            is Route.Channel -> {
                val communities by model.store.communities.collectAsState()
                val channels by remember(route.communityId) { model.store.watch(route.communityId) }.collectAsState()
                val name = (channels as? Load.Ready)?.value?.text?.firstOrNull { it.id == route.channelId }?.name.orEmpty()
                val communityName = (communities as? Load.Ready)?.value
                    ?.firstOrNull { it.id == route.communityId }?.name.orEmpty()
                ChannelScreen(name, communityName, onBack = { model.back() })
            }
        }
        notice?.let {
            Box(
                Modifier.fillMaxWidth().safeDrawingPadding().padding(Tokens.Space.Md).align(Alignment.TopCenter),
            ) {
                Alert(AlertSeverity.Warning, it, onClose = { notice = null })
            }
        }
    }
}
