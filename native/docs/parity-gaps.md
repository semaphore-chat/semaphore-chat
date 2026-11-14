# Native client parity gaps

The remaining work to reach parity with the web/Electron client, ordered by how visible it is to a
user. Every row of `docs/parity-plan.md`'s inventory (128 rows in 11 tables) was re-read against the
code on 2026-11-13; this file lists what that read found still missing. Statuses and evidence live
in the plan; this is the gap list only.

Sizes are S (hours), M (days), L (a week or more) of one engineer's work, including tests and a
story. "Depends" names the thing that must happen first.

## A. Missing features

None: A1 closed on 2026-11-13 (see the closing list below).

## B. Partial features (behaviours missing)

None left: every partial feature the audit found is closed (see the list under Counts).

## C. Platform and distribution

### C1. Windows code signing

- **Web/Electron:** also unsigned (`electron-build.yml` has no signing step), so this is a
  distribution gap rather than a parity one: SmartScreen warns on the exe and the installer.
- **Native:** `native-package.yml` has a marked placeholder step; the exe and the NSIS setup are
  unsigned.
- **Missing:** Authenticode signing of `semaphore-app.exe` and the installer, plus the timestamp
  step.
- **Size:** M (buy/obtain a certificate, wire the CI step, verify).
- **Depends:** product/ops decision (certificate) and CI secrets.

### C2. Update manifest signing

- **Web/Electron:** electron-updater checks signatures only when a publisher name is configured.
- **Native:** `native/crates/semaphore-platform-desktop/src/update/manifest.rs:432`
  `verify_signature` is a no-op returning `Ok(())`; trust today is HTTPS plus the manifest's
  SHA-256.
- **Missing:** a real signature scheme (minisign/ed25519 or similar) and its verification, plus the
  key handling in packaging.
- **Size:** M.
- **Depends:** decision + key management.

### C3. A published update feed

- **Web/Electron:** electron-updater reads the GitHub Release for the tag (`frontend/electron/main.ts`,
  published by `.github/workflows/electron-build.yml`).
- **Native:** `BUILD_FEED` is `option_env!("SEMAPHORE_UPDATE_MANIFEST_URL")`, empty today
  (`native/crates/semaphore-app/src/update.rs:27`); a build with no feed starts no schedule and
  says "Updates aren't checked in this build" in settings.
- **Missing:** the hosted `latest.json` (the format is written by `scripts/package-linux.sh`) and a
  release job that publishes it with the artifacts.
- **Size:** S (build/hosting), plus C1/C2 for trust.
- **Depends:** publishing (C4), signing (C2).

### C4. Publishing the packages, and Flatpak

- **Web/Electron:** `.github/workflows/electron-build.yml` attaches the Windows installer and the
  Linux AppImage, `.deb` and `.rpm` to the GitHub Release of a `v*` tag.
- **Native:** the Windows zip, NSIS installer, AppImage, `.deb` and `.rpm` are built and verified by
  `native/scripts/package-*.sh` and `native-package.yml`, which explicitly never creates a release.
  Flatpak doesn't exist for Electron either, so it isn't a parity gap; it would be a new
  distribution channel (the AppStream metainfo and icons are already there).
- **Missing:** a release lane that attaches the artifacts (and the feed from C3) to a tag, plus the
  version bumping the Electron release lane does.
- **Size:** M.
- **Depends:** release/product decision; C1 and C2 for a trustworthy first release.

### C9. macOS

- **Web/Electron:** ships none (docs-site `desktop-app.md`: "macOS builds are not yet available").
- **Native:** GPUI supports macOS and the app menu is the one `cx.set_menus` draws there, but there
  is no macOS CI, no bundle, no signing/notarisation and nothing has been run.
- **Missing:** only if the product decides to ship macOS; until then this is not a parity gap.
- **Size:** L.
- **Depends:** product decision.

**Checked and already built** (not gaps): window position/size and maximised state
(`native/crates/semaphore-app/src/desktop.rs`, `WindowState`), close to tray and the tray icon on
Linux (StatusNotifier) and Windows, the unread badge on both, single instance with link forwarding,
`semaphore://` registration, and keep-awake during calls. Logging, the voice event log and crash
reports are built (`semaphore-app/src/{logging,crash}.rs`, documented in `packaging.md`), the
Electron settings import runs on first run (`semaphore-app/src/electron_import.rs`; only
`closeToTray` exists in its `settings.json`), and `slice-e2e.sh` runs nightly in
`.github/workflows/native-e2e.yml`.

## D. Things only a person can check

These are proofs, not code. Each is a release checklist item.

1. **Wayland screen share on a real desktop.** The portal dialog, DMA-BUF import,
   `set_max_frame_rate` and `set_target_size` are untested; the headless run is X11 only
   (`native/docs/av-publish.md`, "Not proven yet"). Needs a real device.
2. **Windows screen capture and camera.** WGC, the DXGI fallback and DirectShow have never run on a
   real Windows PC; the CI job builds and links only. Needs a Windows desktop.
3. **Real cameras.** V4L2 (MJPEG, YUY2 at their real rates), libcamera, the portal in a sandbox,
   hot-plug while the settings dialog is open, and a camera unplugged mid-call (the share stays
   `On` with a frozen picture). Needs hardware.
4. **Real audio and video quality between two machines.** Echo cancellation, noise suppression and
   AGC on real devices; the VAD threshold's feel; push-to-talk latency; screen-share sharpness at
   each preset; the 1080p60 bitrate ceiling. The release checklist already asks Mike for this.
5. **The installed packages on real desktops.** `scripts/test-packages.sh` installs and starts them
   in containers, but the desktop entries, icons, tray behaviour on GNOME/Hyprland (no
   StatusNotifier host: the app then refuses to hide on close) and the uninstaller's cleanup need a
   person. The NSIS installer cannot be installed by CI at all
   (`native/scripts/test-package-windows.sh` inspects it only).
6. **Auto-update end to end.** A published feed, an installed older build updating itself (AppImage
   replace and restart, `.deb`/`.rpm` hand-off to the package manager) and a dismissed card staying
   dismissed. Needs C3/C4 first.
7. **Link handling with both apps installed.** Which app wins, whether a forwarded link focuses the
   first instance, and whether the installer/desktop registration survives the other app's
   uninstall.
8. **Accessibility with Orca and Windows Narrator.** Live regions now exist (A1: message arrivals,
   shortcut feedback, alerts/status), and the AT-SPI `Announcement` was proved headless in
   `scripts/desktop-probe.sh`; whether Orca reads each once, politely, and nothing for your own
   message still needs ears. Windows Narrator's `LiveRegionChanged` path is untested, and labels,
   focus order and the shortcut sheet still need ears too.
9. **CPU and memory under a real call.** The design's figures for software VP8 are estimates
   (`docs/av-publish.md`), and the image budget figures come from the T2 fling, not from a real
   conversation with video.
10. **Cold start, resume and network change on a real desktop.** Logind/NetworkManager/Windows power
    notifications are unit-tested, but sleep/resume across a real suspend and a network handover
    mid-call are manual.

## E. Items the plan lists as decided not to build

1. **First-run instance setup wizard.** Owner decision: setup happens on the web; the connect screen
   learns `needs_setup` from `GET /onboarding/status` and tells the user to finish in a browser
   (plan "W6/W7 defaults"; `native/crates/semaphore-app/src/root/u9.rs`). The inventory row is n/a.
2. **Admin debug page (event injection).** Owner decision; `/admin/debug` stays `Route::Unbuilt`
   (`native/crates/semaphore-ui/src/nav/mod.rs:194`). The web's notification debug page and PWA
   debug are n/a on desktop. Core has the W6 admin calls; only the page is absent.
3. **Voice isolation.** No counterpart in libwebrtc's APM (echo cancellation, noise suppression and
   AGC only); the web's toggle is a browser `voiceIsolation` audio-processing constraint
   (`frontend/src/hooks/useVoiceSettings.ts:15`). Native offers the three it can apply
   (`semaphore-media-livekit/src/audio/apm.rs`, settings in `ui/src/settings/voice.rs`). Revisit only
   with a DSP decision.
4. **A server proxy for GIF and link-preview media.** Backend #716 closed as not planned; the decision
   is a direct fetch behind the off-by-default "Load images from other sites (link previews, GIFs)"
   switch (`app/src/settings.rs` v3→v4 migration; `app/src/files.rs` third-party fetcher). The
   viewer's IP is exposed while the switch is on, as the settings description says.
5. **Web Push (service worker, VAPID).** Desktop n/a: the app relies on its live socket, and no push
   path exists for a client that isn't running (plan section 4). Mobile would need FCM/APNs/
   UnifiedPush backend work.
6. **Per-member channel permission overrides (`OverwriteTarget.MEMBER`).** Left out because the API
   has no management routes for them (W5 defaults); role and channel overrides are built
   (`ui/src/roles/overrides.rs`).
7. **Auto-start at login.** n/a: Electron doesn't have it either (nothing writes
   `setLoginItemSettings`), and the docs claim is wrong on both sides.
8. **Reload, force reload, developer tools and zoom in the app menu.** No webview to reload; the kit
   draws in px, so a window-level rem scale would need kit changes (plan's W13 paragraph,
   `app/src/menu.rs`).
9. **High priority on the screen share's top layer.** The Rust SDK's `TrackPublishOptions` can't set
    it; accepted gap in `docs/av-publish.md`.
10. **macOS builds.** Product has not shipped them for Electron either (`docs-site/docs/installation/
    desktop-app.md`); see C9 for what native would need.

Not listed: "Copy message link" from W1's defaults is not a gap — the web has no such action either
(`frontend/src/components/Message/messageActions.ts`), so there is nothing to match.

## Counts

| Group | Items |
|---|---|
| A. Missing features | 0 |
| B. Partial features | 0 |
| C. Platform and distribution | 5 |
| D. Only a person can check | 10 |
| E. Decided not to build | 10 |

Closed on 2026-11-13: A1 (screen-reader announcements: a live region for new messages off the live
edge, shortcut feedback, and the existing status/alert nodes), B1 (reset password), B2 (Home's
invite card), B3 (push-to-talk), B4 (the voice join-failure upload), B5 (the camera test and its
preview in settings), B6 (Check for Updates in the tray and menu), B7 and C5 (log files, the voice
event log, crash reports), C6 (Electron's close-to-tray setting imported on first run; its server
URL lives in browser storage and cannot be), C7 (the "Open semaphore:// links with this app"
setting) and C8 (the end-to-end suite as a nightly CI job). What each builds is spelled out in
`docs/parity-plan.md`'s rows.

The inventory itself (128 rows, 11 tables) now reads: 123 done, 1 partial, 1 not started, 3 n/a.

## The gaps that matter most for a first usable release

1. **A published, signed update feed (C1-C4).** An installed desktop app that can't be replaced or
   patched is a dead end on the first bug; the updater is built, only trust and hosting are missing.
2. **Windows code signing (C1).** SmartScreen's "unknown publisher" wall stops ordinary users before
   the app ever runs, and it is the cheapest of the distribution items to fix.
3. **Real Wayland and Windows capture checks (D1, D2).** Screen share is the feature that sells a
   voice client over a browser; it has never run on a real Wayland or Windows desktop.
