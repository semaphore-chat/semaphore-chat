//! Our own audio graph: device streams at the edge, libwebrtc's APM on the mic, and a mixer with a
//! gain per person and source (their mic, and the audio of their screen share) on the way out.
//!
//! The SDK's `PlatformAudio` would play and capture for us, but it renders every remote track
//! through libwebrtc's own mixer and has no per-track gain (nothing in `webrtc-sys` reaches
//! `AudioSourceInterface::SetVolume`), and the web client's per-user slider goes to 200%. So remote
//! tracks come out through `NativeAudioStream`, which is also the path T7's reconnect runs proved.

pub mod apm;
pub mod cpal_io;
pub mod mixer;
pub mod system;
pub mod vad;
pub mod virtual_io;

use std::any::Any;
use std::sync::Arc;

pub const SAMPLE_RATE: u32 = 48_000;
/// 10 ms at 48 kHz, the only size the APM takes.
pub const FRAME_SAMPLES: usize = 480;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AudioDevices {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

/// Mono 48 kHz samples, and how long ago the device captured them.
pub type InputCallback = Box<dyn FnMut(&[i16], u32) + Send>;
/// Fill with 48 kHz samples, mono unless opened with more channels (then interleaved); the
/// second argument is how far ahead of the device they are, in milliseconds.
pub type OutputCallback = Box<dyn FnMut(&mut [i16], u32) + Send>;
/// The stream died, usually because its device was unplugged.
pub type ErrorCallback = Arc<dyn Fn(String) + Send + Sync>;

/// Dropping it stops the device.
pub struct AudioStream {
    _keep: Box<dyn Any + Send>,
}

impl AudioStream {
    pub fn new(keep: impl Any + Send) -> Self {
        Self {
            _keep: Box::new(keep),
        }
    }
}

/// Where audio physically goes. `cpal_io` is the real one; `virtual_io` is a clock, for tests and
/// machines with no sound card, and the engine can't tell them apart.
pub trait AudioIo: Send + Sync {
    fn devices(&self) -> Result<AudioDevices, String>;
    fn open_input(
        &self,
        device: Option<&str>,
        on_audio: InputCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String>;
    fn open_output(
        &self,
        device: Option<&str>,
        on_audio: OutputCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String>;
    /// [`Self::open_output`] with `channels` interleaved channels in each buffer, for media that
    /// has them (an attachment in stereo). 1 is exactly `open_output`. This default mixes them
    /// down to mono, for an output with no wider path.
    fn open_output_channels(
        &self,
        device: Option<&str>,
        channels: u16,
        on_audio: OutputCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String> {
        if channels <= 1 {
            return self.open_output(device, on_audio, on_error);
        }
        self.open_output(device, mix_down(usize::from(channels), on_audio), on_error)
    }
}

/// A mono output callback that asks `wide` for `channels` interleaved channels and averages them.
pub fn mix_down(channels: usize, mut wide: OutputCallback) -> OutputCallback {
    let mut buffer: Vec<i16> = Vec::new();
    Box::new(move |mono: &mut [i16], latency| {
        buffer.clear();
        buffer.resize(mono.len() * channels, 0);
        wide(&mut buffer, latency);
        for (out, frame) in mono.iter_mut().zip(buffer.chunks_exact(channels)) {
            let sum: i32 = frame.iter().map(|&s| i32::from(s)).sum();
            *out = (sum / channels as i32) as i16;
        }
    })
}

/// Turns any callback size into 10 ms frames.
pub(crate) struct Chunker {
    pending: Vec<i16>,
}

impl Chunker {
    pub(crate) fn new() -> Self {
        Self {
            pending: Vec::with_capacity(FRAME_SAMPLES * 4),
        }
    }

    pub(crate) fn push(&mut self, samples: &[i16], mut on_frame: impl FnMut(&mut [i16])) {
        self.pending.extend_from_slice(samples);
        let mut start = 0;
        while self.pending.len() - start >= FRAME_SAMPLES {
            on_frame(&mut self.pending[start..start + FRAME_SAMPLES]);
            start += FRAME_SAMPLES;
        }
        self.pending.drain(..start);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn mixing_down_averages_the_channels() {
        let mut mono = mix_down(
            2,
            Box::new(|wide: &mut [i16], _| {
                for frame in wide.as_chunks_mut::<2>().0 {
                    *frame = [1000, 3000];
                }
            }),
        );
        let mut out = [0i16; 4];
        mono(&mut out, 0);
        assert_eq!(out, [2000; 4]);
    }

    #[test]
    fn the_virtual_speaker_hears_stereo_interleaved_and_calls_stay_mono() {
        let io = virtual_io::VirtualIo::new();
        let (heard, frames) = mpsc::channel::<usize>();
        let heard = Mutex::new(heard);
        io.set_speaker(Box::new(move |frame| {
            let _ = heard.lock().unwrap().send(frame.len());
        }));
        let quiet: ErrorCallback = Arc::new(|_| {});
        let stereo = io
            .open_output_channels(None, 2, Box::new(|_, _| {}), quiet.clone())
            .unwrap();
        let len = frames.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(len, FRAME_SAMPLES * 2);
        drop(stereo);
        while frames.try_recv().is_ok() {}
        let _mono = io.open_output(None, Box::new(|_, _| {}), quiet).unwrap();
        // A tick of the stereo clock may still be in flight; the next mono one is the proof.
        let lens: Vec<usize> = (0..3)
            .filter_map(|_| frames.recv_timeout(Duration::from_secs(2)).ok())
            .collect();
        assert_eq!(lens.last(), Some(&FRAME_SAMPLES));
    }
}
