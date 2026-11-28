// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

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
        if (intent?.action == ACTION_DISCONNECT) {
            Log.i(TAG, "disconnect asked")
            stop()
            return START_NOT_STICKY
        }
        val host = intent?.getStringExtra(EXTRA_HOST).orEmpty()
        AndroidNotifier.createChannels(this)
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification(host),
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
        )
        running = true
        SemaphoreHost.keepConnected(true)
        Log.i(TAG, "running")
        return START_NOT_STICKY
    }

    private fun stop() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        SemaphoreHost.keepConnected(false)
        Log.i(TAG, "stopped")
        super.onDestroy()
    }

    private fun notification(host: String) = NotificationCompat.Builder(this, NotifyChannels.CONNECTION)
        .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
        .setContentTitle(if (host.isEmpty()) "Connected" else "Connected to $host")
        .setContentText("Semaphore stays connected to receive notifications")
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
        )
        .addAction(
            0,
            DISCONNECT,
            PendingIntent.getService(
                this,
                1,
                Intent(this, ConnectionService::class.java).setAction(ACTION_DISCONNECT),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
        )
        .build()

    companion object {
        private const val TAG = "SemaphoreConnection"
        const val NOTIFICATION_ID = 0x5e3a
        const val ACTION_DISCONNECT = "app.semaphorechat.android.action.DISCONNECT"
        const val EXTRA_HOST = "host"
        const val DISCONNECT = "Disconnect"

        /** Whether the service is started (read by the tests). */
        @Volatile
        var running = false
            private set

        /** The host part of a server URL, for the notification ("Connected to chat.example.org"). */
        fun hostOf(server: String?): String =
            server?.let { runCatching { URI(it).host }.getOrNull() }.orEmpty()

        /**
         * Starts it, when notifications can be shown: call only while the app is visible (Android
         * refuses a foreground service started from the background).
         */
        fun start(context: Context, server: String?) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (!manager.areNotificationsEnabled()) {
                Log.i(TAG, "not starting: notifications are off")
                return
            }
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, ConnectionService::class.java).putExtra(EXTRA_HOST, hostOf(server)),
                )
            } catch (refused: IllegalStateException) {
                // Android 12+ refuses a start from the background (ForegroundServiceStartNotAllowedException).
                Log.w(TAG, "not starting: ${refused.javaClass.simpleName}")
            }
        }

        /** Stops it (sign-out). */
        fun stop(context: Context) {
            context.stopService(Intent(context, ConnectionService::class.java))
        }
    }
}
