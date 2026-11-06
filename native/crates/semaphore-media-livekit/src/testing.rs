//! Tone generation and detection, shared by the real-server tests and the rig. A person is "heard"
//! when their own frequency dominates what actually came out of the mixer, not when the connection
//! says so.

use crate::audio::SAMPLE_RATE;
use std::sync::{Arc, Mutex};

/// A mic that plays a sine.
pub struct ToneMic {
    step: f64,
    phase: f64,
    amplitude: f64,
}

impl ToneMic {
    pub fn new(hz: f64, amplitude: f64) -> Self {
        Self {
            step: 2.0 * std::f64::consts::PI * hz / f64::from(SAMPLE_RATE),
            phase: 0.0,
            amplitude,
        }
    }

    pub fn fill(&mut self, out: &mut [i16]) {
        for sample in out {
            *sample = (self.phase.sin() * self.amplitude * f64::from(i16::MAX)) as i16;
            self.phase += self.step;
        }
        self.phase %= 2.0 * std::f64::consts::PI;
    }
}

/// Energy at `hz` as a share of the window's total, from the Goertzel recurrence.
pub fn tone_share(samples: &[f64], hz: f64) -> f64 {
    let energy: f64 = samples.iter().map(|sample| sample * sample).sum();
    if energy == 0.0 {
        return 0.0;
    }
    let omega = 2.0 * std::f64::consts::PI * hz / f64::from(SAMPLE_RATE);
    let coefficient = 2.0 * omega.cos();
    let (mut previous, mut before) = (0.0, 0.0);
    for sample in samples {
        let current = sample + coefficient * previous - before;
        before = previous;
        previous = current;
    }
    let power = previous * previous + before * before - coefficient * previous * before;
    // A pure sine's bin power is total_energy * N / 2.
    power / (energy * samples.len() as f64 / 2.0)
}

/// The RMS amplitude of the part of the signal at `hz`.
pub fn tone_rms(samples: &[f64], hz: f64) -> f64 {
    let energy: f64 = samples.iter().map(|sample| sample * sample).sum();
    (tone_share(samples, hz) * energy / samples.len() as f64).sqrt()
}

/// Keeps the last `window` samples a speaker played, for measuring from another thread.
#[derive(Clone)]
pub struct SpeakerTap {
    samples: Arc<Mutex<Vec<f64>>>,
    window: usize,
}

impl SpeakerTap {
    pub fn new(window: usize) -> Self {
        Self {
            samples: Arc::default(),
            window,
        }
    }

    pub fn push(&self, frame: &[i16]) {
        let mut samples = self.samples.lock().unwrap_or_else(|p| p.into_inner());
        samples.extend(frame.iter().map(|sample| f64::from(*sample)));
        let excess = samples.len().saturating_sub(self.window);
        samples.drain(..excess);
    }

    /// The window's RMS at `hz`, or 0 if it isn't full yet.
    pub fn rms_at(&self, hz: f64) -> f64 {
        let samples = self.samples.lock().unwrap_or_else(|p| p.into_inner());
        if samples.len() < self.window {
            return 0.0;
        }
        tone_rms(&samples, hz)
    }

    pub fn share_at(&self, hz: f64) -> f64 {
        let samples = self.samples.lock().unwrap_or_else(|p| p.into_inner());
        tone_share(&samples, hz)
    }
}
