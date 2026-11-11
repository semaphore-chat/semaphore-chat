//! What our camera and screen share publish: the web client's numbers, ported from
//! `frontend/src/utils/screenShareQuality.ts` and `voiceActions.ts` (`toggleCameraUnified`), with
//! the vectors of `screenShareQuality.test.ts`. Pure: nothing here touches a room.
//!
//! - **Screen share:** VP8 with rid simulcast. The top layer is the capture size at the chosen
//!   frame rate with a bitrate sized for both; the lower layers stay cheap, so a weak viewer gets a
//!   lower layer rather than a stall (the SFU forwards, it doesn't transcode).
//! - **Camera:** 1280x720 at 30 fps, VP8 simulcast, with livekit-client's 720p encodings (1.7 Mbps
//!   on top, 180p and 360p below).
//!
//! **Not carried over:** the web gives the screen share's top encoding `priority: 'high'`, so it
//! wins over camera video on a congested uplink. The Rust SDK's `VideoEncoding` has no priority
//! field (`RtpEncodingParameters` has one, but `TrackPublishOptions` never sets it), so here the
//! two compete evenly.

use livekit::options::{
    DegradationPreference, TrackPublishOptions, VideoCodec, VideoEncoding, VideoPreset,
};
use livekit::track::TrackSource;

/// Frame rates a screen share can be captured at.
pub const SCREEN_SHARE_FPS_OPTIONS: [u32; 3] = [15, 30, 60];
const DEFAULT_FPS: u32 = 30;
/// Floor for any layer: below this VP8 falls apart at any resolution.
const MIN_LAYER_BITRATE: u64 = 150_000;
/// Ceiling for the top layer (an 8K60 "native" capture would compute more).
const MAX_TOP_BITRATE: u64 = 50_000_000;

/// What the camera is opened at, as the web asks `getUserMedia` for.
pub const CAMERA_CAPTURE_WIDTH: u32 = 1280;
pub const CAMERA_CAPTURE_HEIGHT: u32 = 720;
pub const CAMERA_CAPTURE_FPS: u32 = 30;

/// The screen share's resolution setting: the box the capture is scaled to fit, or the source's
/// own size. The web's `ResolutionPreset`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ShareResolution {
    Native,
    P2160,
    P1440,
    #[default]
    P1080,
    P720,
    P480,
}

impl ShareResolution {
    /// The bounding box, or `None` for the source's size.
    pub fn bounds(self) -> Option<(u32, u32)> {
        match self {
            Self::Native => None,
            Self::P2160 => Some((3840, 2160)),
            Self::P1440 => Some((2560, 1440)),
            Self::P1080 => Some((1920, 1080)),
            Self::P720 => Some((1280, 720)),
            Self::P480 => Some((854, 480)),
        }
    }
}

/// The size to send a `width` x `height` source at: scaled down to fit `resolution`'s box with its
/// aspect ratio kept, never up, and even, as I420 needs. A browser does the same with the web's
/// ideal width and height.
pub fn fit_capture(width: u32, height: u32, resolution: ShareResolution) -> (u32, u32) {
    let (width, height) = (width.max(2), height.max(2));
    let scale = match resolution.bounds() {
        Some((box_w, box_h)) => (box_w as f64 / width as f64)
            .min(box_h as f64 / height as f64)
            .min(1.0),
        None => 1.0,
    };
    (
        even((width as f64 * scale).round()),
        even((height as f64 * scale).round()),
    )
}

/// Bitrate for a VP8 stream of `width` x `height` at `fps`: 7.65 x (pixels per second)^0.75,
/// rounded to 100 kbps, between 150 kbps and 50 Mbps. 1080p30 is about 5.4 Mbps, 1080p60 9 Mbps,
/// 1440p60 13.9 Mbps, 4K60 25.5 Mbps. These are ceilings: the encoder uses less on static content
/// and the congestion controller lowers them on a weak uplink.
pub fn screen_share_bitrate(width: u32, height: u32, fps: u32) -> u64 {
    let pixels_per_second = width.max(1) as f64 * height.max(1) as f64 * fps.max(1) as f64;
    let raw = 7.65 * pixels_per_second.powf(0.75);
    let rounded = (raw / 100_000.0).round() as u64 * 100_000;
    rounded.clamp(MIN_LAYER_BITRATE, MAX_TOP_BITRATE)
}

/// A stored or picked frame rate, with 0 (unset) meaning the default, 30.
pub fn normalize_fps(fps: u32) -> u32 {
    if fps == 0 { DEFAULT_FPS } else { fps }
}

fn even(n: f64) -> u32 {
    ((n / 2.0).floor() as u32 * 2).max(2)
}

/// 30 fps and up asks for smooth motion (games, video); 15 for sharp, mostly static content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentHint {
    Motion,
    Detail,
}

pub fn content_hint(fps: u32) -> ContentHint {
    if normalize_fps(fps) >= 30 {
        ContentHint::Motion
    } else {
        ContentHint::Detail
    }
}

/// What the encoder gives up first when CPU or bandwidth runs short: motion keeps a balance of
/// frame rate and resolution, detail keeps resolution, so text stays readable.
pub fn degradation_preference(fps: u32) -> DegradationPreference {
    match content_hint(fps) {
        ContentHint::Motion => DegradationPreference::Balanced,
        ContentHint::Detail => DegradationPreference::MaintainResolution,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Layer {
    pub width: u32,
    pub height: u32,
    pub max_bitrate: u64,
    pub max_framerate: u32,
}

/// A screen share's encodings: `computeScreenSharePublishOptions`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenSharePublish {
    /// The capture size at the chosen frame rate.
    pub top: Layer,
    /// Low to high: quarter size at up to 15 fps and half size at up to 30, or only the half-size
    /// one below 960 px on the long side, so the second layer is useful rather than tiny.
    pub lower: Vec<Layer>,
    pub degradation: DegradationPreference,
}

impl ScreenSharePublish {
    /// For a capture of `width` x `height` sent at `fps`. 4K60 gives 2160p60, 1080p30 and 540p15;
    /// 1080p60 gives 1080p60, 540p30 and 270p15.
    pub fn new(width: u32, height: u32, fps: u32) -> Self {
        let top_fps = normalize_fps(fps);
        let (w, h) = (width.max(2), height.max(2));
        let layer = |divisor: u32, layer_fps: u32| {
            let lw = even(w as f64 / divisor as f64);
            let lh = even(h as f64 / divisor as f64);
            Layer {
                width: lw,
                height: lh,
                max_bitrate: screen_share_bitrate(lw, lh, layer_fps),
                max_framerate: layer_fps,
            }
        };
        let mid = layer(2, top_fps.min(30));
        let low = layer(4, top_fps.min(15));
        Self {
            top: Layer {
                width: w,
                height: h,
                max_bitrate: screen_share_bitrate(w, h, top_fps),
                max_framerate: top_fps,
            },
            lower: if w.max(h) >= 960 {
                vec![low, mid]
            } else {
                vec![mid]
            },
            degradation: degradation_preference(top_fps),
        }
    }

    pub fn track_publish_options(&self) -> TrackPublishOptions {
        TrackPublishOptions {
            source: TrackSource::Screenshare,
            video_codec: VideoCodec::VP8,
            simulcast: true,
            video_encoding: Some(VideoEncoding {
                max_bitrate: self.top.max_bitrate,
                max_framerate: self.top.max_framerate as f64,
            }),
            simulcast_layers: Some(
                self.lower
                    .iter()
                    .map(|layer| {
                        VideoPreset::new(
                            layer.width,
                            layer.height,
                            layer.max_bitrate,
                            layer.max_framerate as f64,
                        )
                    })
                    .collect(),
            ),
            degradation_preference: Some(self.degradation),
            ..Default::default()
        }
    }
}

/// The camera's. The top encoding is given, not left to the SDK: for a 1280 px wide capture the Rust
/// SDK picks the preset above (1080p, 3 Mbps), where livekit-client picks 720p's 1.7 Mbps
/// (`compute_appropriate_encoding` breaks on `preset.width > size`, livekit-client on `>=`). The
/// lower layers are the SDK's defaults, which are livekit-client's.
pub fn camera_publish_options() -> TrackPublishOptions {
    TrackPublishOptions {
        source: TrackSource::Camera,
        video_codec: VideoCodec::VP8,
        simulcast: true,
        video_encoding: Some(livekit::options::video::H720.encoding),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use livekit::options::compute_video_encodings;

    fn bitrate(w: u32, h: u32, fps: u32) -> u64 {
        screen_share_bitrate(w, h, fps)
    }

    // `computeScreenShareBitrate`, as screenShareQuality.test.ts checks it.

    #[test]
    fn bitrate_is_monotonic_in_width_height_and_fps() {
        assert!(bitrate(2560, 1080, 30) > bitrate(1280, 1080, 30));
        assert!(bitrate(1920, 1440, 30) > bitrate(1920, 720, 30));
        assert!(bitrate(1920, 1080, 60) > bitrate(1920, 1080, 30));
        assert!(bitrate(1920, 1080, 30) > bitrate(1920, 1080, 15));
    }

    #[test]
    fn bitrate_lands_in_the_target_range_for_common_captures() {
        assert!((8_000_000..=10_000_000).contains(&bitrate(1920, 1080, 60)));
        assert!((12_000_000..=15_000_000).contains(&bitrate(2560, 1440, 60)));
        assert!((20_000_000..=26_000_000).contains(&bitrate(3840, 2160, 60)));
    }

    #[test]
    fn bitrate_1080p30_is_at_least_double_the_old_default() {
        assert!(bitrate(1920, 1080, 30) >= 5_000_000);
    }

    #[test]
    fn bitrate_has_a_floor_and_a_ceiling() {
        assert_eq!(bitrate(2, 2, 1), 150_000);
        assert_eq!(bitrate(7680, 4320, 120), 50_000_000);
    }

    #[test]
    fn bitrate_is_a_multiple_of_100_kbps() {
        for (w, h, f) in [
            (1920, 1080, 60),
            (1366, 768, 30),
            (853, 480, 15),
            (2560, 1440, 60),
        ] {
            assert_eq!(bitrate(w, h, f) % 100_000, 0);
        }
    }

    /// The figures in the formula's own comment, exactly.
    #[test]
    fn bitrate_matches_the_documented_figures() {
        assert_eq!(bitrate(1920, 1080, 30), 5_400_000);
        assert_eq!(bitrate(1920, 1080, 60), 9_000_000);
        assert_eq!(bitrate(2560, 1440, 60), 13_900_000);
        assert_eq!(bitrate(3840, 2160, 60), 25_500_000);
        assert_eq!(bitrate(1280, 720, 30), 2_900_000);
        assert_eq!(bitrate(960, 540, 15), 1_100_000);
    }

    // `computeScreenSharePublishOptions`.

    #[test]
    fn builds_1080p60_options() {
        let o = ScreenSharePublish::new(1920, 1080, 60);
        assert_eq!(o.top.max_framerate, 60);
        assert_eq!(o.top.max_bitrate, bitrate(1920, 1080, 60));
        let [low, mid] = o.lower[..] else {
            panic!("two lower layers: {:?}", o.lower)
        };
        assert_eq!((mid.width, mid.height, mid.max_framerate), (960, 540, 30));
        assert_eq!((low.width, low.height, low.max_framerate), (480, 270, 15));
        assert_eq!(mid.max_bitrate, bitrate(960, 540, 30));
        assert_eq!(low.max_bitrate, bitrate(480, 270, 15));
        assert!(mid.max_bitrate < o.top.max_bitrate);
        assert!(low.max_bitrate < mid.max_bitrate);
        let options = o.track_publish_options();
        assert!(options.simulcast);
        assert!(matches!(options.video_codec, VideoCodec::VP8));
        assert_eq!(options.source, TrackSource::Screenshare);
    }

    #[test]
    fn builds_4k60_layers() {
        let o = ScreenSharePublish::new(3840, 2160, 60);
        let [low, mid] = o.lower[..] else {
            panic!("two lower layers: {:?}", o.lower)
        };
        assert_eq!((low.width, low.height, low.max_framerate), (960, 540, 15));
        assert_eq!((mid.width, mid.height, mid.max_framerate), (1920, 1080, 30));
    }

    #[test]
    fn caps_layer_fps_at_the_top_fps() {
        let o = ScreenSharePublish::new(1280, 720, 15);
        assert_eq!(o.top.max_framerate, 15);
        for layer in &o.lower {
            assert_eq!(layer.max_framerate, 15);
        }
    }

    #[test]
    fn uses_a_single_half_size_lower_layer_for_small_captures() {
        let o = ScreenSharePublish::new(800, 600, 30);
        assert_eq!(o.lower.len(), 1);
        let mid = o.lower[0];
        assert_eq!((mid.width, mid.height, mid.max_framerate), (400, 300, 30));
    }

    #[test]
    fn keeps_layer_dimensions_even() {
        let o = ScreenSharePublish::new(1366, 769, 60);
        for layer in &o.lower {
            assert_eq!(layer.width % 2, 0);
            assert_eq!(layer.height % 2, 0);
        }
    }

    #[test]
    fn picks_the_degradation_preference_from_fps() {
        let pick = |fps| ScreenSharePublish::new(1920, 1080, fps).degradation;
        assert!(matches!(pick(60), DegradationPreference::Balanced));
        assert!(matches!(pick(30), DegradationPreference::Balanced));
        assert!(matches!(
            pick(15),
            DegradationPreference::MaintainResolution
        ));
    }

    /// The TS test feeds 0, NaN and undefined; a `u32` can only be 0.
    #[test]
    fn normalizes_an_unset_fps_to_30() {
        assert_eq!(ScreenSharePublish::new(1920, 1080, 0).top.max_framerate, 30);
    }

    #[test]
    fn maps_fps_to_a_content_hint() {
        assert_eq!(content_hint(60), ContentHint::Motion);
        assert_eq!(content_hint(30), ContentHint::Motion);
        assert_eq!(content_hint(15), ContentHint::Detail);
    }

    // What the SDK builds from them: the same rid layers livekit-client builds.

    #[test]
    fn the_sdk_sends_our_three_screen_layers() {
        let o = ScreenSharePublish::new(1920, 1080, 60);
        let encodings = compute_video_encodings(1920, 1080, &o.track_publish_options());
        let got: Vec<_> = encodings
            .iter()
            .map(|e| {
                (
                    e.rid.as_str(),
                    e.max_bitrate.unwrap_or_default(),
                    e.max_framerate.unwrap_or_default(),
                    e.scale_resolution_down_by.unwrap_or_default(),
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                ("f", 9_000_000, 60.0, 1.0),
                ("h", bitrate(960, 540, 30), 30.0, 2.0),
                ("q", 400_000, 15.0, 4.0),
            ]
        );
    }

    #[test]
    fn the_sdk_sends_two_screen_layers_below_960px() {
        let o = ScreenSharePublish::new(800, 600, 30);
        let encodings = compute_video_encodings(800, 600, &o.track_publish_options());
        let got: Vec<_> = encodings
            .iter()
            .map(|e| {
                (
                    e.rid.as_str(),
                    e.max_bitrate.unwrap_or_default(),
                    e.scale_resolution_down_by.unwrap_or_default(),
                )
            })
            .collect();
        assert_eq!(got, [("h", 1_800_000, 1.0), ("q", 600_000, 2.0)]);
    }

    /// livekit-client's `VideoPresets.h720` on top, `h180` and `h360` below.
    #[test]
    fn the_camera_gets_livekit_clients_720p_encodings() {
        let options = camera_publish_options();
        let encodings =
            compute_video_encodings(CAMERA_CAPTURE_WIDTH, CAMERA_CAPTURE_HEIGHT, &options);
        let got: Vec<_> = encodings
            .iter()
            .map(|e| {
                (
                    e.max_bitrate.unwrap_or_default(),
                    e.max_framerate.unwrap_or_default(),
                    e.scale_resolution_down_by.unwrap_or_default(),
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                (1_700_000, 30.0, 1.0),
                (450_000, 20.0, 2.0),
                (160_000, 15.0, 4.0)
            ]
        );
        assert_eq!(options.source, TrackSource::Camera);
    }

    // Fitting the capture into the resolution setting.

    #[test]
    fn fits_a_capture_into_its_box_keeping_the_aspect_ratio() {
        assert_eq!(
            fit_capture(3840, 2160, ShareResolution::P1080),
            (1920, 1080)
        );
        assert_eq!(
            fit_capture(2560, 1600, ShareResolution::P1080),
            (1728, 1080)
        );
        assert_eq!(fit_capture(3440, 1440, ShareResolution::P1080), (1920, 804));
        assert_eq!(fit_capture(1920, 1080, ShareResolution::P480), (852, 480));
    }

    #[test]
    fn never_upscales_and_native_keeps_the_size_even() {
        assert_eq!(fit_capture(1280, 720, ShareResolution::P2160), (1280, 720));
        assert_eq!(fit_capture(801, 599, ShareResolution::Native), (800, 598));
        assert_eq!(fit_capture(0, 0, ShareResolution::Native), (2, 2));
    }
}
