# Our patches to `webrtc-sys` 0.3.53 and `libwebrtc` 0.4.0

Both are LiveKit's crates (Apache-2.0), vendored from crates.io through `series` and `vendor.sh`
like the GPUI crates (see [README.md](README.md)). The patches add only what screen and camera
publishing need and the crates don't expose. The prebuilt libwebrtc that `webrtc-sys` downloads
already contains all of it: everything here is glue compiled by `webrtc-sys`'s own build script
against the prebuilt's headers, so no libwebrtc rebuild is involved.

Every change is marked `Semaphore patch` in the source.

## `patches/webrtc-sys.patch`

| File | Change | Why |
|---|---|---|
| `src/desktop_capturer.rs`, `src/desktop_capturer.cpp` | `DesktopCapturerOptions` gains `allow_wgc`, `target_width`, `target_height` | `allow_wgc = false` gives screens DXGI or GDI and windows GDI on Windows: no yellow capture border, for picker thumbnails. The target size goes to `DesktopCaptureOptions::set_width/height`, so on PipeWire the compositor scales instead of us. Upstream always turned WGC on |
| `include/livekit/desktop_capturer.h`, `src/desktop_capturer.rs` | `DesktopCapturer::set_max_frame_rate` | Calls `webrtc::DesktopCapturer::SetMaxFrameRate`. PipeWire negotiates it with the compositor; without it libwebrtc copies every buffer at the monitor's refresh rate (144 a second on a 144 Hz screen) whatever rate we pull frames at. Other capturers ignore it |
| `include/livekit/camera_capturer.h`, `src/camera_capturer.cpp`, `src/camera_capturer.rs` (new) | A cxx bridge over `webrtc::VideoCaptureModule` and `VideoCaptureFactory`: open a backend, list devices with their modes, start a mode into a `NativeVideoSink`, stop | Cameras. libwebrtc has PipeWire and V4L2 camera backends on Linux and DirectShow on Windows, but `webrtc-sys` binds none of them. Frames reuse the existing `NativeVideoSink`, the one remote tracks use, so they arrive in Rust as ordinary `VideoFrame`s with no copy |
| `build.rs` | Builds the camera bridge on Linux and Windows; links `oleaut32` on Windows | macOS cameras live in the ObjC SDK, not in `VideoCaptureModule`, so it's left out there. DirectShow returns device names as VARIANTs |
| `src/lib.rs` | `pub mod camera_capturer` on Linux and Windows | |

## `patches/libwebrtc.patch`

| File | Change | Why |
|---|---|---|
| `src/desktop_capturer.rs`, `src/native/desktop_capturer.rs` | `DesktopCapturerOptions::set_allow_wgc`, `set_target_size`; `DesktopCapturer::set_max_frame_rate` | The safe API over the `webrtc-sys` additions above |
| `src/native/camera_capturer.rs` (new), `src/native/mod.rs`, `src/lib.rs` | `libwebrtc::native::camera_capturer`: `CameraCapturer::new(CameraBackend, timeout)`, `devices()`, `start(id, mode, on_frame)`, `stop()` | The safe API over the camera bridge. `CameraBackend::PipeWire { fd }` takes an fd that libwebrtc then owns (it passes it to `pw_context_connect_fd`); `None` asks the xdg camera portal, which a sandbox needs |

## Things learned while writing them

- **The PipeWire fd is taken over, not duplicated.** Closing it after `CameraCapturer::new`
  breaks the session (`recvmsg ... Bad file descriptor`), so the API takes an `OwnedFd`.
- **libwebrtc drops PipeWire cameras whose modes it can't list.** It keeps a node only if it has
  `media.role = Camera` and a `node.description`, and only if its `EnumFormat` has fixed sizes and
  frame rates. PipeWire's own `videotestsrc` offers ranges, so it never shows up;
  `rigs/fake-camera` offers one fixed mode, as WirePlumber presents a real webcam.
- **libwebrtc reads a header on every camera buffer** and crashes in `ProcessBuffers` without one,
  so a producer must offer `SPA_META_Header`. Real cameras do.

## On a livekit bump

1. Move `series` to the new versions and checksums, then run `vendor.sh`. Where a patch no longer
   applies, redo that change by hand from the tables above.
2. Check upstream first: drop anything it now has (a camera binding or `SetMaxFrameRate` would
   make the matching part unnecessary).
3. Rebuild the patches: vendor the new versions unpatched into a scratch directory, then
   `diff -ruN a b` against the edited `vendor/` copy, with paths `a/...` and `b/...` (no
   timestamps). Then run `vendor.sh --check`.
4. Run `scripts/capture-probe.sh` (screens and cameras, headless) and
   `scripts/in-image.sh sh scripts/check-webrtc-windows.sh -p semaphore-media-livekit --example capture_probe`.
   The `windows-link` CI job compiles the C++ for Windows.
