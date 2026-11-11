// Semaphore patch: libwebrtc's VideoCaptureModule (cameras). See include/livekit/camera_capturer.h.
// Licensed under the Apache License, Version 2.0, like the rest of this crate.

use crate::impl_thread_safety;

#[cxx::bridge(namespace = "livekit_ffi")]
pub mod ffi {
    /// Linux only; ignored elsewhere.
    #[derive(Clone, Debug)]
    struct CameraCapturerOptions {
        /// PipeWire, else V4L2.
        pipewire: bool,
        /// A connection to the PipeWire daemon, which libwebrtc takes over, or -1 to go
        /// through the camera portal.
        pipewire_fd: i32,
        init_timeout_ms: u32,
    }

    #[derive(Clone, Debug)]
    struct CameraCapability {
        width: i32,
        height: i32,
        max_fps: i32,
        /// `webrtc::VideoType`.
        video_type: i32,
        interlaced: bool,
    }

    #[derive(Clone, Debug)]
    struct CameraDevice {
        unique_id: String,
        name: String,
        capabilities: Vec<CameraCapability>,
    }

    unsafe extern "C++" {
        include!("livekit/camera_capturer.h");

        type CameraCapturer;
        type NativeVideoSink = crate::video_track::ffi::NativeVideoSink;

        /// Blocks until the backend is ready (PipeWire) or `init_timeout_ms` passes.
        fn new_camera_capturer(options: CameraCapturerOptions) -> UniquePtr<CameraCapturer>;
        fn init_status(self: &CameraCapturer) -> i32;
        fn devices(self: &CameraCapturer) -> Vec<CameraDevice>;
        fn start(
            self: &CameraCapturer,
            unique_id: &str,
            capability: CameraCapability,
            sink: SharedPtr<NativeVideoSink>,
        ) -> bool;
        fn stop(self: &CameraCapturer);
        fn is_capturing(self: &CameraCapturer) -> bool;
    }
}

impl_thread_safety!(ffi::CameraCapturer, Send + Sync);
