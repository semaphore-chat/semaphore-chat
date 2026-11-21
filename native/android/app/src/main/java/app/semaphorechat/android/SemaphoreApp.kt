// SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.
package app.semaphorechat.android

import android.app.Application
import android.content.Context

/**
 * The process's [Application]: it runs before any activity, service or receiver, so TLS is ready
 * whichever component starts the process (a push, a share target, a deep link), not only
 * [MainActivity].
 */
class SemaphoreApp : Application() {
    companion object {
        init {
            // The app's one native library: UniFFI's exports, and the TLS initialiser below.
            // UniFFI's bindings load it through JNA on first use; loading it here means the
            // native method is there when onCreate calls it.
            System.loadLibrary("semaphore_ffi")
        }
    }

    override fun onCreate() {
        super.onCreate()
        // rustls-platform-verifier reads Android's trust store through the JVM, and needs an
        // application Context to do it. semaphore-net refuses to build a TLS client until this
        // has run, and a JNI failure throws here. It doesn't check that the Kotlin half
        // (org.rustls.platformverifier) is present: a stripped one shows up at the first handshake.
        initSemaphoreNative(applicationContext)
    }

    /**
     * `semaphore_net::init_android` in libsemaphore_ffi.so (semaphore-ffi's
     * `Java_app_semaphorechat_android_SemaphoreApp_initSemaphoreNative`): hands
     * rustls-platform-verifier this process's JVM and application Context. Idempotent.
     */
    private external fun initSemaphoreNative(context: Context)
}
