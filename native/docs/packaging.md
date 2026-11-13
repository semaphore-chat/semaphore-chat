# Packaging the native client

Linux packages are built by `native/scripts/package-linux.sh` and installed, checked and started
by `native/scripts/test-packages.sh`. CI (`.github/workflows/native-package.yml`) runs both and
uploads the artifacts; it never publishes a release or a repository.

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
| `SHA256SUMS` | Checksums of the three |

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
with `ffmpeg_branding = "Chrome"` and without GPL code: the H.264 decoder and a little libavutil
are LGPL-2.1-or-later. That is not GPL, and `cargo deny` has nothing to say about a C++ archive,
but distributing a statically linked LGPL component carries relinking terms. The file names the
upstream sources and the LiveKit prebuilt; a release that ships these packages should add the
LGPL written offer (or ship the relinkable objects) and have that reviewed. This is listed under
"Known gaps" below.

## CI

`.github/workflows/native-package.yml` has two jobs:

- **linux-packages** (`ubuntu-latest`, 120 min): checkout, `scripts/package-linux.sh`,
  `scripts/test-packages.sh`, upload `native/dist-packages/*` as `native-linux-packages`.
- **windows-portable** (`windows-latest`, 120 min): rustup from `rust-toolchain.toml`, the same
  `fxc.exe` and vendored-renderer checks as `native-spike.yml`, `cargo build --locked --profile
  dist -p semaphore-app` with `SEMAPHORE_PACKAGED=1`, `dumpbin /dependents` (fails if a
  non-system DLL is needed), and a zip with the exe, both licence files, the generated
  third-party list and a README, uploaded as `native-windows-portable`.

Triggers: `workflow_dispatch` (optional `version` input) and pull requests whose paths match the
packaging scripts, the package Dockerfile, this document, the app crate, the workspace manifests
or the workflow itself. There is no `push`/tag trigger. Workflow permissions are
`contents: read`, and the jobs only upload artifacts: no release, tag, registry push or publish
step. Actions are pinned to full commit SHAs (`actions/checkout` v7 and
`actions/upload-artifact` v7).

## Known gaps

- **Code signing.** Linux packages and the AppImage are unsigned; there is no apt/rpm repository
  or signed AppImage. The Windows exe is unsigned, so SmartScreen will warn; the RPM test installs with
  `--nogpgcheck` for the same reason. A release needs a signing key and a signed update manifest
  before auto-update can be safe.
- **Auto-update.** Not implemented. The Electron app uses electron-updater against GitHub
  Releases; the native client would need a signed manifest plus per-format installation.
- **macOS.** Not built. GPUI's macOS support exists, but our vendored video-surface patches are
  Linux and Windows only.
- **Flatpak.** Not built. It would need a manifest, the PipeWire and screen-capture portal
  permissions, and a keyring path that works inside the sandbox.
- **Windows installer.** The workflow produces a portable zip, not an MSI/NSIS installer. An
  installer needs WiX (or `cargo-wix`) or NSIS, Start menu and desktop shortcuts, the
  `semaphore://` registry keys (the app already writes them on first start when
  `SEMAPHORE_PACKAGED=1`), and Authenticode signing. No paid tool is required.
- **Distribution.** The packages are artifacts only. There is no apt repository, no dnf
  repository, no GitHub Release and no AppImage update feed.
- **Coexistence with Electron.** Both applications register `semaphore://` and install a
  `.desktop` entry; whichever desktop environment chooses last wins. The native package's entry
  is detected as packaged, so the app does not overwrite it in `~/.local/share`. The packages use
  different ids, so both can be installed at once.
- **Older distributions.** The highest symbol version is `GLIBC_2.35`, so Ubuntu 22.04 (2.35)
  should work but is not in the test matrix; Ubuntu 20.04 and Debian 11 (2.31) are not
  supported. Supporting them needs an older build image (or a zig/musl build, which libwebrtc's
  prebuilt archive does not allow).
- **AppImage is not self-contained.** See above: it uses the host's desktop libraries.
- **Reproducibility.** The base image digest and Rust/LLVM/appimagetool versions are pinned, but
  Debian's archive and apt.llvm.org are not snapshotted.
- **LGPL relinking.** The FFmpeg part of libwebrtc is LGPL-2.1-or-later; a public release should
  add the written offer or relinkable object files (see the licence section).
