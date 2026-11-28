// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

/**
 * Whether core runs or is suspended, as the app moves to the background and back and
 * [ConnectionService] starts and stops. Pure and process-wide: [SemaphoreHost] keeps one and does
 * what each answer says to core, so every transition (including a Disconnect in the background)
 * is a JVM test.
 */
class HostLifecycle {
    /** What the caller must do to core now. */
    enum class Action { None, Suspend, Resume }

    private var hasSession = false

    /** The app is in the background. Recorded whether or not the session exists yet. */
    private var backgrounded = false

    /** Core is suspended: the socket is closed until the app (or the service) needs it again. */
    private var suspended = false

    /** [ConnectionService] is running: going to the background leaves core connected. */
    private var connectedKept = false

    /**
     * A session was published. One that started while in the background, and not for a running
     * service, starts suspended.
     */
    fun started(): Action {
        hasSession = true
        if (backgrounded && !connectedKept && !suspended) {
            suspended = true
            return Action.Suspend
        }
        return Action.None
    }

    /** No session any more (sign-out, shutdown): nothing left to suspend or resume. */
    fun ended() {
        hasSession = false
        suspended = false
    }

    /** The app came to the foreground (`onStart`). */
    fun foregrounded(): Action {
        val resume = suspended && hasSession
        backgrounded = false
        suspended = false
        return if (resume) Action.Resume else Action.None
    }

    /** The app went to the background (`onStop`), unless the service keeps it connected. */
    fun backgrounded(): Action {
        backgrounded = true
        if (hasSession && !connectedKept && !suspended) {
            suspended = true
            return Action.Suspend
        }
        return Action.None
    }

    /**
     * [ConnectionService] started ([on] true) or stopped. Stopped in the background, core is
     * suspended as [backgrounded] would have; started again while the app is there, it resumes:
     * the service, not the window, is what keeps it connected now.
     */
    fun keepConnected(on: Boolean): Action {
        connectedKept = on
        if (on) {
            if (suspended && hasSession) {
                suspended = false
                return Action.Resume
            }
            return Action.None
        }
        if (backgrounded && hasSession && !suspended) {
            suspended = true
            return Action.Suspend
        }
        return Action.None
    }

    /** Whether going to the background leaves core connected now. */
    val keepsConnected: Boolean get() = connectedKept
}
