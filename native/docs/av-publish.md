# Publishing camera and screen

The engine only receives video today. This is the approved design for sending your camera and
your screen or a window, on Linux (Wayland first, X11 second) and Windows, through core to the voice
bar. The web and Electron client is the spec: `useScreenShare`, `ScreenSourcePicker`,
`screenShareQuality.ts`, `screenSharePublish.ts` and `toggleCameraUnified`.

## Routes

| Source | Route | Pixels |
|---|---|---|
| Screen or window, Wayland | libwebrtc's generic capturer: the xdg ScreenCast portal and its picker, then PipeWire (DMA-BUF through EGL, or SHM). Needs livekit's `glib-main-loop` feature, now on | BGRA to I420 (libyuv), scaled by the compositor (`set_target_size`) or `I420Scale` |
| Screen or window, X11 | libwebrtc's X11 capturers (XShm, XComposite), with our own source list | the same |
| Screen or window, Windows | libwebrtc: WGC for both, DXGI as the screen fallback | the same |
| Camera, Linux | libwebrtc's `VideoCaptureModule` through our shim: PipeWire first (shared, libcamera, portal-ready), V4L2 as the fallback | I420 out of the module, no copy |
| Camera, Windows | The same module: DirectShow | the same |

Rejected: our own ashpd and pipewire-rs screen capture (about 1k more lines; it stays the fallback if
libwebrtc's falls short on Hyprland), `windows-capture` and `scap` (they duplicate libwebrtc),
nokhwa (unmaintained), GStreamer (LGPL, heavy). There's no zero-copy path to the encoder on the
desktop: libwebrtc's DMA-BUF frame buffer is Jetson-only, and software VP8 needs I420 in memory.

**Follow-up if DirectShow proves inadequate (unit G, deferred):** a Media Foundation camera crate
(`IMFSourceReader` with advanced video processing, NV12 out), as Chromium uses. DirectShow can't
open "Frame Server" cameras (some newer laptop and Surface cameras, Windows Hello IR cameras).

## Encodings (unit B: `semaphore-media-livekit/src/video/publish.rs`)

- **Screen:** VP8 simulcast. The top layer is the capture size at the chosen fps with
  7.65 × (pixels/s)^0.75 bits per second, rounded to 100 kbps, 150 kbps to 50 Mbps (1080p60 is
  9 Mbps). Below it are half size at up to 30 fps and quarter size at up to 15, or only the half
  size below 960 px. Balanced degradation at 30 fps and up, maintain-resolution at 15. Ported with
  the TS test vectors.
- **Camera:** 1280x720 at 30 fps, VP8 simulcast, top 1.7 Mbps, 180p and 360p below:
  livekit-client's `h720`. **The Rust SDK, left alone, would send 3 Mbps**: its
  `compute_appropriate_encoding` takes the next preset up for a 1280 px capture (`>` where
  livekit-client has `>=`), so we set the encoding ourselves.
- **Screen audio:** unchanged, 128 kbps stereo, no DTX, RED.
- **Accepted gap:** the web's `priority: 'high'` on the screen's top layer. The Rust SDK's
  `TrackPublishOptions` has no way to set it.

## Decisions

The coordinator decided these on 2026-11-10. The product defaults are the owner's to overrule.

- Permissions (`may_camera`, `may_share`) come from LiveKit's participant permissions
  (`can_publish_sources`), which the backend's `publishGrantFor` sets.
- Core changes 1-6 from the design are approved, `VoiceView.local: LocalMediaView` included. They
  are unit E, which waits for the core split.
- No Wayland headless rig (sway, xdg-desktop-portal-wlr): the portal path is checked on a desktop.
- **Product defaults:**
  - Wayland goes straight to the portal with saved settings, as Electron does. Resolution, fps and
    audio live in voice settings.
  - The standalone "Share audio" button goes once screen share lands.
  - Shared audio is everything except our own call, for screens and windows alike.
  - No restore token: the portal asks every time.
  - Software VP8. 4k and native stay offered.
  - Your own share shows in the stage.

## Units

| Unit | State |
|---|---|
| A. Shim: vendored `webrtc-sys` and `libwebrtc` ([third_party/PATCHES.md](../third_party/PATCHES.md)), `glib-main-loop`, the PipeWire stub fix shared from `semaphore_media_livekit::pipewire_stubs` | Done. `scripts/capture-probe.sh`: an Xvfb screen listed and captured (10 BGRA frames at a 15 fps cap), a PipeWire camera (`rigs/fake-camera`) listed and captured (30 I420 frames at 30 fps). The Rust side type-checks for Windows (`scripts/check-webrtc-windows.sh`) |
| B. Publish options | Done: 19 tests |
| C. Engine publish path | Done: `LiveKitEngine::set_camera`, `start_screen_share`, `stop_screen_share` (the `MediaEngine` methods), `select_camera`, `cameras`. Frames go source → `video/local.rs` (BGRA or I420 to I420, scaled to `fit_capture`) → `NativeVideoSource`, with a 640 px, 15 fps preview to the `VideoSink` under our publication's sid. Self's `camera` and `screen_share` come from our publications; `local.may_*` from the room's permissions. The screen's system audio starts after the screen is published, and its failing leaves the screen on. A rejoin republishes both from the same captures. Sources: `video/platform.rs` (libwebrtc) or `testing::FakeVideoSources`. 8 real-SFU tests (`proof/test-video.sh`) |
| D. T12 rig: a viewer asserting layers, fps, frame counter and bitrates | Next |
| E. Core API | Done: `Core::set_camera`, `start_screen_share`, `stop_screen_share`; `VoiceView.local: LocalMediaView` (`LocalShare::{Off, Starting, On, Failed}`, `may_camera`, `may_share`); `ScreenShareRequest`, `ShareResolution`; `ScreenCapture` with `picker()` and thumbnails; `MediaEngine` methods with `Unavailable` defaults. Mirrored in `semaphore-ffi`. 15 core tests in `tests/media.rs` |
| F. UI: bar buttons, X11/Windows picker, settings | Done: `voice-camera` and `voice-share` follow `LocalShare` (Starting dimmed and not clickable, Failed retries with the reason in the bar), disabled not hidden without `may_*`; share under "more" at phone width. `voice/picker.rs` (Screens and Windows tabs, thumbnails). Settings: camera list, resolution, fps (default 1080p30) and audio, saved in `voice.screen_share`. Stories `voice-camera-*`, `voice-share-*`, `voice-no-permission`, `voice-picker*` |
| G. Media Foundation camera | Deferred (see above) |
| H. App wiring | Done: the buttons call core; Wayland starts straight from the saved settings, X11 and Windows open our picker over `DesktopScreenCapture::sources`; `EngineOptions::system_audio` is `platform_capture()`; the "Share audio" button is gone. `rigs/slice/scripts/voice.steps` drives camera, a failed camera, the picker and our own share against the fake server and LiveKit |

## How core and the engine share the state

Core owns what the buttons show: `Starting` while a start runs, then `On`, or `Failed` with the
engine's reason, which asking again retries. A start that finishes after a leave, or after a newer
start, changes nothing. A join, a leave, a sign-out or the call ending resets everything to `Off`.
The engine's reports carry what it actually sends (`On` or `Off`) and the permissions. Core turns
a share off on its own only when a report goes from `On` to not `On`: the shared window closed, or
the system's "stop sharing".

## Not proven yet

- **The Wayland portal path, on any machine:** the portal dialog, DMA-BUF import,
  `set_max_frame_rate` and `set_target_size`. The headless run is X11 only.
- **The C++ of the shim on Windows:** the image checks only Rust. The `windows-link` job compiles
  and links it, and runs the probe for information only. A hosted runner has no camera and may
  have no desktop to capture.
- **WGC, DXGI and DirectShow on a real Windows PC.**
- **V4L2 and real webcams** (MJPEG, YUY2 at their real rates), libcamera cameras, and the camera
  portal in a sandbox.
- **Hot-plugging a camera** while the backend is open.
- **CPU cost.** The design's figures are estimates.
- **Mid-share audio failure:** if system audio dies after it started, the engine logs it and
  `local.screen_audio` stays `On`.
- **A camera unplugged mid-call:** libwebrtc's module just stops delivering frames, so the share
  stays `On` with a frozen picture.
- **The camera portal for a sandboxed build** (the engine always opens its own PipeWire
  connection), and `set_target_size` (screens are scaled on the CPU for now).
