# Semaphore Chat for Android

The native Android client (epic #848): a Jetpack Compose app over the client core in
`native/crates/semaphore-core`. The app loads one native library, `libsemaphore_mobile.so`
(`native/crates/semaphore-mobile`), which carries the core's UniFFI surface
(`native/crates/semaphore-ffi`) and the real transports behind it (`native/crates/semaphore-net`).
So far it connects to a server, signs in (and restores the session next start), shows the
communities and their channels, and reads a text channel: its messages, paged back to the start,
with live messages, the typing line and "Jump to latest". Writing comes next (D6 part 2).

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
  with a locally generated certificate (its name, `IP:10.0.2.2`, matches, so trust is the only
  reason left to refuse it), and the request fails as a transport error. The script then checks
  the test's saved logcat for the verifier's `UnknownIssuer`. The test
  reads that same certificate over JSSE first (trusting everything), and compares its SHA-256
  with the fingerprint the script computed, so a plain connection failure cannot pass for a
  refused one;
- a certificate the platform store trusts is accepted: the core signs in to `https://dl.google.com`
  (a host the run's own downloads need), the TLS handshake completes and the request comes back
  as something other than a transport error, or a failure before any handshake (TLS not
  initialised, trust store unreadable). Nothing is asserted about the host's body. The JSSE
  pre-check is retried three times. That needs outbound HTTPS from the emulator container.

Not proven: that a *locally installed* CA (a self-hoster's private CA in the device's trust
store) is trusted, since the test does not write to the emulator's trust store; and the
certificate is checked against the platform's store only, as the app configures no network
security config.

Cleartext `http://` servers work too: Android's cleartext policy governs the platform's HTTP
stacks, and the core's requests go through rustls and reqwest in Rust.

## The core on Android

- `SemaphoreHost` starts the core once per process (`semaphore_mobile::start`) on
  `Dispatchers.Default`, with an `AppModel` over it that restores the session on the server
  signed in to last (semaphore-mobile remembers it in `data_dir`).
- Core events go into an unbounded channel (`EventPipe`) and nothing else: they arrive on whatever
  thread changed core state. `CoreStore` drains each burst on a background coroutine and re-reads
  core's views into `StateFlow`s of the screens' models (`screens/.../Models.kt`).
- `AppModel` holds the screen stack (`Navigator`, hand-rolled: the session replaces it, taps push,
  Back pops; an open sheet takes Back first), the connect and sign-in forms, and the last community
  per server (`last-community` in `noBackupFilesDir`).
- Await uniffi's `suspend` functions on a dispatcher that dispatches (Default, IO, Main), never one
  that resumes inline: the resumption comes through a JNA callback on a Tokio worker, and running
  the next poll inside it makes JNA's detach abort the process.
- Lifecycle: `MainActivity.onStop` (not for a rotation) suspends the core, then waits up to
  300 ms for the secret store to finish its queued writes, while Android still counts the app as
  visible; `onStart` resumes it and re-reads the core's views. Both are recorded before the core
  exists, so a core that finishes starting in the background starts suspended. A default-network
  callback maps onto `network_changed`.
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

## Design tokens and icons

`kit/src/main/java/app/semaphorechat/android/design/Tokens.kt` and `Icons.kt` are generated for
this client the same way as the web and desktop clients' files: `python3
design/gen/gen_tokens.py` renders them from `design/tokens.json`, `design/colour.json` and
`design/icons/`. Do not edit them by hand; change the source or the generator and re-run it. CI
runs the generator's `--check` and fails when a copy is stale.

## The Compose kit

`kit/` is a library module with the design system for Compose: `SemaphoreTheme`, the touch
density, the fonts and the components (Text, Button, IconButton, TextField, ListRow, Avatar,
Spinner, Alert, Island, Card, Icon), with the web kit's names and options. It never sees the Rust
core: the app derives the palette through the FFI (`derivePalette`, `CoreTheme.kt`) and hands the
kit a `KitPalette`.

- **Fonts:** Figtree and Bricolage Grotesque from `design/fonts/` (pinned and hash-checked there),
  copied into the kit's font resources at build time. Their licence and the icons' ship in the
  APK as `assets/open_source_licences.txt`.
- **Chat pieces:** `kit/.../kit/chat/` has the web chat kit's read side: `MessageText` (drawn
  from pre-cut pieces), `MessageRow`, `MessageQuote`, `DayDivider`, `TypingLine` and
  `JumpToLatest`. Their rules come from Rust through the FFI, not a Kotlin copy:
  `message_pieces` cuts a message's text at core's UTF-8 byte offsets and checks each link with
  `semaphore_core::links::check_link` (a link draws its checked label, a lookalike host as
  punycode; a refused one is plain text), and `typing_text` and `jump_text` are
  `semaphore_design::chat`'s. `LinkOpener` opens only the address `check_link` returns.
- **Screens:** `screens/` is a library module with the app's screens (connect, sign-in, start,
  the phone Lounge with the dock and the "All communities" sheet, a channel's chat), fed plain
  Kotlin models, so they render without the core. Their stories (`ScreenStories.kt`,
  `ChatStories.kt`, `screen-*`) render like the kit's.
- **Live chat:** `CoreStore` hands core's `MessagesChanged` list changes, in order, to one
  `ConversationStore` per conversation, which applies them to its rows and publishes one
  `ChatModel` per burst. The list is a reversed `LazyColumn` keyed by core's row `seq`, so a page
  of older rows lands above what is read without moving it; its scroll state lives in the store,
  so it survives leaving the channel and a rotation. Core re-syncs the open conversation after a
  reconnect or a resume and sends the changes like any others.
- **Stories:** `kit/src/test/.../stories/KitStories.kt`. `KitStoryShotsTest` renders every story
  under Robolectric (native graphics, SDK 34) at two phone sizes in four themes (light and dark,
  violet and amber, palettes from `design/vectors/colour.json`). `native/scripts/android.sh` runs
  them with the other JVM tests; `native/scripts/android-ui-review.sh` renders them on a base and
  on the working tree and reports what changed.

## Where the APK lands

`native/android/out/semaphore-android-debug.apk` (gitignored) for the default ABI set, arm64-v8a:
the one to sideload. Any other `ANDROID_ABIS` writes `semaphore-android-debug-<abis>.apk` beside
it (`ANDROID_ABIS=x86_64` gives `semaphore-android-debug-x86_64.apk`, the emulator's, which a phone
refuses), so the device test never replaces the sideloadable file. To see what is in it:

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

The container is named per checkout (`native-android-device-<8 hex>`), removed on exit (`EXIT`,
`INT`, `TERM`; a TERM removes it within seconds), labelled so `scripts/test-stack.sh ls` lists a
leftover from a killed run, and removed again at the next run's start. The AVD lives under the
container's `/tmp`, so it goes with it. With the container go the emulator and both
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
trusted-certificate test needs outbound HTTPS from the container (`https://dl.google.com`).
`Dockerfile.android-emulator` pins the emulator (build 16970787, 37.3.10) and the system image
(`x86_64-34_r04.zip`) by their build-numbered URLs and a sha256 each, like cmdline-tools and
Gradle, so the runtime cannot change behind a `docker build`.

## Sideload

```
adb install -r native/android/out/semaphore-android-debug.apk
```

`-r` re-installs over an existing copy, which works because the debug key comes from the volume
above.

## CI

`.github/workflows/native-android.yml` runs the same script on pull requests that touch
`native/**`, the JVM test included, and uploads the APK as an artifact. A second job in the same
workflow runs `native/scripts/android-device-test.sh`: GitHub's `ubuntu-latest` runners expose
`/dev/kvm`, once the runner's udev rule makes it usable by the build user (see
`ReactiveCircus/android-emulator-runner`'s README, "Running hardware accelerated emulators on
Linux runners", which is also where the rule comes from). As in the other `native-*.yml`
workflows, the build's caches are the Docker volumes inside the run; there is no separate
`actions/cache` step.
