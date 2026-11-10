# Vendored GPUI with the video surface patch

`vendor/` is crates.io source plus `patches/`, nothing else. Cargo uses it through
`[patch.crates-io]` in `native/Cargo.toml`. Edit the patches, never `vendor/`.

| File | What |
|---|---|
| `series` | Each vendored crate: version, sha256 of its `.crate`, its patch |
| `patches/gpui-pre.patch` | `VideoSurfaceId`, `Nv12Frame`, `VideoUploader`, `Window::video_uploader`, `Window::paint_video_surface` |
| `patches/gpui-pre-wgpu.patch` | Linux: NV12 textures updated in place, drawn in z-order with rounded corners; device-lost handling |
| `patches/gpui-pre-windows.patch` | Windows: the same over D3D11: a `Surface` shader, dynamic R8 and R8G8 textures, parked frames flushed before each draw |
| `vendor.sh` | Rebuilds `vendor/` from `series`. `--check` fails if it differs. Needs network |

The patches come from the video agent, whose README has the API and the limits. Their rig's telemetry
and cross-build patches are deliberately not here.

```rust
let id = gpui::VideoSurfaceId::next();
let uploader = window.video_uploader();        // Option<Arc<dyn VideoUploader>>; move it to the decode thread
uploader.upload(id, &frame);                   // Nv12Frame borrowed from the caller
window.paint_video_surface(bounds, radii, id); // in paint; draws nothing until a frame arrived
uploader.remove(id);                           // when the tile goes away
uploader.failed();                             // a surface failed: stop using them
```

- **The window must keep drawing** for frames to appear, for example with `window.request_animation_frame()`.
- **`upload` differs by platform:** wgpu writes to the GPU directly. On Windows it copies into a parked buffer, and the render thread writes the latest frame before each draw.
- **After a lost device** a surface draws nothing until its next upload.
- **A failed surface** on Windows goes dark without costing the window its frame, and `uploader.failed()` turns true for good. `VideoFrames` then moves to RGBA. Wgpu never reports this.
- **Limits:** frames are read as BT.601 limited range, with no colour-space argument, and no mipmaps, so tiles far below source size can alias. macOS has none of this API.

**Windows builds:** a release build compiles the shaders with `fxc.exe` from the Windows SDK, so a release
build from Linux fails. `cargo check` in a dev profile works anywhere, and `verify.sh` runs it.

## Swapping in a new patch set

1. Overwrite the files in `patches/`. Paths must read `a/src/...`, because they apply with `-p1` from
   the crate's root.
2. `third_party/vendor.sh`, then `scripts/in-image.sh cargo metadata --format-version 1 >/dev/null` if
   `series` gained a crate, then `scripts/verify.sh`. A new crate also needs a line in `[patch.crates-io]`.

## Moving to a new `gpui-pre`

Change `version` and `sha256` in `series`, run `vendor.sh`, and fix whatever no longer applies.
T9 counts this work. Rerun `scripts/audit-gpui-pre.sh` first: the audit runs against
`Cargo.lock`, so it needs the unpatched lock from that bump.
