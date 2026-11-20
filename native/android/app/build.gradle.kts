// Semaphore Chat's Android client (D1). SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.ValueSource
import org.gradle.api.provider.ValueSourceParameters

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.semaphorechat.android"
    compileSdk = 35
    // Pinned to what the image installs: AGP's own default (34.0.0) would try to download itself
    // into the read-only SDK inside the image.
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "app.semaphorechat.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.0.0"

        // Only the ABI native/scripts/android.sh builds: rust-toolchain.toml installs
        // aarch64-linux-android, and cargo-ndk is asked for arm64-v8a alone.
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets.getByName("main") {
        // Both are written by native/scripts/android.sh before Gradle starts, and both live under
        // app/build/ so nothing generated is source: the uniffi Kotlin bindings, and the cargo-ndk
        // libraries (libsemaphore_ffi.so and JNA's) in jniLibs/<abi>/.
        java.srcDir(layout.buildDirectory.dir("generated/uniffi"))
        jniLibs.srcDir(layout.buildDirectory.dir("rustJniLibs"))
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

/**
 * The Kotlin component of rustls-platform-verifier ships as an AAR versioned by its
 * `rustls-platform-verifier-android` crate, not by the Rust crate. Read that version from the
 * workspace's Cargo.lock so the two can never disagree: the crate's README warns that a
 * mismatch can crash at run time.
 */
abstract class RustlsAndroidVersion : ValueSource<String, RustlsAndroidVersion.Params> {
    interface Params : ValueSourceParameters {
        val lockFile: RegularFileProperty
    }

    override fun obtain(): String {
        val lines = parameters.lockFile.get().asFile.readLines()
        val name = lines.indexOfFirst { it.trim() == "name = \"rustls-platform-verifier-android\"" }
        check(name >= 0) { "rustls-platform-verifier-android is not in Cargo.lock" }
        return lines.drop(name + 1)
            .firstOrNull { it.trimStart().startsWith("version = ") }
            ?.substringAfter('"', "")
            ?.substringBefore('"', "")
            ?.takeIf { it.isNotEmpty() }
            ?: error("rustls-platform-verifier-android has no version in Cargo.lock")
    }
}

// This is the app module, so ../../ is native/.
val rustlsAndroidVersion = providers.of(RustlsAndroidVersion::class.java) {
    parameters.lockFile.set(layout.projectDirectory.file("../../Cargo.lock"))
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    // The UniFFI Kotlin bindings call the Rust library through JNA; the @aar variant is the one
    // that ships Android's own JNA .so with the app.
    implementation("net.java.dev.jna:jna:5.15.0@aar")
    // The generated bindings' `suspend` functions (SemaphoreCore.drive and the async commands)
    // are written against kotlinx.coroutines. Compose brings it in transitively; declared here
    // because the bindings need it.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // The JVM half of rustls-platform-verifier: MainActivity hands it to the Rust TLS verifier
    // through libsemaphore_ffi.so's initSemaphoreNative. Version from Cargo.lock, as above.
    implementation("org.rustls:rustls-platform-verifier:${rustlsAndroidVersion.get()}")
}
