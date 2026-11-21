// SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.
package app.semaphorechat.android

import android.app.Application

/**
 * The process's [Application]: it runs before any activity, service or receiver, so TLS is ready
 * whichever component starts the process (a push, a share target, a deep link), not only
 * [MainActivity].
 */
class SemaphoreApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // rustls-platform-verifier reads Android's trust store through the JVM, and needs an
        // application Context to do it. semaphore-net refuses to build a TLS client until this
        // has run, and a JNI failure throws here. NativeLib.init is idempotent and loads
        // libsemaphore_mobile.so. It doesn't check that the Kotlin half
        // (org.rustls.platformverifier) is present: a stripped one shows up at the first handshake.
        NativeLib.init(this)
    }
}
