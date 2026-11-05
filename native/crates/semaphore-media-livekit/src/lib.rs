//! LiveKit behind core's `MediaEngine`. No LiveKit type crosses this crate's public API, so core
//! and the UI stay free of the SDK and a mobile build can bring its own.

pub mod audio;
mod engine;
pub mod testing;
mod video;

pub use engine::{
    ConnectionQualityView, EngineOptions, LiveKitEngine, MediaSnapshot, MicPreset, RejoinPolicy,
    TokenSource,
};
pub use video::{TrackVideoStats, VideoDemand, layer_for};

use semaphore_core::CoreError;
use semaphore_core::platform::MediaEngine as _;

/// Joins a room and leaves it, blocking until done. Used by the app's `--probe-media` mode.
pub fn probe_connection(url: String, token: String) -> Result<(), CoreError> {
    let runtime = tokio::runtime::Runtime::new().map_err(|error| CoreError::Failed {
        message: error.to_string(),
    })?;
    runtime.block_on(async {
        let engine = LiveKitEngine::new(EngineOptions {
            // A probe proves signalling and ICE. It must not open the mic on the machine it runs on.
            audio_io: std::sync::Arc::new(audio::virtual_io::VirtualIo::new()),
            ..EngineOptions::default()
        });
        engine.connect(url, token).await?;
        engine.disconnect().await;
        Ok(())
    })
}

/// One NV12 frame, borrowed from the caller. The media crate converts LiveKit's I420 to this off
/// the UI thread.
pub struct VideoFrameRef<'a> {
    pub width: u32,
    pub height: u32,
    pub y: &'a [u8],
    pub y_stride: u32,
    pub uv: &'a [u8],
    pub uv_stride: u32,
}

/// Where decoded video goes, called from a media thread. This crate can't see GPUI, so the app
/// implements it: over `VideoUploader` where the renderer has one, otherwise as an RGBA image.
/// Core never sees frames, so a mobile build can render with its own LiveKit SDK.
pub trait VideoSink: Send + Sync {
    fn on_frame(&self, track_sid: &str, frame: &VideoFrameRef<'_>);
    fn on_track_ended(&self, track_sid: &str);
}
