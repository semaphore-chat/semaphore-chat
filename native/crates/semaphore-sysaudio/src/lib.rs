//! System audio capture for screen share: every app's audio, never our own call. Implements
//! `semaphore_media_livekit::audio::system::SystemAudioCapture`.
//!
//! - Linux: PipeWire, linking app streams to a capture stream of ours (`linux`).
//! - Windows: WASAPI process loopback that excludes our process tree (`windows`).
//!
//! Desktop only, and kept out of core: it links libpipewire on Linux.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::PipeWireCapture;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::ProcessLoopbackCapture;

use semaphore_media_livekit::audio::system::SystemAudioCapture;

/// The platform's capture, or `None` where there is none.
pub fn platform_capture() -> Option<Box<dyn SystemAudioCapture>> {
    #[cfg(target_os = "linux")]
    {
        Some(Box::new(PipeWireCapture::default()))
    }
    #[cfg(windows)]
    {
        Some(Box::new(ProcessLoopbackCapture::default()))
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        None
    }
}
