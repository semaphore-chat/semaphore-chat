//! Voice bar and video tiles. Unit U11.

use gpui_kit::Window;

/// How a tile gets its pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoPath {
    /// NV12 textures written in place, through `VideoUploader` and `paint_video_surface`.
    Surface,
    /// RGBA `RenderImage`s. Windows, until its renderer gets a surface path: `draw_surfaces` is
    /// empty there, and this costs far more CPU (70-111% of a core on Linux for the T1 load).
    RgbaFallback,
}

pub fn video_path(window: &Window) -> VideoPath {
    if window.video_uploader().is_some() {
        VideoPath::Surface
    } else {
        VideoPath::RgbaFallback
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
