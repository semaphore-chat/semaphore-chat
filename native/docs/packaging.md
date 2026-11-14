# Packaging the native client

Linux packages are built by `native/scripts/package-linux.sh` and installed, checked and started
by `native/scripts/test-packages.sh`. The Windows installer is built by
`native/scripts/package-windows.sh` and compiled and checked on Linux by
`native/scripts/test-package-windows.sh`. CI (`.github/workflows/native-package.yml`) runs all
of them and uploads the artifacts; it never publishes a release or a repository.

The Electron app remains the reference for names and desktop integration: `Semaphore Chat`, the
`semaphore://` scheme, `Network;InstantMessaging;AudioVideo;` and the same user-facing
description. The native client has its own stable application id,
`app.semaphorechat.semaphore`, because its runtime registers and detects that id (see
`semaphore-platform-desktop/src/links.rs`); the Electron app's package id is `semaphore-chat`.

## Build

```bash
native/scripts/package-linux.sh
```

This writes, under `native/dist-packages/` (gitignored; `SEMAPHORE_PACKAGES_DIR` overrides):

| File | What |
|---|---|
| `Semaphore-Chat-Native-<version>-x86_64.AppImage` | AppImage with `AppRun`, the same tree as the packages, and a top-level `.desktop` and icon |
| `semaphore-chat-native_<version>_amd64.deb` | Debian package |
| `semaphore-chat-native-<version>-1.x86_64.rpm` | RPM package |
| `latest.json` | The release manifest the updater reads (below) |
| `SHA256SUMS` | Checksums of the three and the manifest |

The version is the `semaphore-app` crate's version in `native/crates/semaphore-app/Cargo.toml`
(today `0.0.0`), or `SEMAPHORE_VERSION` for CI. It must use digits, letters and dots only, so the
same string is valid in dpkg and RPM.

### Why a separate package image

The development image (`docker/Dockerfile.build`, Arch) links against glibc 2.44. Debian 13 has
2.41, Ubuntu 24.04 2.39 and Debian 12 2.36, so a binary built there does not start on any of them
(`docs/size.md`, "Release build environment"). `docker/Dockerfile.package` is a pinned Debian 12
image (glibc 2.36) with clang 22, rustup 1.99.1, `dpkg-deb`, `rpmbuild`, `appimagetool` 1.9.1 and
the native headers. package-linux.sh builds and runs only in that image; development, `fmt`,
`clippy`, tests and `cargo deny` keep using the Arch image.

The image is pinned by its base digest and by the rustup and appimagetool versions and hashes.
Debian's archive and apt.llvm.org are not snapshotted, so a rebuild months later may pick up a
newer package (not a different ABI). The output is reproducible on one host, and
`SOURCE_DATE_EPOCH` is the checkout's commit time.

## Test

```bash
native/scripts/test-packages.sh
```

Each check is a `--rm` container on the shared `semaphore-test` network. Nothing is installed on
the host and nothing opens a window:

| Package | Image | How |
|---|---|---|
| `.deb` | `debian:13-slim` and `ubuntu:24.04` | `apt-get install ./package.deb` resolves the declared dependencies, then the checks below |
| `.rpm` | `fedora:45` | `dnf install ./package.rpm`, then the checks below |
| AppImage | `debian:13-slim`, no FUSE | `--appimage-extract` to inspect the tree, `ldd`, then `--appimage-extract-and-run --version` |

The checks:

- the package manager lists `/usr/bin/semaphore-app`, the `.desktop` entry, the metainfo file and
  the licence files, and an icon at 16, 24, 32, 48, 64, 128, 256 and 512 px;
- `desktop-file-validate` accepts the entry;
- `ldd` reports no missing library;
- `semaphore-app --version` exits 0 and prints the same version as the package metadata.

`--version` is the start-up proof. It runs after the ELF loader has resolved every `NEEDED`
library and before the app opens a window, touches the keyring, starts a socket or reads the
data directory. The app has no offscreen window mode of its own; the headless screenshot and
slice rigs (`native/rigs/shot`, `native/rigs/slice`) link the app as a library and use GPUI's
test platform, so they cannot be used to test an installed binary. A separate process launch
under Xvfb/weston would need more libraries in the test container and would not prove more
about packaging.

The script prints each package's size and a `du -sh` of the installed files.

## What is in a package

All three carry the same tree:

```
/usr/bin/semaphore-app
/usr/share/applications/app.semaphorechat.semaphore.desktop
/usr/share/icons/hicolor/{16x16,24x24,32x32,48x48,64x64,128x128,256x256,512x512}/apps/app.semaphorechat.semaphore.png
/usr/share/metainfo/app.semaphorechat.semaphore.metainfo.xml
/usr/share/doc/semaphore-chat-native/LICENSE.md
/usr/share/doc/semaphore-chat-native/LICENSE_COM.md
/usr/share/doc/semaphore-chat-native/copyright
/usr/share/doc/semaphore-chat-native/THIRD-PARTY-LICENCES.txt
```

The AppImage adds `AppRun`, a top-level `app.semaphorechat.semaphore.desktop` and a top-level
`app.semaphorechat.semaphore.png`, and uses `Exec=semaphore-app %u` instead of the absolute path.

The `.desktop` entry has `MimeType=x-scheme-handler/semaphore;` and
`StartupWMClass=app.semaphorechat.semaphore`; the `Categories`, `Keywords`, `Name`, `GenericName`
and `Comment` values match the Electron entry. There is no `postinst`/`post` script: nothing
writes to the network or to a user's home during installation. The app writes `settings.json`
and its single-instance lock under the user's data directory at run time, as before.

## Logs, voice events and crash reports

Everything is written under the log folder inside the app's data directory
(`semaphore-app/src/logging.rs`):

| Platform | Log folder |
|---|---|
| Linux | `~/.local/share/semaphore/logs` (`$XDG_DATA_HOME/semaphore/logs`) |
| Windows | `%APPDATA%\semaphorechat\semaphore\data\logs` |

The data directory is the one `settings.json` and `last-server` already live in
(`DesktopPaths`, `directories`'s `ProjectDirs`). The settings' Desktop App tab has an "Open log
folder" button in its About section.

| File | What |
|---|---|
| `semaphore.log` | the app's log, at `SEMAPHORE_LOG` |
| `semaphore.1.log` … `semaphore.4.log` | the four previous files, newest first |
| `voice.log` | voice events (`target: "voice"`), the counterpart of Electron's `voiceLog.ts` |
| `voice.1.log`, `voice.2.log` | the two previous voice files |
| `crash-<YYYYMMDD>-<HHMMSS>-<ms>-<pid>.txt` | panic reports, the newest 10 kept |

`SEMAPHORE_LOG` takes `error`, `warn`, `info`, `debug` or `trace`. A packaged build defaults to
`info`; a build from a checkout defaults to `warn`, as before. stderr gets exactly the same lines
in the same format it always had; the files add a UTC timestamp and a level, one line per record.
Rotation is by hand and by size: an app file is capped at 2 MiB (five kept, 10 MiB in all) and a
voice file at 512 KiB (three kept). A line is never split; a line larger than a whole file goes in
alone and the next write rotates. Writers in one process share a lock, so two threads' lines never
interleave.

Nothing secret reaches a file. Every line goes through `semaphore_core::redact`: an access or
refresh token (`token=`, `"access_token":"…"`, `Bearer …`), a password, a `secret`, an invite code
in `semaphore://join/<code>`, and any URL query string are replaced by `<redacted>` (the whole
query, because a report never needs it). The app never logs message text, a token or a server
address with a query in the first place; the redaction is the second line of defence, and the test
`seeded_secrets_never_reach_a_file` writes representative lines through the real sink and greps the
files for them. A directory that can't be written (read-only, a full disk, a missing permission)
turns the files off, says so once on stderr and leaves the app running.

Voice events are the native equivalent of Electron's `voiceLog.ts` (which validates a renderer
entry and writes it with `electron-log`). They go to `voice.log` and stderr, not to
`semaphore.log`, and carry no channel, DM or user ids:

| Event | Fields |
|---|---|
| `join` | `target` (`channel` or `dm`), `muted`, `deafened` |
| `joined` | `target`, `duration_ms` |
| `join-failed` | `target`, `error_class` (`media_unreachable`, `server_unreachable`, `permission`, `not_found`, `session`, `server_error`, `unknown`, or `call_ended`), `duration_ms`, `message` (redacted, 500 characters) |
| `join-superseded` | `target`, `error_class`, `message` |
| `leave` | `target` |
| `call-ended` | `target`, `from` (the status it left), `message` |
| `reconnecting` | `target`, `attempt` |
| `reconnected` | `target`, `attempts` |
| `device-changed` | `which` (`input`, `output` or `camera`), `device` (`system-default` or the id) |
| `system-resume` | none: the OS woke the machine, as Electron's `system-resume` |

A panic writes a report next to the logs and keeps the default hook's stderr output: the hook runs
the previous hook first, then the report inside `catch_unwind`, so it never panics itself. The
report is plain text:

```text
Semaphore Chat crash report
time: 2026-11-13T12:34:56.789Z
version: 0.10.0
platform: linux x86_64
thread: tokio-runtime-worker
panic: called `Option::unwrap()` on a `None` value
location: crates/semaphore-app/src/voice.rs:123:45
backtrace:
   0: ...
```

No environment dump and no user data; the panic message goes through the same redaction. The
oldest reports are removed so ten stay, and the next start only logs that a report exists (no
dialog, nothing is sent anywhere). Remote reporting is not built: the Electron app has no
`crashReporter` either.

## Importing the Electron app's settings

On a first run only (no native `settings.json` yet), the app reads the Electron app's
`userData/settings.json` (`frontend/electron/main.ts:39-59`) and imports what has an exact native
equivalent: `closeToTray` becomes `close_to_tray`. The Electron folder is
`~/.config/Semaphore Chat` on Linux, `%APPDATA%\Semaphore Chat` on Windows and
`~/Library/Application Support/Semaphore Chat` on macOS. The file is only read; nothing there is
ever written, and an existing native `settings.json` is never touched. A file with a wrong type, an
unknown `version` or no JSON object imports nothing (`semaphore-app/src/electron_import.rs`).

That file holds only `closeToTray` today. The server URL and the renderer settings (volumes,
devices, drafts) are in Chromium's `localStorage` (LevelDB), the refresh token is encrypted in
`userData/secure-tokens`: none is read, so the server URL stays unset until the first sign-in and
devices are picked again. Electron has no start-minimised or notification toggles in a file either.

## Auto-update

The native client has its own updater. It reads one JSON document from the release host, compares
its version with the one this build reports (`semaphore-app --version`), downloads the artifact for
the way this copy was installed, checks its SHA-256, and installs it where that is possible. The
Electron app's electron-updater is the reference for the states, the wording and the schedule; see
"Per format" below for where native deliberately stops short of what Electron does.

### The release manifest

The release workflow assembles it from every platform's packages (`scripts/assemble-release.py`;
see "Releasing a native preview" below), and `scripts/package-linux.sh` writes a Linux-only one
next to the packages it built, which `scripts/test-packages.sh` checks:

```json
{
  "version": "1.4.0",
  "notes_url": "https://github.com/semaphore-chat/semaphore-chat/releases/tag/v1.4.0",
  "artifacts": [
    { "kind": "appimage", "arch": "x86_64",
      "url": "https://github.com/semaphore-chat/semaphore-chat/releases/download/v1.4.0/Semaphore-Chat-Native-1.4.0-x86_64.AppImage",
      "sha256": "0369a40525e0beb9e9a2aa81a9470a1e4aac203da286b7cefabf2f7c5df1d8a6",
      "size": 30345720 }
  ]
}
```

- `version` is a bare semantic version (`1.4.0`, `2.0.0-rc.1`): no `v`, and pre-releases order
  before their release. Newer means semver precedence: build metadata (`+ci.5`) never makes a
  version newer. **A stable build ignores pre-release versions** in the feed; a pre-release build
  (`2.0.0-beta.1`) accepts them.
- `notes_url` is optional; the update card links it when it is there.
- `kind` is `appimage`, `deb`, `rpm`, `windows-zip` or `windows-nsis` (the installer, listed so
  the feed describes every published file; no install downloads it yet). A kind this build
  doesn't know, or another
  `arch` (`x86_64`, `aarch64`), is ignored, so a future macOS artifact doesn't stop today's
  client. Two artifacts for the same kind and architecture are refused.
- Every artifact must have `url`, `sha256` (64 hex digits) and `size` (1 byte to 512 MiB).
- `url` and `notes_url` must be `https`; plain `http` is accepted only for a loopback address,
  which is how the end-to-end rig serves a feed. A URL with a user name or password is refused.

The URLs are where the artifacts *will* be published, not where they are built: `SEMAPHORE_UPDATE_BASE_URL`
sets that prefix (default: the tagged GitHub release download URL), and `SEMAPHORE_RELEASE_NOTES_URL`
overrides the notes link. The build writes it right after `SHA256SUMS` (`finish_artifacts` in the
script) and refuses a `version` that isn't a semantic version the updater would accept.
`scripts/test-packages.sh` checks the generated manifest against the built files without building
them again, with `scripts/check-manifest.py`: semver version, kinds, https URLs, and each artifact's
SHA-256 and size against the file on disk. To test just that step on any three files:
`SEMAPHORE_PACKAGES_DIR=<dir> scripts/package-linux.sh --finish-artifacts <deb> <rpm> <AppImage> <version>`
then `scripts/check-manifest.py <dir>/latest.json <deb> <rpm> <AppImage>` (no build, no image).

### Trust: the signed feed

The manifest is signed. A release publishes `latest.json` and next to it `latest.json.sig`: one
line of base64 (no newline), the detached **Ed25519** signature of the manifest's exact bytes, as
`openssl pkeyutl -sign -inkey <key> -rawin -in latest.json | base64 -w0` writes it
(`scripts/manifest-signature.sh`, which CI and the local test both run). The updater fetches the
manifest, then the signature from the same URL with `.sig` appended, under the same redirect,
https, timeout (one 30 s deadline for both) and size rules (the signature is capped at 1 KiB),
and verifies before `ReleaseManifest::parse` reads a single field. A missing (404/410),
malformed or wrong signature is a failure without Retry ("The update was refused: ... Nothing
was downloaded."), and nothing is downloaded; the next hourly check reads the feed again. A
signature host answering 5xx is a network fault like the manifest's, and retryable. Then, as
before, the artifact must hash to the SHA-256 the signed manifest names.

**Which keys.** `TRUSTED_UPDATE_KEYS` in `crates/semaphore-app/src/update.rs` lists the public keys
a build accepts (base64 of the raw 32 bytes); any one verifying is enough, which is what makes
rotation possible. The first key's PEM is committed as `packaging/update-signing-key.pub.pem`
(CI verifies with it, and a test checks it is in the list). The private key is the repository
secret `NATIVE_UPDATE_SIGNING_KEY` and exists nowhere else in the repository.

**When a signature is required** (`signature_policy` in
`crates/semaphore-platform-desktop/src/update/signature.rs`, every cell unit-tested):

| Feed | `SEMAPHORE_UPDATE_PUBLIC_KEY` | Check |
|---|---|---|
| the build's own (`SEMAPHORE_UPDATE_MANIFEST_URL`) | ignored | required, against `TRUSTED_UPDATE_KEYS` |
| `SEMAPHORE_UPDATE_URL`, https | not set | required, against `TRUSTED_UPDATE_KEYS` |
| `SEMAPHORE_UPDATE_URL`, https | set | required, against that key only |
| `SEMAPHORE_UPDATE_URL`, loopback | not set | none: transport plus hash (the w13 rig, tests) |
| `SEMAPHORE_UPDATE_URL`, loopback | set | required, against that key only |
| `SEMAPHORE_UPDATE_URL`, either | set, not a key | updates off ("The update signing key this build was given isn't one.") |

`SEMAPHORE_UPDATE_PUBLIC_KEY` takes a PEM `PUBLIC KEY` block, the base64 of its DER, or the base64
of the raw 32 bytes. So a remote feed is never unchecked; only a loopback one without a key is.

**Where the maths is.** The Ed25519 check is ring's (`semaphore_net::ed25519::verify`), already in
the graph through rustls; the policy and the fetch are in `semaphore-platform-desktop`, which is
handed the function (`update::Ed25519Verify`) because ring needs MSVC headers that crate's
Windows check in the build image doesn't have. Its tests use a SHA-256 stand-in for the plumbing;
`semaphore-net`'s tests verify a signature OpenSSL made (`fixtures/update-signature/`: a manifest,
its signature and the throwaway key's public half only).

**Redirects.** The updater has its own HTTP client (the app's TLS trust, its own rules): every
redirect hop is checked before it is followed, and must be `https` without a user name or password.
Plain `http` is followed only to a loopback address *and* only when the request itself started at
a loopback address (the rig, the tests); an https release host can never send the client to
`http://127.0.0.1:…`. At most 10 hops. Where the response finally came from is checked again by
the same rule. A refused redirect is a refusal (not retried as a network fault).

### Where the feed comes from

The app checks only when it was built with a feed and this copy can update:

- the build-time constant `SEMAPHORE_UPDATE_MANIFEST_URL`, which only `native-release.yml` sets,
  to `https://github.com/semaphore-chat/semaphore-chat/releases/download/native-preview-feed/latest.json`
  (the feed release, below). Local, pull-request and `native-package.yml` builds leave it empty,
  so they have nothing to check and their settings say so;
- `SEMAPHORE_UPDATE_URL` overrides it at run time and is held to the same rule (HTTPS, or loopback
  for a test), so an override cannot point the app at a plain-HTTP feed; its signature check is
  the table above;
- if this build's version isn't a semantic version, or its architecture isn't `x86_64`/`aarch64`,
  the updater stays off.

`InstallEnv::current()` (`crates/semaphore-platform-desktop/src/update/install.rs`) decides what
this copy is, without writing anything:

| Copy | Detected by | An update |
|---|---|---|
| AppImage | `$APPIMAGE` names a regular file, the running executable is inside `$APPDIR` (the image's mount: so this process runs from that image), and the file's folder is the user's own (owned by them, not writable by group or others, so not `/tmp`) and writable | replaces that file, then restarts |
| `.deb` | the executable is under `/usr` or `/opt`, is not writable, and `/etc/os-release` is Debian-like | downloads the package; the app shows how to install it |
| `.rpm` | the same, on a Fedora-like (`dnf`) or SUSE-like (`zypper`) distribution | the same, with that manager's command |
| Windows portable zip | a Windows build | announces the release; opens the release page, downloads nothing |
| anything else | a checkout, a sandbox, a package in a directory the user owns, a distribution it doesn't recognise, an AppImage in a shared folder | never updates |

`APPIMAGE`/`APPDIR` alone prove nothing: an AppImage runtime exports them to everything it starts,
so a `.deb` build or a checkout started from an AppImage-packaged terminal inherits the terminal's.
Without the executable inside `$APPDIR` they are ignored and the copy is judged like any other
executable. An AppImage whose folder others can write is not updated at all: the temporary and
backup names beside it couldn't be trusted.

Checks run three seconds after the app starts and then hourly, as Electron's do
(`electron/main.ts`'s `setupAutoUpdater`), and "Check for updates" in Settings > Desktop app runs
one at once. **One check or download runs at a time**: a check started while another (or a
download) is running does nothing. A newer release found while an update is downloaded replaces
it; a failed check, a feed with the same or an older version, or a newer release whose download
fails leaves the downloaded update "Ready". A release whose artifact didn't match its hash (or
was larger than it said) isn't fetched again by the hourly check, only by "Check for updates" or
Retry. The manifest fetch must finish within 30 s; a download that moves less than 64 KiB in a
minute is given up.

### Per format

| Format | Native | Electron (electron-updater 6.8.3) |
|---|---|---|
| AppImage | downloads beside the running file (`<file>.part`, created new, 0600, no symlink followed), reads it back and checks its size and SHA-256, gives it the replaced file's permission bits, keeps the old file as `<file>.old`, renames the new one into place, and offers "Restart to update" (see "Restarting" below) | `AppImageUpdater.doInstall` deletes the running file (`unlinkSync`) and moves the download into its place, then starts it |
| `.deb` | downloads to `<cache>/updates/`, then shows the folder and `sudo apt install '<path>'` (apt, not `dpkg -i`, so a release with a new dependency installs). It does not elevate or install | `DebUpdater` runs `dpkg -i` (and `apt-get -f -y` on failure) through `pkexec`/`sudo` |
| `.rpm` | the same, with `sudo dnf install '<path>'` or `sudo zypper install '<path>'` | `RpmUpdater` runs `dnf`/`zypper` through `pkexec`/`sudo` |
| Windows (zip or installer) | announces the version; the card's Release notes link is the manifest's `notes_url`, the versioned release's page with both Windows files; nothing is downloaded. Running the installer silently (`/S`) is a later step | n/a (electron-builder ships NSIS/MSI) |

Native never asks for elevated rights: installing a package is left to the user's package manager.
That is a deliberate difference from Electron, which installs `.deb`/`.rpm` under `pkexec` (see
`frontend/src/__tests__/electron/linuxUpdaterInstall.node.test.ts` and `patches/README.md`).

The old AppImage's `.old` copy is removed on the next start, which proves the new file runs. An
update that fails (a dropped transfer, a wrong hash, a full disk), or an app that quits mid-download,
leaves the running file alone and the partial download deleted; a `.part` left by a killed process
is removed at the next start. A completed package download removes older packages from
`<cache>/updates/`. A package path that isn't UTF-8 gets no command (a lossy one would name another
file); the card points at the folder instead.

**No automatic rollback.** If the new AppImage doesn't start, nothing switches back on its own:
until the next successful start removes it, the previous build is `<file>.old` beside it, and the
user can rename it back.

### Restarting

"Restart to update" is refused during a call (restarting would end it): the card says to leave
the call first, and Retry brings the restart back. Otherwise the app starts the new AppImage
*before* quitting, with `--after-update`, the launch's `--server` if it had one, and the
environment without the old image's traces (`APPIMAGE`, `APPDIR`, `ARGV0`, `OWD` dropped, entries
inside the old mount removed from `PATH`-like lists), in the folder the user launched from. If it
can't be started, the app keeps running and the card says why. If it starts, the app quits; after
its shutdown it stops the single-instance listener, removes the socket and unlocks, in that order
(`ServingInstance::release`). The new build, meanwhile, waits on the lock itself
(`instance::acquire_after_update`) instead of handing its launch to the running app as a second
launch would, so it becomes the primary exactly when the old one lets go, however long shutting
down takes (if the old process dies instead, the kernel frees the lock with the same result). A
new build that waited 60 s without getting the lock exits and leaves the old app running.

### What the user sees

A card in the shell's bottom-left notice corner, above the connection chip, with Electron's
states and wording: "Version 1.4.0 is available." (with Release notes), "Downloading update...
40%" and a progress bar, "Update downloaded! Version 1.4.0 is ready to install." with "Restart to
update", the download's install command for a package, and a failure with "Retry" when asking
again could work. The card can be dismissed per version (saved in `settings.json` as
`dismissed_update`), and a dismissed failure stays away until the next attempt. Settings > Desktop
app carries the same status and the manual check, the running version in its About section, and,
when updates are off, why (no feed, or an install that can't update).

## Sizes

The `dist` binary and the three packages built from it (version 0.10.0, 2026-11-12). The
installed tree is the same in all three; the AppImage adds its runtime (about 0.9 MB).

| What | Bytes | MiB |
|---|---:|---:|
| `semaphore-app` (stripped, `dist`) | 76,747,016 | 73.2 |
| `semaphore-chat-native_0.10.0_amd64.deb` | 22,755,076 | 21.7 |
| `semaphore-chat-native-0.10.0-1.x86_64.rpm` | 24,432,568 | 23.3 |
| `Semaphore-Chat-Native-0.10.0-x86_64.AppImage` | 30,345,720 | 28.9 |
| installed tree (binary + desktop files + licences) | about 77.6 MB | about 74 |

The RPM payload is zstd (`_binary_payload w19.zstdio`, matching Fedora), the .deb is xz -6, and
the AppImage is a squashfs with appimagetool's block compression.


### Runtime assets

Nothing is read from the installation prefix at run time. Everything the app draws or plays is
compiled in:

| Asset | Where |
|---|---|
| Notification and call sounds (9 WAV files) | `crates/semaphore-app/assets/sounds`, `include_bytes!` in `sounds.rs` |
| Roboto 400/500/600/700 | `crates/semaphore-ui/assets/fonts`, `include_bytes!` in `theme/mod.rs` |
| Emoji names and categories | `crates/semaphore-ui/assets/emoji/emoji.json`, `include_str!` in `emoji/data.rs` |
| 317 design icons and Material icons | `crates/semaphore-design/assets/icons`, `include_bytes!` in `generated.rs` |
| gpui-kit's Lucide icons | `gpui-kit-assets`, RustEmbed in the crate |
| Tray/window icon | `crates/semaphore-platform-desktop/assets/icon.png`, `include_bytes!` in `icon.rs` |

The only files the running app reads are the user's: `settings.json`, `last-server`, the
single-instance lock/socket, attachments the user picks, and downloads the user chooses. The
package's own icon and `.desktop` file are for the desktop environment, not for the binary. This
was confirmed by running `--version` in a container with no `/usr/share/semaphore` tree and by
reading the asset loaders (`semaphore-ui/src/kit/assets.rs` falls back to gpui-kit's embedded
`Assets`; `semaphore-app/src/files.rs` serves in-memory files under `semaphore-file/`).

## Runtime libraries and the bundle decision

Measured with `readelf -d`, `objdump -T` and `ldd` on the `dist` binary. It needs at most
`GLIBC_2.35` (the Debian 12 build image has 2.36), so the packages declare `>= 2.35`: Debian 12,
Ubuntu 22.04 and newer, and Fedora 45 satisfy it.

### `NEEDED`: declared, never bundled

These are in the package's `Depends` (.deb) / `Requires` (.rpm). All of them are part of a
normal Linux desktop and have a stable ABI. Bundling them would duplicate the system's copies and
make security updates harder.

| Library | Debian/Ubuntu | Fedora | Why |
|---|---|---|---|
| `libc.so.6`, `ld-linux-x86-64.so.2`, `libm.so.6` | `libc6 (>= 2.35)` | `glibc >= 2.35` | the C library; never bundled |
| `libgcc_s.so.1` | `libgcc-s1` | `libgcc` | unwinding for Rust and C++ |
| `libglib-2.0.so.0`, `libgobject-2.0.so.0`, `libgio-2.0.so.0` | `libglib2.0-0` | `glib2` | libwebrtc's Wayland/portal glue and GPUI's D-Bus integration |
| `libpipewire-0.3.so.0` | `libpipewire-0.3-0` | `pipewire-libs` | screen capture and camera access through PipeWire |
| `libasound.so.2` | `libasound2` | `alsa-lib` | ALSA device enumeration/fallback through `cpal` |
| `libxcb.so.1` | `libxcb1` | `libxcb` | X11 connection |
| `libxkbcommon.so.0`, `libxkbcommon-x11.so.0` | `libxkbcommon0`, `libxkbcommon-x11-0` | `libxkbcommon`, `libxkbcommon-x11` | keyboard layout and X11 key handling |

The transitive libraries `ldd` also shows (`libgmodule-2.0`, `libmount`, `libffi`, `libpcre2-8`,
`libz`, `libXau`, `libXdmcp`, `libxcb-xkb`, `libblkid`, `libsystemd`) are dependencies of glib and
PipeWire and are pulled in by their packages. They are not separate package dependencies because
the sonames are implementation details of those packages.

### Opened with `dlopen`: recommended, not required

Missing ones disable a feature rather than stopping the app, so they are `Recommends` (.deb) or
`Recommends` (.rpm):

| Library | Debian/Ubuntu | Fedora | Feature |
|---|---|---|---|
| `libvulkan.so.1` | `libvulkan1` (+ `mesa-vulkan-drivers`) | `vulkan-loader` (+ `mesa-vulkan-drivers`) | the wgpu renderer; without it GPUI can fall back to GL |
| `libEGL.so.1`, `libGL.so.1` | `libegl1`, `libgl1` | `mesa-libEGL`, `mesa-libGL` | the GL fallback |
| `libpulse.so.0` | `libpulse0` | `pulseaudio-libs` | PulseAudio devices through `cpal` |
| `libwayland-client.so.0`, `libwayland-egl.so.1` | `libwayland-client0`, `libwayland-egl1` | `wayland-libs-client`, `wayland-libs-egl` | Wayland windows and capture |
| `libX11.so.6`, `libXext`, `libXfixes`, `libXdamage`, `libXcomposite`, `libXrandr` | `libx11-6`, `libxext6`, `libxfixes3`, `libxdamage1`, `libxcomposite1`, `libxrandr2` | `libX11`, `libXext`, `libXfixes`, `libXdamage`, `libXcomposite`, `libXrandr` | X11 windows and capture |
| `libva.so.2`, `libva-drm.so.2` | `libva2`, `libva-drm2` | `libva` | VA-API hardware video |
| `libdrm.so.2`, `libgbm.so.1` | `libdrm2`, `libgbm1` | `libdrm`, `mesa-libgbm` | DMA-BUF video frames |
| colour emoji font | `fonts-noto-color-emoji` | `google-noto-color-emoji-fonts` | colour emoji (text falls back to the system's fonts otherwise) |
| `xdg-open` | `xdg-utils` | `xdg-utils` | opening links in the browser |
| Secret Service | `gnome-keyring` or `kwallet` | `gnome-keyring` or `kwallet` | the refresh token; the app uses the OS keyring through D-Bus, not libsecret |

### AppImage

The AppImage does **not** bundle glibc, glib, PipeWire, ALSA, xcb, xkbcommon, Vulkan, GL or the
X11 libraries. AppImage's convention is to use the host's system libraries, and bundling these
would either conflict with the user's desktop (glib, PipeWire, systemd) or add LGPL code with
relinking obligations for no benefit: a machine that can show a Window and play a call already
has them. The AppImage test container therefore installs the same declared libraries as the
`.deb` before running it. A fully self-contained AppImage is possible later by copying the
closure into `usr/lib` and setting `LD_LIBRARY_PATH` in `AppRun`, but that is a separate decision.

## Third-party licences

`cargo deny check` remains the CI gate: `native/deny.toml` allows licences by name, so a GPL,
LGPL or AGPL crate fails unless it is one of our own AGPL crates. The package contains no
GPL-licensed code.

`THIRD-PARTY-LICENCES.txt` is generated at package time from:

- `cargo metadata` and `cargo tree` for every normal dependency of `semaphore-app` on Linux
  (name, version, SPDX licence, source);
- `third_party/vendor/webrtc-sys/NOTICE.md` (the vendored notices, including the Apache-2.0 and
  MIT texts);
- a component table for the statically linked libwebrtc;
- the Roboto (SIL OFL-1.1) and Material Icons (MIT) licence texts.

libwebrtc is statically linked. Its components are permissive except FFmpeg, which WebRTC builds
with `ffmpeg_branding = "Chrome"` and without GPL code: the H.264 decoder, a little libavutil and
— since the player is part of every package (`--features player`) — the demuxers and audio
decoders it uses (AAC included, AAC-LC only; docs/player.md) are LGPL-2.1-or-later. That is not
GPL, and `cargo deny` has nothing to say about a C++ archive, but distributing a statically linked
LGPL component carries relinking terms. The file names the
upstream sources and the LiveKit prebuilt; a release that ships these packages should add the
LGPL written offer (or ship the relinkable objects) and have that reviewed. This is listed under
"Known gaps" below.

## Windows installer

`native/scripts/package-windows.sh` compiles `native/packaging/windows/installer.nsi` into
`Semaphore-Chat-Native-Setup-<version>-x64.exe` and writes the matching
`...x64.exe.sha256` (`sha256sum` format: `<hash>  <name>`). The Windows job of
`native-package.yml` runs it on the runner image's NSIS (3.10, installed with Chocolatey and on
`PATH`; see `actions/runner-images`, `images/windows/scripts/build/Install-NSIS.ps1`) after the
dist exe is built, and uploads the installer and its hash next to the portable zip. The version
comes from `PACKAGE_VERSION`; `--version` / `SEMAPHORE_VERSION` override it. The four-part
file-version resource is derived from it (`1.2.3-rc.1` becomes `1.2.3.0`).

The reference is the Electron installer, `frontend/electron-builder.yml` lines 54-66
(`oneClick: false`, `allowToChangeInstallationDirectory: true`, `createDesktopShortcut`,
`createStartMenuShortcut`, `shortcutName: Semaphore Chat`, `installerIcon`/`uninstallerIcon:
build/icon.ico`) and electron-builder's NSIS templates; its behaviour is summarised below.

| | Electron (electron-builder) | Native |
|---|---|---|
| Mode | assisted; per-user by default, an all-users option elevates through UAC | assisted; **per-user only**, `RequestExecutionLevel user`, never elevates |
| Install directory | `%LOCALAPPDATA%\Programs\Semaphore Chat`, changeable on the directory page | the same |
| Shortcuts | Start menu (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Semaphore Chat.lnk`) and desktop (`%USERPROFILE%\Desktop\Semaphore Chat.lnk`) | the same names and targets |
| Add/Remove Programs | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>`: DisplayName `Semaphore Chat <version>`, DisplayVersion, Publisher, DisplayIcon, UninstallString, QuietUninstallString, EstimatedSize, NoModify/NoRepair | `HKCU\...\Uninstall\app.semaphorechat.semaphore` with the same value set |
| `semaphore://` | `HKCU\Software\Classes\semaphore`: `URL Protocol`, `DefaultIcon`, `shell\open\command` = `"<exe>" -- "%1"` (the `--` ends the app's options, so a link can't add one) | the same values the app writes itself (`semaphore-platform-desktop/src/links.rs::registry_values`), so its own status check recognises the registration. The uninstaller also removes the older `"<exe>" "%1"` form, which the app rewrites on its next start |
| Run after finish | finish-page "Run" checkbox | the same |
| Upgrade | closes the running app, runs the previous version's uninstaller silently, then installs | the same (`/S _?=<old dir>`) |
| Compression | electron-builder's default (7z/LZMA) | solid LZMA (`SetCompressor /SOLID lzma`) |
| Icon | `frontend/build/icon.ico` | the same file, copied unchanged to `native/packaging/windows/semaphore-chat.ico` (the Rust exe has no embedded icon resource) |
| App id | `com.semaphorechat.app` | `app.semaphorechat.semaphore`, the native client's own id, so both apps can be installed side by side |

The installer also:

- closes the running `semaphore-app.exe` of the current user before touching its files: an
  interactive install asks first and aborts with exit code 2 on Cancel; `/S` closes it without
  asking; a graceful `taskkill` is retried, then a forced one, then it refuses with a message;
- removes the previous version by running its uninstaller from `%TEMP%` with
  `/S _?=<old install dir>`, and aborts with a clear message if that fails;
- deletes the `semaphore://` key on uninstall **only** when it points at the installed exe, so
  uninstalling the native client does not break an Electron install that owns the scheme;
- never deletes the user's data directory (settings, session): Electron's
  `deleteAppDataOnUninstall` defaults to false and this installer has no switch for it;
- adds no services, scheduled tasks, firewall rules or `%PATH%` entries.

### Silent switches

| Switch | Effect |
|---|---|
| `/S` | Silent install or uninstall (no pages, no prompts; a running app is closed without asking) |
| `/D=<dir>` | Install directory (NSIS convention: last argument, unquoted, absolute) |
| `/currentuser` | Ignored (unknown switches are ignored); there is no all-users mode |
| `Uninstall Semaphore Chat.exe /S` | Silent uninstall (`QuietUninstallString` points here) |

There is no license page, matching the commented-out `license` option in
`frontend/electron-builder.yml`; the third-party licences are installed as
`THIRD-PARTY-LICENCES.txt` next to the exe (the zip and the Linux packages carry the same file).

### Not done

- **Signing.** The installer and the exe are unsigned, so SmartScreen warns and no auto-updater
  can trust them. One clearly marked placeholder step in the workflow shows where `signtool`
  goes (on the exe before packaging and on the installer after).
- **Auto-update hook.** There is no `--updated` handling and no update manifest; `/S` is the
  switch a future updater would use to install silently.
- **MSI.** Not built. NSIS is what the Electron app ships, and WiX would need a second toolchain
  for no user-visible gain.
- **Per-machine install, AUMI, components page.** Electron's installer offers an all-users mode
  by elevating; the native one is per-user only. electron-builder sets the AppUserModelID on the
  shortcuts with the third-party `WinShell` plug-in; this installer uses stock NSIS only and does
  not. There is no components page (Electron has none either without custom NSIS code).

### Licences of the installer itself

NSIS is zlib-licensed (`COPYING` in the NSIS distribution; Debian's `nsis` 3.08-3+deb12u1
lists `Zlib` as its main licence). The script uses only the compiler's stock headers and
plug-ins: `MUI2`, `LogicLib`, `x64`, `FileFunc`, `System.dll` and `nsExec.dll`, plus NSIS's own
wizard bitmap. The solid-LZMA compressor is the LZMA SDK, covered by the package's
`lzma-cpl-exception` stanza (the package also lists bzip2, Expat, NTP and wxWindows for other
bundled pieces). These are compiler/runtime terms and add nothing to the installer or to the
application it installs. No third-party NSIS plug-in (`nsProcess`, `WinShell`, `StdUtils`,
`SpiderBanner`, ...) is used, so nothing else adds terms.
`native/scripts/test-package-windows.sh` fails if one appears. The icon is the repository's own
(`frontend/build/icon.ico`, the Electron installer's), not a new asset.

### Verifying it on Linux

`native/scripts/test-package-windows.sh` runs in `native/docker/Dockerfile.nsis` (Debian 12,
stock NSIS 3.08, `7z`) with no network:

- compiles the script with `-WX` (warnings are errors) for `0.10.0` and a prerelease
  `1.2.3-rc.1`;
- checks the artifact name, the `.sha256` content and `sha256sum -c`;
- lists the installer with `7z` and requires the exe, `THIRD-PARTY-LICENCES.txt` and
  `Uninstall Semaphore Chat.exe` inside, solid LZMA and NSIS-3 Unicode;
- from the script text: every registry key written by the install section is deleted by the
  uninstall section (directly or through a parent key), every `CreateShortCut` has a matching
  `Delete`, each installed file has its own `Delete` and the directory is removed only if empty, `%APPDATA%` is never touched,
  `semaphore://` has `-- "%1"`, and the Add/Remove Programs values exist.

This proves the installer compiles and describes what it will do; it cannot install, start or
uninstall it. That needs Windows.

### After merge: check on the Windows runner

The workflow uploads `native-windows-installer`; run these against a Windows machine (or a
disposable VM) with the artifact from the *next* `native-package` run:

1. Run `Semaphore-Chat-Native-Setup-<version>-x64.exe` interactively. The directory page shows
   `%LOCALAPPDATA%\Programs\Semaphore Chat`; no UAC prompt; the finish-page Run box starts the
   app; both shortcuts exist.
2. Sign in, then open `semaphore://join/<code>` from `Start > Run`: the running app (or a fresh
   one) receives the link. `reg query HKCU\Software\Classes\semaphore\shell\open\command`
   shows `"<install dir>\semaphore-app.exe" -- "%1"`.
3. Settings > Apps lists `Semaphore Chat <version>` with the icon, publisher and a non-zero
   estimated size.
4. Upgrade: install an older build, start it, then run the newer installer. The app closes
   (after the OK prompt when interactive), the upgrade completes, there is still exactly one
   entry in Settings > Apps, and the shortcuts still work.
5. Silent: `Semaphore-Chat-Native-Setup-<version>-x64.exe /S /D=C:\Temp\sc-test`, exit code 0,
   no window; then `"C:\Temp\sc-test\Uninstall Semaphore Chat.exe" /S`, exit code 0; the
   directory, shortcuts, ARP entry and `HKCU\Software\app.semaphorechat.semaphore` are gone and
   the app's data directory is still there.
6. If the Electron app is installed too: note which app opens `semaphore://` after each install,
   then uninstall the native client and confirm the Electron registration still works.

### Known limits

`windows-latest` currently runs two image generations (Windows Server 2022 and 2025), both
listing NSIS 3.10; the job asserts `makensis -VERSION` before building. Debian's NSIS is 3.08,
older than the runner's; the script uses only long-standing NSIS 3 features, and the `-WX`
compile on both versions is the guard.

## CI

`.github/workflows/native-package.yml` has two jobs:

- **linux-packages** (`ubuntu-latest`, 120 min): checkout, `scripts/package-linux.sh`,
  `scripts/test-packages.sh`, upload `native/dist-packages/*` as `native-linux-packages`.
- **windows-portable** (`windows-latest`, 120 min): rustup from `rust-toolchain.toml`, the same
  `fxc.exe` and vendored-renderer checks as `native-spike.yml`, `cargo build --locked --profile
  dist -p semaphore-app --features player` with `SEMAPHORE_PACKAGED=1`, `dumpbin /dependents` (fails if a
  non-system DLL is needed), and a zip with the exe, both licence files, the generated
  third-party list and a README, uploaded as `native-windows-portable`. Then it asserts
  `makensis -VERSION`, runs `scripts/package-windows.sh` (the installer and its `.sha256`) and
  uploads them as `native-windows-installer`. Signing is a clearly marked placeholder step, not
  a build step (see "Windows installer", "Not done").

`native-release.yml` calls it (`workflow_call`, inputs `version`, `update_feed_url`, `release`):
that is the only build that compiles a feed in, and with `release` the Windows job also checks
`semaphore-app.exe --version` prints the release version. See "Releasing a native preview".

Triggers: `workflow_dispatch` (optional `version` input) and pull requests whose paths match the
packaging scripts, the package Dockerfiles, the NSIS script and its icon, this document, the app
crate, the workspace manifests, the app's `semaphore://` registration or the workflow itself.
There is no `push`/tag trigger. Workflow permissions are `contents: read`, and the jobs only
upload artifacts: no release, tag, registry push or publish step. Actions are pinned to full
commit SHAs (`actions/checkout` v7 and `actions/upload-artifact` v7).

## Releasing a native preview

The native client ships as a **preview channel** next to the Electron releases: GitHub
pre-releases tagged `native-vX.Y.Z`, built by `.github/workflows/native-release.yml`. The Electron
lane (`v*` and `electron-v*` tags, `electron-build.yml`) is untouched, and no native tag matches
its patterns or the Docker and Helm ones.

### What a release publishes

1. **`native-vX.Y.Z`**, a pre-release (never "Latest"), with: the AppImage, `.deb`, `.rpm`, the
   Windows zip and installer (unsigned: SmartScreen warns), `SHA256SUMS`, `latest.json` and
   `latest.json.sig`. Notes: a short header plus the commits touching `native/` since the previous
   `native-v*` tag (`scripts/release-notes.sh`).
2. **`native-preview-feed`**, a fixed pre-release whose only assets are `latest.json` and
   `latest.json.sig`, replaced by each release **after** the versioned release is published and
   every file the manifest names is checked to be there. Installed copies read
   `.../releases/download/native-preview-feed/latest.json`; the artifact URLs inside point at the
   versioned release.

**Why a feed release.** GitHub's `releases/latest` (and `releases/latest/download/<asset>`) skips
pre-releases, so it would never see a preview, and making previews full releases would make them
the repository's "Latest", which the Electron app's electron-updater reads. A release at a fixed
tag has a fixed asset URL whatever its status, and as a pre-release it can never become "Latest"
either. The feed never moves backwards: re-running an older tag leaves a newer feed alone. The
two feed files are replaced in one upload call, not atomically: a client that reads the old
manifest and the new signature in between fails that check without retry and succeeds an hour
later.

Versions are plain `X.Y.Z` (the Windows package step takes no `-rc.1`), validated before anything
builds; the packages are built as that version, the release job refuses a file whose name
carries another one, `test-packages.sh` checks each Linux binary's `--version` against its
package, and the Windows job checks the exe's.

### Procedure (owner)

1. **Dry run first**, from the commit you mean to release: Actions > Native release > Run
   workflow, `version` = `X.Y.Z`, `dry_run` ticked (the default). It builds and tests every
   package with the feed URL compiled in, assembles and validates `latest.json`, writes the notes
   into the run summary, proves the signing commands with a throwaway key, and uploads
   `native-release-X.Y.Z` (the release directory and `notes.md`) as a workflow artifact. It uses no
   secret and creates no tag or release. (CLI: `gh workflow run native-release.yml -f version=X.Y.Z`.)
2. Check the artifact: install a package, `semaphore-app --version`, read `notes.md`.
3. **Publish** by pushing the tag on that commit:
   `git tag -a native-vX.Y.Z -m "native-vX.Y.Z" && git push origin native-vX.Y.Z`.
   (Or dispatch again with `dry_run` unticked: allowed from the default branch only, refused if
   the tag exists, and it creates the tag at the dispatched commit.)
4. The run signs `latest.json` with `NATIVE_UPDATE_SIGNING_KEY` in the `assemble` job (read-only
   token; the key is written to a mode-600 file under `$RUNNER_TEMP` and removed in an `always()`
   step), verifies it with `packaging/update-signing-key.pub.pem`, and the `publish` job (the only
   one with `contents: write`, which never sees the key) verifies again, creates the draft
   pre-release with every asset, publishes it, checks the assets, and updates the feed last.
5. Verify: `gh release view native-vX.Y.Z`, and that
   `curl -sL https://github.com/semaphore-chat/semaphore-chat/releases/download/native-preview-feed/latest.json`
   shows the new version; an installed older preview offers the update within an hour (or at once
   from Settings > Desktop app > Check for updates).

A failed run publishes nothing it shouldn't: before `publish` nothing is written, and the
versioned release is a draft until all its assets are uploaded. If `publish` fails after the
release is out but before the feed moved, re-run the failed job (the release exists, so delete
the draft or release first if `gh release create` refuses).

### Key rotation

1. Generate the new pair offline: `openssl genpkey -algorithm ed25519 -out new.pem` and
   `openssl pkey -in new.pem -pubout`.
2. Add the new public key (base64 of the raw 32 bytes: the last 32 bytes of the PEM's DER,
   `openssl pkey -pubin -in new.pub.pem -outform DER | tail -c 32 | base64`) to
   `TRUSTED_UPDATE_KEYS`, keep the old one, and release that build **signed with the old key**:
   every installed copy trusts only the old key.
3. Once that release is out, replace `NATIVE_UPDATE_SIGNING_KEY` with the new private key and
   `packaging/update-signing-key.pub.pem` with the new public key (the test requires it to be
   listed), and sign from then on with the new key.
4. Remove the old key from the list after the copies that only know it are no longer expected to
   update (they keep working until then).

### If the key is lost or leaks

- **Lost** (the secret deleted, no copy): installed copies can never verify another release, so
  they never update again. Ship a release with a new key in `TRUSTED_UPDATE_KEYS` and tell preview
  users to install it by hand from the release page; from then on rotate as above. Keep an offline
  copy of the private key to avoid this.
- **Leaked**: anyone with it can sign a feed that installed copies accept, but the artifact still
  has to come from an https URL and match the hash in that manifest. Rotate at once: a release
  that adds the new key and *removes* the leaked one, signed with the leaked key one last time
  (that is the only key the installed copies have), then the new secret and PEM. Copies that
  never take that release remain exposed; say so in the release notes.

## Known gaps

- **Code signing.** Linux packages and the AppImage are unsigned; there is no apt/rpm repository
  or signed AppImage. The Windows exe and the NSIS installer are unsigned, so SmartScreen will
  warn; the RPM test installs with `--nogpgcheck` for the same reason. The update feed itself is
  signed (Ed25519, above), so auto-update trusts the signed manifest's SHA-256, not just HTTPS.
- **Auto-update.** Implemented against `latest.json` (above): AppImage replaces itself and
  restarts; `.deb`/`.rpm` are downloaded and the user installs them; Windows is announced only.
  The feed is signed and published by `native-release.yml` (above). Still missing: running the
  NSIS installer (`/S`) for the Windows case, and a first real release proving it end to end.
- **macOS.** Not built. GPUI's macOS support exists, but our vendored video-surface patches are
  Linux and Windows only.
- **Flatpak.** Not built. It would need a manifest, the PipeWire and screen-capture portal
  permissions, and a keyring path that works inside the sandbox.
- **Windows installer signing, MSI and update hook.** The NSIS installer is built and checked,
  but it is unsigned (SmartScreen warns; no updater can trust it), there is no MSI and no
  auto-update integration beyond `/S`. It is per-user only: there is no elevated all-users mode,
  and no AppUserModelID on the shortcuts (that needs a third-party NSIS plug-in). See "Windows
  installer", "Not done".
- **Distribution.** Preview releases go to GitHub Releases (`native-v*` pre-releases, above).
  There is no apt or dnf repository.
- **Coexistence with Electron.** Both applications register `semaphore://` and install a
  `.desktop` entry on Linux; whichever desktop environment chooses last wins. The native
  package's entry is detected as packaged, so the app does not overwrite it in
  `~/.local/share`. The packages use different ids, so both can be installed at once. On
  Windows the native installer writes the same `HKCU\Software\Classes\semaphore` values the
  app does, and its uninstaller removes that key only when it points at the native exe, so
  uninstalling the native client leaves an Electron-owned registration intact.
- **Older distributions.** The highest symbol version is `GLIBC_2.35`, so Ubuntu 22.04 (2.35)
  should work but is not in the test matrix; Ubuntu 20.04 and Debian 11 (2.31) are not
  supported. Supporting them needs an older build image (or a zig/musl build, which libwebrtc's
  prebuilt archive does not allow).
- **AppImage is not self-contained.** See above: it uses the host's desktop libraries.
- **Reproducibility.** The base image digest and Rust/LLVM/appimagetool versions are pinned, but
  Debian's archive and apt.llvm.org are not snapshotted.
- **LGPL relinking.** The FFmpeg part of libwebrtc is LGPL-2.1-or-later, and the packages ship
  its use: the H.264 and AAC decoders, and the player's demuxers. A public release should add the
  written offer or relinkable object files (see the licence section).
