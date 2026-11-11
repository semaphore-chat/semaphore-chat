//! The desktop's cameras and screens, through libwebrtc (our patched `libwebrtc`; see
//! `third_party/PATCHES.md`).
//!
//! - **Screens and windows:** the portal and PipeWire on Wayland (the portal's own picker), X11's
//!   capturers, Windows.Graphics.Capture with DXGI behind it. One thread per share paces
//!   `capture_frame` at the share's frame rate; PipeWire also gets the rate from
//!   `set_max_frame_rate`, so frames above it are never copied.
//! - **Cameras:** libwebrtc's capture module: PipeWire over our own connection to the daemon, else
//!   V4L2, on Linux; DirectShow on Windows.

use super::local::{Capturing, OnEnded, OnFrame, SourceFrame, VideoCaptureSource, VideoSources};
use livekit::webrtc::desktop_capturer::{
    CaptureError, CaptureSource as LkSource, DesktopCaptureSourceType, DesktopCapturer,
    DesktopCapturerOptions,
};
use livekit::webrtc::native::camera_capturer::{
    CameraBackend, CameraCapability, CameraCapturer, CameraFormat,
};
use livekit::webrtc::video_frame::VideoBuffer as _;
use semaphore_core::model::ScreenShareRequest;
use semaphore_core::platform::{
    CaptureKind, CaptureSource, CoreError, PickerKind, ScreenCapture, Thumbnail,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

/// How long the camera backend may take to list its devices.
const CAMERA_INIT_TIMEOUT: Duration = Duration::from_secs(5);

/// Whether screens come from the xdg portal: libwebrtc's own test.
pub fn uses_portal() -> bool {
    cfg!(target_os = "linux")
        && std::env::var("XDG_SESSION_TYPE").is_ok_and(|session| session == "wayland")
}

#[derive(Default)]
pub struct PlatformVideoSources;

impl VideoSources for PlatformVideoSources {
    fn camera(&self, device: Option<&str>) -> Result<Box<dyn VideoCaptureSource>, String> {
        Ok(Box::new(CameraSource {
            device: device.map(str::to_owned),
        }))
    }

    fn screen(&self, request: &ScreenShareRequest) -> Result<Box<dyn VideoCaptureSource>, String> {
        let kind = if uses_portal() {
            ScreenKind::Portal
        } else {
            let id = request
                .source_id
                .as_deref()
                .ok_or("choose a screen or window to share")?;
            parse_source_id(id).ok_or_else(|| format!("not a screen or window: {id}"))?
        };
        Ok(Box::new(ScreenSource {
            kind,
            fps: request.fps.max(1),
        }))
    }

    fn cameras(&self) -> Vec<(String, String)> {
        open_cameras()
            .map(|capturer| {
                capturer
                    .devices()
                    .into_iter()
                    .map(|device| (device.unique_id, device.name))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScreenKind {
    Portal,
    Screen(u64),
    Window(u64),
}

fn parse_source_id(id: &str) -> Option<ScreenKind> {
    let (kind, number) = id.split_once(':')?;
    let number = number.parse().ok()?;
    match kind {
        "screen" => Some(ScreenKind::Screen(number)),
        "window" => Some(ScreenKind::Window(number)),
        _ => None,
    }
}

fn source_id(kind: CaptureKind, source: &LkSource) -> String {
    match kind {
        CaptureKind::Screen => format!("screen:{}", source.id()),
        CaptureKind::Window => format!("window:{}", source.id()),
    }
}

fn capturer(kind: DesktopCaptureSourceType, allow_wgc: bool) -> Option<DesktopCapturer> {
    let mut options = DesktopCapturerOptions::new(kind);
    // The browser's getDisplayMedia default: the pointer is in the picture.
    options.set_include_cursor(true);
    options.set_allow_wgc(allow_wgc);
    DesktopCapturer::new(options)
}

struct ScreenSource {
    kind: ScreenKind,
    fps: u32,
}

impl VideoCaptureSource for ScreenSource {
    fn start(self: Box<Self>, on_frame: OnFrame, on_ended: OnEnded) -> Result<Capturing, String> {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let thread = std::thread::Builder::new()
            .name("semaphore-screen".into())
            .spawn(move || run_screen(*self, on_frame, on_ended, &ready_tx, stop_rx))
            .map_err(|error| error.to_string())?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Capturing::new(ScreenThread {
                stop: Some(stop_tx),
                thread: Some(thread),
            })),
            Ok(Err(error)) => Err(error),
            Err(_) => Err("the screen capture thread died".into()),
        }
    }
}

struct ScreenThread {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for ScreenThread {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run_screen(
    source: ScreenSource,
    on_frame: OnFrame,
    on_ended: OnEnded,
    ready: &mpsc::Sender<Result<(), String>>,
    stop: mpsc::Receiver<()>,
) {
    let (kind, wanted) = match source.kind {
        // The portal's generic capturer; only Linux has one, and only Wayland gets here.
        #[cfg(target_os = "linux")]
        ScreenKind::Portal => (DesktopCaptureSourceType::Generic, None),
        #[cfg(not(target_os = "linux"))]
        ScreenKind::Portal => (DesktopCaptureSourceType::Screen, None),
        ScreenKind::Screen(id) => (DesktopCaptureSourceType::Screen, Some(id)),
        ScreenKind::Window(id) => (DesktopCaptureSourceType::Window, Some(id)),
    };
    let Some(mut capturer) = capturer(kind, true) else {
        let _ = ready.send(Err("screen capture isn't available here".into()));
        return;
    };
    let selected = match wanted {
        None => None,
        Some(id) => match capturer
            .get_source_list()
            .into_iter()
            .find(|s| s.id() == id)
        {
            Some(found) => Some(found),
            None => {
                let _ = ready.send(Err("that screen or window is gone".into()));
                return;
            }
        },
    };
    let ended = Arc::new(AtomicBool::new(false));
    let on_frame = Arc::new(Mutex::new(on_frame));
    let callback_ended = ended.clone();
    let callback_frame = on_frame.clone();
    capturer.set_max_frame_rate(source.fps);
    capturer.start_capture(selected, move |result| match result {
        Ok(frame) => {
            let mut on_frame = callback_frame.lock().unwrap_or_else(|p| p.into_inner());
            on_frame(SourceFrame::Bgra {
                width: frame.width().max(0) as u32,
                height: frame.height().max(0) as u32,
                stride: frame.stride(),
                data: frame.data(),
            });
        }
        // Nothing new yet, or a portal still waiting for the user.
        Err(CaptureError::Temporary) => {}
        Err(CaptureError::Permanent) => callback_ended.store(true, Ordering::Relaxed),
    });
    let _ = ready.send(Ok(()));
    // The pacer: one `capture_frame` per tick. It waits on the stop channel, so a stop is
    // immediate; the timeout is the next frame's due time.
    let period = Duration::from_secs_f64(1.0 / source.fps as f64);
    let mut due = Instant::now();
    loop {
        capturer.capture_frame();
        if ended.load(Ordering::Relaxed) {
            on_ended("the shared screen or window went away, or its picker was closed".into());
            return;
        }
        due += period;
        let now = Instant::now();
        if due < now {
            // Behind: skip the ticks that are already gone rather than burst to catch up.
            due = now;
        }
        match stop.recv_timeout(due - now) {
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Lists screens and windows for our own picker (X11, Windows). The portal on Wayland picks for us.
#[derive(Default)]
pub struct DesktopScreenCapture;

impl ScreenCapture for DesktopScreenCapture {
    fn picker(&self) -> PickerKind {
        if uses_portal() {
            PickerKind::System
        } else {
            PickerKind::Listed
        }
    }

    fn sources(&self, thumbnail_px: u32) -> Result<Vec<CaptureSource>, CoreError> {
        if uses_portal() {
            return Ok(Vec::new());
        }
        let mut sources = Vec::new();
        for (kind, lk_kind) in [
            (CaptureKind::Screen, DesktopCaptureSourceType::Screen),
            (CaptureKind::Window, DesktopCaptureSourceType::Window),
        ] {
            let Some(capturer) = capturer(lk_kind, false) else {
                continue;
            };
            for source in capturer.get_source_list() {
                let thumbnail = (thumbnail_px > 0)
                    .then(|| thumbnail(lk_kind, &source, thumbnail_px))
                    .flatten();
                sources.push(CaptureSource {
                    id: source_id(kind, &source),
                    name: source.title(),
                    kind,
                    thumbnail,
                });
            }
        }
        Ok(sources)
    }
}

/// One frame of `source`, shrunk to fit `max_px` on its long side. Without WGC, so Windows draws
/// no capture border for it.
fn thumbnail(kind: DesktopCaptureSourceType, source: &LkSource, max_px: u32) -> Option<Thumbnail> {
    let mut capturer = capturer(kind, false)?;
    let shot = Arc::new(Mutex::new(None));
    let into = shot.clone();
    capturer.start_capture(Some(source.clone()), move |result| {
        if let Ok(frame) = result {
            *into.lock().unwrap_or_else(|p| p.into_inner()) = Some(shrink(
                frame.width().max(0) as u32,
                frame.height().max(0) as u32,
                frame.stride() as usize,
                frame.data(),
                max_px,
            ));
        }
    });
    capturer.capture_frame();
    shot.lock().unwrap_or_else(|p| p.into_inner()).take()
}

/// Nearest-neighbour: plenty for a 320 px picker tile.
fn shrink(width: u32, height: u32, stride: usize, bgra: &[u8], max_px: u32) -> Thumbnail {
    let scale = (max_px as f64 / width.max(height).max(1) as f64).min(1.0);
    let (out_w, out_h) = (
        ((width as f64 * scale) as u32).max(1),
        ((height as f64 * scale) as u32).max(1),
    );
    let mut out = Vec::with_capacity((out_w * out_h * 4) as usize);
    for y in 0..out_h {
        let src_y = (y as u64 * height as u64 / out_h as u64) as usize;
        for x in 0..out_w {
            let src_x = (x as u64 * width as u64 / out_w as u64) as usize;
            let at = src_y * stride + src_x * 4;
            out.extend_from_slice(bgra.get(at..at + 4).unwrap_or(&[0, 0, 0, 255]));
        }
    }
    Thumbnail {
        width: out_w,
        height: out_h,
        bgra: out,
    }
}

/// The platform's camera backend: PipeWire first on Linux, then V4L2.
fn open_cameras() -> Result<CameraCapturer, String> {
    #[cfg(target_os = "linux")]
    {
        if let Some(fd) = pipewire_connection() {
            match CameraCapturer::new(
                CameraBackend::PipeWire { fd: Some(fd) },
                CAMERA_INIT_TIMEOUT,
            ) {
                Ok(capturer) if !capturer.devices().is_empty() => return Ok(capturer),
                Ok(_) => log::info!("PipeWire lists no camera; trying V4L2"),
                Err(error) => log::info!("PipeWire cameras: {error}; trying V4L2"),
            }
        }
        CameraCapturer::new(CameraBackend::V4l2, CAMERA_INIT_TIMEOUT).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        CameraCapturer::new(CameraBackend::DirectShow, CAMERA_INIT_TIMEOUT)
            .map_err(|e| e.to_string())
    }
}

/// Our own connection to the PipeWire daemon, as an unsandboxed app has. A sandbox would ask the
/// camera portal instead (`fd: None`); not done yet.
#[cfg(target_os = "linux")]
fn pipewire_connection() -> Option<std::os::fd::OwnedFd> {
    let socket = std::env::var_os("PIPEWIRE_REMOTE")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("XDG_RUNTIME_DIR")
                .map(|dir| std::path::Path::new(&dir).join("pipewire-0"))
        })?;
    std::os::unix::net::UnixStream::connect(socket)
        .ok()
        .map(Into::into)
}

/// The mode a camera is opened in: the one closest to 1280x720 at 30 fps, as the web asks for.
/// Raw formats win a tie over MJPEG, which costs a decode.
pub(crate) fn camera_mode(modes: &[CameraCapability]) -> Option<CameraCapability> {
    modes.iter().copied().min_by_key(|mode| {
        let size = (mode.width as i64 - 1280).abs() + (mode.height as i64 - 720).abs();
        let fps = (mode.max_fps as i64 - 30).abs() * 20;
        let decode = i64::from(mode.format == CameraFormat::Mjpeg);
        (size + fps, decode)
    })
}

struct CameraSource {
    device: Option<String>,
}

impl VideoCaptureSource for CameraSource {
    fn start(self: Box<Self>, on_frame: OnFrame, _on_ended: OnEnded) -> Result<Capturing, String> {
        let capturer = open_cameras()?;
        let devices = capturer.devices();
        let device = match &self.device {
            Some(id) => devices.iter().find(|device| &device.unique_id == id),
            None => devices.first(),
        }
        .ok_or("no camera")?;
        let mode = camera_mode(&device.capabilities).ok_or("the camera lists no modes")?;
        let on_frame = Mutex::new(on_frame);
        let started = capturer.start(&device.unique_id, mode, move |frame| {
            let converted;
            let i420 = match frame.buffer.as_i420() {
                Some(buffer) => buffer,
                None => {
                    converted = frame.buffer.to_i420();
                    &converted
                }
            };
            let (y, u, v) = i420.data();
            let (stride_y, stride_u, stride_v) = i420.strides();
            let mut on_frame = on_frame.lock().unwrap_or_else(|p| p.into_inner());
            on_frame(SourceFrame::I420 {
                width: i420.width(),
                height: i420.height(),
                y,
                stride_y,
                u,
                stride_u,
                v,
                stride_v,
            });
        });
        if !started {
            return Err(format!("{} wouldn't start", device.name));
        }
        // Unplugging isn't reported by the module: the frames just stop.
        Ok(Capturing::new(CameraRunning(capturer)))
    }
}

struct CameraRunning(CameraCapturer);

impl Drop for CameraRunning {
    fn drop(&mut self) {
        self.0.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode(width: u32, height: u32, max_fps: u32, format: CameraFormat) -> CameraCapability {
        CameraCapability {
            width,
            height,
            max_fps,
            format,
            interlaced: false,
        }
    }

    #[test]
    fn the_camera_opens_closest_to_720p30_and_prefers_raw() {
        let modes = [
            mode(640, 480, 30, CameraFormat::Yuy2),
            mode(1280, 720, 10, CameraFormat::Yuy2),
            mode(1280, 720, 30, CameraFormat::Mjpeg),
            mode(1920, 1080, 30, CameraFormat::Mjpeg),
        ];
        assert_eq!(camera_mode(&modes), Some(modes[2]));
        let raw = [
            mode(1280, 720, 30, CameraFormat::Mjpeg),
            mode(1280, 720, 30, CameraFormat::Nv12),
        ];
        assert_eq!(camera_mode(&raw), Some(raw[1]));
        assert_eq!(camera_mode(&[]), None);
    }

    #[test]
    fn source_ids_round_trip() {
        assert_eq!(parse_source_id("screen:231"), Some(ScreenKind::Screen(231)));
        assert_eq!(parse_source_id("window:7"), Some(ScreenKind::Window(7)));
        assert_eq!(parse_source_id("tab:7"), None);
        assert_eq!(parse_source_id("screen:x"), None);
    }

    #[test]
    fn a_thumbnail_keeps_the_shape_and_fits() {
        let bgra = [10u8, 20, 30, 255].repeat(1920 * 1080);
        let thumb = shrink(1920, 1080, 1920 * 4, &bgra, 320);
        assert_eq!((thumb.width, thumb.height), (320, 180));
        assert_eq!(thumb.bgra.len(), 320 * 180 * 4);
        assert_eq!(&thumb.bgra[..4], &[10, 20, 30, 255]);
    }
}
