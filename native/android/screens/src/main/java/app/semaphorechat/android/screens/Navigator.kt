// Semaphore Chat's Android screens. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** Where the app is. The session decides the first entry; the rest are pushed by taps. */
sealed interface Route {
    /** Starting the core, restoring the session, or showing why that failed. */
    data object Start : Route
    data object Connect : Route
    data object SignIn : Route
    /** A community's home, or, with no id, the no-communities state. */
    data class Community(val id: String?) : Route
    data class Channel(val communityId: String, val channelId: String) : Route
}

/**
 * The app's screen stack: a hand-rolled state machine, no navigation library. The session
 * replaces the whole stack ([reset]); taps push onto it; the system Back pops it when no overlay
 * took the Back first, and at the root goes to the platform (the activity finishes, as on
 * Discord).
 *
 * Thread-safe: core's session changes arrive on a background coroutine.
 */
class Navigator(initial: Route = Route.Start) {
    private val routes = MutableStateFlow(listOf(initial))

    val stack: StateFlow<List<Route>> = routes

    val top: Route get() = routes.value.last()

    /** Back has somewhere to go inside the app. */
    val canPop: Boolean get() = routes.value.size > 1

    fun push(route: Route) {
        routes.update { if (it.last() == route) it else it + route }
    }

    /** One step back: `false`, and nothing changes, at the root. */
    fun pop(): Boolean {
        var popped = false
        routes.update {
            if (it.size > 1) {
                popped = true
                it.dropLast(1)
            } else {
                popped = false
                it
            }
        }
        return popped
    }

    /** Replaces the stack: the session changed, or another community was picked. */
    fun reset(route: Route) {
        routes.value = listOf(route)
    }

    /**
     * Opens a community from the dock or the sheet. Switching starts that community's stack
     * afresh (Back then leaves the app, as on Discord); picking the one shown pops back to its
     * home.
     */
    fun openCommunity(id: String) {
        reset(Route.Community(id))
    }

    /** The community shown, if a community or one of its channels is on top. */
    val community: String?
        get() = when (val route = top) {
            is Route.Community -> route.id
            is Route.Channel -> route.communityId
            else -> null
        }
}
