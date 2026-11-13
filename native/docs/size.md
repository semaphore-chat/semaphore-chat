# Download and install size of the native desktop client

Measured 2026-11-11 on `native/size` (= `f22bf60f`), Linux x86_64, in the pinned build image
(`scripts/in-image.sh`, Rust 1.99.1, clang/lld). Windows numbers come from the CI artifact of the
latest successful "Native Spike" run on `main` (run 42988152950, commit `8e25bd6d`). MB = 10^6 bytes.

**Measured** means a build or a file was measured as written here. **Estimate** means the number is
derived from the link map or from proportions of measured builds, and is labelled as such.

## Headline

| | Raw binary | What a user downloads |
|---|---:|---:|
| Electron 0.9.0 AppImage / .deb / .rpm / Windows installer | | 128.4 / 103.0 / 91.4 / 123.3 MB |
| Native today, Linux (`strip = "symbols"`, `lto = "thin"`) | 88.5 MB | **23.0 MB** (.deb-style xz -6), 25.1 MB (zstd -19), 30.5 MB (AppImage-style 128 KiB-block zstd) |
| Native today, Windows (CI exe) | 68.9 MB | **17.0 MB** (xz -9, what an NSIS/LZMA installer gets) |
| Native, Linux, "change now" set below (measured, `now-safe`) | 65.7 MB | **19.4 MB** xz -6, 21.1 MB zstd -19, 25.1 MB 128 KiB-block zstd |
| Native, Linux, every lever incl. the decision items (measured, `combo-s-code`) | 44.0 MB | **14.0 MB** xz -6, 15.1 MB zstd -19, 17.6 MB 128 KiB-block zstd |

The 88 MB is an uncompressed binary; the Electron figures are compressed packages. Compared like for
like, today's native package is already 4 to 7 times smaller than Electron's (23 MB against 91-128 MB),
with the safe changes it is about 19-26 MB, and with every lever including `opt-level = "s"` and
`panic = "abort"` it is 6 to 9 times smaller (14-18 MB). The installed size
(the raw binary) goes from 88.5 to 44-54 MB. An unpacked Electron app is typically 250 MB or more
(not measured here; Chromium's runtime alone is most of it).

## 1. What is in the 88.5 MB

Method: the baseline build was linked with `-Wl,-Map` (lld link map; the map does not change the
output: same size as without it), every input section was attributed to its origin, and the stripped
binary's sections were read with `readelf -SW`. With thin LTO, Rust object files are named after their
crate (`semaphore_app-<h>.<crate>-<h>.<crate>.<h>-cgu.N.rcgu.o`), so code is attributed to the crate
whose codegen unit holds it. Generic code instantiated by a crate (GPUI elements, serde, tokio
futures) counts against the instantiating crate, so "our code" includes a lot of monomorphised
GPUI/serde/tokio code. libwebrtc is a static archive bundled into the `webrtc_sys` rlib; its 2,347
linked members are grouped by the symbols they define (heuristic; within about ±0.3 MB per group).

### By section (stripped binary, measured)

| Section | MB | Note |
|---|---:|---|
| `.text` (code) | 66.52 | |
| `.eh_frame` + `.eh_frame_hdr` (unwind tables) | 7.73 | Rust 5.39, libwebrtc 1.33, header 0.98 |
| `.gcc_except_table` (landing-pad tables) | 2.84 | Rust 2.80, C++ 0.04 |
| `.rodata` | 5.41 | merged strings 1.2; no fonts; SVG icons 0.11; emoji JSON 0.01 |
| `.rela.dyn` (PIE relocations) | 3.38 | removable with RELR, see 3 |
| `.data.rel.ro` | 2.32 | vtables and pointer tables |
| everything else | 0.29 | |
| **File** | **88.50** | `.bss` (2.2 MB, libwebrtc) takes no file space |

**Debug info does not survive the strip:** there is no `.debug_*` section and no `.symtab`. What
survives is unwind information: 7.7 MB of `.eh_frame` (needed for backtraces and for unwinding Rust
panics; libwebrtc's own 1.3 MB is kept because Chromium builds with asynchronous unwind tables even
though it builds with `-fno-exceptions`) and 2.8 MB of Rust landing-pad tables.

### By origin (measured, all file-backed sections)

| Origin | MB | Of which |
|---|---:|---|
| **Rust, all crates** | **62.73** | code 49.19, unwind 8.19, rodata+relro 5.20 |
| GPUI, gpui-component, gpui-kit, platform glue | 17.99 | gpui_base 5.43, gpui_linux 4.19, gpui_component 3.19, gpui 2.93, oo7 0.72, gpui_wgpu 0.45 |
| Our crates (`semaphore_*`) | 13.11 | app 3.07, media-livekit 2.99, ui 2.36, net 2.10, platform-desktop 0.99, core 0.97, wire 0.32 |
| D-Bus: zbus 4 and 5, secret-service, notify-rust | 6.64 | zbus 3.57 (two versions, 1.83 + 1.74), secret_service 1.51, notify_rust 1.00 |
| Renderer: wgpu, naga, ash | 5.11 | naga 1.87, wgpu_core 1.79, wgpu_hal 0.75, wgpu 0.44 |
| Text, fonts, SVG: cosmic-text, swash, skrifa, harfrust, rustybuzz, usvg, resvg | 4.69 | |
| HTTP, TLS, WebSocket: reqwest (two versions), rustls, ring, tokio, tungstenite | 3.90 | reqwest 1.64 (0.80 + 0.84) |
| LiveKit Rust SDK | 3.37 | livekit 1.97, signaling 0.40, net 0.36, datatrack 0.24 |
| markdown/html5ever, regex, serde, jiff, misc | 2.73 | |
| Accessibility (accesskit) | 2.38 | accesskit_unix 2.06 |
| Images (image + codecs, incl. exr, tiff) | 1.27 | exr 0.39 is a format we never decode |
| Audio (cpal, pulseaudio, alsa) | 0.58 | |
| Rust std/core/alloc | 0.50 | |
| other | 0.46 | |
| **libwebrtc (C++, static) + webrtc-sys glue** | **18.88** | see below |
| Linker-made: relocations, `.eh_frame_hdr`, merged strings, GOT | 5.70 | `.rela.dyn` 3.38 |
| Other C (ring's asm, crt) | 1.19 | |

### libwebrtc in detail (measured, grouped by symbol prefix)

The prebuilt archive holds 3,686 objects with 35.0 MB of code and data (`llvm-size -t`); the linker
already keeps only the 2,347 objects reachable from our code, **18.9 MB**. Of that:

| Component | MB | Used by this app? |
|---|---:|---|
| WebRTC core: peer connection, SDP, RTP/RTCP, NetEq, call, P2P/ICE, stats, part of audio processing | 5.40 | yes |
| **libaom: AV1 encoder** | 3.21 | **no**: we publish VP8 only (`video/publish.rs`); the web client publishes VP8 too |
| ffmpeg: H.264 decoder (+ some libavutil) | 2.00 | only if a peer publishes H.264 |
| libvpx: VP8 + VP9 encoder and decoder | 1.94 | VP8 yes; VP9 encoder no |
| dav1d: AV1 decoder | 1.69 | only if a peer publishes AV1 |
| BoringSSL | 1.38 | yes (DTLS-SRTP) |
| libjpeg-turbo and other unclassified | 0.49 | MJPEG cameras |
| **OpenH264: H.264 encoder** | 0.48 | **no** |
| Opus (+ a small ffmpeg MP3 decoder) | 0.45 | Opus yes |
| libc++ (hermetic `std::__Cr`) | 0.36 | yes |
| webrtc-sys C++ glue (ours, compiled by `build.rs`) | 0.29 | yes |
| SCTP data channels (dcsctp) | 0.23 | yes: LiveKit's reliable/lossy data channels |
| Audio processing (AEC3, NS, AGC), the part matched by name | 0.22 | yes |
| dlopen stubs for X11, libdrm, libgbm, libva | 0.15 | screen capture, VA-API |
| libyuv, pffft/rnnoise, desktop capture, camera capture, abseil, libsrtp, G.711/G.722/iLBC/CNG | 0.66 | mostly yes; legacy audio codecs 0.04 |

H.265 is enabled in the build (`rtc_use_h265 = true`) but has no software codec; it costs only
packetisation code. Legacy audio codecs are 0.04 MB. Desktop capture is 0.11 MB.

### Assets

No fonts are embedded (text uses system fonts through fontconfig; Roboto is not bundled yet, see 2).
The 317 SVG icons embedded with `include_bytes!` (ours and gpui-component's) total 0.11 MB, the emoji
table 0.01 MB, six small PNGs. **Assets are about 0.1% of the binary.**

So the binary is 71% Rust code and 21% libwebrtc. The Rust side is large mostly because everything
is compiled at `opt-level = 3`, with unwinding, and with no cross-crate deduplication.

## 2. What the user downloads

Compressed like a package would (measured on the baseline binary). `.deb` uses xz -6 (dpkg default);
Fedora `.rpm` uses zstd -19; an AppImage is a squashfs, which compresses in independent blocks
(simulated as 128 KiB blocks, appimagetool's default, compressed one by one); a Windows NSIS installer
uses solid LZMA (≈ xz -9).

| Binary | raw | xz -6 | xz -9e | zstd -19 | zstd -19 --long | zstd -3 | gzip -9 | 128 KiB blocks zstd -19 | 128 KiB blocks gzip -9 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Linux baseline | 88.50 | 23.05 | 22.02 | 25.14 | 24.25 | 32.12 | 34.10 | 30.54 | 34.59 |
| Windows CI exe | 68.93 | 17.54 | 17.00 | 19.16 | 18.70 | 24.53 | 25.22 | 22.52 | 25.57 |
| Linux, recommended (`combo-s-code`) | 44.00 | 14.02 | 13.90 | 15.12 | 15.03 | 18.91 | 19.27 | 17.56 | 19.54 |

Against Electron 0.9.0 (AppImage 128.4, .deb 103.0, .rpm 91.4, Windows 123.3 MB), today's native
build would ship as roughly a 23 MB .deb, 25 MB .rpm, 31 MB AppImage and 17 MB Windows installer.

What else a package has to carry or depend on (measured with `objdump -p`, `ldd` and the strings the
binary dlopens):

- **Linked (`NEEDED`):** `libpipewire-0.3`, `libasound`, `libgio/gobject/glib-2.0`, `libxcb`,
  `libxkbcommon`, `libxkbcommon-x11`, `libgcc_s`, glibc. All are on a normal desktop; a .deb/.rpm
  lists them as dependencies. Bundling all of them in an AppImage would add 7.0 MB raw, 2.2 MB xz.
- **dlopened:** `libvulkan.so.1` (the renderer; Vulkan loader plus a driver must be installed),
  `libwayland-client`, `libwayland-egl`, `libX11`, `libXext`, `libXfixes`, `libXdamage`,
  `libXcomposite`, `libXrandr`, `libdrm`, `libgbm`, `libEGL`/`libGL`, `libva`, `libva-drm`,
  `libpulse`. Missing ones only disable a feature (VA-API, X11 capture).
- **Fonts:** none bundled. Colour emoji need a system emoji font (Noto Color Emoji). Bundling
  Roboto, which the UI asks for, would add about 0.3 MB (estimate: four Latin-subset TTFs).
- **Desktop integration:** a `.desktop` file and icons, well under 0.2 MB.
- **glibc floor (not size, but a packaging blocker):** the image-built binary needs `GLIBC_2.44`
  (Arch, November 2026). Ubuntu 24.04 has 2.39, Debian 13 2.41. Release builds have to be linked
  against an older glibc (an older base image, or `cargo zigbuild` with a glibc target), and that
  choice also decides whether RELR (below) can be used: RELR needs glibc 2.36 or newer.
- **Windows:** the exe is linked with `+crt-static`, so it needs no VC++ redistributable. It is the
  whole app; an installer adds only its stub (~0.1-0.5 MB) and shortcuts.

## 3. The usual levers, one at a time

Each variant is a clean release build of `semaphore-app` into its own target directory with the
setting changed through `CARGO_PROFILE_RELEASE_*` or `--config`; the build time includes downloading
and unpacking libwebrtc and compiling the C++ glue. The machine was shared with other agents' builds,
so build times are ±20%. Δ is against the baseline.

| Variant | raw MB | Δ raw | xz -6 | Δ xz | zstd -19 | AppImage-style | build s |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (`lto = "thin"`, O3, unwind) | 88.5 | | 23.0 | | 25.1 | 30.5 | 90 |
| `opt-level = "s"` | 69.9 | -18.7 | 18.3 | -4.7 | 20.1 | 23.6 | 81 |
| `opt-level = "z"` | 68.7 | -19.8 | 17.9 | -5.1 | 19.6 | 23.0 | 68 |
| `opt-level = "s"` except hot crates at 3 (list below) | 76.6 | -11.9 | 20.5 | -2.5 | 22.4 | 26.2 | 79 |
| `lto = "fat"` | 77.2 | -11.3 | 22.3 | -0.8 | 24.1 | 28.6 | 336 |
| `codegen-units = 1` (with thin LTO) | 76.9 | -11.6 | 21.6 | -1.4 | 23.5 | 28.0 | 114 |
| `panic = "abort"` | 76.8 | -11.7 | 20.0 | -3.1 | 21.7 | 26.3 | 85 |
| `-Wl,--icf=all` | 85.1 | -3.4 | 22.7 | -0.4 | 24.7 | 29.6 | 107 |
| `-Wl,--icf=safe` | 87.9 | -0.6 | 23.0 | -0.1 | 25.1 | 30.4 | 85 |
| `-Wl,-z,pack-relative-relocs` (RELR) | 85.2 | -3.3 | 22.9 | -0.1 | 24.9 | 30.3 | 94 |
| `--gc-sections` | already on | | | | | | |
| gpui-pre's image formats cut to bmp/gif/ico/jpeg/png/webp | 87.1 | -1.4 | 22.7 | -0.4 | 24.8 | 30.0 | 97 |
| software video encoders cut to VP8 (webrtc-sys glue) | 84.7 | -3.8 | 21.8 | -1.2 | 23.8 | 29.0 | 96 |

Combinations (all but `now-safe` with `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`, ICF and RELR):

| Variant | raw MB | Δ raw | xz -6 | Δ xz | zstd -19 | AppImage-style | build s |
|---|---:|---:|---:|---:|---:|---:|---:|
| `now-safe`: fat LTO, `codegen-units = 1`, ICF, both patches; opt-level 3, unwinding, no RELR | 65.7 | -22.8 | 19.4 | -3.6 | 21.1 | 25.1 | 270 |
| `combo-o3`: opt-level 3 | 61.2 | -27.3 | 18.6 | -4.5 | 20.0 | 23.9 | 278 |
| `combo-mixed`: opt-level s, hot crates at 3 | 53.8 | -34.7 | 17.0 | -6.1 | 18.3 | 21.3 | 235 |
| `combo-s`: opt-level s | 48.4 | -40.1 | 15.4 | -7.6 | 16.6 | 19.3 | 201 |
| `combo-z`: opt-level z | 45.5 | -43.0 | 14.6 | -8.5 | 15.7 | 18.0 | 178 |
| `combo-s-code`: `combo-s` + the image-format and VP8-only patches | 44.0 | -44.5 | 14.0 | -9.0 | 15.1 | 17.6 | 200 |

"Hot crates" kept at opt-level 3 in the mixed variants: gpui-pre, gpui-pre-wgpu, gpui-pre-linux,
gpui-pre-sum-tree, gpui-base, wgpu-core, wgpu-hal, cosmic-text, swash, skrifa, harfrust, image, png,
zune-jpeg, image-webp, fdeflate, tiny-skia, semaphore-media-livekit, semaphore-ui. These are the big
crates, so holding them at 3 gives back most of what `s` saves.

Per-section effect (MB, measured): `panic = "abort"` removes the landing-pad tables (2.84 → 0.05), the
landing-pad code (-7.1 in `.text`) and 1.7 of `.eh_frame`; unwind tables for backtraces stay. Fat LTO
and one codegen unit mostly remove duplicated monomorphisations (`.text` -6.4/-7.7). RELR turns
`.rela.dyn` (3.38) into a 0.05 `.relr.dyn`, which is why it saves 3.3 MB raw but almost nothing
compressed: relocations compress very well. `opt-level = "s"` cuts `.text` from 66.5 to 47.8.

### Runtime cost

`rig-list fling --arm real` (the T2 scenario: a 100k-message list flung up and down in a real window
under headless sway on the RTX 4090, pinned to 8 cores), built with each variant's settings, two runs
each, interleaved. Frame cost is the CPU time GPUI spends per frame; the budget is 16.7 ms. Measured:

| Variant | setup ms | fling-up frame cost p50 ; p99 ms | fling-down p50 ; p99 ms | CPU % of a core | missed vsyncs |
|---|---:|---:|---:|---:|---:|
| baseline | 673 / 788 | 0.78 / 0.78 ; 3.64 / 2.19 | 0.81 / 0.77 ; 3.39 / 1.43 | 7.2 / 7.2 | 0 / 0 |
| `combo-o3` | 681 / 657 | 0.65 / 0.78 ; 1.91 / 4.39 | 0.64 / 0.66 ; 1.19 / 1.38 | 5.7 / 7.9 | 0 / 0 |
| `combo-mixed` | 641 / 642 | 0.71 / 0.87 ; 2.76 / 4.79 | 0.66 / 0.64 ; 1.39 / 1.29 | 6.5 / 8.6 | 0 / 0 |
| `combo-s` | 682 / 765 | 0.72 / 0.73 ; 3.24 / 2.18 | 0.93 / 0.74 ; 3.37 / 1.61 | 9.0 / 7.1 | 0 / 0 |
| `opt-level = "s"` alone (thin LTO) | 773 / 806 | 0.92 / 0.92 ; 2.54 / 2.29 | 0.86 / 0.89 ; 1.83 / 1.72 | 7.9 / 7.4 | 0 / 0 |

Read with care: the machine was shared, run-to-run spread in p99 and CPU % is as large as any
difference between variants, and two runs are not a benchmark. What the numbers do support:

- **`opt-level = "s"` alone costs about 15-20% in median frame cost** (0.92 against 0.78 ms, both
  runs) and about 100 ms of setup. That is 0.15 ms of a 16.7 ms frame.
- **With fat LTO and one codegen unit, `s` is back to the baseline's median** (0.72-0.73 ms), and
  `combo-o3` is the fastest at the median. Nothing misses a vsync.
- Not covered: video. Encoding, decoding and scaling run in libwebrtc's C++ and libyuv, which none
  of these settings touch, but the NV12/RGBA frame handling in `semaphore-media-livekit` is Rust; a
  `video` rig run on the chosen profile should confirm it before shipping `s`. The mixed profile
  keeps that crate at 3.

### What each lever would break or cost

- **`opt-level = "s"`/`"z"`:** slower code in hot loops (text layout, rendering setup, image decode,
  video frame handling in our crates). See the runtime table. `z` saves only 0.4-0.9 MB compressed
  over `s` and also turns off loop vectorisation, so `s` is the better default.
- **`lto = "fat"` + `codegen-units = 1`:** release builds take about 3-5 minutes instead of 1.5 on
  32 threads (measured above); no runtime downside. Dev builds are unaffected.
- **`panic = "abort"`:** nothing in our crates calls `catch_unwind`, inspects a `JoinError`, or sets
  a panic hook. GPUI's `catch_unwind` uses are in tests, or rethrow (`gpui-base`
  `with_text_selection_scope`), or guard a log call in wgpu-hal's Vulkan debug callback. What does
  change: **a panic in any tokio task or background thread (ours, LiveKit's signalling and
  reconnect tasks, reqwest) now kills the app** instead of ending that task; destructors don't run on
  a panic. A panic on the GPUI main thread already ends the app today. The panic message still
  prints. Tests are unaffected (`cargo test` uses the test profile, which keeps unwinding).
- **`--icf=all`:** folds identical functions, so two different functions can have the same address.
  Rust gives no guarantee on function-pointer identity, and Chromium ships its own libwebrtc with
  `--icf=all`; nothing found here compares function pointers. `--icf=safe` is safe by construction
  but finds almost nothing here (-0.6 MB), because most objects carry no address-significance table.
- **RELR (`-z pack-relative-relocs`):** the binary then needs glibc ≥ 2.36 to load. Fine for current
  distributions; ties in with the glibc-floor decision above. Not applicable to Windows.
- **`--gc-sections`:** already on (rustc passes it). Proof: a build with `-Wl,--no-gc-sections` fails
  to link (`undefined symbol: XTestQueryExtension`): libwebrtc's dead sections reference libXtst.

### Features and duplicates (from `cargo tree -d` and the link map)

| Item | Cost today (O3, thin LTO) | Fix | Status |
|---|---:|---|---|
| zbus 4 (via `keyring` → `secret-service`) next to zbus 5 (via GPUI's `ashpd`, `oo7`, `notify-rust`) | zbus 4 1.8 + secret-service 1.5 + zvariant 4 0.1 + keyring 0.1 ≈ **3.5 MB** | store the token with `oo7` (already linked through GPUI, zbus 5) instead of `keyring` on Linux, or wait for a keyring release on zbus 5 | estimate, from the map |
| reqwest 0.12 (via `livekit-net`) next to reqwest 0.13 (ours, progenitor) | 0.8 MB | upstream LiveKit bump | estimate |
| image formats gpui-pre turns on: `dds exr ff hdr pnm qoi rayon tga tiff` | **1.4 MB** | patch gpui-pre's `Cargo.toml` through `third_party/patches/gpui-pre.patch` | measured |
| Software video encoders: AV1 (libaom), H.264 (OpenH264), VP9 | **3.8 MB** | VP8-only `VideoEncoderFactoryTemplate` in `webrtc-sys`'s `video_encoder_factory.cpp` (our vendored glue) | measured |
| tungstenite 0.26 (ours) next to 0.29 (LiveKit) | 0.16 MB | bump `tokio-tungstenite` to 0.29 | estimate |
| png 0.17 (tiny-skia) + 0.18, skrifa 0.40 + 0.44, read-fonts ×2, roxmltree ×2 | < 0.2 MB together | upstream | estimate |

Other duplicates in `cargo tree -d` (base64 ×3, rand ×2, hashbrown ×3, getrandom ×3, nix ×2,
thiserror ×2, …) cost under 10 KB each in the binary.

## 4. libwebrtc

`webrtc-sys`'s `build.rs` calls `webrtc_sys_build::download_webrtc()`, which fetches
`webrtc-linux-x64-release.zip` from the `webrtc-a545de4` release of `livekit/rust-sdks` into the
`scratch` crate's directory in the target dir, and links `libwebrtc.a` statically
(`LK_CUSTOM_WEBRTC` points it at a custom build instead). Its `args.gn`: `is_debug = false`,
`symbol_level = 0`, `enable_libaom = true`, `rtc_libvpx_build_vp9 = true`, `rtc_use_h264 = true`,
`rtc_use_h265 = true`, `ffmpeg_branding = "Chrome"`, `rtc_use_pipewire = true`, `rtc_use_x11 = true`,
`use_custom_libcxx = true`, `use_rtti = true`; the defines add `WEBRTC_HAVE_SCTP`,
`RTC_DAV1D_IN_INTERNAL_DECODER_FACTORY` and `RTC_USE_LIBAOM_AV1_ENCODER`. Our patches
(`third_party/PATCHES.md`) change only the C++ glue that `build.rs` compiles against the prebuilt's
headers; the library itself is LiveKit's.

So yes, it is a full build: AV1 encoder and decoder, H.264 encoder and decoder, VP9, SCTP, X11 and
PipeWire capture, VA-API. But it is a static archive, so **the linker already drops every object our
code can't reach: 35.0 MB of code and data in the archive, 18.9 MB in the binary**. What stays is what
the glue references. Desktop capture (0.11), legacy audio codecs (0.04) and H.265 (packetisation only)
are already negligible; SCTP (0.23) is needed for LiveKit data channels.

What can still go, cheapest first:

1. **Encoders we never use, by patching the glue (measured, -3.8 MB raw, -1.2 MB xz).** The encoder
   factory template lists VP8, OpenH264, libaom AV1 and VP9 adapters; with VP8 only, libaom and
   OpenH264 drop out at link time. No libwebrtc rebuild. Cost: one more hunk in `webrtc-sys.patch`
   to carry on LiveKit bumps, and choosing another codec later (AV1 or VP9 screen share, simulcast
   with H.264 for Safari) means adding its adapter back. The app publishes VP8 only today, and so does
   the web client (`frontend/src/utils/screenShareQuality.ts`).
2. **Decoders (estimate, -3.7 MB raw: dav1d 1.7, ffmpeg H.264 2.0).** Same mechanism in
   `video_decoder_factory.cpp`. Not recommended: we can't control what other clients publish
   (a future mobile client with H.264 hardware encode, a LiveKit default change), and a missing
   decoder is a black tile, not an error.
3. **A custom libwebrtc build (estimate: 1-3 MB raw beyond 1 and 2).** With the codecs gone from the
   glue, what a custom build could still remove is mostly code reachable through the peer-connection
   factory that we never call (stats, unused RTP extensions, BoringSSL ciphers we don't negotiate),
   plus `-Os` for the C++ (Chromium builds `-O2`) and ThinLTO across libwebrtc, which could shrink
   the remaining ~15 MB of C++ by perhaps 15-25%. Cost: a depot_tools checkout (~20 GB), a 1-2 hour
   build per platform on 32 threads, a pipeline that rebuilds it for Linux, Windows (and later macOS,
   mobile) on every LiveKit bump, and owning its ABI defines (`webrtc.ninja`) that `webrtc-sys` reads.
   For about 1 MB compressed this is not worth it now.

## 5. Windows

The `semaphore-app-windows` artifact (`semaphore-app.exe`, built by the "Link the desktop app
(Windows)" job with the same release profile: thin LTO, stripped, `+crt-static`):

| | MB |
|---|---:|
| `semaphore-app.exe` | 68.93 |
| `.text` / `.rdata` / `.pdata` / `.data` / `.reloc` | 53.62 / 12.84 / 1.95 / 0.32 / 0.20 |
| xz -6 / **xz -9** (≈ NSIS LZMA) / xz -9e | 17.54 / **17.02** / 17.00 |
| zstd -19 / zstd -19 --long / zstd -22 --long | 19.16 / 18.70 / 18.61 |
| gzip -9 (≈ MSI MSZIP) | 25.22 |

It is smaller than the Linux binary because Windows x64 has no `.eh_frame`/`.gcc_except_table` (its
unwind data is the 1.95 MB `.pdata` plus `.xdata` inside `.rdata`), no D-Bus stack, no accesskit-unix
and no PIE relocation table. **Against Electron's 123.3 MB installer it is 17 MB today.** With the
same profile changes it should land around 10-11 MB compressed (estimate: Linux `combo-s-code` is
61% of the baseline's xz size; not measured on Windows, which can only be built in CI).

## Recommendation

### Applied

The "change now" set is in the tree:

1. **`[profile.dist]`** in `native/Cargo.toml`: inherits `release`, adds `lto = "fat"` and
   `codegen-units = 1`. `[profile.release]` is unchanged, so `verify.sh`, CI and the rigs keep their
   build time; packaging builds `--profile dist` (output in `target/dist/`).
2. **`-Wl,--icf=all`** for every Linux link (`native/.cargo/config.toml`). The linker is lld 23.1.4,
   from the build image, which CI's Linux job also uses (it runs `verify.sh`). Windows is left alone:
   rustc already passes `/OPT:REF,ICF` to MSVC `link.exe` in optimised builds.
3. **gpui-pre's `image` formats** cut to `bmp gif ico jpeg png webp` (`patches/gpui-pre.patch`, see
   `third_party/README.md`). Kept: everything the backend accepts for attachments, avatars, banners
   and custom emoji (PNG, JPEG, GIF, WebP; SVG goes through resvg), plus BMP and ICO for link
   previews. Bytes in a dropped format fail `files::decodable` and draw as a file row.
4. **VP8 as the only software video encoder** in the `webrtc-sys` glue (`patches/webrtc-sys.patch`,
   see `third_party/PATCHES.md`). All decoders stay, and so do the hardware encoder factories.

Measured on the merged tree (`spike/native-gpui` at `fd8553df` merged in), in the image:

| Build | raw MB | xz -6 MB | build |
|---|---:|---:|---|
| baseline before this change (`release`) | 88.5 | 23.0 | |
| `release` with ICF and both patches | 80.0 | 21.1 | `verify.sh`'s build, unchanged profile |
| **`dist`** (`cargo build --locked --profile dist -p semaphore-app`) | **65.7** | **19.4** | 4 min 8 s on top of a warm `release` build |

Checked with `verify.sh` (all 24 steps exit 0), `slice-e2e.sh` (46 static shots, 0 differ) and
`slice-e2e.sh --voice` (pass; LiveKit's room listing during the run showed our camera and screen
share as `video/VP8`, and the demo publisher's `video/H264` decoded into a tile, so decoders are intact).

### Decisions pending

Not applied; each needs a decision first.


5. **`opt-level = "s"`** is the single biggest lever (-18.7 MB raw, -4.7 MB compressed alone; the
   difference between `combo-o3` and `combo-s` is -12.8 MB raw, -3.2 MB xz). Cost: in the fling rig,
   `s` with fat LTO matched the baseline's and `combo-o3`'s median frame cost (0.72-0.73 against
   0.78 and 0.65-0.78 ms); `s` with thin LTO was ~18% slower than the baseline. Video handling is not covered
   by that rig. If a cost shows in real use, the mixed profile keeps rendering, text, image and media
   crates at 3 and still saves 7.4 MB raw (1.6 MB xz) over `combo-o3`.
6. **`panic = "abort"`**: -11.7 MB raw, -3.1 MB compressed, the second-best lever compressed. Cost:
   any panic in a background task kills the app instead of only that task. Worth it only together
   with a panic hook that logs the panic (and, later, a crash report), and a review of `unwrap`/`expect`
   in long-lived tasks.
7. **RELR**: -3.3 MB raw, ~0 compressed. Only installed size. Decide together with the glibc floor of
   the release build (needs ≥ 2.36).
8. **Replace `keyring` with `oo7` on Linux**: about -3.5 MB raw (estimate) by dropping the second D-Bus
   stack. A small code change in `semaphore-platform-desktop`; behaviour is the same Secret Service.

### Release build environment

The binary built in the image needs **glibc 2.44** (`objdump -T` shows `GLIBC_2.44`; the image is Arch
from November 2026). Ubuntu 24.04 has 2.39 and Debian 13 2.41, so a package built in the
image won't start on them. **Release builds must come from an older-glibc environment**: a build
image on the oldest distribution we support (for example Ubuntu 22.04, glibc 2.35, with clang 21+ and
lld from LLVM's apt repository, since libwebrtc needs them), or `cargo zigbuild` against a glibc
target. Whatever floor is chosen also decides RELR (needs 2.36). The packaging unit owns this; the
size numbers here won't move much with it (estimate).

**Decided:** packages are linked in `native/docker/Dockerfile.package`, a pinned Debian 12 image
(glibc 2.36, clang 22). The resulting binary's highest symbol version is `GLIBC_2.35`, which Debian 12,
Ubuntu 22.04 and newer, and Fedora 45 provide. See [packaging.md](packaging.md).

### Not worth it now

- `opt-level = "z"` over `"s"`: -0.4 to -0.9 MB compressed for slower code and no loop vectorisation.
- Removing video decoders (-3.7 MB raw, estimate): breaks interop with clients that publish H.264 or
  AV1.
- A custom libwebrtc build: 1-3 MB raw (estimate) for a multi-platform C++ build pipeline.

### Realistic target

| | Linux .deb (xz -6) | Linux .rpm (zstd -19) | AppImage | Windows installer |
|---|---:|---:|---:|---:|
| Electron 0.9.0 | 103.0 | 91.4 | 128.4 | 123.3 |
| Native today (measured) | 23.0 | 25.1 | ~31.5 | 17.0 |
| Native with "change now" (measured as `now-safe`, Linux; Windows estimate) | 19.4 | 21.1 | ~26 | ~14.5 |
| Native with all of the above (measured as `combo-s-code`, Linux) | 14.0 | 15.1 | ~18.5 | ~10-11 (estimate) |

AppImage figures add about 1 MB for the AppImage runtime to the measured block-compressed size, and
assume system libraries are not bundled (bundling them all adds ~2.2 MB). Installed size goes from
88.5 MB to 44-54 MB.

## Commands

Everything ran in the build image. `W=native/target/size` was a throwaway directory (ignored by
`native/.gitignore`), removed afterwards. The scripts lived in the scratch space; their essence:

```bash
# one clean build per variant, own target dir, timed
scripts/in-image.sh env CARGO_TARGET_DIR=$W/<variant> [CARGO_PROFILE_RELEASE_OPT_LEVEL=s] \
  [CARGO_PROFILE_RELEASE_LTO=fat] [CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1] [CARGO_PROFILE_RELEASE_PANIC=abort] \
  cargo build --release --locked -p semaphore-app \
  [--config 'target.x86_64-unknown-linux-gnu.rustflags=["-C","link-arg=-Wl,--icf=all","-C","link-arg=-Wl,-z,pack-relative-relocs"]'] \
  [--config 'profile.release.package.<hot-crate>.opt-level=3' ...]
# (cargo merges the --config rustflags array with .cargo/config.toml's)

# link map for the breakdown (baseline only)
  --config 'target.x86_64-unknown-linux-gnu.rustflags=["-C","link-arg=-Wl,-Map=<dir>/link.map"]'
# then: a Python pass over the map summing input-section sizes per output section and origin
# (Rust crate from the rcgu object name; libwebrtc members classified by the symbols they define)

readelf -SW <bin>; objdump -p <bin> | grep NEEDED; objdump -T <bin> | grep -o 'GLIBC_[0-9.]*' | sort -uV
llvm-ar t libwebrtc.a | wc -l; llvm-size -t libwebrtc.a
cargo tree --locked -p semaphore-app -e normal -d --target x86_64-unknown-linux-gnu
cargo tree --locked -p semaphore-app -e normal,features --target x86_64-unknown-linux-gnu -i <crate>

# compression (host xz/zstd/gzip on the copied binaries)
xz -T1 -6 -c f | wc -c; xz -T1 -9e ...; zstd -19 ...; zstd -19 --long=27 ...; zstd -3 ...; gzip -9 ...
split -b 131072 f c. && for c in c.*; do zstd -19 -c $c | wc -c; done   # squashfs-style blocks

# the two source experiments: temporary edits, built without --locked, then
git checkout -- third_party/vendor/gpui-pre/Cargo.toml third_party/vendor/webrtc-sys/src/video_encoder_factory.cpp Cargo.lock

# Windows
gh run download 42988152950 -n semaphore-app-windows -D <empty dir>; objdump -h semaphore-app.exe

# runtime: the same build with -p rig-list in each variant's target dir and settings, then
# scripts/run-list.sh with its target-volume mount pointed at that dir:
VARIANT_TARGET=$W/<variant> CPUSET=8-15 LABEL=<variant>-<run> <copy of run-list.sh> gpu <out> fling --arm real
```
