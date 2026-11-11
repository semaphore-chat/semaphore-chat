//! Voice bar and video tiles. Unit U11.

mod bar;
mod debug;
pub mod dock;
mod float;
pub(crate) mod frames;
mod icons;
mod incoming;
mod menu;
mod model;
mod picker;
mod soundboard;
mod stage;
#[cfg(feature = "stories")]
mod stories;
#[cfg(feature = "stories")]
mod stories_w4;
mod theme;

pub use debug::{DebugActions, voice_debug_panel};
pub use dock::{PipAnchor, PipPlacement, dock_zones};
pub use float::{FloatCard, FloatEvent};
pub use frames::VideoFrames;
pub use incoming::{
    DmCallActions, DmCallState, IncomingActions, IncomingProps, dm_call_controls,
    incoming_call_banner, incoming_subtitle,
};
pub use menu::{ParticipantMenu, ParticipantMenuEvent, ParticipantMenuModel, toggled_volume};
pub use model::{
    NoController, PttState, QualityLevel, ShareLook, TileDemand, VoiceController, VoiceStageModel,
    bar_subtitle, build_tiles, camera_label, grid_columns, mic_blocked_reason, screen_label,
};
pub use picker::{
    PickerActions, PickerModel, PickerSource, PickerState, THUMBNAIL_PX, source_picker,
    thumbnail_image,
};
pub use soundboard::{SoundboardActions, SoundboardBar, soundboard_popover};
pub use stage::{VoiceBadge, VoiceBadgeKind, VoiceStage, voice_badges};

/// The call's bar on its own, for the shell to show under the columns away from the call.
pub fn voice_bar_element(
    model: &VoiceStageModel,
    narrow: bool,
    controller: std::sync::Arc<dyn VoiceController>,
) -> gpui_kit::AnyElement {
    voice_bar_element_with(model, &SoundboardBar::default(), narrow, controller)
}

/// W4: the bar with the soundboard's button (channel calls) and its popover.
pub fn voice_bar_element_with(
    model: &VoiceStageModel,
    soundboard: &SoundboardBar,
    narrow: bool,
    controller: std::sync::Arc<dyn VoiceController>,
) -> gpui_kit::AnyElement {
    use gpui_kit::IntoElement as _;
    bar::VoiceBar {
        model: model.clone(),
        soundboard: soundboard.clone(),
        narrow,
        controller,
    }
    .into_any_element()
}

use gpui_kit::{Window, WindowOptions};

/// How a tile gets its pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoPath {
    /// NV12 textures written in place, through `VideoUploader` and `paint_video_surface`.
    Surface,
    /// RGBA `RenderImage`s: where there's no surface path, after one has failed, or when
    /// `SEMAPHORE_VIDEO_PATH=rgba` asks for it. This costs far more CPU (70-111% of a core on Linux for
    /// the T1 load).
    RgbaFallback,
}

/// The compile-time switch: a platform goes here once its renderer has a surface path. A renderer can
/// have an uploader and still draw nothing, so asking at run time alone isn't enough.
///
/// Windows' D3D11 path has never run on a real GPU. A surface that fails to write or draw flips
/// `VideoUploader::failed`, and `VideoFrames` moves to RGBA. Wrong colours or a black tile can't be
/// detected, and that's what `SEMAPHORE_VIDEO_PATH=rgba` is for.
const SURFACE_PATH_BUILT: bool = cfg!(any(target_os = "linux", target_os = "windows"));

/// Names the fallback, as a way out when the surface path draws wrongly with no error to notice.
const VIDEO_PATH_ENV: &str = "SEMAPHORE_VIDEO_PATH";

fn choose_video_path(built: bool, has_uploader: bool, asked_for: Option<&str>) -> VideoPath {
    if built && has_uploader && asked_for != Some("rgba") {
        VideoPath::Surface
    } else {
        VideoPath::RgbaFallback
    }
}

pub fn video_path(window: &Window) -> VideoPath {
    choose_video_path(
        SURFACE_PATH_BUILT,
        window.video_uploader().is_some(),
        std::env::var(VIDEO_PATH_ENV).ok().as_deref(),
    )
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
pub fn stories() -> Vec<crate::stories::Story> {
    let mut all = stories::stories();
    all.extend(stories_w4::stories());
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn the_surface_path_needs_a_build_an_uploader_and_no_one_asking_otherwise() {
        assert_eq!(choose_video_path(true, true, None), VideoPath::Surface);
        assert_eq!(
            choose_video_path(true, true, Some("anything")),
            VideoPath::Surface
        );
        for (built, has_uploader, asked_for) in [
            (false, true, None),
            (true, false, None),
            (true, true, Some("rgba")),
        ] {
            assert_eq!(
                choose_video_path(built, has_uploader, asked_for),
                VideoPath::RgbaFallback
            );
        }
    }

    #[test]
    fn windows_and_linux_build_the_surface_path() {
        assert_eq!(
            SURFACE_PATH_BUILT,
            cfg!(any(target_os = "linux", target_os = "windows"))
        );
    }

    #[test]
    fn video_windows_are_never_throttled_for_being_inactive() {
        let options = video_window_options(WindowOptions::default());
        assert_eq!(options.inactive_frame_interval, None);
    }
}
