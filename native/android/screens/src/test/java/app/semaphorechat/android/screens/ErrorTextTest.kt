// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorTextTest {
    private val html = "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>"

    @Test
    fun aServerCodeKeepsTheServersMessage() {
        assertEquals("Wrong username or password.", errorText("INVALID_CREDENTIALS", "Wrong username or password."))
    }

    @Test
    fun aBodyThatIsNotAnErrorResponseIsNeverShown() {
        assertEquals(SERVER_ERROR_FALLBACK, errorText("UNKNOWN", html))
        assertEquals(SERVER_ERROR_FALLBACK, errorText("CLIENT_INVALID_RESPONSE", html))
        assertEquals(SERVER_ERROR_FALLBACK, errorText("", "connection reset"))
        assertEquals(SERVER_ERROR_FALLBACK, errorText("SOME_CODE", " "))
    }

    @Test
    fun aTransportFailureSaysWhatHappened() {
        assertTrue(errorText("CLIENT_UNREACHABLE", "tcp connect error").startsWith("Can't reach"))
        assertTrue(errorText("CLIENT_TLS", "invalid peer certificate").contains("certificate"))
    }

    @Test
    fun aRestoreFailureSaysWhy() {
        val server = "https://chat.lumen.studio"
        val offline = startUnreachableText(StartState.Unreachable(server, "CLIENT_UNREACHABLE", "x"))
        assertEquals("Can't reach chat.lumen.studio", offline.first)
        assertTrue(offline.second.startsWith("Check your connection"))
        val tls = startUnreachableText(StartState.Unreachable(server, "CLIENT_TLS", "x"))
        assertEquals("The connection isn't secure", tls.first)
        assertTrue(!tls.second.contains("Check your connection"))
        val failed = startUnreachableText(StartState.Unreachable(server, "UNKNOWN", SERVER_ERROR_FALLBACK))
        assertEquals("chat.lumen.studio had a problem" to SERVER_ERROR_FALLBACK, failed)
    }
}
