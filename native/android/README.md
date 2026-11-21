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

1. `cargo ndk -t <each ABI> --platform 26 build --locked -p semaphore-mobile --release`, for
   `arm64-v8a` alone unless `ANDROID_ABIS` names others (`ANDROID_ABIS=arm64-v8a,x86_64`, or
   `ANDROID_ABIS=x86_64` for the emulator; the image has the Rust targets for both)
2. `uniffi-bindgen generate --language kotlin` over the resulting `libsemaphore_mobile.so`, in
   library mode, which writes both crates' Kotlin: `uniffi.semaphore` (the core) and
   `uniffi.semaphore_mobile` (`start`, `MobileHost`, `SecretStore`)
3. a symbol check, per ABI: both crates' exports, the JNI entry point and every `external fun`
   the bindings declare are in the shipped library
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

On the device, `DeviceCoreTest` (`app/src/androidTest`) proves both halves of that:

- `NativeLib.init` runs: the library loads, the JNI entry point is there, and
  `rustls-platform-verifier` accepts the JVM and `Context` it is given;
- a self-signed certificate is refused: the core signs in to an HTTPS server the script starts
  with a locally generated certificate, and the request fails as a transport error. The test
  reads that same certificate over JSSE first (trusting everything), and compares its SHA-256
  with the fingerprint the script computed, so a plain connection failure cannot pass for a
  refused one;
- a certificate the platform store trusts is accepted: the core signs in to `https://example.com`,
  the TLS handshake completes and the request comes back an HTTP/JSON answer, not a transport
  error. That needs outbound HTTPS from the emulator container.

Not proven: that a *locally installed* CA (a self-hoster's private CA in the device's trust
store) is trusted, since the test does not write to the emulator's trust store; and the
certificate is checked against the platform's store only, as the app configures no network
security config.

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
  session. A Keystore key that stops working is replaced (its secrets are lost: one new sign-in).
  It needs a device, so the JVM test uses an in-memory store and `DeviceCoreTest` takes
  the Keystore store through its paces: round trip, a new instance over the same directory,
  delete, and a file renamed to another key must not decrypt.
- Permissions: `INTERNET` and `ACCESS_NETWORK_STATE`, both granted at install.

Once a minified release build type exists (R8 is off today), it needs the keep rule upstream's
README asks for, or the verifier's Kotlin classes are stripped:
`-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }`

## Where the APK lands

`native/android/out/semaphore-android-debug.apk` (gitignored). To see what is in it:

```
unzip -l native/android/out/semaphore-android-debug.apk | grep -E 'lib/.*\.so|classes'
```

It contains `lib/arm64-v8a/libsemaphore_mobile.so` (the core and its transports),
`lib/arm64-v8a/libjnidispatch.so` (JNA) and `classes.dex`.

`native/scripts/android.sh` builds arm64-v8a alone by default. `rust-toolchain.toml` installs
`aarch64-linux-android` because the shared base image is also every other native tool; the Android
image adds `x86_64-linux-android` itself (`Dockerfile.android`), and `ANDROID_ABIS` picks which
ABIs cargo-ndk builds and `abiFilters` ships. The emulator's test passes `x86_64`
(`native/scripts/android-device-test.sh`, below).

## The instrumented test, on the emulator

```
native/scripts/android-device-test.sh
```

Docker-only as well, and on the same `semaphore-test` network. It builds
`semaphore-native-android-emulator` from `native/docker/Dockerfile.android-emulator` — the Android
image plus the pinned emulator and Android 14's AOSP (`default`, no Google APIs, no Play Store)
x86_64 system image — and runs one container on it, as the host user, with `--device /dev/kvm`:

1. `ANDROID_ABIS=x86_64 android.sh --inner`: the x86_64 libraries, the bindings, the debug APK and
   the JVM test, as usual (the connected task then builds the instrumented test APK itself);
2. an AVD, and the emulator headless (`-no-window -no-audio -gpu swiftshader_indirect`), started
   before the build so the boot overlaps it;
3. `semaphore-fake-server` on `127.0.0.1:18080` and a self-signed HTTPS server on
   `127.0.0.1:18443`, both in the same container as the emulator;
4. `adb wait-for-device`, then `sys.boot_completed`, then `./gradlew connectedDebugAndroidTest`,
   with the addresses and the certificate's fingerprint as instrumentation arguments
   (`-Pandroid.testInstrumentationRunnerArguments.*`);
5. the results, one line per test, and a count that fails the script on any failure, any skip or
   no tests at all.

The container is removed on exit (`EXIT`, `INT`, `TERM`), and with it the emulator and both
servers; no network is created or removed and no other container is touched.

**Why 10.0.2.2.** Inside an emulator, `10.0.2.2` is QEMU's user-mode network's alias for the
*emulator process's* loopback, so it reaches a server listening on `127.0.0.1` in the emulator's
own container. A server in a second container would be a different host, reachable from the guest
only as that container's bridge address, routed through the emulator's NAT: possible, but it needs
address discovery and the guest's DNS. In one container it is one address, and the app dials it
without knowing anything about Docker.

`DeviceCoreTest` covers:

- `NativeLib.init` (and that a second call is a no-op);
- `KeystoreSecretStore`: round trip of a long non-ASCII value, a new instance over the same
  directory, delete, and a file renamed to another key refused (the key is the GCM's associated
  data);
- the core against the fake server: sign in, communities, a message posted from another member
  arriving live, suspend, resume, a network loss and recovery, then shutdown; the refresh token is
  in Keystore-sealed files, and a second start with the same directory and a new store restores
  the session;
- the two TLS checks described under [TLS](#tls).

What it does not cover: a real device (the emulator has no hardware-backed Keystore, so the key is
software-backed there), screen behaviour, and a privately installed CA.

Two dependencies outside the checkout: the emulator needs `/dev/kvm` on the host, and the
trusted-certificate test needs outbound HTTPS from the container (`https://example.com`).
`Dockerfile.android-emulator` pins the emulator's and the system image's revisions and fails the
image build if sdkmanager installs a different one, so the runtime cannot change behind a
`docker build`; sdkmanager verifies every file against the checksums in Google's repository XML.

## Sideload

```
adb install -r native/android/out/semaphore-android-debug.apk
```

`-r` re-installs over an existing copy, which works because the debug key comes from the volume
above. The app has one screen: a sign-in form (server, username, password), then the session,
the connection and the communities' names.

## CI

`.github/workflows/native-android.yml` runs the same script on pull requests that touch
`native/**`, the JVM test included, and uploads the APK as an artifact. A second job in the same
workflow runs `native/scripts/android-device-test.sh`: GitHub's `ubuntu-latest` runners expose
`/dev/kvm`, once the runner's udev rule makes it usable by the build user (see
`ReactiveCircus/android-emulator-runner`'s README, "Running hardware accelerated emulators on
Linux runners", which is also where the rule comes from). As in the other `native-*.yml`
workflows, the build's caches are the Docker volumes inside the run; there is no separate
`actions/cache` step.
