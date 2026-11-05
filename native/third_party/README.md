# Vendored GPUI with the video surface patch

`vendor/` is crates.io source plus `patches/`, nothing else. Cargo uses it through
`[patch.crates-io]` in `native/Cargo.toml`. Edit the patches, never `vendor/`.

| File | What |
|---|---|
| `series` | Each vendored crate: version, sha256 of its `.crate`, its patch |
| `patches/*.patch` | What ships: an NV12 `VideoUploader` and `paint_video_surface` on the wgpu renderer |
| `patches/rig-only/video-telemetry.patch` | Counters the T1 rig reads. Never in `series`. Apply on top of `vendor/` for a T1 build: `patch -p1 -d third_party/vendor < third_party/patches/rig-only/video-telemetry.patch`, and the rig needs `gpui_wgpu::telemetry` |
| `vendor.sh` | Rebuilds `vendor/` from `series`. `--check` fails if it differs. Needs network |

**Platforms:** Linux only so far. `gpui-pre-windows` has its own DirectX renderer, whose
`draw_surfaces` is empty, and its atlas has no uploader, so `Window::video_uploader()` returns
`None` there. A video tile must then fall back to an RGBA `RenderImage`.

## Swapping in a new patch set

1. Overwrite `patches/gpui-pre.patch` and `patches/gpui-pre-wgpu.patch`. Paths must read
   `a/<crate>/src/...`, so that they apply with `-p1` from `vendor/`.
2. For the Windows patch: add `patches/gpui-pre-windows.patch`, a `gpui-pre-windows` line in
   `series` (0.3.11, sha256 from `Cargo.lock`, before it's patched), and
   `gpui-pre-windows = { path = "third_party/vendor/gpui-pre-windows" }` in `[patch.crates-io]`.
3. `third_party/vendor.sh`, then `scripts/in-image.sh cargo metadata --format-version 1 >/dev/null`
   to update `Cargo.lock`, then `scripts/verify.sh`.

## Moving to a new `gpui-pre`

Change `version` and `sha256` in `series`, run `vendor.sh`, and fix whatever no longer applies.
T9 counts this work. Rerun `scripts/audit-gpui-pre.sh` first: the audit runs against
`Cargo.lock`, so it needs the unpatched lock from that bump.
