// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.provider.Settings
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import uniffi.semaphore.CoreEvent
import uniffi.semaphore.CoreListener
import uniffi.semaphore.NetworkState
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.WallClock
import uniffi.semaphore_mobile.MobileConfig
import uniffi.semaphore_mobile.MobileHost
import uniffi.semaphore_mobile.start

/**
 * The process's one core, over the real transports (semaphore-mobile). Built on first use and
 * kept for the life of the process, so an activity recreated on rotation finds the same one.
 */
object SemaphoreHost {
    private val lock = Mutex()

    @Volatile
    private var host: MobileHost? = null

    /** Background work that outlives any one screen: restoring the session. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val changes = MutableStateFlow(0L)

    /** Bumped on every core event: a screen re-reads the views it shows when it changes. */
    val changed: StateFlow<Long> = changes

    /** Guards [backgrounded] together with [host] being set, so a change is applied exactly once. */
    private val lifecycle = Any()

    /**
     * Whether the app is in the background. Recorded whether or not the host exists yet, so one
     * that finishes starting in the background starts suspended, and is resumed on return.
     * Process-wide, so an activity recreated while in the background still resumes it.
     */
    private var backgrounded = false

    /** Started already, or null. */
    fun current(): MobileHost? = host

    /** The host, started on first call. */
    suspend fun get(context: Context): MobileHost {
        host?.let { return it }
        return lock.withLock { host ?: create(context.applicationContext) }
    }

    /** The app came to the foreground (`onStart`): resumes the core if it was suspended. */
    fun foregrounded() {
        val resume = synchronized(lifecycle) {
            val was = backgrounded
            backgrounded = false
            host.takeIf { was }
        }
        resume?.core()?.resume()
    }

    /**
     * The app went to the background (`onStop`, not for a rotation): suspends the core, then
     * waits up to [FLUSH_BOUND_MS] for the secret store, on an IO thread. Waiting here, while
     * Android still counts the app as visible, is what lets a just-rotated refresh token land
     * before the process becomes one the OS may end at once.
     */
    fun backgroundedNow() {
        val started = synchronized(lifecycle) {
            backgrounded = true
            host
        } ?: return
        started.core().suspend()
        runBlocking(Dispatchers.IO) { started.flush(FLUSH_BOUND_MS) }
    }

    /** Short: `onStop` runs on the main thread. */
    private val FLUSH_BOUND_MS = 300u

    private suspend fun create(app: Context): MobileHost {
        NativeLib.init(app)
        // noBackupFilesDir: neither the remembered server nor the sealed secrets go into backups.
        val base = app.noBackupFilesDir
        val started = start(
            MobileConfig(
                dataDir = File(base, "core").path,
                userAgent = "Semaphore-Android/${versionName(app)} (Android ${Build.VERSION.RELEASE})",
                deviceName = deviceName(app),
                appVersion = versionName(app),
            ),
            KeystoreSecretStore(File(base, "secrets")),
            SystemClock,
            Listener,
        )
        // Published with whatever the activity recorded meanwhile: a start that finished in the
        // background is suspended now, and `foregrounded` resumes it.
        val suspend = synchronized(lifecycle) {
            host = started
            backgrounded
        }
        if (suspend) started.core().suspend()
        watchNetwork(app, started.core())
        // Restored while suspended, core waits for `resume` to connect the socket. What a restore
        // that can't reach the server shows, and its retry, come with D5.
        started.lastServer()?.let { server ->
            scope.launch { runCatching { started.core().restoreSession(server) } }
        }
        return started
    }

    /** Core's events, from whatever thread changed core state: only a counter bump here. */
    private object Listener : CoreListener {
        override fun onEvent(event: CoreEvent) {
            changes.update { it + 1 }
        }
    }

    private object SystemClock : WallClock {
        override fun nowMs(): ULong = System.currentTimeMillis().toULong()
    }

    /** The default network coming and going, as core's `network_changed`. */
    private fun watchNetwork(app: Context, core: SemaphoreCore) {
        val connectivity = app.getSystemService(ConnectivityManager::class.java) ?: return
        connectivity.registerDefaultNetworkCallback(
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    core.networkChanged(NetworkState.AVAILABLE)
                }

                override fun onLost(network: Network) {
                    core.networkChanged(NetworkState.UNAVAILABLE)
                }
            },
        )
    }

    /** The name the user gave the device, else its model. semaphore-mobile makes it header-safe. */
    private fun deviceName(app: Context): String =
        Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME)
            ?.takeIf { it.isNotBlank() }
            ?: Build.MODEL

    private fun versionName(app: Context): String =
        runCatching { app.packageManager.getPackageInfo(app.packageName, 0).versionName }
            .getOrNull()
            ?: "0.0.0"
}
