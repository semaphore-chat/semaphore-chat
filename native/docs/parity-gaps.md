# Native client parity gaps

The remaining work to reach parity with the web/Electron client, ordered by how visible it is to a
user. Every row of `docs/parity-plan.md`'s inventory (128 rows in 11 tables) was re-read against the
code on 2026-11-13; this file lists what that read found still missing. Statuses and evidence live
in the plan; this is the gap list only.

Sizes are S (hours), M (days), L (a week or more) of one engineer's work, including tests and a
story. "Depends" names the thing that must happen first.

## A. Missing features

### A1. Screen-reader announcements of new messages

- **Web:** `frontend/src/hooks/useMessageListAnnouncer.ts` keeps an `aria-live` region and announces
  qualifying new messages, coalescing arrivals within 2 s and cutting the preview to 80 characters.
- **Native:** rows have accessible labels (`native/crates/semaphore-ui/src/messages/row.rs:2002`,
  `accessible_label`) and the list is a `Role::List` with the name "Messages"
  (`native/crates/semaphore-ui/src/messages/view.rs:1321`). Nothing announces an arrival, and no
  live region is used anywhere in `semaphore-ui` or `semaphore-app`.
- **Missing:** the announcement itself: a live region, the decision of which messages qualify, the
  batch window and the preview text. Whether the pinned GPUI (the external `gpui-kit` 0.9 crate, not
  vendored here) exposes a live region is unverified; that is the first question, then the announcer
  on top.
- **Size:** M.
- **Depends:** gpui-kit/GPUI accessibility work (platform); otherwise this cannot be built at all.

## B. Partial features (behaviours missing)

### B4. Voice diagnostics upload

- **Web:** `frontend/src/features/voice/joinFailureReport.ts` posts a classified join failure to
  `POST /voice-diagnostics` with `platform: 'web' | 'electron'`.
- **Native:** join failures are classified and kept for the debug panel
  (`native/crates/semaphore-ui/src/voice/debug.rs`, `Core::refresh_voice_diagnostics`,
  `semaphore-core/src/commands/diagnostics.rs:79`), and "Copy report" copies the text
  (`voice/debug.rs:250`). There is no upload path in core or net (no `report_join_failure` anywhere).
- **Missing:** the upload, which is intentionally held until the backend accepts a native platform
  value (`VOICE_CLIENT_PLATFORMS` is web and electron only, "Backend asks W4").
- **Size:** S once the backend allows it.
- **Depends:** backend change (a native value in `ReportJoinFailureDto.platform`).

### B5. Camera test and preview in settings

- **Web:** `frontend/src/hooks/useDeviceTest.ts` tests the camera (`testVideoInput`) and
  `AudioVideoSettingsPanel.tsx` shows the preview and permission state beside the microphone test.
- **Native:** the microphone test, level meter and VAD marker are built
  (`native/crates/semaphore-ui/src/settings/voice.rs:257`, `MediaEngine::start_input_test`,
  `root/account.rs:617`), along with devices, processing, mic quality, the PTT key, the camera list
  and screen-share size/fps/audio. The settings module says it outright: no camera preview
  (`settings/voice.rs:3`).
- **Missing:** a camera test loop with a preview surface and its permission/failure states.
- **Size:** S-M (the engine's capture and preview path today only runs for a published camera; a test
  loop outside a call is the audio `start_input_test`'s video analogue).
- **Depends:** none for the engine seam; a real camera to check it (D3).

- **Size:** S.
- **Depends:** none.

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

### C7. Which app owns `semaphore://`

- **Web/Electron:** electron-builder declares the protocol and `electron/main.ts` registers it on
  launch; whichever app registered last wins, exactly as here.
- **Native:** both apps register the scheme; whichever registered last wins. The native installer
  writes `HKCU\Software\Classes\semaphore` and its uninstaller only removes the key when it points
  at the native exe, so an Electron registration survives (`native/packaging/windows/installer.nsi`,
  `semaphore-platform-desktop/src/links.rs`). Linux `.desktop` registration is last-writer-wins.
- **Missing:** a shared "which app opens links" setting or an install-time question.
- **Size:** S.
- **Depends:** product decision (and C4 if the answer is "the packaged native app asks").

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
8. **Accessibility with Orca and Windows Narrator.** No live region exists (A1), so this will fail
   the announcer check until A1 lands; labels, focus order and the shortcut sheet still need ears.
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
| A. Missing features | 1 |
| B. Partial features | 2 |
| C. Platform and distribution | 6 |
| D. Only a person can check | 10 |
| E. Decided not to build | 10 |

Closed on 2026-11-13: B1 (reset password), B2 (Home's invite card), B3 (push-to-talk), B6 (Check
for Updates in the tray and menu), B7 and C5 (log files, the voice event log, crash reports), C6
(Electron's close-to-tray setting imported on first run; its server URL lives in browser storage
and cannot be) and C8 (the end-to-end suite as a nightly CI job). What each builds is spelled out
in `docs/parity-plan.md`'s rows.

The inventory itself (128 rows, 11 tables) now reads: 120 done, 3 partial, 2 not started, 3 n/a.

## The gaps that matter most for a first usable release

1. **A published, signed update feed (C1-C4).** An installed desktop app that can't be replaced or
   patched is a dead end on the first bug; the updater is built, only trust and hosting are missing.
2. **Windows code signing (C1).** SmartScreen's "unknown publisher" wall stops ordinary users before
   the app ever runs, and it is the cheapest of the distribution items to fix.
3. **Real Wayland and Windows capture checks (D1, D2).** Screen share is the feature that sells a
   voice client over a browser; it has never run on a real Wayland or Windows desktop.
4. **Voice diagnostics upload (B4).** The panel classifies failures but can't tell anyone; it needs
   the backend's native platform value and then a one-line upload.
5. **Screen-reader announcements (A1).** The one outright missing user-facing feature, and the
   blocker for any accessibility claim; scope the kit question before promising it.
6. **Camera test and preview in settings (B5).** The microphone has a test and a meter; the camera
   has neither, so a broken camera is only found in a call.
7. **Which app opens `semaphore://` (C7).** With both apps installed, the last registration wins
   silently; a link that opens the wrong client looks like the app is broken.
