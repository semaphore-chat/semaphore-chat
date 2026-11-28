// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * [ConnectionService]: its notification's private and public versions, a stop as a command (so a
 * start that `startForegroundService` asked for is never orphaned), and starting with
 * notifications off.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ConnectionServiceTest {
    private val app = RuntimeEnvironment.getApplication()
    private val manager = app.getSystemService(NotificationManager::class.java)

    @Before
    fun forgetPreviousRun() = ConnectionService.resetForTest()

    @After
    fun leaveNothingRunning() = ConnectionService.resetForTest()

    private fun startIntent() =
        Intent(app, ConnectionService::class.java).putExtra(ConnectionService.EXTRA_HOST, "chat.example.org")

    @Test
    fun theNotificationNamesTheHostPrivatelyAndNotOnTheLockScreen() {
        val shown = ConnectionService.connectionNotification(app, "chat.example.org")
        assertEquals("Connected to chat.example.org", shown.extras.getString(Notification.EXTRA_TITLE))
        assertEquals(NotifyText.STAYS_CONNECTED, shown.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals(Notification.VISIBILITY_PRIVATE, shown.visibility)
        val public = checkNotNull(shown.publicVersion) { "no public version" }
        assertEquals("Semaphore", public.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Connected", public.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        // Which server this phone uses is not on the lock screen.
        listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT).forEach {
            assertFalse(it, public.extras.getCharSequence(it)?.contains("example") == true)
        }
        // Its one action is Disconnect, through the service itself.
        val disconnect = shadowOf(shown.actions.first().actionIntent).savedIntent
        assertEquals(ConnectionService.ACTION_DISCONNECT, disconnect.action)
        assertEquals(ConnectionService::class.java.name, disconnect.component?.className)
        // No host either when there is none (a bare address).
        assertEquals(NotifyText.CONNECTED, ConnectionService.connectionNotification(app, "").extras.getString(Notification.EXTRA_TITLE))
    }

    @Test
    fun startingWithNotificationsOffStopsTheRunningService() {
        shadowOf(manager).setNotificationsEnabled(true)
        val service = Robolectric.buildService(ConnectionService::class.java, startIntent()).create().get()
        service.onStartCommand(startIntent(), 0, 1)
        assertTrue(ConnectionService.running)

        shadowOf(manager).setNotificationsEnabled(false)
        ConnectionService.start(app, "https://chat.example.org")
        val stop = shadowOf(app).nextStartedService
        assertEquals(ConnectionService.ACTION_STOP, stop.action)

        // Delivered after the start command above, as Android would.
        service.onStartCommand(stop, 0, 2)
        assertFalse(ConnectionService.running)
        assertTrue(shadowOf(service).isStoppedBySelf)
    }

    @Test
    fun aStopWhileTheStartIsStillOnItsWayIsACommandToo() {
        shadowOf(manager).setNotificationsEnabled(true)
        ConnectionService.start(app, "https://chat.example.org")
        assertFalse(ConnectionService.running)
        // The start the system took (and the stop that follows it, in order).
        assertNull(shadowOf(app).nextStartedService.action)
        ConnectionService.stop(app)
        val stop = shadowOf(app).nextStartedService
        // Not `stopService`: a start Android already took would then never call startForeground,
        // which Android kills the app for.
        assertEquals(ConnectionService.ACTION_STOP, stop.action)

        // In order: the start runs, then the stop takes it down.
        val service = Robolectric.buildService(ConnectionService::class.java).create().get()
        service.onStartCommand(startIntent(), 0, 1)
        assertTrue(ConnectionService.running)
        service.onStartCommand(stop, 0, 2)
        assertFalse(ConnectionService.running)
        assertTrue(shadowOf(service).isStoppedBySelf)
    }

    @Test
    fun theDisconnectActionStopsIt() {
        shadowOf(manager).setNotificationsEnabled(true)
        val service = Robolectric.buildService(ConnectionService::class.java, startIntent()).create().get()
        service.onStartCommand(startIntent(), 0, 1)
        assertTrue(ConnectionService.running)
        service.onStartCommand(
            Intent(app, ConnectionService::class.java).setAction(ConnectionService.ACTION_DISCONNECT),
            0,
            2,
        )
        assertFalse(ConnectionService.running)
        assertTrue(shadowOf(service).isStoppedBySelf)
    }

    @Test
    fun hostOfTakesTheHostAndNothingElse() {
        assertEquals("chat.example.org", ConnectionService.hostOf("https://chat.example.org:8443/path"))
        assertEquals("", ConnectionService.hostOf(null))
        assertEquals("", ConnectionService.hostOf("not a url"))
    }
}
