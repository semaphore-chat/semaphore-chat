// Semaphore Chat's Android client. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.
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

        // The instrumented test (src/androidTest) runs on the emulator
        // (native/scripts/android-device-test.sh).
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Only the ABIs native/scripts/android.sh built, which it passes as `-Psemaphore.abis`.
        // Its default is arm64-v8a alone: cargo-ndk is asked for that, and the image carries the
        // Rust targets it needs (x86_64-linux-android for the emulator as well).
        val abis = providers.gradleProperty("semaphore.abis").getOrElse("arm64-v8a")
        ndk {
            abiFilters += abis.split(',').map { it.trim() }.filter { it.isNotEmpty() }
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
        // library (libsemaphore_mobile.so) in jniLibs/<abi>/.
        java.srcDir(layout.buildDirectory.dir("generated/uniffi"))
        jniLibs.srcDir(layout.buildDirectory.dir("rustJniLibs"))
        // open_source_licences.txt, written by openSourceLicences below.
        assets.srcDir(layout.buildDirectory.dir("generated/licenceAssets"))
    }
}

/**
 * The notices the bundled design files must travel with, as one text asset
 * (`assets/open_source_licences.txt`): the fonts' SIL Open Font License (design/fonts) and the
 * icons' licence (design/icons). An "Open source licences" screen can show it later.
 */
abstract class OpenSourceLicences : DefaultTask() {
    @get:InputFiles
    abstract val notices: ConfigurableFileCollection

    @get:OutputFile
    abstract val output: RegularFileProperty

    @TaskAction
    fun write() {
        val text = notices.files.sortedBy { it.path }.joinToString("\n\n") { file ->
            val title = when (file.parentFile.name) {
                "fonts" -> "Fonts: Figtree and Bricolage Grotesque"
                "icons" -> "Icons: Lucide"
                else -> file.parentFile.name
            }
            "$title\n${"=".repeat(title.length)}\n\n${file.readText().trim()}"
        }
        output.get().asFile.apply { parentFile.mkdirs() }.writeText(text + "\n")
    }
}

val openSourceLicences by tasks.registering(OpenSourceLicences::class) {
    // This is the app module, so ../../../ is the repository root.
    notices.from(
        layout.projectDirectory.file("../../../design/fonts/LICENSE-OFL.txt"),
        layout.projectDirectory.file("../../../design/icons/LICENSE"),
    )
    output.set(layout.buildDirectory.file("generated/licenceAssets/open_source_licences.txt"))
}
tasks.named("preBuild") { dependsOn(openSourceLicences) }

// The JVM test (src/test): the generated bindings over a host build of libsemaphore_mobile.so,
// against semaphore-fake-server. native/scripts/android.sh passes where both are; without them the
// test is skipped, and android.sh fails a run that skipped it.
android.testOptions.unitTests.all { test ->
    for (name in listOf("hostLibDir", "fakeServer", "channelId", "authorId")) {
        providers.gradleProperty("semaphore.$name").orNull?.let {
            test.systemProperty("semaphore.$name", it)
        }
    }
    providers.gradleProperty("semaphore.hostLibDir").orNull?.let {
        test.systemProperty("jna.library.path", it)
    }
    test.testLogging {
        events("passed", "skipped", "failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
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
    // The Compose kit: the theme, the density, the fonts and the components (native/android/kit).
    implementation(project(":kit"))
    // The screens, fed plain models by CoreStore (native/android/screens).
    implementation(project(":screens"))
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    // FileProvider, which hands an opened attachment to another app (FileOpener). activity-compose
    // already brings this version in; declared because the app uses it directly.
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    // The UniFFI Kotlin bindings call the Rust library through JNA; the @aar variant is the one
    // that ships Android's own JNA .so with the app.
    implementation("net.java.dev.jna:jna:5.15.0@aar")
    // The generated bindings' `suspend` functions (SemaphoreCore.drive and the async commands)
    // are written against kotlinx.coroutines. Compose brings it in transitively; declared here
    // because the bindings need it.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // The JVM half of rustls-platform-verifier: SemaphoreApp (through NativeLib) hands it to the Rust TLS verifier
    // through libsemaphore_mobile.so's nativeInit. Version from Cargo.lock, as above.
    implementation("org.rustls:rustls-platform-verifier:${rustlsAndroidVersion.get()}")

    // The JVM test: JUnit, and JNA's plain jar, which carries the desktop libjnidispatch the @aar
    // above leaves out.
    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.15.0")

    // The instrumented test (src/androidTest): JUnit on the device, and the runner that gives it
    // InstrumentationRegistry (its arguments come from `adb shell am instrument -e`).
    androidTestImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    // The device flow test drives the real screens through Compose's test rule.
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.12.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
