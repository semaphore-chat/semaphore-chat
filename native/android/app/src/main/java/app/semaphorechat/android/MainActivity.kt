// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Alert
import app.semaphorechat.android.kit.AlertSeverity
import app.semaphorechat.android.kit.Avatar
import app.semaphorechat.android.kit.AvatarShape
import app.semaphorechat.android.kit.Button
import app.semaphorechat.android.kit.ButtonSize
import app.semaphorechat.android.kit.ButtonVariant
import app.semaphorechat.android.kit.Island
import app.semaphorechat.android.kit.KitRoot
import app.semaphorechat.android.kit.ListRow
import app.semaphorechat.android.kit.Spinner
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextField
import app.semaphorechat.android.kit.TextFieldType
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant
import kotlinx.coroutines.launch
import uniffi.semaphore.Appearance
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.CoreException
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.SessionState
import uniffi.semaphore.ThemeMode

/**
 * D3's one screen, drawn with the kit (D4b): sign in to a server and see the session, the
 * connection and the communities, read from the networked core, in the theme the account's
 * appearance derives. The real screens come with D5 and D6.
 *
 * Lifecycle: going to the background suspends the core (the socket closes) and waits briefly for
 * its secrets to be written, since Android may end the process there without another word; coming
 * back resumes it. Both are recorded even before the core has started (SemaphoreHost).
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // TLS is initialised by SemaphoreApp.onCreate, before any component of this process starts.
        setContent { CoreScreen() }
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
    mode = ThemeMode.DARK,
    accent = uniffi.semaphore.AccentColor.PURPLE,
    intensity = uniffi.semaphore.ThemeIntensity.MINIMAL,
    base = uniffi.semaphore.Rgb(0x8Eu, 0x75u, 0xFFu),
    matchSystem = false,
    newDesign = false,
    baseColourSettings = true,
)

@Composable
private fun CoreScreen() {
    val context = androidx.compose.ui.platform.LocalContext.current
    var core by remember { mutableStateOf<SemaphoreCore?>(null) }
    var startError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { SemaphoreHost.get(context).core() }
            .onSuccess { core = it }
            .onFailure { startError = it.message ?: it.javaClass.name }
    }
    // Re-read the views on every core event.
    val tick by SemaphoreHost.changed.collectAsState()
    val loaded = core
    // Read so the composition depends on it: every event redraws this.
    @Suppress("UNUSED_VARIABLE")
    val seen = tick
    val appearance = loaded?.appearance()?.appearance ?: DEFAULT_APPEARANCE

    CoreTheme(appearance) {
        KitRoot {
            Column(
                modifier = Modifier
                    .safeDrawingPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Space.Md),
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
            ) {
                Island(modifier = Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md)) {
                        Text("Semaphore Chat", variant = TextVariant.Title, heading = true)
                        when {
                            startError != null -> Alert(
                                AlertSeverity.Danger,
                                "The core did not start: $startError",
                                announce = false,
                            )
                            loaded == null -> Spinner(label = "Starting")
                            else -> {
                                val session = loaded.session()
                                Text("Session: ${sessionLabel(session)}", tone = TextTone.Secondary)
                                Text("Connection: ${connectionLabel(loaded.connection())}", tone = TextTone.Secondary)
                                if (session is SessionState.SignedIn) {
                                    loaded.communities().forEach {
                                        ListRow(
                                            it.name,
                                            leading = {
                                                Avatar(it.name, shape = AvatarShape.Rounded, decorative = true)
                                            },
                                        )
                                    }
                                } else {
                                    SignInForm(loaded, session)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SignInForm(core: SemaphoreCore, session: SessionState) {
    var server by remember { mutableStateOf("https://") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    TextField(server, { server = it }, label = "Server", type = TextFieldType.Url, imeAction = ImeAction.Next)
    val signIn = {
        error = null
        scope.launch {
            try {
                core.signIn(server.trim(), username.trim(), password)
            } catch (failure: CoreException) {
                error = failure.message
            }
        }
        Unit
    }
    TextField(username, { username = it }, label = "Username", imeAction = ImeAction.Next)
    TextField(
        password,
        { password = it },
        label = "Password",
        type = TextFieldType.Password,
        imeAction = ImeAction.Done,
        onImeAction = { if (session != SessionState.SigningIn) signIn() },
    )
    (error ?: (session as? SessionState.SignInFailed)?.error?.message)?.let {
        Alert(AlertSeverity.Danger, it)
    }
    Button(
        label = "Sign in",
        variant = ButtonVariant.Primary,
        size = ButtonSize.Lg,
        fullWidth = true,
        loading = session == SessionState.SigningIn,
        onClick = signIn,
    )
}

private fun sessionLabel(state: SessionState): String = when (state) {
    SessionState.SignedOut -> "signed out"
    SessionState.SigningIn -> "signing in"
    is SessionState.SignedIn -> "signed in as ${state.me.username}"
    is SessionState.SignInFailed -> "sign-in failed"
}

private fun connectionLabel(state: ConnectionState): String = when (state) {
    ConnectionState.DISCONNECTED -> "disconnected"
    ConnectionState.CONNECTED -> "connected"
    ConnectionState.SUSPENDED -> "suspended"
    ConnectionState.OFFLINE -> "offline"
}
