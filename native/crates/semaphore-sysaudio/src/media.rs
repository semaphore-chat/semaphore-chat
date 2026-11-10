//! The backends behind the media crate's `SystemAudioCapture`.

use semaphore_media_livekit::audio::AudioStream;
use semaphore_media_livekit::audio::ErrorCallback;
use semaphore_media_livekit::audio::system::{
    CaptureScope, SYSTEM_AUDIO_CHANNELS, SYSTEM_AUDIO_RATE, SystemAudioCallback,
    SystemAudioCapture, SystemAudioSupport,
};

const _: () = assert!(crate::RATE == SYSTEM_AUDIO_RATE && crate::CHANNELS == SYSTEM_AUDIO_CHANNELS);

fn support(support: crate::Support) -> SystemAudioSupport {
    match support {
        crate::Support::Supported => SystemAudioSupport::Supported,
        crate::Support::Unsupported(why) => SystemAudioSupport::Unsupported(why),
    }
}

macro_rules! capture {
    ($backend:ty) => {
        impl SystemAudioCapture for $backend {
            fn support(&self) -> SystemAudioSupport {
                support(<$backend>::support(self))
            }

            fn start(
                &self,
                scope: CaptureScope,
                on_audio: SystemAudioCallback,
                on_error: ErrorCallback,
            ) -> Result<AudioStream, String> {
                // The only scope so far. A per-window one selects by the shared app's process.
                let CaptureScope::EverythingExceptOurs = scope;
                self.start_capture(on_audio, on_error).map(AudioStream::new)
            }
        }
    };
}

#[cfg(target_os = "linux")]
capture!(crate::PipeWireCapture);
#[cfg(windows)]
capture!(crate::ProcessLoopbackCapture);

/// The platform's capture, or `None` where there is none.
pub fn platform_capture() -> Option<Box<dyn SystemAudioCapture>> {
    #[cfg(target_os = "linux")]
    {
        Some(Box::new(crate::PipeWireCapture::default()))
    }
    #[cfg(windows)]
    {
        Some(Box::new(crate::ProcessLoopbackCapture::default()))
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        None
    }
}
