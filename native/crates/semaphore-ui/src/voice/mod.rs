//! Voice bar and video tiles. Unit U11.

mod bar;
mod frames;
mod icons;
mod model;
mod stage;
#[cfg(feature = "stories")]
mod stories;
mod theme;

pub use frames::VideoFrames;
pub use model::{
    NoController, PttState, QualityLevel, TileDemand, VoiceController, VoiceStageModel,
    build_tiles, grid_columns,
};
pub use stage::VoiceStage;

use gpui_kit::{Window, WindowOptions};

/// How a tile gets its pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoPath {
    /// NV12 textures written in place, through `VideoUploader` and `paint_video_surface`.
    Surface,
    /// RGBA `RenderImage`s. Windows, until its renderer gets a surface path: `draw_surfaces` is
    /// empty there, and this costs far more CPU (70-111% of a core on Linux for the T1 load).
    RgbaFallback,
}

/// The compile-time switch for the D3D11 patch: a platform goes here once its renderer really draws
/// surfaces. A renderer can have an uploader and still draw nothing, so asking at run time alone
/// isn't enough. Add `target_os = "windows"` when `third_party/README.md`'s swap is done.
const SURFACE_PATH_BUILT: bool = cfg!(target_os = "linux");

pub fn video_path(window: &Window) -> VideoPath {
    if SURFACE_PATH_BUILT && window.video_uploader().is_some() {
        VideoPath::Surface
    } else {
        VideoPath::RgbaFallback
    }
}

/// Apply to any window that can show video. GPUI otherwise caps an inactive window to about 30 fps,
/// and a call is exactly what people watch while they type elsewhere.
pub fn video_window_options(options: WindowOptions) -> WindowOptions {
    WindowOptions {
        inactive_frame_interval: None,
        ..options
    }
}

#[cfg(feature = "stories")]
pub use stories::stories;

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn video_windows_are_never_throttled_for_being_inactive() {
        let options = video_window_options(WindowOptions::default());
        assert_eq!(options.inactive_frame_interval, None);
    }
}
