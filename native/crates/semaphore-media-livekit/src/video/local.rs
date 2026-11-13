//! Sending video: a capture source's frames, scaled to what is sent, into a `NativeVideoSource`,
//! with a small copy for our own preview tile.
//!
//! A source is anything that hands over frames on its own thread: libwebrtc's screen capturers and
//! camera module (`video::platform`), or `testing::FakeVideoSource`. No LiveKit type appears in
//! the source API, so a test or a rig can bring its own.

use crate::{VideoFrameRef, VideoSink};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::video_frame::{I420Buffer, VideoBuffer as _, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::VideoResolution;
use livekit::webrtc::video_source::native::NativeVideoSource;
use semaphore_core::model::ScreenShareRequest;
use std::any::Any;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// One frame from a source, borrowed for the length of the call.
pub enum SourceFrame<'a> {
    /// B, G, R, A bytes (libyuv's "ARGB"), rows `stride` bytes apart: what screens give.
    Bgra {
        width: u32,
        height: u32,
        stride: u32,
        data: &'a [u8],
    },
    /// Planar 4:2:0: what cameras give once libwebrtc has converted them.
    I420 {
        width: u32,
        height: u32,
        y: &'a [u8],
        stride_y: u32,
        u: &'a [u8],
        stride_u: u32,
        v: &'a [u8],
        stride_v: u32,
    },
}

impl SourceFrame<'_> {
    pub fn size(&self) -> (u32, u32) {
        match self {
            Self::Bgra { width, height, .. } | Self::I420 { width, height, .. } => {
                (*width, *height)
            }
        }
    }
}

/// Called on the source's thread for every frame.
pub type OnFrame = Box<dyn FnMut(SourceFrame<'_>) + Send>;
/// The source stopped on its own (a window closed, a camera unplugged), and why.
pub type OnEnded = Box<dyn FnOnce(String) + Send>;

/// A running capture. Dropping it stops the source.
pub struct Capturing {
    _keep: Box<dyn Any + Send>,
}

impl Capturing {
    pub fn new(keep: impl Any + Send) -> Self {
        Self {
            _keep: Box::new(keep),
        }
    }
}

pub trait VideoCaptureSource: Send {
    /// Starts it. Frames may take a while to come: a system picker is open until the user picks.
    fn start(self: Box<Self>, on_frame: OnFrame, on_ended: OnEnded) -> Result<Capturing, String>;
}

/// Where the engine gets its cameras and screens.
pub trait VideoSources: Send + Sync {
    /// The camera with this unique id, or the first one.
    fn camera(&self, device: Option<&str>) -> Result<Box<dyn VideoCaptureSource>, String>;
    fn screen(&self, request: &ScreenShareRequest) -> Result<Box<dyn VideoCaptureSource>, String>;
    /// Cameras for a settings list: unique id and name.
    fn cameras(&self) -> Vec<(String, String)> {
        Vec::new()
    }
}

/// None: every start fails, saying so.
pub struct NoVideoSources;

impl VideoSources for NoVideoSources {
    fn camera(&self, _device: Option<&str>) -> Result<Box<dyn VideoCaptureSource>, String> {
        Err("no camera support in this build".into())
    }
    fn screen(&self, _request: &ScreenShareRequest) -> Result<Box<dyn VideoCaptureSource>, String> {
        Err("no screen capture in this build".into())
    }
}

/// Our preview tile never needs more than this: it's small, and it's our own picture.
const PREVIEW_MAX_WIDTH: u32 = 640;
const PREVIEW_INTERVAL: Duration = Duration::from_millis(1000 / 15);

/// The small NV12 picture our own tile draws, at most 15 a second. Shared by a published camera
/// or screen (under the publication's sid) and the settings page's camera test (under
/// `CAMERA_TEST_TRACK_SID`), so both reach a tile the same way.
pub(crate) struct PreviewFrame {
    last: Option<Instant>,
    y: Vec<u8>,
    uv: Vec<u8>,
}

impl PreviewFrame {
    pub(crate) fn new() -> Self {
        Self {
            last: None,
            y: Vec::new(),
            uv: Vec::new(),
        }
    }

    /// Whether a frame now would be sent rather than dropped: a caller that converts its frames
    /// first (the camera test) skips the work for frames `send` would drop.
    pub(crate) fn due(&self) -> bool {
        self.last
            .is_none_or(|last| Instant::now() - last >= PREVIEW_INTERVAL)
    }

    /// Sends `buffer` to `sink` as `sid`, scaled and converted to NV12. False when the frame came
    /// too soon after the last one and was dropped.
    pub(crate) fn send(&mut self, sink: &dyn VideoSink, sid: &str, buffer: &I420Buffer) -> bool {
        let now = Instant::now();
        if self.last.is_some_and(|last| now - last < PREVIEW_INTERVAL) {
            return false;
        }
        self.last = Some(now);
        let (width, height) = preview_size(buffer.width(), buffer.height());
        let mut scaled;
        let small = if (width, height) == (buffer.width(), buffer.height()) {
            buffer
        } else {
            // `scale` takes `&mut self` but leaves the source as it was.
            scaled = clone_i420(buffer);
            scaled = scaled.scale(width as i32, height as i32);
            &scaled
        };
        let (y, u, v) = small.data();
        let (stride_y, stride_u, stride_v) = small.strides();
        let uv_stride = width.div_ceil(2) * 2;
        self.y.resize((width * height) as usize, 0);
        self.uv.resize((uv_stride * height.div_ceil(2)) as usize, 0);
        yuv_helper::i420_to_nv12(
            y,
            stride_y,
            u,
            stride_u,
            v,
            stride_v,
            &mut self.y,
            width,
            &mut self.uv,
            uv_stride,
            width as i32,
            height as i32,
        );
        sink.on_frame(
            sid,
            &VideoFrameRef {
                width,
                height,
                y: &self.y,
                y_stride: width,
                uv: &self.uv,
                uv_stride,
            },
        );
        true
    }
}

/// Turns frames into what is sent, at `target` (even, never larger than the frame).
pub(crate) struct FramePipeline {
    target: (u32, u32),
    source: NativeVideoSource,
    preview: Option<Arc<dyn VideoSink>>,
    /// Our publication's sid once published: the preview goes to the sink under it.
    sid: Arc<Mutex<Option<String>>>,
    epoch: Instant,
    preview_picture: PreviewFrame,
}

impl FramePipeline {
    pub(crate) fn new(
        target: (u32, u32),
        is_screencast: bool,
        preview: Option<Arc<dyn VideoSink>>,
        sid: Arc<Mutex<Option<String>>>,
    ) -> Self {
        let source = NativeVideoSource::new(
            VideoResolution {
                width: target.0,
                height: target.1,
            },
            is_screencast,
        );
        Self {
            target,
            source,
            preview,
            sid,
            epoch: Instant::now(),
            preview_picture: PreviewFrame::new(),
        }
    }

    pub(crate) fn source(&self) -> NativeVideoSource {
        self.source.clone()
    }

    pub(crate) fn push(&mut self, frame: SourceFrame<'_>) {
        let Some(buffer) = to_i420(&frame, self.target) else {
            return;
        };
        self.preview(&buffer);
        self.source.capture_frame(&VideoFrame {
            rotation: VideoRotation::VideoRotation0,
            timestamp_us: self.epoch.elapsed().as_micros() as i64,
            frame_metadata: None,
            buffer,
        });
    }

    fn preview(&mut self, buffer: &I420Buffer) {
        let Some(sink) = &self.preview else {
            return;
        };
        let Some(sid) = self.sid.lock().unwrap_or_else(|p| p.into_inner()).clone() else {
            return;
        };
        self.preview_picture.send(sink.as_ref(), &sid, buffer);
    }
}

/// The preview's size: at most `PREVIEW_MAX_WIDTH` wide, same shape, even.
pub(crate) fn preview_size(width: u32, height: u32) -> (u32, u32) {
    if width <= PREVIEW_MAX_WIDTH {
        return (width, height);
    }
    let scaled = (height as u64 * PREVIEW_MAX_WIDTH as u64 / width as u64) as u32;
    (PREVIEW_MAX_WIDTH, (scaled / 2 * 2).max(2))
}

fn clone_i420(buffer: &I420Buffer) -> I420Buffer {
    let (width, height) = (buffer.width(), buffer.height());
    let (y, u, v) = buffer.data();
    let (stride_y, stride_u, stride_v) = buffer.strides();
    let mut copy = I420Buffer::new(width, height);
    copy_planes(
        &mut copy,
        (y, stride_y),
        (u, stride_u),
        (v, stride_v),
        width,
        height,
    );
    copy
}

fn copy_planes(
    dst: &mut I420Buffer,
    y: (&[u8], u32),
    u: (&[u8], u32),
    v: (&[u8], u32),
    width: u32,
    height: u32,
) {
    let (dst_stride_y, dst_stride_u, dst_stride_v) = dst.strides();
    let (dst_y, dst_u, dst_v) = dst.data_mut();
    let (chroma_w, chroma_h) = (width.div_ceil(2), height.div_ceil(2));
    copy_plane(dst_y, dst_stride_y, y.0, y.1, width, height);
    copy_plane(dst_u, dst_stride_u, u.0, u.1, chroma_w, chroma_h);
    copy_plane(dst_v, dst_stride_v, v.0, v.1, chroma_w, chroma_h);
}

fn copy_plane(dst: &mut [u8], dst_stride: u32, src: &[u8], src_stride: u32, w: u32, h: u32) {
    for row in 0..h as usize {
        let from = row * src_stride as usize;
        let to = row * dst_stride as usize;
        dst[to..to + w as usize].copy_from_slice(&src[from..from + w as usize]);
    }
}

/// The frame as I420 at `target`. `None` for a frame too small to hold its own size (a source
/// bug), which is dropped rather than crashing the capture thread.
pub(crate) fn to_i420(frame: &SourceFrame<'_>, target: (u32, u32)) -> Option<I420Buffer> {
    let (width, height) = frame.size();
    if width < 2 || height < 2 {
        return None;
    }
    let mut full = I420Buffer::new(width, height);
    match *frame {
        SourceFrame::Bgra {
            stride, data: bgra, ..
        } => {
            if stride < width * 4 || bgra.len() < (stride * (height - 1) + width * 4) as usize {
                return None;
            }
            let (stride_y, stride_u, stride_v) = full.strides();
            let (y, u, v) = full.data_mut();
            yuv_helper::argb_to_i420(
                bgra,
                stride,
                y,
                stride_y,
                u,
                stride_u,
                v,
                stride_v,
                width as i32,
                height as i32,
            );
        }
        SourceFrame::I420 {
            y,
            stride_y,
            u,
            stride_u,
            v,
            stride_v,
            ..
        } => {
            let (chroma_w, chroma_h) = (width.div_ceil(2), height.div_ceil(2));
            let fits = |plane: &[u8], stride: u32, w: u32, h: u32| {
                stride >= w && plane.len() >= (stride * (h - 1) + w) as usize
            };
            if !fits(y, stride_y, width, height)
                || !fits(u, stride_u, chroma_w, chroma_h)
                || !fits(v, stride_v, chroma_w, chroma_h)
            {
                return None;
            }
            copy_planes(
                &mut full,
                (y, stride_y),
                (u, stride_u),
                (v, stride_v),
                width,
                height,
            );
        }
    }
    if target == (width, height) || target.0 == 0 || target.1 == 0 {
        Some(full)
    } else {
        Some(full.scale(target.0 as i32, target.1 as i32))
    }
}

/// Livekit's permission sources: `true` when the room lets us publish this source.
pub(crate) fn may_publish(
    permission: Option<&livekit_protocol::ParticipantPermission>,
    source: livekit_protocol::TrackSource,
) -> bool {
    match permission {
        // Before the server has said, LiveKit's default is "everything": the join itself said
        // nothing else. A token can't grant less than this without a permission object.
        None => true,
        Some(permission) => {
            permission.can_publish
                && (permission.can_publish_sources.is_empty()
                    || permission.can_publish_sources.contains(&(source as i32)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use livekit_protocol::{ParticipantPermission, TrackSource};

    fn bgra(width: u32, height: u32, pixel: [u8; 4]) -> Vec<u8> {
        pixel.repeat((width * height) as usize)
    }

    #[test]
    fn a_white_screen_becomes_white_i420_at_its_size() {
        let data = bgra(64, 32, [255, 255, 255, 255]);
        let frame = SourceFrame::Bgra {
            width: 64,
            height: 32,
            stride: 64 * 4,
            data: &data,
        };
        let out = to_i420(&frame, (64, 32)).unwrap();
        assert_eq!((out.width(), out.height()), (64, 32));
        let (y, u, v) = out.data();
        // BT.601 limited range: white is Y 235, U and V 128.
        assert!(y.iter().all(|&value| value >= 234), "{:?}", &y[..4]);
        assert!(u.iter().chain(v).all(|&value| (127..=129).contains(&value)));
    }

    #[test]
    fn a_preview_frame_is_due_first_and_not_again_until_its_interval() {
        struct Counting(std::sync::atomic::AtomicU32);
        impl VideoSink for Counting {
            fn on_frame(&self, _: &str, _: &crate::VideoFrameRef<'_>) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            fn on_track_ended(&self, _: &str) {}
        }
        let sink = Counting(Default::default());
        let mut preview = PreviewFrame::new();
        assert!(preview.due());
        let buffer = I420Buffer::new(64, 36);
        assert!(preview.send(&sink, "sid", &buffer));
        // Right after a send, `due` says what `send` would do: drop it.
        assert!(!preview.due());
        assert!(!preview.send(&sink, "sid", &buffer));
        assert_eq!(sink.0.load(std::sync::atomic::Ordering::Relaxed), 1);
        preview.last = Some(Instant::now() - PREVIEW_INTERVAL);
        assert!(preview.due());
    }

    #[test]
    fn a_frame_is_scaled_to_the_target() {
        let data = bgra(128, 64, [0, 0, 255, 255]);
        let frame = SourceFrame::Bgra {
            width: 128,
            height: 64,
            stride: 128 * 4,
            data: &data,
        };
        let out = to_i420(&frame, (64, 32)).unwrap();
        assert_eq!((out.width(), out.height()), (64, 32));
    }

    #[test]
    fn padded_i420_rows_are_read_by_stride() {
        let (width, height) = (8, 4);
        let y = [16u8; 16 * 4];
        let uv = [128u8; 8 * 2];
        let frame = SourceFrame::I420 {
            width,
            height,
            y: &y,
            stride_y: 16,
            u: &uv,
            stride_u: 8,
            v: &uv,
            stride_v: 8,
        };
        let out = to_i420(&frame, (width, height)).unwrap();
        assert!(out.data().0.iter().all(|&value| value == 16));
    }

    #[test]
    fn a_short_buffer_is_dropped_not_read_past() {
        let data = vec![0u8; 10];
        let frame = SourceFrame::Bgra {
            width: 64,
            height: 32,
            stride: 256,
            data: &data,
        };
        assert!(to_i420(&frame, (64, 32)).is_none());
    }

    #[test]
    fn the_preview_is_at_most_640_wide_and_keeps_its_shape() {
        assert_eq!(preview_size(1920, 1080), (640, 360));
        assert_eq!(preview_size(640, 480), (640, 480));
        assert_eq!(preview_size(3440, 1440), (640, 266));
    }

    #[test]
    fn permissions_follow_livekits_rules() {
        let grant = |can_publish, sources: &[TrackSource]| ParticipantPermission {
            can_publish,
            can_publish_sources: sources.iter().map(|s| *s as i32).collect(),
            ..Default::default()
        };
        // An empty list means every source.
        assert!(may_publish(Some(&grant(true, &[])), TrackSource::Camera));
        assert!(!may_publish(Some(&grant(false, &[])), TrackSource::Camera));
        let mic_only = grant(true, &[TrackSource::Microphone]);
        assert!(!may_publish(Some(&mic_only), TrackSource::Camera));
        assert!(!may_publish(Some(&mic_only), TrackSource::ScreenShare));
        let share = grant(
            true,
            &[TrackSource::ScreenShare, TrackSource::ScreenShareAudio],
        );
        assert!(may_publish(Some(&share), TrackSource::ScreenShare));
        assert!(!may_publish(Some(&share), TrackSource::Camera));
    }
}
