# gpui-pre supply-chain audit

Generated 2026-11-05T19:13:52+00:00 from `native/Cargo.lock`.

Upstream: <https://github.com/zed-industries/zed>. Every published `.crate` was downloaded from static.crates.io and checked against its `Cargo.lock` sha256. The claimed Zed commit was shallow-fetched and each crate directory byte-compared against the published source.

## Summary

| Measure | Count |
|---|---|
| Crates in Cargo.lock | 22 |
| Compared against Zed | 21 |
| Unmatched or error | 1 |
| Files compared | 336 |
| Expected packaging diffs | 103 |
| **Unexpected diffs** | **14** |

## Crates

| Crate | Version | Claimed commit | Zed path | Files | Expected | Unexpected | Status |
|---|---|---|---|---|---|---|---|
| gpui-pre | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui | 161 | 4 | 1 | compared |
| gpui-pre-apple | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_apple | 12 | 4 | 6 | compared |
| gpui-pre-bench-metrics | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/bench_metrics | 2 | 4 | 0 | compared |
| gpui-pre-collections | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/collections | 4 | 4 | 0 | compared |
| gpui-pre-derive-refineable | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/refineable/derive_refineable | 2 | 4 | 0 | compared |
| gpui-pre-http-client | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/http_client | 3 | 4 | 0 | compared |
| gpui-pre-ios | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_ios | 13 | 4 | 0 | compared |
| gpui-pre-linux | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_linux | 29 | 4 | 0 | compared |
| gpui-pre-macos | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_macos | 12 | 4 | 0 | compared |
| gpui-pre-macros | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_macros | 16 | 4 | 3 | compared |
| gpui-pre-platform | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_platform | 5 | 4 | 0 | compared |
| gpui-pre-refineable | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/refineable | 2 | 7 | 0 | compared |
| gpui-pre-reqwest | 0.12.15 | (none) | (none) | 0 | 0 | 1 | unmatched |
| gpui-pre-scheduler | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/scheduler | 6 | 4 | 0 | compared |
| gpui-pre-shared-string | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_shared_string | 2 | 4 | 0 | compared |
| gpui-pre-sum-tree | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/sum_tree | 5 | 4 | 0 | compared |
| gpui-pre-util | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_util | 3 | 4 | 0 | compared |
| gpui-pre-web | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_web | 17 | 20 | 0 | compared |
| gpui-pre-wgpu | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_wgpu | 11 | 4 | 3 | compared |
| gpui-pre-windows | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/gpui_windows | 25 | 4 | 0 | compared |
| gpui-pre-ztracing | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/ztracing | 4 | 4 | 0 | compared |
| gpui-pre-ztracing-macro | 0.3.11 | f816e1f9263e3a8ef63c4baaa02e1441ce1c6038 | crates/ztracing_macro | 2 | 4 | 0 | compared |

## Crates that could not be matched

- **gpui-pre-reqwest 0.12.15** (unmatched): no [package.metadata.gpui-pre] zed-rev/zed-crate in Cargo.toml; description='higher level HTTP client library zed-industries/request@c156624'; repository=https://github.com/seanmonstar/reqwest; .cargo_vcs_info.json sha1=68a26f46bb6ed5131f56517a574041d2c4d2aec8 dirty=True path_in_vcs=''; no Zed commit is claimed and no Zed crate can be identified, so there is nothing to compare it against

## Expected packaging changes

- **cargo_generated_lockfile**: 21
  - gpui-pre:Cargo.lock, gpui-pre-apple:Cargo.lock, gpui-pre-bench-metrics:Cargo.lock, gpui-pre-collections:Cargo.lock, gpui-pre-derive-refineable:Cargo.lock, gpui-pre-http-client:Cargo.lock, ...
- **cargo_manifest_orig**: 21
  - gpui-pre:Cargo.toml.orig, gpui-pre-apple:Cargo.toml.orig, gpui-pre-bench-metrics:Cargo.toml.orig, gpui-pre-collections:Cargo.toml.orig, gpui-pre-derive-refineable:Cargo.toml.orig, gpui-pre-http-client:Cargo.toml.orig, ...
- **cargo_manifest_rewrite**: 21
  - gpui-pre:Cargo.toml, gpui-pre-apple:Cargo.toml, gpui-pre-bench-metrics:Cargo.toml, gpui-pre-collections:Cargo.toml, gpui-pre-derive-refineable:Cargo.toml, gpui-pre-http-client:Cargo.toml, ...
- **nested_package_omitted**: 3
  - gpui-pre-refineable:derive_refineable/Cargo.toml, gpui-pre-refineable:derive_refineable/LICENSE-APACHE, gpui-pre-refineable:derive_refineable/src/derive_refineable.rs
- **omitted_from_package**: 16
  - gpui-pre-web:examples/hello_web/.cargo/config.toml, gpui-pre-web:examples/hello_web/.gitignore, gpui-pre-web:examples/hello_web/Cargo.toml, gpui-pre-web:examples/hello_web/LICENSE-APACHE, gpui-pre-web:examples/hello_web/dynamic_fonts.rs, gpui-pre-web:examples/hello_web/font_fallback_test.rs, ...
- **symlink_dereferenced**: 21
  - gpui-pre:LICENSE-APACHE, gpui-pre-apple:LICENSE-APACHE, gpui-pre-bench-metrics:LICENSE-APACHE, gpui-pre-collections:LICENSE-APACHE, gpui-pre-derive-refineable:LICENSE-APACHE, gpui-pre-http-client:LICENSE-APACHE, ...

## Unexpected differences

### gpui-pre 0.3.11

- claimed Zed commit: `f816e1f9263e3a8ef63c4baaa02e1441ce1c6038`
- Zed path: `crates/gpui`

- **`src/action.rs`** — modified
  - removed 2 line(s), added 3 line(s)

    ```diff
    -    27             #[derive(::std::clone::Clone, ::std::cmp::PartialEq, ::std::default::Default, ::std::fmt::Debug, gpui::Action)]
    -    35             #[derive(::std::clone::Clone, ::std::cmp::PartialEq, ::std::default::Default, ::std::fmt::Debug, gpui::Action)]
    +     1 // Modified for gpui-pre (snapshot of zed@f816e1f): the `actions!` derive paths are crate-relative.
    +    28             #[derive(::std::clone::Clone, ::std::cmp::PartialEq, ::std::default::Default, ::std::fmt::Debug, $crate::Action)]
    +    36             #[derive(::std::clone::Clone, ::std::cmp::PartialEq, ::std::default::Default, ::std::fmt::Debug, $crate::Action)]
    ```

### gpui-pre-apple 0.3.11

- claimed Zed commit: `f816e1f9263e3a8ef63c4baaa02e1441ce1c6038`
- Zed path: `crates/gpui_apple`

- **`build.rs`** — modified — signals: build_script
  - removed 1 line(s), added 2 line(s)

    ```diff
    -   105         PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../gpui")
    +     1 // Modified for gpui-pre (snapshot of zed@f816e1f): the gpui sources it reads are vendored under `vendor/gpui`.
    +   106         PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("vendor/gpui")
    ```

- **`vendor/gpui/src/color.rs`** — added_file — signals: added_file, network
  - vendored copy of `crates/gpui/src/color.rs`; identical to upstream: True
  - removed 0 line(s), added 1070 line(s)

    ```diff
    +     1 use anyhow::{Context as _, bail};
    +     2 use schemars::{JsonSchema, json_schema};
    +     3 use serde::{
    +     4     Deserialize, Deserializer, Serialize, Serializer,
    +     5     de::{self, Visitor},
    +     6 };
    +     7 use std::borrow::Cow;
    +     8 use std::{
    +     9     fmt::{self, Display, Formatter},
    +    10     hash::{Hash, Hasher},
    +    11 };
    +    12 
    +    13 /// Convert an RGB hex color code number to a color type
    +    14 pub fn rgb(hex: u32) -> Rgba {
    +    15     let [_, r, g, b] = hex.to_be_bytes().map(|b| (b as f32) / 255.0);
    +    16     Rgba { r, g, b, a: 1.0 }
    +    17 }
    +    18 
    +    19 /// Convert an RGBA hex color code number to [`Rgba`]
    +    20 pub fn rgba(hex: u32) -> Rgba {
    +    21     let [r, g, b, a] = hex.to_be_bytes().map(|b| (b as f32) / 255.0);
    +    22     Rgba { r, g, b, a }
    +    23 }
    +    24 
    +    25 /// Swap from RGBA with premultiplied alpha to BGRA
    +    26 pub fn swap_rgba_pa_to_bgra(color: &mut [u8]) {
    +    27     color.swap(0, 2);
    +    28     if color[3] > 0 {
    +    29         let a = color[3] as f32 / 255.;
    +    30         color[0] = (color[0] as f32 / a) as u8;
    +    31         color[1] = (color[1] as f32 / a) as u8;
    +    32         color[2] = (color[2] as f32 / a) as u8;
    +    33     }
    +    34 }
    +    35 
    +    36 /// An RGBA color
    +    37 #[derive(PartialEq, Clone, Copy, Default)]
    +    38 #[repr(C)]
    +    39 pub struct Rgba {
    +    40     /// The red component of the color, in the range 0.0 to 1.0
    +    41     pub r: f32,
    +    42     /// The green component of the color, in the range 0.0 to 1.0
    +    43     pub g: f32,
    +    44     /// The blue component of the color, in the range 0.0 to 1.0
    +    45     pub b: f32,
    +    46     /// The alpha component of the color, in the range 0.0 to 1.0
    +    47     pub a: f32,
    +    48 }
    +    49 
    +    50 impl fmt::Debug for Rgba {
    +    51     fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    +    52         write!(f, "rgba({:#010x})", u32::from(*self))
    +    53     }
    +    54 }
    +    55 
    +    56 impl Rgba {
    +    57     /// Create a new [`Rgba`] color by blending this and another color together
    +    58     pub fn blend(&self, other: Rgba) -> Self {
    +    59         if other.a >= 1.0 {
    +    60             other
    ```
    1010 more changed line(s) are listed in the JSON report.

- **`vendor/gpui/src/geometry.rs`** — added_file — signals: added_file
  - vendored copy of `crates/gpui/src/geometry.rs`; identical to upstream: True
  - removed 0 line(s), added 4041 line(s)

    ```diff
    +     1 //! The GPUI geometry module is a collection of types and traits that
    +     2 //! can be used to describe common units, concepts, and the relationships
    +     3 //! between them.
    +     4 
    +     5 use anyhow::{Context as _, anyhow};
    +     6 use core::fmt::Debug;
    +     7 use derive_more::{Add, AddAssign, Div, DivAssign, Mul, Neg, Sub, SubAssign};
    +     8 use refineable::Refineable;
    +     9 use schemars::{JsonSchema, json_schema};
    +    10 use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
    +    11 use std::borrow::Cow;
    +    12 use std::ops::{AddAssign, Range};
    +    13 use std::{
    +    14     cmp::{self, PartialOrd},
    +    15     fmt::{self, Display},
    +    16     hash::Hash,
    +    17     ops::{Add, Div, Mul, MulAssign, Neg, Sub},
    +    18 };
    +    19 use taffy::prelude::{TaffyGridLine, TaffyGridSpan};
    +    20 
    +    21 use crate::{App, DisplayId};
    +    22 
    +    23 /// Axis in a 2D cartesian space.
    +    24 #[derive(Copy, Clone, PartialEq, Eq, Serialize, Deserialize, Debug)]
    +    25 pub enum Axis {
    +    26     /// The y axis, or up and down
    +    27     Vertical,
    +    28     /// The x axis, or left and right
    +    29     Horizontal,
    +    30 }
    +    31 
    +    32 impl Axis {
    +    33     /// Swap this axis to the opposite axis.
    +    34     pub fn invert(self) -> Self {
    +    35         match self {
    +    36             Axis::Vertical => Axis::Horizontal,
    +    37             Axis::Horizontal => Axis::Vertical,
    +    38         }
    +    39     }
    +    40 }
    +    41 
    +    42 /// A trait for accessing the given unit along a certain axis.
    +    43 pub trait Along {
    +    44     /// The unit associated with this type
    +    45     type Unit;
    +    46 
    +    47     /// Returns the unit along the given axis.
    +    48     fn along(&self, axis: Axis) -> Self::Unit;
    +    49 
    +    50     /// Applies the given function to the unit along the given axis and returns a new value.
    +    51     fn apply_along(&self, axis: Axis, f: impl FnOnce(Self::Unit) -> Self::Unit) -> Self;
    +    52 }
    +    53 
    +    54 /// Describes a location in a 2D cartesian space.
    +    55 ///
    +    56 /// It holds two public fields, `x` and `y`, which represent the coordinates in the space.
    +    57 /// The type `T` for the coordinates can be any type that implements `Default`, `Clone`, and `Debug`.
    +    58 ///
    +    59 /// # Examples
    +    60 ///
    ```
    3981 more changed line(s) are listed in the JSON report.

- **`vendor/gpui/src/platform.rs`** — added_file — signals: added_file, network, process_spawn, unsafe
  - vendored copy of `crates/gpui/src/platform.rs`; identical to upstream: True
  - removed 0 line(s), added 3967 line(s)

    ```diff
    +     1 mod app_menu;
    +     2 mod keyboard;
    +     3 mod keystroke;
    +     4 mod platform_info;
    +     5 
    +     6 #[cfg(all(target_os = "linux", feature = "wayland"))]
    +     7 #[expect(missing_docs)]
    +     8 pub mod layer_shell;
    +     9 
    +    10 /// Types for configuring parent-anchored popup windows such as menus, dropdowns and tooltips.
    +    11 pub mod popup;
    +    12 
    +    13 #[cfg(any(test, feature = "test-support", feature = "bench-support"))]
    +    14 mod threaded_dispatcher;
    +    15 
    +    16 #[cfg(any(test, feature = "test-support", feature = "bench-support"))]
    +    17 mod test;
    +    18 
    +    19 #[cfg(all(target_os = "macos", any(test, feature = "test-support")))]
    +    20 mod visual_test;
    +    21 
    +    22 #[cfg(all(
    +    23     feature = "screen-capture",
    +    24     any(target_os = "windows", target_os = "linux", target_os = "freebsd",)
    +    25 ))]
    +    26 pub mod scap_screen_capture;
    +    27 
    +    28 #[cfg(all(
    +    29     any(target_os = "windows", target_os = "linux"),
    +    30     feature = "screen-capture"
    +    31 ))]
    +    32 pub(crate) type PlatformScreenCaptureFrame = scap::frame::Frame;
    +    33 #[cfg(not(feature = "screen-capture"))]
    +    34 pub(crate) type PlatformScreenCaptureFrame = ();
    +    35 #[cfg(all(target_os = "macos", feature = "screen-capture"))]
    +    36 pub(crate) type PlatformScreenCaptureFrame =
    +    37     objc2_core_foundation::CFRetained<objc2_core_video::CVImageBuffer>;
    +    38 
    +    39 use crate::{
    +    40     Action, AnyWindowHandle, App, AsyncWindowContext, BackgroundExecutor, Bounds, Corners,
    +    41     DEFAULT_WINDOW_SIZE, DevicePixels, DispatchEventResult, Edges, ExternalDragPayload, Font,
    +    42     FontId, FontMetrics, FontRun, ForegroundExecutor, GlyphId, GpuSpecs, Hsla, ImageSource, Keymap,
    +    43     LineLayout, MissingGlyphSink, Pixels, PlatformGestures, PlatformInput, Point, Priority,
    +    44     RenderGlyphParams, RenderImage, RenderImageParams, RenderSvgParams, Scene, ShapedGlyph,
    +    45     ShapedRun, SharedString, Size, SvgRenderer, SystemWindowTab, Task, Window, WindowControlArea,
    +    46     hash, point, px, size,
    +    47 };
    +    48 #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    +    49 use anyhow::bail;
    +    50 use anyhow::{Context as _, Result};
    +    51 use async_task::Runnable;
    +    52 use collections::FxHashMap;
    +    53 use futures::channel::oneshot;
    +    54 #[cfg(any(test, feature = "test-support", feature = "bench-support"))]
    +    55 use image::RgbaImage;
    +    56 use image::codecs::gif::GifDecoder;
    +    57 use image::{AnimationDecoder as _, DynamicImage, Frame};
    +    58 use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
    +    59 use scheduler::Instant;
    +    60 pub use scheduler::RunnableMeta;
    ```
    3907 more changed line(s) are listed in the JSON report.

- **`vendor/gpui/src/scene.rs`** — added_file — signals: added_file
  - vendored copy of `crates/gpui/src/scene.rs`; identical to upstream: True
  - removed 0 line(s), added 949 line(s)

    ```diff
    +     1 // todo("windows"): remove
    +     2 #![cfg_attr(windows, allow(dead_code))]
    +     3 
    +     4 use schemars::JsonSchema;
    +     5 use serde::{Deserialize, Serialize};
    +     6 
    +     7 use crate::{
    +     8     AtlasTextureId, AtlasTile, Background, Bounds, ContentMask, Corners, Edges, Hsla, Pixels,
    +     9     Point, Radians, ScaledPixels, Size, bounds_tree::BoundsTree, point,
    +    10 };
    +    11 use std::{
    +    12     fmt::Debug,
    +    13     iter::Peekable,
    +    14     ops::{Add, Range, Sub},
    +    15     slice,
    +    16 };
    +    17 
    +    18 #[allow(non_camel_case_types, unused)]
    +    19 #[expect(missing_docs)]
    +    20 pub type PathVertex_ScaledPixels = PathVertex<ScaledPixels>;
    +    21 
    +    22 #[expect(missing_docs)]
    +    23 pub type DrawOrder = u32;
    +    24 
    +    25 /// A boolean stored as a `u32` so that GPU-facing structs contain no
    +    26 /// compiler-inserted padding bytes, which would be undefined behavior to
    +    27 /// reinterpret as `&[u8]` when writing instance buffers. Guaranteed to be
    +    28 /// `0` or `1` by construction; shaders read it as a `u32`/`uint`.
    +    29 #[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
    +    30 #[repr(transparent)]
    +    31 pub struct PaddedBool32(u32);
    +    32 
    +    33 impl From<bool> for PaddedBool32 {
    +    34     fn from(value: bool) -> Self {
    +    35         PaddedBool32(value as u32)
    +    36     }
    +    37 }
    +    38 
    +    39 #[derive(Default)]
    +    40 #[expect(missing_docs)]
    +    41 pub struct Scene {
    +    42     pub(crate) paint_operations: Vec<PaintOperation>,
    +    43     primitive_bounds: BoundsTree<ScaledPixels>,
    +    44     layer_stack: Vec<DrawOrder>,
    +    45     pub shadows: Vec<Shadow>,
    +    46     pub quads: Vec<Quad>,
    +    47     pub paths: Vec<Path<ScaledPixels>>,
    +    48     pub underlines: Vec<Underline>,
    +    49     pub monochrome_sprites: Vec<MonochromeSprite>,
    +    50     pub subpixel_sprites: Vec<SubpixelSprite>,
    +    51     pub polychrome_sprites: Vec<PolychromeSprite>,
    +    52     pub surfaces: Vec<PaintSurface>,
    +    53 }
    +    54 
    +    55 #[expect(missing_docs)]
    +    56 impl Scene {
    +    57     pub fn clear(&mut self) {
    +    58         self.paint_operations.clear();
    +    59         self.primitive_bounds.clear();
    +    60         self.layer_stack.clear();
    ```
    889 more changed line(s) are listed in the JSON report.

- **`vendor/gpui/src/window.rs`** — added_file — signals: added_file, process_spawn, unsafe
  - vendored copy of `crates/gpui/src/window.rs`; identical to upstream: True
  - removed 0 line(s), added 10573 line(s)

    ```diff
    +     1 #[cfg(feature = "profiler")]
    +     2 use crate::DebugFrameOverlayMode;
    +     3 #[cfg(any(feature = "inspector", debug_assertions))]
    +     4 use crate::Inspector;
    +     5 #[cfg(feature = "profiler")]
    +     6 use crate::profiler;
    +     7 use crate::subscription::SingleSubscriberSet;
    +     8 use crate::taffy::TaffyLayoutEngine;
    +     9 use crate::{
    +    10     Action, AnyDrag, AnyElement, AnyImageCache, AnyTooltip, AnyView, App, AppContext, Arena, Asset,
    +    11     AsyncWindowContext, AtlasTile, AvailableSpace, Background, BorderStyle, Bounds, BoxShadow,
    +    12     Capslock, Context, Corners, CursorHideMode, CursorStyle, Decorations, DevicePixels,
    +    13     DispatchActionListener, DispatchNodeId, DispatchTree, DisplayId, Edges, Effect, Entity,
    +    14     EntityId, EventEmitter, FileDropEvent, FontId, Global, GlobalElementId, GlyphId, GpuSpecs,
    +    15     Hsla, InputHandler, InputPreference, IsZero, KeyBinding, KeyContext, KeyDownEvent, KeyEvent,
    +    16     Keystroke, KeystrokeEvent, LayoutId, LineLayoutIndex, Modifiers, ModifiersChangedEvent,
    +    17     MonochromeSprite, MouseButton, MouseEvent, MouseMoveEvent, MouseUpEvent, Path, Pixels,
    +    18     PlatformAtlas, PlatformDisplay, PlatformInput, PlatformInputHandler, PlatformWindow, Point,
    +    19     PolychromeSprite, Priority, PromptButton, PromptLevel, Quad, Render, RenderGlyphParams,
    +    20     RenderImage, RenderImageParams, RenderSvgParams, Replay, ResizeEdge, SMOOTH_SVG_SCALE_FACTOR,
    +    21     SUBPIXEL_VARIANTS_X, SUBPIXEL_VARIANTS_Y, ScaledPixels, Scene, Shadow, SharedString, Size,
    +    22     StrikethroughStyle, Style, SubpixelSprite, Subscription, SystemWindowTab,
    +    23     SystemWindowTabController, TabStopMap, Task, TextInputConfiguration, TextInputStateChange,
    +    24     TextRenderingMode, TextStyle, TextStyleRefinement, ThermalState, TransformationMatrix,
    +    25     Underline, UnderlineStyle, WindowAppearance, WindowBackgroundAppearance, WindowBounds,
    +    26     WindowControls, WindowDecorations, WindowInsets, WindowOptions, WindowParams, WindowTextSystem,
    +    27     WindowVisibility, point, prelude::*, px, rems, size, transparent_black,
    +    28 };
    +    29 
    +    30 use crate::gestures::{GestureTuning, RecognizedTouchGesture, TouchGestureRecognizer};
    +    31 use crate::interactive::TouchEvent;
    +    32 use anyhow::{Context as _, Result, anyhow};
    +    33 use collections::{FxHashMap, FxHashSet};
    +    34 use derive_more::{Deref, DerefMut};
    +    35 use futures::channel::oneshot;
    +    36 use gpui_util::post_inc;
    +    37 use gpui_util::{ResultExt, measure};
    +    38 use itertools::FoldWhile::{Continue, Done};
    +    39 use itertools::Itertools;
    +    40 #[cfg(any(target_os = "macos", target_os = "ios"))]
    +    41 use objc2_core_foundation::CFRetained;
    +    42 #[cfg(any(target_os = "macos", target_os = "ios"))]
    +    43 use objc2_core_video::CVPixelBuffer;
    +    44 use parking_lot::{RwLock, RwLockUpgradableReadGuard};
    +    45 use raw_window_handle::{HandleError, HasDisplayHandle, HasWindowHandle};
    +    46 use refineable::Refineable;
    +    47 use scheduler::Instant;
    +    48 use slotmap::SlotMap;
    +    49 use smallvec::SmallVec;
    +    50 use std::{
    +    51     any::{Any, TypeId},
    +    52     borrow::Cow,
    +    53     cell::{Cell, RefCell},
    +    54     cmp,
    +    55     fmt::{Debug, Display},
    +    56     hash::{Hash, Hasher},
    +    57     marker::PhantomData,
    +    58     mem,
    +    59     ops::{DerefMut, Range},
    +    60     rc::Rc,
    ```
    10513 more changed line(s) are listed in the JSON report.

### gpui-pre-macros 0.3.11

- claimed Zed commit: `f816e1f9263e3a8ef63c4baaa02e1441ce1c6038`
- Zed path: `crates/gpui_macros`

- **`Cargo.toml`** — dependency_set_changed — signals: new_dependency
  - dependency table keys differ from the Zed manifest; renames keep their key and dev-dependencies are stripped by cargo when publishing, so neither explains this
  - added dependencies: `proc-macro-crate`

- **`src/gpui_macros.rs`** — modified — signals: proc_macro
  - removed 0 line(s), added 79 line(s)

    ```diff
    +     1 // Modified for gpui-pre (snapshot of zed@f816e1f): the proc-macro entry points resolve gpui through a facade.
    +     2 mod gpui_pre_facade_paths;
    +    23     gpui_pre_facade_paths::rewrite(__gpui_pre_derive_action(input))
    +    24 }
    +    25 
    +    26 fn __gpui_pre_derive_action(input: TokenStream) -> TokenStream {
    +    35     gpui_pre_facade_paths::rewrite(__gpui_pre_register_action(ident))
    +    36 }
    +    37 
    +    38 fn __gpui_pre_register_action(ident: TokenStream) -> TokenStream {
    +    46     gpui_pre_facade_paths::rewrite(__gpui_pre_derive_into_element(input))
    +    47 }
    +    48 
    +    49 fn __gpui_pre_derive_into_element(input: TokenStream) -> TokenStream {
    +    56     gpui_pre_facade_paths::rewrite(__gpui_pre_derive_render(input))
    +    57 }
    +    58 
    +    59 fn __gpui_pre_derive_render(input: TokenStream) -> TokenStream {
    +    78     gpui_pre_facade_paths::rewrite(__gpui_pre_derive_app_context(input))
    +    79 }
    +    80 
    +    81 fn __gpui_pre_derive_app_context(input: TokenStream) -> TokenStream {
    +   115     gpui_pre_facade_paths::rewrite(__gpui_pre_derive_visual_context(input))
    +   116 }
    +   117 
    +   118 fn __gpui_pre_derive_visual_context(input: TokenStream) -> TokenStream {
    +   126     gpui_pre_facade_paths::rewrite(__gpui_pre_style_helpers(input))
    +   127 }
    +   128 
    +   129 fn __gpui_pre_style_helpers(input: TokenStream) -> TokenStream {
    +   136     gpui_pre_facade_paths::rewrite(__gpui_pre_visibility_style_methods(input))
    +   137 }
    +   138 
    +   139 fn __gpui_pre_visibility_style_methods(input: TokenStream) -> TokenStream {
    +   146     gpui_pre_facade_paths::rewrite(__gpui_pre_margin_style_methods(input))
    +   147 }
    +   148 
    +   149 fn __gpui_pre_margin_style_methods(input: TokenStream) -> TokenStream {
    +   156     gpui_pre_facade_paths::rewrite(__gpui_pre_padding_style_methods(input))
    +   157 }
    +   158 
    +   159 fn __gpui_pre_padding_style_methods(input: TokenStream) -> TokenStream {
    +   166     gpui_pre_facade_paths::rewrite(__gpui_pre_position_style_methods(input))
    +   167 }
    +   168 
    +   169 fn __gpui_pre_position_style_methods(input: TokenStream) -> TokenStream {
    +   176     gpui_pre_facade_paths::rewrite(__gpui_pre_overflow_style_methods(input))
    +   177 }
    +   178 
    +   179 fn __gpui_pre_overflow_style_methods(input: TokenStream) -> TokenStream {
    +   186     gpui_pre_facade_paths::rewrite(__gpui_pre_cursor_style_methods(input))
    +   187 }
    +   188 
    +   189 fn __gpui_pre_cursor_style_methods(input: TokenStream) -> TokenStream {
    +   196     gpui_pre_facade_paths::rewrite(__gpui_pre_border_style_methods(input))
    +   197 }
    +   198 
    +   199 fn __gpui_pre_border_style_methods(input: TokenStream) -> TokenStream {
    +   206     gpui_pre_facade_paths::rewrite(__gpui_pre_box_shadow_style_methods(input))
    +   207 }
    ```
    19 more changed line(s) are listed in the JSON report.

- **`src/gpui_pre_facade_paths.rs`** — added_file — signals: added_file, proc_macro
  - removed 0 line(s), added 87 line(s)

    ```diff
    +     1 // Modified for gpui-pre (snapshot of zed@f816e1f): this module is added by the script.
    +     2 // Injected by gpui-kit's script/bump-gpui.ts. Keep fixes in that script.
    +     3 use proc_macro::{Group, Ident, Literal, Punct, Spacing, TokenStream, TokenTree};
    +     4 use proc_macro_crate::{crate_name, FoundCrate};
    +     5 
    +     6 enum FacadePath {
    +     7     Itself,
    +     8     Name(String),
    +     9 }
    +    10 
    +    11 pub(crate) fn rewrite(stream: TokenStream) -> TokenStream {
    +    12     let facade = match crate_name("gpui-kit") {
    +    13         Ok(FoundCrate::Name(name)) => Some(FacadePath::Name(name)),
    +    14         Ok(FoundCrate::Itself) => Some(FacadePath::Itself),
    +    15         Err(_) => None,
    +    16     };
    +    17     rewrite_stream(stream, facade.as_ref())
    +    18 }
    +    19 
    +    20 fn rewrite_stream(stream: TokenStream, facade: Option<&FacadePath>) -> TokenStream {
    +    21     let tokens: Vec<_> = stream.into_iter().collect();
    +    22     let mut output = TokenStream::new();
    +    23     for (index, token) in tokens.iter().enumerate() {
    +    24         match token {
    +    25             TokenTree::Group(group) => {
    +    26                 let mut rewritten = Group::new(group.delimiter(), rewrite_stream(group.stream(), facade));
    +    27                 rewritten.set_span(group.span());
    +    28                 output.extend([TokenTree::Group(rewritten)]);
    +    29             }
    +    30             TokenTree::Ident(ident)
    +    31                 if is_path_head(&tokens, index)
    +    32                     && (ident.to_string() == "gpui" || ident.to_string() == "gpui_platform") =>
    +    33             {
    +    34                 append_path_head(&mut output, ident, facade);
    +    35             }
    +    36             TokenTree::Literal(literal) => {
    +    37                 output.extend([TokenTree::Literal(rewrite_literal(literal, facade))]);
    +    38             }
    +    39             token => output.extend([token.clone()]),
    +    40         }
    +    41     }
    +    42     output
    +    43 }
    +    44 
    +    45 fn is_path_head(tokens: &[TokenTree], index: usize) -> bool {
    +    46     matches!(tokens.get(index + 1), Some(TokenTree::Punct(first)) if first.as_char() == ':')
    +    47         && matches!(tokens.get(index + 2), Some(TokenTree::Punct(second)) if second.as_char() == ':')
    +    48 }
    +    49 
    +    50 fn append_path_head(output: &mut TokenStream, original: &Ident, facade: Option<&FacadePath>) {
    +    51     let name = match facade {
    +    52         Some(FacadePath::Itself) => "crate",
    +    53         Some(FacadePath::Name(name)) => name,
    +    54         None => {
    +    55             output.extend([TokenTree::Ident(original.clone())]);
    +    56             return;
    +    57         }
    +    58     };
    +    59     output.extend([TokenTree::Ident(Ident::new(name, original.span()))]);
    +    60     if original.to_string() == "gpui_platform" {
    ```
    27 more changed line(s) are listed in the JSON report.

### gpui-pre-reqwest 0.12.15

- claimed Zed commit: `(none)`
- Zed path: `(none)`

- **`(crate)`** — unmatched_crate
  - no [package.metadata.gpui-pre] zed-rev/zed-crate in Cargo.toml; description='higher level HTTP client library zed-industries/request@c156624'; repository=https://github.com/seanmonstar/reqwest; .cargo_vcs_info.json sha1=68a26f46bb6ed5131f56517a574041d2c4d2aec8 dirty=True path_in_vcs=''; no Zed commit is claimed and no Zed crate can be identified, so there is nothing to compare it against

### gpui-pre-wgpu 0.3.11

- claimed Zed commit: `f816e1f9263e3a8ef63c4baaa02e1441ce1c6038`
- Zed path: `crates/gpui_wgpu`

- **`src/wgpu_atlas.rs`** — modified
  - removed 1 line(s), added 1 line(s)

    ```diff
    -   429                     default_queue: wgpu::QueueDescriptor::default(),
    +     1 // Modified for gpui-pre (snapshot of zed@f816e1f): adapt device queues and sRGB detection to wgpu 30.0.1.
    ```

- **`src/wgpu_context.rs`** — modified
  - removed 1 line(s), added 1 line(s)

    ```diff
    -   466                 default_queue: wgpu::QueueDescriptor::default(),
    +     1 // Modified for gpui-pre (snapshot of zed@f816e1f): adapt device queues and sRGB detection to wgpu 30.0.1.
    ```

- **`src/wgpu_renderer.rs`** — modified
  - removed 1 line(s), added 2 line(s)

    ```diff
    -   406                     .find(|format| !format.has_srgb_suffix())
    +     1 // Modified for gpui-pre (snapshot of zed@f816e1f): adapt device queues and sRGB detection to wgpu 30.0.1.
    +   407                     .find(|format| !format.is_srgb())
    ```
