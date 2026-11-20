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

    /** Background work that outlives any one screen: restoring the session, flushing secrets. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val changes = MutableStateFlow(0L)

    /** Bumped on every core event: a screen re-reads the views it shows when it changes. */
    val changed: StateFlow<Long> = changes

    /**
     * Whether the app went to the background and suspended the core. Process-wide, so an activity
     * recreated while in the background still resumes it.
     */
    @Volatile
    var backgrounded = false

    /** Started already, or null. */
    fun current(): MobileHost? = host

    /** The host, started on first call. */
    suspend fun get(context: Context): MobileHost {
        host?.let { return it }
        return lock.withLock { host ?: create(context.applicationContext).also { host = it } }
    }

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
        watchNetwork(app, started.core())
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
