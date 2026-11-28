// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import app.semaphorechat.android.HostLifecycle.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** [HostLifecycle]'s transitions: when core is suspended, resumed, or left alone. */
class HostLifecycleTest {
    private val state = HostLifecycle()

    @Test
    fun backgroundingSuspendsAndComingBackResumes() {
        assertEquals(Action.None, state.started())
        assertEquals(Action.Suspend, state.backgrounded())
        assertEquals("already suspended", Action.None, state.backgrounded())
        assertEquals(Action.Resume, state.foregrounded())
        assertEquals("nothing to resume any more", Action.None, state.foregrounded())
        assertEquals(Action.Suspend, state.backgrounded())
    }

    @Test
    fun aSessionThatFinishedStartingInTheBackgroundStartsSuspended() {
        assertEquals("no session yet", Action.None, state.backgrounded())
        assertEquals(Action.Suspend, state.started())
        assertEquals(Action.Resume, state.foregrounded())
    }

    @Test
    fun theServiceRunningKeepsCoreConnectedInTheBackground() {
        assertEquals(Action.None, state.started())
        assertEquals(Action.None, state.keepConnected(true))
        assertEquals(Action.None, state.backgrounded())
        assertEquals(Action.None, state.foregrounded())
        assertTrue(state.keepsConnected)
    }

    @Test
    fun aDisconnectInTheBackgroundSuspendsCore() {
        state.started()
        state.keepConnected(true)
        state.backgrounded()
        assertEquals(Action.Suspend, state.keepConnected(false))
        assertFalse(state.keepsConnected)
        assertEquals("already suspended", Action.None, state.keepConnected(false))
        assertEquals(Action.Resume, state.foregrounded())
    }

    @Test
    fun theServiceStartingInTheBackgroundResumesWhatItsStopSuspended() {
        state.started()
        assertEquals(Action.Suspend, state.backgrounded())
        // The service's start command can arrive after onStop (started at sign-in, the user left
        // before Android delivered it): the service, not the window, keeps the connection now.
        assertEquals(Action.Resume, state.keepConnected(true))
        assertTrue(state.keepsConnected)
        assertEquals("still connected", Action.None, state.backgrounded())
        assertEquals("never suspended", Action.None, state.foregrounded())
    }

    @Test
    fun anEndedSessionLeavesNothingToSuspendOrResume() {
        state.started()
        state.backgrounded()
        state.ended()
        assertEquals(Action.None, state.foregrounded())
        assertEquals(Action.None, state.keepConnected(true))
    }
}
