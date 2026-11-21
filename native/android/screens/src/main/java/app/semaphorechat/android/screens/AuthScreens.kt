// Semaphore Chat's Android screens. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Alert
import app.semaphorechat.android.kit.AlertAction
import app.semaphorechat.android.kit.AlertSeverity
import app.semaphorechat.android.kit.Button
import app.semaphorechat.android.kit.ButtonSize
import app.semaphorechat.android.kit.ButtonVariant
import app.semaphorechat.android.kit.Island
import app.semaphorechat.android.kit.Spinner
import app.semaphorechat.android.kit.SpinnerSize
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextField
import app.semaphorechat.android.kit.TextFieldType
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant

/** The warning a plain-`http://` server gets, on connect and on sign-in. */
const val INSECURE_WARNING =
    "This server isn't using HTTPS. Your password and messages can be read on the network."

/** The connect screen's button and field texts, shared with the tests. */
object ConnectText {
    const val TITLE = "Connect to a server"
    const val FIELD = "Server address"
    const val CONNECT = "Connect"
    const val CONTINUE = "Continue"
    const val FINISH_SETUP = "Finish setup on the web"
}

object SignInText {
    const val USERNAME = "Username"
    const val PASSWORD = "Password"
    const val SIGN_IN = "Sign in"
    const val CHANGE_SERVER = "Use another server"
    const val FORGOT = "Forgot your password?"
    const val REGISTER = "Create an account"
}

/** The signed-out screens' frame: the wordmark, then one island, centred and scrolling. */
@Composable
private fun AuthFrame(content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Layout.Gutter),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.widthIn(max = Tokens.Layout.DialogSm).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.Lg),
        ) {
            Text("Semaphore Chat", variant = TextVariant.Title, tone = TextTone.Secondary)
            Island { Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Lg), content = content) }
        }
    }
}

/** What a failed connect says: a title and a line, as the web's server errors read. */
internal fun connectFailureText(failure: ConnectFailure): Pair<String, String>? = when (failure) {
    ConnectFailure.Unreachable ->
        "Can't reach that server" to "Check the address and your connection, then try again."
    ConnectFailure.TlsRefused ->
        "The connection isn't secure" to
            "This device doesn't trust the server's certificate, or the server doesn't use HTTPS at that address."
    ConnectFailure.NotSemaphore ->
        "That isn't a Semaphore Chat server" to "Something answered at that address, but not Semaphore Chat. Check the address."
    is ConnectFailure.NeedsSetup ->
        "This server isn't set up yet" to "Finish setting it up in a web browser, then come back here to sign in."
    is ConnectFailure.Failed -> "The server answered with an error" to failure.message
    ConnectFailure.Invalid -> null
}

/**
 * Connect: the server's address and a probe of it. A `https://` server that answers goes on to
 * sign-in by itself; a plain `http://` one shows [INSECURE_WARNING] first, and [onContinue]
 * goes on. A server with no users yet is finished on the web ([onOpenWeb]).
 */
@Composable
fun ConnectScreen(
    state: ConnectState,
    onUrlChange: (String) -> Unit,
    onConnect: () -> Unit,
    onContinue: () -> Unit,
    onOpenWeb: (String) -> Unit,
) {
    AuthFrame {
        Text(ConnectText.TITLE, variant = TextVariant.Title, heading = true)
        Text("Enter the address of your Semaphore Chat server.", tone = TextTone.Secondary)
        state.notice?.let { Alert(AlertSeverity.Info, it, announce = false) }
        TextField(
            value = state.url,
            onValueChange = onUrlChange,
            label = ConnectText.FIELD,
            placeholder = "chat.example.com",
            type = TextFieldType.Url,
            enabled = !state.probing,
            imeAction = ImeAction.Done,
            onImeAction = { if (!state.probing) onConnect() },
            error = if (state.failure == ConnectFailure.Invalid) "Enter a server address, like chat.example.com" else null,
        )
        state.failure?.let { failure ->
            connectFailureText(failure)?.let { (title, message) ->
                val setup = failure as? ConnectFailure.NeedsSetup
                Alert(
                    severity = if (setup != null) AlertSeverity.Warning else AlertSeverity.Danger,
                    title = title,
                    message = message,
                    action = setup?.let { AlertAction(ConnectText.FINISH_SETUP) { onOpenWeb(it.url) } },
                )
            }
        }
        if (state.insecure != null) {
            Alert(AlertSeverity.Warning, INSECURE_WARNING)
        }
        Button(
            label = if (state.insecure != null) ConnectText.CONTINUE else ConnectText.CONNECT,
            onClick = if (state.insecure != null) onContinue else onConnect,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Lg,
            fullWidth = true,
            loading = state.probing,
            enabled = state.url.isNotBlank(),
        )
    }
}

/**
 * Sign-in: username and password on the probed server. Registration and password reset are on
 * the web for now ([onOpenWeb]), as desktop does for setup.
 */
@Composable
fun SignInScreen(
    state: SignInState,
    onUsernameChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onChangeServer: () -> Unit,
    onOpenWeb: (String) -> Unit,
) {
    AuthFrame {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
            Text("Sign in", variant = TextVariant.Title, heading = true)
            Text(
                state.server.name?.let { "$it · ${hostOf(state.server.url)}" } ?: hostOf(state.server.url),
                tone = TextTone.Secondary,
                truncate = true,
            )
        }
        state.notice?.let { Alert(AlertSeverity.Info, it, announce = false) }
        if (state.server.insecure) Alert(AlertSeverity.Warning, INSECURE_WARNING, announce = false)
        TextField(
            state.username,
            onUsernameChange,
            label = SignInText.USERNAME,
            enabled = !state.busy,
            imeAction = ImeAction.Next,
        )
        TextField(
            state.password,
            onPasswordChange,
            label = SignInText.PASSWORD,
            type = TextFieldType.Password,
            enabled = !state.busy,
            imeAction = ImeAction.Done,
            onImeAction = { if (!state.busy && state.username.isNotBlank() && state.password.isNotEmpty()) onSignIn() },
        )
        state.error?.let { Alert(AlertSeverity.Danger, it) }
        Button(
            label = SignInText.SIGN_IN,
            onClick = onSignIn,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Lg,
            fullWidth = true,
            loading = state.busy,
            enabled = state.username.isNotBlank() && state.password.isNotEmpty(),
        )
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
            if (state.server.passwordReset) {
                Button(SignInText.FORGOT, onClick = { onOpenWeb(state.server.url) }, variant = ButtonVariant.Text)
            }
            if (state.server.canRegister) {
                Button(SignInText.REGISTER, onClick = { onOpenWeb(state.server.url) }, variant = ButtonVariant.Text)
            }
            Button(SignInText.CHANGE_SERVER, onClick = onChangeServer, variant = ButtonVariant.Text, enabled = !state.busy)
        }
        if (state.server.passwordReset || state.server.canRegister) {
            Text("Accounts and password resets open in your web browser.", variant = TextVariant.Meta, tone = TextTone.Dim)
        }
    }
}

/** `https://chat.example.com/x` → `chat.example.com/x`, for showing. */
fun hostOf(url: String): String = url.substringAfter("://").trimEnd('/')

/**
 * Starting: the core starting and the session restoring, or why they didn't. An unreachable
 * server keeps the stored session: [onRetry] tries again, [onOtherServer] goes to connect.
 */
@Composable
fun StartScreen(state: StartState, onRetry: () -> Unit, onOtherServer: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(Tokens.Layout.Gutter),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.widthIn(max = Tokens.Layout.DialogSm).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.Lg),
        ) {
            Text("Semaphore Chat", variant = TextVariant.Title, heading = true)
            when (state) {
                StartState.Starting -> Spinner(size = SpinnerSize.Md, label = "Starting")
                is StartState.Restoring -> {
                    Spinner(size = SpinnerSize.Md, label = "Signing in to ${hostOf(state.server)}")
                }
                is StartState.StartFailed -> Alert(
                    AlertSeverity.Danger,
                    title = "Semaphore Chat didn't start",
                    message = state.message,
                    announce = false,
                )
                is StartState.Unreachable -> {
                    Alert(
                        AlertSeverity.Warning,
                        title = "Can't reach ${hostOf(state.server)}",
                        message = "Check your connection. You're still signed in: try again when you're back online.",
                        action = AlertAction("Try again", onRetry),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row { Button("Use another server", onClick = onOtherServer, variant = ButtonVariant.Text) }
                }
            }
        }
    }
}
