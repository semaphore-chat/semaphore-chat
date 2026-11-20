pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // The Kotlin half of rustls-platform-verifier, which the TLS verifier in
        // libsemaphore_ffi.so calls into. The crate publishes it from this branch of its own
        // repository, not to Maven Central (its README, "Android"). app/build.gradle.kts pins the
        // version from native/Cargo.lock.
        maven {
            url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
        }
    }
}

rootProject.name = "SemaphoreChatAndroid"
include(":app")
