//! Audio devices that are only a clock: a mic that plays what you give it, a speaker that hands you
//! what it was told to play. Runs at real time on threads, so everything downstream (the APM, Opus,
//! the SFU, the mixer) is the real code path on a machine with no sound card.

use super::{
    AudioDevice, AudioDevices, AudioIo, AudioStream, ErrorCallback, FRAME_SAMPLES, InputCallback,
    OutputCallback,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub type MicFn = Box<dyn FnMut(&mut [i16]) + Send>;
pub type SpeakerFn = Box<dyn FnMut(&[i16]) + Send>;

#[derive(Default)]
struct State {
    devices: AudioDevices,
    mic: Option<MicFn>,
    speaker: Option<SpeakerFn>,
    errors: Vec<(String, ErrorCallback)>,
    opened_inputs: Vec<Option<String>>,
    opened_outputs: Vec<Option<String>>,
}

#[derive(Clone, Default)]
pub struct VirtualIo {
    state: Arc<Mutex<State>>,
}

fn device(id: &str, is_default: bool) -> AudioDevice {
    AudioDevice {
        id: id.to_owned(),
        name: format!("Virtual {id}"),
        is_default,
    }
}

impl VirtualIo {
    /// One default mic and one default speaker, silent until given something.
    pub fn new() -> Self {
        let io = Self::default();
        {
            let mut state = io.lock();
            state.devices.inputs.push(device("mic-0", true));
            state.devices.outputs.push(device("spk-0", true));
        }
        io
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn set_mic(&self, mic: MicFn) {
        self.lock().mic = Some(mic);
    }

    pub fn set_speaker(&self, speaker: SpeakerFn) {
        self.lock().speaker = Some(speaker);
    }

    pub fn plug_in(&self, id: &str, input: bool) {
        let mut state = self.lock();
        let list = if input {
            &mut state.devices.inputs
        } else {
            &mut state.devices.outputs
        };
        list.push(device(id, false));
    }

    /// Takes the device away, and fails any stream open on it, as a USB headset does.
    pub fn unplug(&self, id: &str) {
        let mut state = self.lock();
        state.devices.inputs.retain(|d| d.id != id);
        state.devices.outputs.retain(|d| d.id != id);
        let errors = std::mem::take(&mut state.errors);
        let (failed, kept): (Vec<_>, Vec<_>) = errors.into_iter().partition(|(d, _)| d == id);
        state.errors = kept;
        drop(state);
        for (_, on_error) in failed {
            on_error(format!("{id} was unplugged"));
        }
    }

    /// Every device a stream has opened on, oldest first; `None` means the system default.
    pub fn opened_inputs(&self) -> Vec<Option<String>> {
        self.lock().opened_inputs.clone()
    }

    pub fn opened_outputs(&self) -> Vec<Option<String>> {
        self.lock().opened_outputs.clone()
    }

    fn resolve(&self, device: Option<&str>, input: bool) -> Result<String, String> {
        let state = self.lock();
        let list = if input {
            &state.devices.inputs
        } else {
            &state.devices.outputs
        };
        match device {
            Some(id) => list.iter().find(|d| d.id == id),
            None => list.iter().find(|d| d.is_default).or(list.first()),
        }
        .map(|d| d.id.clone())
        .ok_or_else(|| format!("no such device: {device:?}"))
    }

    fn clock(stop: Arc<AtomicBool>, mut tick: impl FnMut() + Send + 'static) {
        std::thread::spawn(move || {
            let period = Duration::from_millis(10);
            let mut next = Instant::now() + period;
            while !stop.load(Ordering::Relaxed) {
                tick();
                // Pacing a device clock, not waiting for an event.
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                }
                next += period;
            }
        });
    }
}

struct StopOnDrop(Arc<AtomicBool>);
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

impl AudioIo for VirtualIo {
    fn devices(&self) -> Result<AudioDevices, String> {
        Ok(self.lock().devices.clone())
    }

    fn open_input(
        &self,
        device: Option<&str>,
        mut on_audio: InputCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String> {
        let id = self.resolve(device, true)?;
        {
            let mut state = self.lock();
            state.opened_inputs.push(device.map(str::to_owned));
            state.errors.push((id, on_error));
        }
        let stop = Arc::new(AtomicBool::new(false));
        let me = self.clone();
        Self::clock(stop.clone(), move || {
            let mut frame = [0i16; FRAME_SAMPLES];
            if let Some(mic) = me.lock().mic.as_mut() {
                mic(&mut frame);
            }
            on_audio(&frame, 0);
        });
        Ok(AudioStream::new(StopOnDrop(stop)))
    }

    fn open_output(
        &self,
        device: Option<&str>,
        mut on_audio: OutputCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String> {
        let id = self.resolve(device, false)?;
        {
            let mut state = self.lock();
            state.opened_outputs.push(device.map(str::to_owned));
            state.errors.push((id, on_error));
        }
        let stop = Arc::new(AtomicBool::new(false));
        let me = self.clone();
        Self::clock(stop.clone(), move || {
            let mut frame = [0i16; FRAME_SAMPLES];
            on_audio(&mut frame, 0);
            if let Some(speaker) = me.lock().speaker.as_mut() {
                speaker(&frame);
            }
        });
        Ok(AudioStream::new(StopOnDrop(stop)))
    }
}
