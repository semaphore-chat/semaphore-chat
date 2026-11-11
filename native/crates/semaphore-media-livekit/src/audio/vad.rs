//! Voice activity: the web client's level and gate, so a threshold set on either means the same.
//!
//! **The level** is the web's `computeVoiceLevel` over an `AnalyserNode` with `fftSize = 256` and
//! `smoothingTimeConstant = 0.5`, done by hand: a Blackman-windowed 256-point DFT of the latest
//! samples, each bin's magnitude smoothed over time, in dB, mapped from -100..-30 dB onto 0..255
//! as `getByteFrequencyData` does, then averaged over the 80 Hz to 4 kHz bins and scaled to
//! 0..100. Only those 21 bins are computed. The web samples it about every 30 ms; this does it
//! every 10 ms frame, which smooths a little faster.
//!
//! **The gate** (`useSpeakingDetection`): opens above the threshold (after at least 100 ms
//! closed), stays open while the level is above the threshold less 5, and closes 300 ms after it
//! last was. A threshold of 0 means no gate.

use super::{FRAME_SAMPLES, SAMPLE_RATE};

const FFT: usize = 256;
const SMOOTHING: f64 = 0.5;
const MIN_DB: f64 = -100.0;
const MAX_DB: f64 = -30.0;
const HOLD_OPEN_MS: u32 = 300;
const MIN_CLOSED_MS: u32 = 100;
const HYSTERESIS: u8 = 5;
const FRAME_MS: u32 = (FRAME_SAMPLES as u32 * 1000) / SAMPLE_RATE;

/// The web's 0..100 voice level of a mono 48 kHz signal, fed 10 ms at a time.
pub struct VoiceLevel {
    history: [f32; FFT],
    window: [f64; FFT],
    /// `cos` and `sin` of `-2 pi k / FFT`: every angle the DFT needs.
    twiddle: [(f64, f64); FFT],
    first_bin: usize,
    smoothed: Vec<f64>,
}

impl Default for VoiceLevel {
    fn default() -> Self {
        let bin_hz = f64::from(SAMPLE_RATE) / FFT as f64;
        let first_bin = ((80.0 / bin_hz).floor() as usize).max(1);
        let end_bin = ((4000.0 / bin_hz).ceil() as usize).min(FFT / 2);
        let window = std::array::from_fn(|n| {
            let x = 2.0 * std::f64::consts::PI * n as f64 / FFT as f64;
            0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos()
        });
        let twiddle = std::array::from_fn(|k| {
            let angle = -2.0 * std::f64::consts::PI * k as f64 / FFT as f64;
            (angle.cos(), angle.sin())
        });
        Self {
            history: [0.0; FFT],
            window,
            twiddle,
            first_bin,
            smoothed: vec![0.0; end_bin - first_bin],
        }
    }
}

impl VoiceLevel {
    /// Takes the next samples and returns the level now.
    pub fn push(&mut self, frame: &[i16]) -> u8 {
        let take = frame.len().min(FFT);
        self.history.copy_within(take.., 0);
        for (slot, sample) in self.history[FFT - take..]
            .iter_mut()
            .zip(&frame[frame.len() - take..])
        {
            *slot = f32::from(*sample) / 32_768.0;
        }
        let mut sum = 0.0;
        for (offset, smoothed) in self.smoothed.iter_mut().enumerate() {
            let bin = self.first_bin + offset;
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (n, (&sample, &weight)) in self.history.iter().zip(&self.window).enumerate() {
                let value = f64::from(sample) * weight;
                let (cos, sin) = self.twiddle[(bin * n) % FFT];
                re += value * cos;
                im += value * sin;
            }
            let magnitude = (re * re + im * im).sqrt() / FFT as f64;
            *smoothed = SMOOTHING * *smoothed + (1.0 - SMOOTHING) * magnitude;
            let db = 20.0 * smoothed.max(1e-12).log10();
            let byte = (255.0 / (MAX_DB - MIN_DB) * (db - MIN_DB))
                .clamp(0.0, 255.0)
                .floor();
            sum += byte;
        }
        let level = sum / self.smoothed.len() as f64 / 255.0 * 100.0;
        level.round().clamp(0.0, 100.0) as u8
    }
}

/// Whether the mic may send, frame by frame.
#[derive(Debug, Default)]
pub struct VadGate {
    open: bool,
    /// Milliseconds since the level was last above the closing threshold, and since closing.
    since_above_ms: u32,
    since_closed_ms: u32,
}

impl VadGate {
    /// Advances 10 ms. `threshold` 0 turns the gate off (always open).
    pub fn step(&mut self, level: u8, threshold: u8) -> bool {
        if threshold == 0 {
            self.open = true;
            self.since_above_ms = 0;
            return true;
        }
        if self.open {
            if level > threshold.saturating_sub(HYSTERESIS) {
                self.since_above_ms = 0;
            } else {
                self.since_above_ms = self.since_above_ms.saturating_add(FRAME_MS);
                if self.since_above_ms >= HOLD_OPEN_MS {
                    self.open = false;
                    self.since_closed_ms = 0;
                }
            }
        } else {
            self.since_closed_ms = self.since_closed_ms.saturating_add(FRAME_MS);
            if level > threshold && self.since_closed_ms >= MIN_CLOSED_MS {
                self.open = true;
                self.since_above_ms = 0;
            }
        }
        self.open
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::ToneMic;

    fn level_of(hz: f64, amplitude: f64) -> u8 {
        let mut mic = ToneMic::new(hz, amplitude);
        let mut level = VoiceLevel::default();
        let mut frame = [0i16; FRAME_SAMPLES];
        let mut last = 0;
        for _ in 0..20 {
            mic.fill(&mut frame);
            last = level.push(&frame);
        }
        last
    }

    #[test]
    fn the_level_rises_with_loudness_and_ignores_what_voices_dont_have() {
        assert_eq!(level_of(440.0, 0.0), 0);
        let quiet = level_of(440.0, 0.01);
        let loud = level_of(440.0, 0.5);
        assert!(quiet < loud, "{quiet} vs {loud}");
        assert!(loud <= 100);
        // 10 kHz is outside 80 Hz..4 kHz: only window leakage shows.
        assert!(
            level_of(10_000.0, 0.5) < loud / 2,
            "{}",
            level_of(10_000.0, 0.5)
        );
    }

    fn run(gate: &mut VadGate, level: u8, threshold: u8, ms: u32) -> Vec<bool> {
        (0..ms / FRAME_MS)
            .map(|_| gate.step(level, threshold))
            .collect()
    }

    #[test]
    fn the_gate_opens_holds_and_closes_like_the_web() {
        let mut gate = VadGate::default();
        // Closed to start; a level at the threshold isn't above it.
        assert!(!run(&mut gate, 40, 40, 200).iter().any(|&open| open));
        // Above it, it opens (it has been closed for long enough).
        assert!(gate.step(41, 40));
        // Within the hysteresis band it stays open indefinitely.
        assert!(run(&mut gate, 36, 40, 1000).iter().all(|&open| open));
        // Below it, it holds for 300 ms and then closes.
        let falling = run(&mut gate, 10, 40, 300);
        assert!(falling[..29].iter().all(|&open| open));
        assert!(!falling[29]);
        // Reopening waits for 100 ms closed.
        assert!(!run(&mut gate, 90, 40, 60).iter().any(|&open| open));
        assert!(run(&mut gate, 90, 40, 50).iter().any(|&open| open));
    }

    #[test]
    fn threshold_zero_is_no_gate() {
        let mut gate = VadGate::default();
        assert!(run(&mut gate, 0, 0, 1000).iter().all(|&open| open));
    }
}
