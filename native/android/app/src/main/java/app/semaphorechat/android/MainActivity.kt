// Semaphore Chat's Android client (D1). Copyright (C) 2026 the Semaphore Chat authors.
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
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import uniffi.semaphore.ConnectionState
import uniffi.semaphore.CoreEvent
import uniffi.semaphore.CoreListener
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.SessionState
import uniffi.semaphore.WallClock

/**
 * D1's one screen: it builds [SemaphoreCore] (the Rust client core, through the UniFFI surface in
 * crates/semaphore-ffi) and shows values read back from it. A core with no services is exactly
 * what `SemaphoreCore::new` gives: state and lifecycle work, commands report Unavailable.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    CoreStatus()
                }
            }
        }
    }
}

@Composable
private fun CoreStatus() {
    // Once, for the activity: a failure here is a build problem, and re-reading state does not
    // fix it.
    val core = remember { runCatching { SemaphoreCore(SystemClock, QuietListener) } }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Semaphore core loaded", style = MaterialTheme.typography.headlineSmall)

        core.fold(
            onSuccess = { loaded ->
                // What core reports for a fresh, service-less instance: signed out, disconnected,
                // no communities. Spelled out rather than interpolated, because a sealed class's
                // unit variant prints as an object identity.
                Text(
                    "session: ${sessionLabel(loaded.session())}",
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    "connection: ${connectionLabel(loaded.connection())}",
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    "communities: ${loaded.communities().size}",
                    style = MaterialTheme.typography.bodyLarge,
                )
            },
            onFailure = { error ->
                Text(
                    "core did not load: ${error.message ?: error.javaClass.name}",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                )
            },
        )
    }
}

/** The platform's wall clock, in Unix milliseconds, as core asks for it. */
private object SystemClock : WallClock {
    override fun nowMs(): ULong = System.currentTimeMillis().toULong()
}

/** Nothing here subscribes: D1 reads state and ignores the events core would push. */
private object QuietListener : CoreListener {
    override fun onEvent(event: CoreEvent) = Unit
}

private fun sessionLabel(state: SessionState): String = when (state) {
    SessionState.SignedOut -> "signed out"
    SessionState.SigningIn -> "signing in"
    is SessionState.SignedIn -> "signed in"
    is SessionState.SignInFailed -> "sign-in failed"
}

private fun connectionLabel(state: ConnectionState): String = when (state) {
    ConnectionState.DISCONNECTED -> "disconnected"
    ConnectionState.CONNECTED -> "connected"
    ConnectionState.SUSPENDED -> "suspended"
    ConnectionState.OFFLINE -> "offline"
}
