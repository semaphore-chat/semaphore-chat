# Vendored GPUI with the video surface and close-to-tray patches, and libwebrtc with capture

`vendor/` is crates.io source plus `patches/`, nothing else. Cargo uses it through
`[patch.crates-io]` in `native/Cargo.toml`. Edit the patches, never `vendor/`.

| File | What |
|---|---|
| `series` | Each vendored crate: version, sha256 of its `.crate`, its patch |
| `patches/gpui-pre.patch` | `VideoSurfaceId`, `Nv12Frame`, `VideoUploader`, `Window::video_uploader`, `Window::paint_video_surface`; `image` formats cut to what the app can receive, see below |
| `patches/gpui-pre-wgpu.patch` | Linux: NV12 textures updated in place, drawn in z-order with rounded corners; device-lost handling; images (polychrome sprites) filtered from tile-local coordinates; emoji to the colour emoji font, see below |
| `patches/gpui-pre-windows.patch` | Windows: the same over D3D11: a `Surface` shader, dynamic R8 and R8G8 textures, parked frames flushed before each draw |
| `patches/gpui-pre-linux.patch` | Ours, not the video agent's: close to tray and activation tokens on X11 and Wayland, see below |
| `patches/webrtc-sys.patch`, `patches/libwebrtc.patch` | Capture options libwebrtc has but doesn't expose (frame rate cap, PipeWire target size, WGC off) and a camera binding over its `VideoCaptureModule`. Each change and why: [PATCHES.md](PATCHES.md) |
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

## Image sampling (ours, not the video agent's)

Upstream samples a polychrome sprite at `(tile origin + local) / atlas size`, computed per vertex and
interpolated. The float precision left for the fraction shrinks as the tile's origin grows, so a
scaled image came out one level different on the rows whose filter weight sits on a rounding step,
depending on where the atlas happened to put it (lavapipe quantises the weights; the slice e2e caught
it as `18-media.png` differing on two rows when the image landed at y 256 instead of 0). An edge also
read its neighbouring tile. `fs_poly_sprite` now filters bilinearly itself from tile-local
coordinates with four `textureLoad`s clamped to the tile, so an image draws the same wherever it is in
the atlas and never bleeds. Glyphs (monochrome and subpixel) draw 1:1 and are unchanged. If a GPUI
bump drops or rewrites `fs_poly_sprite`, port this and rerun the default `slice-e2e.sh` many times.

## Emoji in colour (ours)

cosmic-text picks a font for a character the requested font lacks from its own list, which knows
nothing of emoji presentation and puts DejaVu Sans ahead of Noto Color Emoji. So 😀 😂 ❤️ drew as
DejaVu's black-and-white outlines wherever DejaVu is installed, and only emoji DejaVu lacks (🤣 👍)
came out in colour. `layout_line_no_separators` in `cosmic_text_system.rs` now gives every grapheme
cluster that draws as an emoji by default (first character `Emoji_Presentation=Yes`, or a VS16
sequence; VS15 opts out) to the installed colour emoji font, the first face `check_is_known_emoji_font`
knows, when that font has the character. Everything else is shaped exactly as before. It adds
`unicode-properties` (already in the lock) for the emoji property. If a GPUI or cosmic-text bump
changes `layout_line_no_separators`, port it and check the `emoji-default` story shot.

## Image formats (ours)

gpui-pre turns on 15 `image` formats. Its `Cargo.toml` now keeps `bmp gif ico jpeg png webp`: the
backend accepts PNG, JPEG, GIF and WebP (and SVG, which resvg draws) for attachments, avatars, banners
and custom emoji, and link previews can be any web image, of which BMP and ICO (favicons) are the
ones browsers draw that `image` has. Dropped: `dds exr ff hdr pnm qoi rayon tga tiff`, 1.4 MB of the
app ([docs/size.md](../docs/size.md)). Bytes in a dropped format fail `files::decodable` as
`NotAnImage` and draw as a file row. A gpui-pre bump that changes this table needs the hunk redone.

## Close to tray and activation tokens (ours)

Three `PlatformWindow` methods, each marked `Semaphore patch`, with `Window` wrappers:
`set_window_visible(bool)` hides a window without closing it, `can_hide_window()` says whether
that works here, and `activate_window_with_token(&str)` activates with a token another process
handed over (a second launch's `XDG_ACTIVATION_TOKEN`). The default trait methods (`gpui-pre.patch`)
do nothing and return false, so macOS and the test platform are unchanged.

- **Windows** (`gpui-pre-windows.patch`): `ShowWindowAsync` with `SW_HIDE` or `SW_SHOW`.
- **X11** (`gpui-pre-linux.patch`): `UnmapWindow` plus the ICCCM synthetic `UnmapNotify` on the
  root, and `MapWindow`.
- **Wayland** (`gpui-pre-linux.patch`): hiding attaches no buffer, destroys the decoration,
  toplevel and xdg_surface, and parks the frame loop in `Unconfigured` so nothing presents to the
  bare surface. Showing gives the same `wl_surface` a new xdg_surface and toplevel (title, app id,
  size limits, decoration mode, maximized), commits with no buffer, and the configure handler draws
  the first frame as at creation. Only `WindowKind::Normal` windows hide. Re-mapping the old
  toplevel, which xdg-shell allows, gets no configure from weston 15, so the role objects are made
  again, as GTK does. `activate_with_token` calls `xdg_activation_v1.activate`.

`scripts/desktop-probe.sh` (in `verify.sh`) proves it on Xvfb and headless weston: the X11 map
state, no frames while hidden on Wayland, frames again after each show, and a hidden window closed
without a protocol error. A real compositor (Hyprland, KDE, GNOME) is on the manual checklist in
`docs/slice-app.md`. If a GPUI bump changes `WaylandWindowState` or the frame loop, port this and
rerun the probe.

## Swapping in a new patch set

1. Overwrite the files in `patches/`. Paths must read `a/src/...`, because they apply with `-p1` from
   the crate's root.
2. `third_party/vendor.sh`, then `scripts/in-image.sh cargo metadata --format-version 1 >/dev/null` if
   `series` gained a crate, then `scripts/verify.sh`. A new crate also needs a line in `[patch.crates-io]`.

## Moving to a new `gpui-pre`

Change `version` and `sha256` in `series`, run `vendor.sh`, and fix whatever no longer applies.
T9 counts this work. Rerun `scripts/audit-gpui-pre.sh` first: the audit runs against
`Cargo.lock`, so it needs the unpatched lock from that bump.
