// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.
//
// The app's screens, drawn with the kit and fed plain Kotlin models: no core, no bindings, no
// native library. The app module turns core's views into these models (CoreStore), so the
// screens render under Robolectric for the stories and the UI review without a Rust build.

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.semaphorechat.android.screens"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        minSdk = 26
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The kit's story palettes, sizes and `Story` (kit/src/storyShared).
    sourceSets.getByName("test") {
        java.srcDir("../kit/src/storyShared/java")
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// The screen stories (src/test/.../stories), as the kit's: android-ui-review.sh passes
// `-Psemaphore.shotsDir=<dir>`; without it they render to build/outputs/stories.
android.testOptions.unitTests.all { test ->
    test.systemProperty(
        "semaphore.colourVectors",
        layout.projectDirectory.file("../../../design/vectors/colour.json").asFile.absolutePath,
    )
    test.systemProperty("roborazzi.test.record", "true")
    providers.gradleProperty("semaphore.shotsDir").orNull?.let {
        test.systemProperty("semaphore.shotsDir", it)
        test.outputs.upToDateWhen { false }
    }
    providers.gradleProperty("semaphore.stories").orNull?.let {
        test.systemProperty("semaphore.stories", it)
    }
    // See kit/build.gradle.kts: the image's user has no home of its own.
    System.getenv("ANDROID_SDK_HOME")?.let { test.systemProperty("user.home", it) }
    test.maxHeapSize = "2g"
    test.testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

dependencies {
    api(project(":kit"))
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.foundation:foundation")
    // BackHandler: the system Back closes the top overlay first (design/behaviour, rule 20).
    implementation("androidx.activity:activity-compose:1.9.3")
    // The navigator's StateFlow.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.18.1")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.60.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.60.0")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
