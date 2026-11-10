//! Our own audio graph: device streams at the edge, libwebrtc's APM on the mic, and a mixer with a
//! gain per person on the way out.
//!
//! The SDK's `PlatformAudio` would play and capture for us, but it renders every remote track
//! through libwebrtc's own mixer and has no per-track gain (nothing in `webrtc-sys` reaches
//! `AudioSourceInterface::SetVolume`), and the web client's per-user slider goes to 200%. So remote
//! tracks come out through `NativeAudioStream`, which is also the path T7's reconnect runs proved.

pub mod apm;
pub mod cpal_io;
pub mod mixer;
pub mod system;
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
/// Fill with mono 48 kHz samples; the second argument is how far ahead of the device they are.
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
