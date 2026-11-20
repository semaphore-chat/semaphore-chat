# Semaphore Chat for Android

The native Android client (epic #848): a Jetpack Compose app over the client core in
`native/crates/semaphore-core`. The app loads one native library, `libsemaphore_mobile.so`
(`native/crates/semaphore-mobile`), which carries the core's UniFFI surface
(`native/crates/semaphore-ffi`) and the real transports behind it (`native/crates/semaphore-net`).
So far it has one screen: sign in to a server, then see the session, the connection and the
communities.

The app is licensed AGPL-3.0-only, like the rest of the workspace: see `LICENSE.md` at the
repository root.

## Build

```
native/scripts/android.sh
```

Everything runs in Docker; nothing is installed on the host. The script builds (or reuses) the
Android image from `native/docker/Dockerfile.android`, layered on the pinned native build image,
and inside it:

1. `cargo ndk -t arm64-v8a --platform 26 build --locked -p semaphore-mobile --release`
2. `uniffi-bindgen generate --language kotlin` over the resulting `libsemaphore_mobile.so`, in
   library mode, which writes both crates' Kotlin: `uniffi.semaphore` (the core) and
   `uniffi.semaphore_mobile` (`start`, `MobileHost`, `SecretStore`)
3. a symbol check: both crates' exports, the JNI entry point and every `external fun` the
   bindings declare are in the shipped library
4. the JVM test (`app/src/test`): a host build of `libsemaphore_mobile.so` and the generated
   bindings, against `semaphore-fake-server` on loopback, signing in, hearing a live message,
   going through suspend, resume and a network loss, and restoring the session on a second start
5. `./gradlew assembleDebug testDebugUnitTest` in this directory

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

## TLS

`semaphore-net` builds its TLS client with rustls-platform-verifier, which on Android reads the
system trust store through the JVM. That needs two pieces outside Rust, both in place already:

- the crate's Kotlin component, `org.rustls:rustls-platform-verifier`, from the Maven
  repository named in its README (`settings.gradle.kts`); `app/build.gradle.kts` reads its
  version from `../Cargo.lock` so it can never disagree with the Rust crate;
- an initialisation call carrying the JVM and an application `Context`. `SemaphoreApp` (the
  `Application`, so any process start) calls `NativeLib.init` (idempotent), which loads `libsemaphore_mobile.so` and calls its JNI entry point, which calls
  `semaphore_net::init_android`, before the core is built.

The verifier's initialisation is only proven on a device, which waits for D6.

Cleartext `http://` servers work too: Android's cleartext policy governs the platform's HTTP
stacks, and the core's requests go through rustls and reqwest in Rust.

## The core on Android

- `SemaphoreHost` starts the core once per process (`semaphore_mobile::start`), and restores the
  session on the server signed in to last (semaphore-mobile remembers it in `data_dir`).
- Every core event bumps a counter the screen re-reads its views on. Events arrive on whatever
  thread changed core state, so the listener does nothing else.
- Lifecycle: `MainActivity.onStop` (not for a rotation) suspends the core, then waits up to
  300 ms for the secret store to finish its queued writes, while Android still counts the app as
  visible; `onStart` resumes it. Both are recorded before the core exists, so a core that finishes
  starting in the background starts suspended. A default-network callback maps onto
  `network_changed`.
- `NativeLib.init` sends the library's log records and panics to logcat (tag `semaphore`). A secret
  store that fails is logged there at error level once, and `MobileHost.secretStoreFailure()`
  says so: the session then won't survive a restart.
- `KeystoreSecretStore` keeps secrets as AES-256-GCM files under `noBackupFilesDir`, sealed with
  a non-exportable Android Keystore key; `save` is durable when it returns (temp file, fsync,
  rename, fsync of the directory), because a rotated refresh token lost to a crash ends the
  session. A Keystore key that stops working is replaced (its secrets are lost: one new sign-in). It needs a device, so the JVM test uses an in-memory store and the Keystore store gets
  its device test with D6.
- Permissions: `INTERNET` and `ACCESS_NETWORK_STATE`, both granted at install.

Once a minified release build type exists (R8 is off today), it needs the keep rule upstream's
README asks for, or the verifier's Kotlin classes are stripped:
`-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }`

## Design tokens and icons

`app/src/main/java/app/semaphorechat/android/design/Tokens.kt` and `Icons.kt` are generated for
this client the same way as the web and desktop clients' files: `python3
design/gen/gen_tokens.py` renders them from `design/tokens.json`, `design/colour.json` and
`design/icons/`. Do not edit them by hand; change the source or the generator and re-run it. CI
runs the generator's `--check` and fails when a copy is stale.

## Where the APK lands

`native/android/out/semaphore-android-debug.apk` (gitignored). To see what is in it:

```
unzip -l native/android/out/semaphore-android-debug.apk | grep -E 'lib/.*\.so|classes'
```

It contains `lib/arm64-v8a/libsemaphore_mobile.so` (the core and its transports),
`lib/arm64-v8a/libjnidispatch.so` (JNA) and `classes.dex`.

Only arm64-v8a is built: `rust-toolchain.toml` installs `aarch64-linux-android` and the script
asks cargo-ndk for that ABI alone, so the APK runs on devices but not on the x86_64 emulator.
Adding `x86_64-linux-android` to `rust-toolchain.toml`, `-t x86_64` in the script and `"x86_64"`
to `abiFilters` is all it takes.

## Sideload

```
adb install -r native/android/out/semaphore-android-debug.apk
```

`-r` re-installs over an existing copy, which works because the debug key comes from the volume
above. The app has one screen: a sign-in form (server, username, password), then the session,
the connection and the communities' names.

## CI

`.github/workflows/native-android.yml` runs the same script on pull requests that touch
`native/**`, the JVM test included, and uploads the APK as an artifact. As in the other `native-*.yml` workflows, the
build's caches are the Docker volumes inside the run; there is no separate `actions/cache` step.
