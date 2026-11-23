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
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import uniffi.semaphore.NetworkState
import uniffi.semaphore.SemaphoreCore
import uniffi.semaphore.WallClock
import uniffi.semaphore_mobile.MobileConfig
import uniffi.semaphore_mobile.MobileHost
import uniffi.semaphore_mobile.start

/**
 * The process's one core, over the real transports (semaphore-mobile), and the [AppModel] over
 * it. Built on first use and kept for the life of the process, so an activity recreated on
 * rotation finds the same ones.
 */
object SemaphoreHost {
    private val lock = Mutex()

    /** A started core and what the app keeps over it. */
    class Session(
        val host: MobileHost,
        val model: AppModel,
        val scope: CoroutineScope,
        private val events: EventPipe,
        private val network: ConnectivityManager.NetworkCallback?,
        private val connectivity: ConnectivityManager?,
    ) {
        internal fun close() {
            network?.let { runCatching { connectivity?.unregisterNetworkCallback(it) } }
            events.close()
            scope.cancel()
            host.shutdown()
        }
    }

    @Volatile
    private var session: Session? = null

    /** Guards [backgrounded] together with [session] being set, so a change is applied exactly once. */
    private val lifecycle = Any()

    /**
     * Whether the app is in the background. Recorded whether or not the session exists yet, so a
     * core that finishes starting in the background starts suspended, and is resumed on return.
     * Process-wide, so an activity recreated while in the background still resumes it.
     */
    private var backgrounded = false

    /** Started already, or null. */
    fun current(): Session? = session

    /**
     * The core and the app model, started on first call.
     *
     * The start runs on [Dispatchers.Default], whatever the caller's context. uniffi resumes an
     * awaited Rust future from a Tokio worker, through a JNA callback; a caller whose dispatcher
     * resumes inline (a Compose test's frame clock does) would then run Kotlin, and the next poll,
     * inside that callback, and JNA's detach at its end aborts the process ("attempting to detach
     * while still running code", seen on the emulator). Default's dispatch only enqueues.
     */
    suspend fun get(context: Context): Session {
        session?.let { return it }
        val app = context.applicationContext
        return withContext(Dispatchers.Default) {
            lock.withLock { session ?: create(app) }
        }
    }

    /** The app came to the foreground (`onStart`): resumes the core if it was suspended. */
    fun foregrounded() {
        val resume = synchronized(lifecycle) {
            val was = backgrounded
            backgrounded = false
            session.takeIf { was }
        } ?: return
        resume.host.core().resume()
        // The views went stale while the socket was closed; read them again.
        resume.model.store.refresh()
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
            session
        } ?: return
        started.host.core().suspend()
        runBlocking(Dispatchers.IO) { started.host.flush(FLUSH_BOUND_MS) }
    }

    /** Short: `onStop` runs on the main thread. */
    private val FLUSH_BOUND_MS = 300u

    /**
     * Shuts the core down and forgets it, as the process ending would: the next [get] starts a
     * new one, which restores the session from what was stored. For the device test.
     */
    suspend fun shutdownForTest() = withContext(Dispatchers.Default) {
        lock.withLock {
            synchronized(lifecycle) {
                session?.let {
                    it.host.flush(2_000u)
                    it.close()
                }
                session = null
            }
        }
    }

    private suspend fun create(app: Context): Session {
        NativeLib.init(app)
        // noBackupFilesDir: neither the remembered server nor the sealed secrets go into backups.
        val base = app.noBackupFilesDir
        val events = EventPipe()
        val started = start(
            MobileConfig(
                dataDir = File(base, "core").path,
                userAgent = "Semaphore-Android/${versionName(app)} (Android ${Build.VERSION.RELEASE})",
                deviceName = deviceName(app),
                appVersion = versionName(app),
            ),
            KeystoreSecretStore(File(base, "secrets")),
            SystemClock,
            events,
        )
        val core = started.core()
        val connectivity = app.getSystemService(ConnectivityManager::class.java)
        val network = connectivity?.let { watchNetwork(it, core) }
        val modelScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val store = CoreStore(core, modelScope, events.events)
        val model = AppModel(
            core = core,
            store = store,
            scope = modelScope,
            lastCommunity = FileLastCommunity(File(base, "last-community")),
            lastServer = started.lastServer(),
            networks = connectivity?.let(::connectivityWatch) ?: NetworkWatch.None,
        )
        // Published with whatever the activity recorded meanwhile: a start that finished in the
        // background is suspended now, and `foregrounded` resumes it.
        val startedSession = Session(started, model, modelScope, events, network, connectivity)
        val suspend = synchronized(lifecycle) {
            session = startedSession
            backgrounded
        }
        if (suspend) core.suspend()
        return startedSession
    }

    private object SystemClock : WallClock {
        override fun nowMs(): ULong = System.currentTimeMillis().toULong()
    }

    /** The default network coming and going, as core's `network_changed`. */
    private fun watchNetwork(connectivity: ConnectivityManager, core: SemaphoreCore): ConnectivityManager.NetworkCallback {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                core.networkChanged(NetworkState.AVAILABLE)
            }

            override fun onLost(network: Network) {
                core.networkChanged(NetworkState.UNAVAILABLE)
            }
        }
        connectivity.registerDefaultNetworkCallback(callback)
        return callback
    }

    /** [NetworkWatch] over the system's default-network callback: all the platform the model needs. */
    private fun connectivityWatch(connectivity: ConnectivityManager) = NetworkWatch { onAvailable ->
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = onAvailable()
        }
        connectivity.registerDefaultNetworkCallback(callback)
        AutoCloseable { runCatching { connectivity.unregisterNetworkCallback(callback) } }
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

/**
 * [LastCommunity] in one small file, one `server<TAB>community` line per server, beside the
 * remembered server (no backups). Written whole through a temp file and a rename.
 */
class FileLastCommunity(private val file: File) : LastCommunity {
    private val lock = Any()

    private fun read(): Map<String, String> = runCatching {
        file.readLines().mapNotNull { line ->
            line.split('\t').takeIf { it.size == 2 }?.let { it[0] to it[1] }
        }.toMap()
    }.getOrDefault(emptyMap())

    override fun get(server: String): String? = synchronized(lock) { read()[server] }

    override fun set(server: String, communityId: String) {
        synchronized(lock) {
            val next = read() + (server to communityId)
            runCatching {
                file.parentFile?.mkdirs()
                val temp = File(file.path + ".tmp")
                temp.writeText(next.entries.joinToString("") { "${it.key}\t${it.value}\n" })
                check(temp.renameTo(file)) { "rename failed" }
            }
        }
    }
}
