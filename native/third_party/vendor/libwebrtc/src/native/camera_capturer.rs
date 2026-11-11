// Semaphore patch: cameras through libwebrtc's VideoCaptureModule. PipeWire or V4L2 on Linux,
// DirectShow on Windows. Licensed under the Apache License, Version 2.0, like this crate.

//! Cameras, as libwebrtc's own capture module sees them.
//!
//! Frames arrive as I420 (the module converts YUY2, MJPEG and the rest with libyuv), on the
//! module's capture thread, already in the shape [`NativeVideoSource`] takes.
//!
//! [`NativeVideoSource`]: crate::video_source::native::NativeVideoSource

use std::sync::Arc;
use std::time::Duration;

use cxx::UniquePtr;
use webrtc_sys::camera_capturer::ffi as sys_cc;
use webrtc_sys::video_track as sys_vt;

use super::video_frame::new_video_frame_buffer;
use crate::video_frame::{BoxVideoFrame, VideoFrame};

/// Which capture backend to open.
#[derive(Debug)]
pub enum CameraBackend {
    /// PipeWire, over `fd`: a connection to the daemon, which libwebrtc takes over and closes.
    /// `None` asks the xdg camera portal for one, as a sandboxed app must.
    #[cfg(target_os = "linux")]
    PipeWire { fd: Option<std::os::fd::OwnedFd> },
    /// V4L2 device nodes directly.
    #[cfg(target_os = "linux")]
    V4l2,
    /// DirectShow, the only camera backend in libwebrtc on Windows.
    #[cfg(target_os = "windows")]
    DirectShow,
}

/// `webrtc::VideoType`: what the device produces, before the module converts it to I420.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CameraFormat {
    Unknown,
    I420,
    Iyuv,
    Rgb24,
    Bgr24,
    Argb,
    Abgr,
    Rgb565,
    Yuy2,
    Yv12,
    Uyvy,
    Mjpeg,
    Bgra,
    Nv12,
    Other(i32),
}

impl CameraFormat {
    fn from_sys(value: i32) -> Self {
        use CameraFormat::*;
        match value {
            0 => Unknown,
            1 => I420,
            2 => Iyuv,
            3 => Rgb24,
            4 => Bgr24,
            5 => Argb,
            6 => Abgr,
            7 => Rgb565,
            8 => Yuy2,
            9 => Yv12,
            10 => Uyvy,
            11 => Mjpeg,
            12 => Bgra,
            13 => Nv12,
            other => Other(other),
        }
    }

    fn to_sys(self) -> i32 {
        use CameraFormat::*;
        match self {
            Unknown => 0,
            I420 => 1,
            Iyuv => 2,
            Rgb24 => 3,
            Bgr24 => 4,
            Argb => 5,
            Abgr => 6,
            Rgb565 => 7,
            Yuy2 => 8,
            Yv12 => 9,
            Uyvy => 10,
            Mjpeg => 11,
            Bgra => 12,
            Nv12 => 13,
            Other(other) => other,
        }
    }
}

/// One mode a device offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CameraCapability {
    pub width: u32,
    pub height: u32,
    pub max_fps: u32,
    pub format: CameraFormat,
    pub interlaced: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CameraDevice {
    /// Stable for the device while it's plugged in; what [`CameraCapturer::start`] takes.
    pub unique_id: String,
    pub name: String,
    /// May be empty for a moment after a PipeWire device appears: its formats come later.
    pub capabilities: Vec<CameraCapability>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CameraInitError {
    #[error("camera backend uninitialized")]
    Uninitialized,
    #[error("camera backend unavailable")]
    Unavailable,
    #[error("camera access denied")]
    Denied,
    #[error("camera backend failed")]
    Error,
    #[error("camera backend didn't answer in time")]
    TimedOut,
    #[error("camera backend status {0}")]
    Other(i32),
}

/// A camera backend, and at most one running capture from it.
pub struct CameraCapturer {
    sys_handle: UniquePtr<sys_cc::CameraCapturer>,
}

impl CameraCapturer {
    /// Opens the backend, blocking until it's ready: PipeWire lists its nodes first. Fails with
    /// [`CameraInitError::TimedOut`] after `init_timeout`.
    pub fn new(backend: CameraBackend, init_timeout: Duration) -> Result<Self, CameraInitError> {
        #[allow(unused_mut)]
        let mut options = sys_cc::CameraCapturerOptions {
            pipewire: false,
            pipewire_fd: -1,
            init_timeout_ms: init_timeout.as_millis().min(u32::MAX as u128) as u32,
        };
        match backend {
            #[cfg(target_os = "linux")]
            CameraBackend::PipeWire { fd } => {
                use std::os::fd::IntoRawFd as _;
                options.pipewire = true;
                options.pipewire_fd = fd.map_or(-1, |fd| fd.into_raw_fd());
            }
            #[cfg(target_os = "linux")]
            CameraBackend::V4l2 => {}
            #[cfg(target_os = "windows")]
            CameraBackend::DirectShow => {}
        }
        let sys_handle = sys_cc::new_camera_capturer(options);
        match sys_handle.init_status() {
            0 => Ok(Self { sys_handle }),
            1 => Err(CameraInitError::Uninitialized),
            2 => Err(CameraInitError::Unavailable),
            3 => Err(CameraInitError::Denied),
            4 => Err(CameraInitError::Error),
            100 => Err(CameraInitError::TimedOut),
            other => Err(CameraInitError::Other(other)),
        }
    }

    pub fn devices(&self) -> Vec<CameraDevice> {
        self.sys_handle
            .devices()
            .into_iter()
            .map(|device| CameraDevice {
                unique_id: device.unique_id,
                name: device.name,
                capabilities: device
                    .capabilities
                    .into_iter()
                    .map(|c| CameraCapability {
                        width: c.width.max(0) as u32,
                        height: c.height.max(0) as u32,
                        max_fps: c.max_fps.max(0) as u32,
                        format: CameraFormat::from_sys(c.video_type),
                        interlaced: c.interlaced,
                    })
                    .collect(),
            })
            .collect()
    }

    /// Starts capturing `capability` from the device. `on_frame` runs on the capture thread for
    /// every frame, so it must return quickly. False if the device is gone, busy, refuses the
    /// mode, or a capture is already running.
    pub fn start<F>(&self, unique_id: &str, capability: CameraCapability, on_frame: F) -> bool
    where
        F: Fn(BoxVideoFrame) + Send + Sync + 'static,
    {
        let sink = sys_vt::ffi::new_native_video_sink(Box::new(sys_vt::VideoSinkWrapper::new(
            Arc::new(FrameSink { on_frame }),
        )));
        let capability = sys_cc::CameraCapability {
            width: capability.width as i32,
            height: capability.height as i32,
            max_fps: capability.max_fps as i32,
            video_type: capability.format.to_sys(),
            interlaced: capability.interlaced,
        };
        self.sys_handle.start(unique_id, capability, sink)
    }

    /// Stops the capture, if one runs. No `on_frame` call starts after this returns.
    pub fn stop(&self) {
        self.sys_handle.stop();
    }

    pub fn is_capturing(&self) -> bool {
        self.sys_handle.is_capturing()
    }
}

struct FrameSink<F> {
    on_frame: F,
}

impl<F> sys_vt::VideoSink for FrameSink<F>
where
    F: Fn(BoxVideoFrame) + Send + Sync,
{
    fn on_frame(&self, frame: UniquePtr<webrtc_sys::video_frame::ffi::VideoFrame>) {
        (self.on_frame)(VideoFrame {
            rotation: frame.rotation().into(),
            timestamp_us: frame.timestamp_us(),
            frame_metadata: None,
            buffer: new_video_frame_buffer(unsafe { frame.video_frame_buffer() }),
        });
    }

    fn on_discarded_frame(&self) {}

    fn on_constraints_changed(&self, _constraints: sys_vt::ffi::VideoTrackSourceConstraints) {}
}
