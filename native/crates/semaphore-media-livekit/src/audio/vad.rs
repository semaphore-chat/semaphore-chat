//! Voice activity: the web client's level and gate, so a threshold set on either means the same.
//!
//! **The level** is the web's `computeVoiceLevel` over an `AnalyserNode` with `fftSize = 256` and
//! `smoothingTimeConstant = 0.5`, done by hand: a Blackman-windowed 256-point DFT of the latest
//! samples, each bin's magnitude smoothed over time, in dB, mapped from -100..-30 dB onto 0..255
//! as `getByteFrequencyData` does, then averaged over the 80 Hz to 4 kHz bins and scaled to
//! 0..100. Only those 21 bins are computed. The web samples it about every 30 ms; this does it
//! every 10 ms frame, which smooths a little faster.
//!
//! **The gate** (`useSpeakingDetection`): starts open, as if the level had just been above the
//! threshold, so the first words after a join go out; opens above the threshold (after at least
//! 100 ms closed), stays open while the level is above the threshold less 5, and closes 300 ms
//! after it last was. The level is compared unrounded, as the web's float. A threshold of 0 means
//! no gate.

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
    /// Takes the next samples and returns the level now, 0.0..=100.0.
    pub fn push(&mut self, frame: &[i16]) -> f32 {
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
        level.clamp(0.0, 100.0) as f32
    }
}

/// Whether the mic may send, frame by frame.
#[derive(Debug)]
pub struct VadGate {
    open: bool,
    /// Milliseconds since the level was last above the closing threshold, and since closing.
    since_above_ms: u32,
    since_closed_ms: u32,
}

impl Default for VadGate {
    /// Open, with the level last above the threshold just now: the web's start.
    fn default() -> Self {
        Self {
            open: true,
            since_above_ms: 0,
            since_closed_ms: 0,
        }
    }
}

impl VadGate {
    /// Advances 10 ms. `threshold` 0 turns the gate off (always open).
    pub fn step(&mut self, level: f32, threshold: u8) -> bool {
        if threshold == 0 {
            self.open = true;
            self.since_above_ms = 0;
            return true;
        }
        if self.open {
            if level > f32::from(threshold.saturating_sub(HYSTERESIS)) {
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
            if level > f32::from(threshold) && self.since_closed_ms >= MIN_CLOSED_MS {
                self.open = true;
                self.since_above_ms = 0;
            }
        }
        self.open
    }
}

/// Whether we're speaking, for our own ring: the web's `useSpeakingDetection` tick for the local
/// participant, on the same level, 10 ms at a time. Kept apart from [`VadGate`], which decides
/// what is sent: the web's ring starts off where its gate starts open, and its threshold 0 is
/// "above silence" where the gate's is "no gate".
///
/// - The mic shut (muted, server-muted, push-to-talk not held): off, and the gate closes.
/// - Push-to-talk held: on while the level is above the threshold.
/// - Voice activity: on while the gate holds open on speech, off once it closes.
#[derive(Debug)]
pub struct SpeakingIndicator {
    open: bool,
    shown: bool,
    since_above_ms: u32,
    since_closed_ms: u32,
}

impl Default for SpeakingIndicator {
    /// The web's start: the gate open, last above "now", last closed long ago, the ring off.
    fn default() -> Self {
        Self {
            open: true,
            shown: false,
            since_above_ms: 0,
            since_closed_ms: MIN_CLOSED_MS,
        }
    }
}

impl SpeakingIndicator {
    /// Advances 10 ms and returns whether the ring shows.
    pub fn step(&mut self, level: f32, mic_open: bool, push_to_talk: bool, threshold: u8) -> bool {
        self.since_closed_ms = self.since_closed_ms.saturating_add(FRAME_MS);
        if !mic_open {
            self.open = false;
            self.shown = false;
        } else if push_to_talk {
            self.open = true;
            self.shown = level > f32::from(threshold);
        } else if self.open {
            if level > f32::from(threshold.saturating_sub(HYSTERESIS)) {
                self.since_above_ms = 0;
                self.shown = true;
            } else {
                self.since_above_ms = self.since_above_ms.saturating_add(FRAME_MS);
                if self.since_above_ms >= HOLD_OPEN_MS {
                    self.open = false;
                    self.since_closed_ms = 0;
                    self.shown = false;
                }
            }
        } else if level > f32::from(threshold) && self.since_closed_ms >= MIN_CLOSED_MS {
            self.open = true;
            self.since_above_ms = 0;
            self.shown = true;
        }
        self.shown
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::ToneMic;

    fn level_of(hz: f64, amplitude: f64) -> f32 {
        let mut mic = ToneMic::new(hz, amplitude);
        let mut level = VoiceLevel::default();
        let mut frame = [0i16; FRAME_SAMPLES];
        let mut last = 0.0;
        for _ in 0..20 {
            mic.fill(&mut frame);
            last = level.push(&frame);
        }
        last
    }

    #[test]
    fn the_level_rises_with_loudness_and_ignores_what_voices_dont_have() {
        assert_eq!(level_of(440.0, 0.0), 0.0);
        let quiet = level_of(440.0, 0.01);
        let loud = level_of(440.0, 0.5);
        assert!(quiet < loud, "{quiet} vs {loud}");
        assert!(loud <= 100.0);
        // 10 kHz is outside 80 Hz..4 kHz: only window leakage shows.
        assert!(
            level_of(10_000.0, 0.5) < loud / 2.0,
            "{}",
            level_of(10_000.0, 0.5)
        );
    }

    fn run(gate: &mut VadGate, level: f32, threshold: u8, ms: u32) -> Vec<bool> {
        (0..ms / FRAME_MS)
            .map(|_| gate.step(level, threshold))
            .collect()
    }

    #[test]
    fn the_gate_opens_holds_and_closes_like_the_web() {
        let mut gate = VadGate::default();
        // Open to start; silence closes it after the hold.
        run(&mut gate, 0.0, 40, 300);
        // A level at the threshold isn't above it.
        assert!(!run(&mut gate, 40.0, 40, 200).iter().any(|&open| open));
        // Just above it is, unrounded (it has been closed for long enough).
        assert!(gate.step(40.4, 40));
        // Within the hysteresis band it stays open indefinitely.
        assert!(run(&mut gate, 35.5, 40, 1000).iter().all(|&open| open));
        // Below it, it holds for 300 ms and then closes.
        let falling = run(&mut gate, 10.0, 40, 300);
        assert!(falling[..29].iter().all(|&open| open));
        assert!(!falling[29]);
        // Reopening waits for 100 ms closed.
        assert!(!run(&mut gate, 90.0, 40, 60).iter().any(|&open| open));
        assert!(run(&mut gate, 90.0, 40, 50).iter().any(|&open| open));
    }

    #[test]
    fn the_gate_starts_open_like_the_web() {
        // The web starts open with "last above" at now, so the first words after a join go out.
        let mut gate = VadGate::default();
        let start = run(&mut gate, 0.0, 40, 300);
        assert!(start[..29].iter().all(|&open| open), "{start:?}");
        assert!(!start[29]);
    }

    #[test]
    fn threshold_zero_is_no_gate() {
        let mut gate = VadGate::default();
        assert!(run(&mut gate, 0.0, 0, 1000).iter().all(|&open| open));
    }

    /// `(level, mic open, push to talk, threshold)`.
    type Input = (f32, bool, bool, u8);
    /// `(case, input, ms, every frame shows, last frame shows)`.
    type Case = (&'static str, Input, u32, Option<bool>, bool);

    /// `step` held for `ms`: what the ring showed each 10 ms.
    fn ring(indicator: &mut SpeakingIndicator, step: Input, ms: u32) -> Vec<bool> {
        let (level, open, ptt, threshold) = step;
        (0..ms / FRAME_MS)
            .map(|_| indicator.step(level, open, ptt, threshold))
            .collect()
    }

    #[test]
    fn the_ring_follows_the_web_rules() {
        let cases: &[Case] = &[
            // Voice activity at 40: quiet at the start never lights it, though the gate is open.
            (
                "starts off",
                (0.0, true, false, 40),
                200,
                Some(false),
                false,
            ),
            (
                "speech opens it",
                (60.0, true, false, 40),
                200,
                Some(true),
                true,
            ),
            (
                "within hysteresis",
                (36.0, true, false, 40),
                500,
                Some(true),
                true,
            ),
            (
                "holds 300 ms",
                (10.0, true, false, 40),
                290,
                Some(true),
                true,
            ),
            ("then closes", (10.0, true, false, 40), 10, None, false),
            // Muted: off whatever the level, and the gate shuts with it.
            ("muted", (90.0, false, false, 40), 300, Some(false), false),
            (
                "unmuted, quiet",
                (0.0, true, false, 40),
                200,
                Some(false),
                false,
            ),
            (
                "unmuted, speech",
                (60.0, true, false, 40),
                10,
                Some(true),
                true,
            ),
            // Threshold 0 (the web's default): anything above silence lights it.
            ("t0 sound", (0.5, true, false, 0), 100, Some(true), true),
            (
                "t0 silence holds",
                (0.0, true, false, 0),
                290,
                Some(true),
                true,
            ),
            ("t0 silence closes", (0.0, true, false, 0), 10, None, false),
            // Push to talk: not held is a shut mic; held, the level against the threshold.
            ("ptt idle", (90.0, false, true, 40), 100, Some(false), false),
            (
                "ptt held, quiet",
                (10.0, true, true, 40),
                100,
                Some(false),
                false,
            ),
            (
                "ptt held, speech",
                (60.0, true, true, 40),
                100,
                Some(true),
                true,
            ),
            (
                "ptt held, dips",
                (39.0, true, true, 40),
                10,
                Some(false),
                false,
            ),
            ("ptt held, t0", (0.5, true, true, 0), 10, Some(true), true),
            (
                "ptt released",
                (90.0, false, true, 0),
                10,
                Some(false),
                false,
            ),
        ];
        let mut indicator = SpeakingIndicator::default();
        for (case, step, ms, every, last) in cases {
            let shown = ring(&mut indicator, *step, *ms);
            if let Some(every) = every {
                assert!(shown.iter().all(|s| s == every), "{case}: {shown:?}");
            }
            assert_eq!(shown.last(), Some(last), "{case}");
        }
    }

    #[test]
    fn a_closed_ring_waits_100_ms_to_reopen() {
        let mut indicator = SpeakingIndicator::default();
        ring(&mut indicator, (60.0, true, false, 40), 100);
        ring(&mut indicator, (0.0, true, false, 40), 300);
        assert!(!indicator.step(0.0, true, false, 40));
        let again = ring(&mut indicator, (60.0, true, false, 40), 100);
        assert!(!again[..8].iter().any(|&s| s), "{again:?}");
        assert!(again[9], "{again:?}");
    }

    #[test]
    fn a_tone_lights_the_ring_and_silence_puts_it_out() {
        let mut mic = ToneMic::new(440.0, 0.3);
        let mut level = VoiceLevel::default();
        let mut indicator = SpeakingIndicator::default();
        let mut frame = [0i16; FRAME_SAMPLES];
        let mut shown = false;
        for _ in 0..10 {
            mic.fill(&mut frame);
            shown = indicator.step(level.push(&frame), true, false, 0);
        }
        assert!(shown);
        let silence = [0i16; FRAME_SAMPLES];
        let mut off_after = None;
        for n in 0..100 {
            if !indicator.step(level.push(&silence), true, false, 0) {
                off_after = Some(n);
                break;
            }
        }
        // The smoothing takes the level to 0 within a few frames, then the 300 ms hold.
        let off_after = off_after.expect("the ring went out");
        assert!((30..60).contains(&off_after), "{off_after}");
    }
}
