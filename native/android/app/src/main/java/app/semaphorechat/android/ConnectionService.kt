// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.net.URI

/**
 * A foreground service that keeps core's connection open while the app is in the background, so
 * core's notifications still arrive (no Play Services push on F-Droid; D8's UnifiedPush falls back
 * to this). While it runs, [SemaphoreHost.backgroundedNow] leaves core connected. Its ongoing
 * "Connected to <host>" notification has a Disconnect action, which stops it and suspends core.
 *
 * Started only from the visible activity (`onStart`, or right after sign-in or the permission),
 * never at boot, and `START_NOT_STICKY`: a process the system ends stays ended until the app opens.
 */
class ConnectionService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISCONNECT, ACTION_STOP -> {
                Log.i(TAG, if (intent.action == ACTION_DISCONNECT) "disconnect asked" else "stop asked")
                stop()
                return START_NOT_STICKY
            }
        }
        val host = intent?.getStringExtra(EXTRA_HOST).orEmpty()
        AndroidNotifier.createChannels(this)
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                connectionNotification(this, host),
                if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
            )
        } catch (failed: RuntimeException) {
            // POST_NOTIFICATIONS revoked between the check and now, or a start the system no longer
            // allows: a notification that cannot be shown must not end the app.
            Log.w(TAG, "not starting: ${failed.javaClass.simpleName}")
            starting = false
            stopSelf()
            return START_NOT_STICKY
        }
        starting = false
        running = true
        SemaphoreHost.keepConnected(true)
        Log.i(TAG, "running")
        return START_NOT_STICKY
    }

    private fun stop() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        // Stopped as of now: the system's `onDestroy` follows, and `stop` must not send a second
        // command meanwhile.
        running = false
        starting = false
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        starting = false
        SemaphoreHost.keepConnected(false)
        Log.i(TAG, "stopped")
        super.onDestroy()
    }

    companion object {
        private const val TAG = "SemaphoreConnection"
        const val NOTIFICATION_ID = 0x5e3a
        const val ACTION_DISCONNECT = "app.semaphorechat.android.action.DISCONNECT"
        const val ACTION_STOP = "app.semaphorechat.android.action.STOP"
        const val EXTRA_HOST = "host"
        const val DISCONNECT = "Disconnect"

        /** Whether the service is started (read by the tests). */
        @Volatile
        var running = false
            private set

        /**
         * `startForegroundService` returned and its command has not run yet (read by [stop]).
         * `startForeground` is owed until it does.
         */
        @Volatile
        private var starting = false

        /** For tests: forget a start or run a previous test left (Robolectric keeps statics). */
        internal fun resetForTest() {
            running = false
            starting = false
        }

        /** The host part of a server URL, for the notification ("Connected to chat.example.org"). */
        fun hostOf(server: String?): String =
            server?.let { runCatching { URI(it).host }.getOrNull() }.orEmpty()

        /** The private title: the host, which only the unlocked device sees (see the public version). */
        fun titleOf(host: String): String = if (host.isEmpty()) NotifyText.CONNECTED else "Connected to $host"

        /**
         * The ongoing notification. Its public version says only that the app is connected: a lock
         * screen, or a notification a guest can see, does not show which server this phone uses.
         */
        fun connectionNotification(context: Context, host: String): Notification {
            val public = NotificationCompat.Builder(context, NotifyChannels.CONNECTION)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle(NotifyText.APP)
                .setContentText(NotifyText.CONNECTED)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build()
            return NotificationCompat.Builder(context, NotifyChannels.CONNECTION)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle(titleOf(host))
                .setContentText(NotifyText.STAYS_CONNECTED)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(public)
                .setContentIntent(
                    PendingIntent.getActivity(
                        context,
                        0,
                        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                )
                .addAction(
                    0,
                    DISCONNECT,
                    PendingIntent.getService(
                        context,
                        1,
                        Intent(context, ConnectionService::class.java).setAction(ACTION_DISCONNECT),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                )
                .build()
        }

        /**
         * Starts it, when notifications can be shown: call only while the app is visible (Android
         * refuses a foreground service started from the background). With notifications off it
         * stops a service left running instead: it exists to show them.
         */
        fun start(context: Context, server: String?) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (!manager.areNotificationsEnabled()) {
                Log.i(TAG, "not starting: notifications are off")
                stop(context)
                return
            }
            starting = true
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, ConnectionService::class.java).putExtra(EXTRA_HOST, hostOf(server)),
                )
            } catch (refused: IllegalStateException) {
                // Android 12+ refuses a start from the background (ForegroundServiceStartNotAllowedException).
                starting = false
                Log.w(TAG, "not starting: ${refused.javaClass.simpleName}")
            }
        }

        /**
         * Stops it (sign-out, notifications turned off, its Disconnect action). While it runs, or a
         * start is still on its way, the stop goes as a command that runs after that start: stopping
         * a service that `startForegroundService` asked for before it called `startForeground` is
         * what Android kills the app for (ForegroundServiceDidNotStartInTimeException), an immediate
         * `stopService` included.
         */
        fun stop(context: Context) {
            val intent = Intent(context, ConnectionService::class.java).setAction(ACTION_STOP)
            if (running || starting) {
                try {
                    context.startService(intent)
                    return
                } catch (refused: IllegalStateException) {
                    // Background start refused (Android 8+): the service is up, so going down is safe.
                    Log.w(TAG, "stop not sent as a command: ${refused.javaClass.simpleName}")
                }
            }
            context.stopService(intent)
        }
    }
}
