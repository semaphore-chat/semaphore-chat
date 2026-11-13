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
| `semaphore://` | `HKCU\Software\Classes\semaphore`: `URL Protocol`, `DefaultIcon`, `shell\open\command` = `"<exe>" "%1"` | the same values the app writes itself (`semaphore-platform-desktop/src/links.rs::registry_values`), so its own status check recognises the registration |
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
  `semaphore://` has `"%1"`, and the Add/Remove Programs values exist.

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
   shows `"<install dir>\semaphore-app.exe" "%1"`.
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
  dist -p semaphore-app` with `SEMAPHORE_PACKAGED=1`, `dumpbin /dependents` (fails if a
  non-system DLL is needed), and a zip with the exe, both licence files, the generated
  third-party list and a README, uploaded as `native-windows-portable`. Then it asserts
  `makensis -VERSION`, runs `scripts/package-windows.sh` (the installer and its `.sha256`) and
  uploads them as `native-windows-installer`. Signing is a clearly marked placeholder step, not
  a build step (see "Windows installer", "Not done").

Triggers: `workflow_dispatch` (optional `version` input) and pull requests whose paths match the
packaging scripts, the package Dockerfiles, the NSIS script and its icon, this document, the app
crate, the workspace manifests, the app's `semaphore://` registration or the workflow itself.
There is no `push`/tag trigger. Workflow permissions are `contents: read`, and the jobs only
upload artifacts: no release, tag, registry push or publish step. Actions are pinned to full
commit SHAs (`actions/checkout` v7 and `actions/upload-artifact` v7).

## Known gaps

- **Code signing.** Linux packages and the AppImage are unsigned; there is no apt/rpm repository
  or signed AppImage. The Windows exe and the NSIS installer are unsigned, so SmartScreen will
  warn; the RPM test installs with `--nogpgcheck` for the same reason. A release needs a signing key and a signed update manifest
  before auto-update can be safe.
- **Auto-update.** Not implemented. The Electron app uses electron-updater against GitHub
  Releases; the native client would need a signed manifest plus per-format installation.
- **macOS.** Not built. GPUI's macOS support exists, but our vendored video-surface patches are
  Linux and Windows only.
- **Flatpak.** Not built. It would need a manifest, the PipeWire and screen-capture portal
  permissions, and a keyring path that works inside the sandbox.
- **Windows installer signing, MSI and update hook.** The NSIS installer is built and checked,
  but it is unsigned (SmartScreen warns; no updater can trust it), there is no MSI and no
  auto-update integration beyond `/S`. It is per-user only: there is no elevated all-users mode,
  and no AppUserModelID on the shortcuts (that needs a third-party NSIS plug-in). See "Windows
  installer", "Not done".
- **Distribution.** The packages are artifacts only. There is no apt repository, no dnf
  repository, no GitHub Release and no AppImage update feed.
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
- **LGPL relinking.** The FFmpeg part of libwebrtc is LGPL-2.1-or-later; a public release should
  add the written offer or relinkable object files (see the licence section).
