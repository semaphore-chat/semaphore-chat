# Semaphore Chat for Android

D1 of the Android epic (#848): the first piece of the native Android client. It is an empty
Jetpack Compose app that links the client core in `native/crates/semaphore-core` through the
UniFFI surface in `native/crates/semaphore-ffi`, and shows a value read back from the core. No
networking, no sign-in, no other screens.

The app is licensed AGPL-3.0-only, like the rest of the workspace: see `LICENSE.md` at the
repository root.

## Build

```
native/scripts/android.sh
```

Everything runs in Docker; nothing is installed on the host. The script builds (or reuses) the
Android image from `native/docker/Dockerfile.android`, layered on the pinned native build image,
and inside it:

1. `cargo ndk -t arm64-v8a --platform 26 build --locked -p semaphore-ffi --release`
2. `uniffi-bindgen generate --language kotlin` over the resulting `libsemaphore_ffi.so`
3. `./gradlew assembleDebug` in this directory

Both the generated Kotlin and the `.so` files are written under `app/build/`, which is not source:
`app/build/generated/uniffi` and `app/build/rustJniLibs` are source directories of the `app`
module (see `app/build.gradle.kts`).

Caches are Docker volumes, so a rebuild is fast and none of it lands in the checkout:

|Volume|What it holds|
|---|---|
|`semaphore-native-cargo`|the cargo registry|
|`semaphore-native-target-android-<checkout>`|cargo's target directory for this checkout|
|`semaphore-android-gradle`|Gradle's distribution and dependency caches|
|`semaphore-android-home`|`HOME`, and with it `~/.android/debug.keystore`|

The debug keystore lives in that last volume on purpose: a keystore regenerated per build signs
every APK with a different key, and Android then refuses to install an update over an installed
copy (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Remove the volumes to start from scratch:

```
docker volume rm semaphore-android-gradle semaphore-android-home
```

## Where the APK lands

`native/android/out/semaphore-android-debug.apk` (gitignored). To see what is in it:

```
unzip -l native/android/out/semaphore-android-debug.apk | grep -E 'lib/.*\.so|classes'
```

It contains `lib/arm64-v8a/libsemaphore_ffi.so` (the core), `lib/arm64-v8a/libjnidispatch.so`
(JNA) and `classes.dex`.

Only arm64-v8a is built: `rust-toolchain.toml` installs `aarch64-linux-android` and the script
asks cargo-ndk for that ABI alone, so the APK runs on devices but not on the x86_64 emulator.
Adding `x86_64-linux-android` to `rust-toolchain.toml`, `-t x86_64` in the script and `"x86_64"`
to `abiFilters` is all it takes.

## Sideload

```
adb install -r native/android/out/semaphore-android-debug.apk
```

`-r` re-installs over an existing copy, which works because the debug key comes from the volume
above. The app has one screen: "Semaphore core loaded" and the session state, connection state
and community count that `SemaphoreCore` reports (a new core with no services reports
`SIGNED_OUT`, `DISCONNECTED` and no communities).

## CI

`.github/workflows/native-android.yml` runs the same script on pull requests that touch
`native/**` and uploads the APK as an artifact. As in the other `native-*.yml` workflows, the
build's caches are the Docker volumes inside the run; there is no separate `actions/cache` step.
