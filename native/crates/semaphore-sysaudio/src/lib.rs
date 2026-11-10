//! System audio capture for screen share: every app's audio, never our own call.
//!
//! - Linux: PipeWire, linking app streams to a capture stream of ours (`linux`).
//! - Windows: WASAPI process loopback that excludes our process tree (`windows`).
//!
//! Desktop only, and kept out of core: it links libpipewire on Linux. With the default `media`
//! feature each backend implements `semaphore_media_livekit::audio::system::SystemAudioCapture`.
//! Without it the crate needs no C toolchain, which is how the Windows backend is type-checked
//! for `x86_64-pc-windows-msvc` in the Linux build image.

use std::any::Any;
use std::sync::Arc;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::PipeWireCapture;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::ProcessLoopbackCapture;

#[cfg(feature = "media")]
mod media;
#[cfg(feature = "media")]
pub use media::platform_capture;

/// Captured audio is interleaved stereo f32 at 48 kHz.
pub const RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

/// Called on the capture thread with interleaved stereo samples, any length.
pub type OnAudio = Box<dyn FnMut(&[f32]) + Send>;
/// The capture stopped working after it started.
pub type OnError = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Support {
    Supported,
    Unsupported(String),
}

/// A running capture. Dropping it stops the capture and leaves nothing in the OS audio graph.
pub struct Capturing {
    _keep: Box<dyn Any + Send>,
}

impl Capturing {
    fn new(keep: impl Any + Send) -> Self {
        Self {
            _keep: Box::new(keep),
        }
    }
}
