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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.CoreException
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.SessionState

/**
 * D3's one screen: sign in to a server and see the session, the connection and the communities,
 * read from the networked core. The real screens come with the design-system rows.
 *
 * Lifecycle: going to the background suspends the core (the socket closes) and flushes its
 * secrets, since Android may end the process there without another word; coming back resumes it.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // TLS is initialised by SemaphoreApp.onCreate, before any component of this process starts.
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    CoreScreen()
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val host = SemaphoreHost.current() ?: return
        if (SemaphoreHost.backgrounded) {
            SemaphoreHost.backgrounded = false
            host.core().resume()
        }
    }

    override fun onStop() {
        super.onStop()
        // A rotation stops and starts the activity at once: not a trip to the background.
        if (isChangingConfigurations) return
        val host = SemaphoreHost.current() ?: return
        host.core().suspend()
        SemaphoreHost.backgrounded = true
        SemaphoreHost.scope.launch(Dispatchers.IO) { host.flush(FLUSH_TIMEOUT_MS) }
    }

    private companion object {
        val FLUSH_TIMEOUT_MS = 2_000u
    }
}

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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Semaphore Chat", style = MaterialTheme.typography.headlineSmall)
        val loaded = core
        when {
            startError != null -> Text(
                "core did not start: $startError",
                color = MaterialTheme.colorScheme.error,
            )
            loaded == null -> Text("starting…")
            else -> {
                // Read so the composition depends on it: every event redraws this.
                @Suppress("UNUSED_VARIABLE")
                val seen = tick
                val session = loaded.session()
                Text("session: ${sessionLabel(session)}")
                Text("connection: ${connectionLabel(loaded.connection())}")
                if (session is SessionState.SignedIn) {
                    val communities = loaded.communities()
                    Text("communities: ${communities.size}")
                    communities.forEach { Text("• ${it.name}") }
                } else {
                    SignInForm(loaded, session)
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
    OutlinedTextField(
        value = server,
        onValueChange = { server = it },
        label = { Text("Server") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = username,
        onValueChange = { username = it },
        label = { Text("Username") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = password,
        onValueChange = { password = it },
        label = { Text("Password") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
    )
    Button(
        enabled = session != SessionState.SigningIn,
        onClick = {
            error = null
            scope.launch {
                try {
                    core.signIn(server.trim(), username.trim(), password)
                } catch (failure: CoreException) {
                    error = failure.message
                }
            }
        },
    ) { Text("Sign in") }
    (error ?: (session as? SessionState.SignInFailed)?.error?.message)?.let {
        Text(it, color = MaterialTheme.colorScheme.error)
    }
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
