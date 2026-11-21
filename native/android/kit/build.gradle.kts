// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.
//
// The theme (the derived palette, the touch density, the fonts) and the kit components. This
// module never sees the Rust core: the app hands it a palette, so its stories render on the JVM
// under Robolectric with no native library (src/test, native/scripts/android-ui-review.sh).
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.semaphorechat.android.kit"
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

    sourceSets.getByName("main") {
        // The design system's fonts (design/fonts), copied in by copyDesignFonts below, so the
        // files have one home in the repository.
        res.srcDir(layout.buildDirectory.dir("generated/designFonts"))
    }

    testOptions {
        unitTests {
            // Robolectric reads the merged resources: the fonts and the theme's strings.
            isIncludeAndroidResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// This is the kit module, so ../../ is native/ and ../../../ the repository root.
val designFonts = layout.projectDirectory.dir("../../../design/fonts")
val copyDesignFonts by tasks.registering(Sync::class) {
    from(designFonts) { include("*.ttf") }
    into(layout.buildDirectory.dir("generated/designFonts/font"))
}
tasks.named("preBuild") { dependsOn(copyDesignFonts) }

// The screenshot stories (src/test/.../stories). native/scripts/android-ui-review.sh passes
// `-Psemaphore.shotsDir=<dir>` to write every story's PNGs there; without it they go to
// build/outputs/stories, so every test run renders every story and one that throws fails. The vectors give the stories
// their palettes without the Rust library.
android.testOptions.unitTests.all { test ->
    test.systemProperty(
        "semaphore.colourVectors",
        layout.projectDirectory.file("../../../design/vectors/colour.json").asFile.absolutePath,
    )
    test.systemProperty(
        "semaphore.personVectors",
        layout.projectDirectory.file("../../../design/vectors/person-colour.json").asFile.absolutePath,
    )
    // Roborazzi writes a capture only when recording; the stories always write theirs.
    test.systemProperty("roborazzi.test.record", "true")
    providers.gradleProperty("semaphore.shotsDir").orNull?.let {
        test.systemProperty("semaphore.shotsDir", it)
        // A new render every run: Gradle must not answer from its cache.
        test.outputs.upToDateWhen { false }
    }
    providers.gradleProperty("semaphore.stories").orNull?.let {
        test.systemProperty("semaphore.stories", it)
    }
    // The image's user has no passwd entry, so the JVM's user.home is "?" and Robolectric would
    // put its android-all jars in a "?" directory here. The image's home is the volume at
    // ANDROID_SDK_HOME (/cache/home, mounted by android.sh and android-ui-review.sh), so the jars
    // are fetched once.
    System.getenv("ANDROID_SDK_HOME")?.let { test.systemProperty("user.home", it) }
    test.maxHeapSize = "2g"
    test.testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    api("androidx.compose.material3:material3")
    api("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.18.1")
    // 1.60.0: the newest Roborazzi built with Kotlin 2.0 (2.0.21, as this build) and Compose 1.7
    // (this BOM). 1.61.0 and later are built with Kotlin 2.3, whose metadata Kotlin 2.0 cannot
    // read; moving past it means bumping Kotlin and the Compose compiler plugin first.
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.60.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.60.0")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    // The activity Robolectric hosts a captured composable in.
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
