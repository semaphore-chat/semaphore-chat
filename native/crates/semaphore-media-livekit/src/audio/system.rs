//! System audio for a screen share: what the user hears from other apps, never our own call.
//!
//! The capture itself is OS work (`semaphore-sysaudio`: PipeWire links on Linux, WASAPI process
//! loopback on Windows). This crate only defines the seam and publishes what comes through it.

use super::{AudioStream, ErrorCallback, SAMPLE_RATE};

/// Captured audio is always interleaved stereo f32 at 48 kHz.
pub const SYSTEM_AUDIO_CHANNELS: usize = 2;
pub const SYSTEM_AUDIO_RATE: u32 = SAMPLE_RATE;

/// Called on the capture thread with interleaved stereo samples, any length.
pub type SystemAudioCallback = Box<dyn FnMut(&[f32]) + Send>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemAudioSupport {
    Supported,
    /// Why not, for the UI to show next to a disabled toggle.
    Unsupported(String),
}

/// Whose audio goes into the share. Everything except our own process is what Electron does on
/// Windows. A per-window mode ("only this app's process") is the planned addition; it is a new
/// variant here and a different selection rule in each backend, not a different mechanism.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum CaptureScope {
    #[default]
    EverythingExceptOurs,
}

pub trait SystemAudioCapture: Send + Sync {
    fn support(&self) -> SystemAudioSupport;
    /// Starts capturing. Dropping the returned stream stops it and leaves nothing behind in the
    /// OS's audio graph.
    fn start(
        &self,
        scope: CaptureScope,
        on_audio: SystemAudioCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String>;
}

/// Turns any callback size into 10 ms stereo i16 frames, which is what `NativeAudioSource` takes.
pub(crate) struct StereoChunker {
    pending: Vec<i16>,
}

pub(crate) const STEREO_FRAME_SAMPLES: usize = super::FRAME_SAMPLES * SYSTEM_AUDIO_CHANNELS;

impl StereoChunker {
    pub(crate) fn new() -> Self {
        Self {
            pending: Vec::with_capacity(STEREO_FRAME_SAMPLES * 4),
        }
    }

    pub(crate) fn push(&mut self, samples: &[f32], mut on_frame: impl FnMut(&[i16])) {
        self.pending.extend(
            samples
                .iter()
                .map(|sample| (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16),
        );
        let mut start = 0;
        while self.pending.len() - start >= STEREO_FRAME_SAMPLES {
            on_frame(&self.pending[start..start + STEREO_FRAME_SAMPLES]);
            start += STEREO_FRAME_SAMPLES;
        }
        self.pending.drain(..start);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_into_ten_ms_stereo_frames() {
        let mut chunker = StereoChunker::new();
        let mut frames = Vec::new();
        chunker.push(&vec![0.5; 700], |frame| frames.push(frame.to_vec()));
        assert!(frames.is_empty());
        chunker.push(&vec![-2.0; 1300], |frame| frames.push(frame.to_vec()));
        assert_eq!(frames.len(), 2);
        assert!(
            frames
                .iter()
                .all(|frame| frame.len() == STEREO_FRAME_SAMPLES)
        );
        assert_eq!(frames[0][0], 16383);
        assert_eq!(frames[1][STEREO_FRAME_SAMPLES - 1], -i16::MAX);
    }
}
