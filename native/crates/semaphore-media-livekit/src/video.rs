//! Receiving video: which simulcast layer a tile asks for, and getting decoded frames to the sink.

use crate::{VideoFrameRef, VideoSink};
use futures_util::StreamExt;
use livekit::track::{RemoteVideoTrack, VideoQuality};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::video_stream::native::{NativeVideoStream, NativeVideoStreamOptions};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

pub use semaphore_core::model::VideoDemand;

/// The smallest layer that still covers the tile. A layer may be upscaled by up to 25% before we
/// take the next one up: the web's adaptive stream is similarly forgiving, and the next layer costs
/// about four times the decode.
pub fn layer_for(
    track_w: u32,
    track_h: u32,
    tile_w: u32,
    tile_h: u32,
    focused: bool,
) -> VideoQuality {
    if focused || track_w == 0 || track_h == 0 {
        return VideoQuality::High;
    }
    let width_ratio = f64::from(tile_w) / f64::from(track_w);
    let height_ratio = f64::from(tile_h) / f64::from(track_h);
    let needed = width_ratio.max(height_ratio) / 1.25;
    if needed <= 0.25 {
        VideoQuality::Low
    } else if needed <= 0.5 {
        VideoQuality::Medium
    } else {
        VideoQuality::High
    }
}

#[derive(Debug, Default)]
pub struct TrackCounters {
    pub frames: AtomicU64,
    pub width: AtomicU32,
    pub height: AtomicU32,
}

/// What the rigs read to prove a layer change really reached the decoder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackVideoStats {
    pub track_sid: String,
    pub identity: String,
    pub is_screen_share: bool,
    pub frames: u64,
    pub width: u32,
    pub height: u32,
}

/// Runs until the track ends. I420 to NV12 happens here, off the UI thread, into a buffer reused
/// frame to frame, so the sink only has to copy the planes into its textures.
pub(crate) async fn pump_frames(
    track: RemoteVideoTrack,
    track_sid: String,
    sink: Option<Arc<dyn VideoSink>>,
    counters: Arc<TrackCounters>,
) {
    let mut stream = NativeVideoStream::with_options(
        track.rtc_track(),
        NativeVideoStreamOptions {
            // A late frame is worthless. One queued is what the SDK defaults to.
            queue_size_frames: Some(1),
        },
    );
    let mut y = Vec::new();
    let mut uv = Vec::new();
    while let Some(frame) = stream.next().await {
        let (width, height) = (frame.buffer.width(), frame.buffer.height());
        let converted;
        let i420 = match frame.buffer.as_i420() {
            Some(buffer) => buffer,
            None => {
                converted = frame.buffer.to_i420();
                &converted
            }
        };
        let (src_y, src_u, src_v) = i420.data();
        let (stride_y, stride_u, stride_v) = i420.strides();
        let uv_stride = width.div_ceil(2) * 2;
        let y_size = (width * height) as usize;
        let uv_size = (uv_stride * height.div_ceil(2)) as usize;
        y.resize(y_size, 0);
        uv.resize(uv_size, 0);
        yuv_helper::i420_to_nv12(
            src_y,
            stride_y,
            src_u,
            stride_u,
            src_v,
            stride_v,
            &mut y,
            width,
            &mut uv,
            uv_stride,
            width as i32,
            height as i32,
        );
        counters.frames.fetch_add(1, Ordering::Relaxed);
        counters.width.store(width, Ordering::Relaxed);
        counters.height.store(height, Ordering::Relaxed);
        if let Some(sink) = &sink {
            sink.on_frame(
                &track_sid,
                &VideoFrameRef {
                    width,
                    height,
                    y: &y,
                    y_stride: width,
                    uv: &uv,
                    uv_stride,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thumbnail_takes_the_low_layer() {
        assert!(matches!(
            layer_for(1280, 720, 200, 150, false),
            VideoQuality::Low
        ));
        assert!(matches!(
            layer_for(1280, 720, 400, 225, false),
            VideoQuality::Low
        ));
    }

    #[test]
    fn a_grid_tile_takes_the_layer_that_covers_it() {
        assert!(matches!(
            layer_for(1280, 720, 640, 360, false),
            VideoQuality::Medium
        ));
        assert!(matches!(
            layer_for(1280, 720, 1200, 675, false),
            VideoQuality::High
        ));
    }

    #[test]
    fn a_focused_tile_always_takes_the_top_layer() {
        assert!(matches!(
            layer_for(1920, 1080, 300, 200, true),
            VideoQuality::High
        ));
    }

    #[test]
    fn an_unknown_track_size_asks_for_the_top_layer() {
        assert!(matches!(
            layer_for(0, 0, 300, 200, false),
            VideoQuality::High
        ));
    }

    #[test]
    fn a_tall_tile_is_judged_by_its_height() {
        assert!(matches!(
            layer_for(1280, 720, 200, 600, false),
            VideoQuality::High
        ));
    }
}
