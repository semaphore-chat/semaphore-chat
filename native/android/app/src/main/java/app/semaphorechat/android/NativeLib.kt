// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.content.Context

/**
 * The app's one native library, `libsemaphore_mobile.so`: the core's UniFFI exports, and the TLS
 * initialiser below. UniFFI's bindings load it through JNA on first use; loading it here as well
 * means the JNI method is there when [init] calls it.
 */
object NativeLib {
    @Volatile
    private var initialised = false

    /**
     * Hands rustls-platform-verifier this process's JVM and application Context, which it reads
     * Android's trust store through. Call it before anything builds a TLS client (the verifier
     * panics otherwise). Idempotent and thread-safe. A JNI failure throws here, which is better
     * than every connection failing later with no explanation.
     */
    fun init(context: Context) {
        if (initialised) return
        synchronized(this) {
            if (initialised) return
            System.loadLibrary("semaphore_mobile")
            nativeInit(context.applicationContext)
            initialised = true
        }
    }

    /** `Java_app_semaphorechat_android_NativeLib_nativeInit` in semaphore-mobile. */
    private external fun nativeInit(context: Context)
}
