//! Sample-rate conversion to the output's 48 kHz: a windowed-sinc (Blackman) interpolator over
//! interleaved `f32`, streaming. 16 taps a side, cut off just under the lower Nyquist, so
//! 44.1 kHz music comes out without the imaging a linear resampler leaves. Equal rates pass
//! through untouched.

use std::f64::consts::PI;

const HALF: usize = 16;

pub struct Resampler {
    channels: usize,
    /// Input frames per output frame.
    step: f64,
    /// Where the next output falls, in input frames from the start of `history`.
    position: f64,
    history: Vec<f32>,
    /// Fraction of the input's Nyquist kept.
    cutoff: f64,
    passthrough: bool,
}

impl Resampler {
    pub fn new(from: u32, to: u32, channels: usize) -> Self {
        let (from, to) = (from.max(1), to.max(1));
        let channels = channels.max(1);
        Self {
            channels,
            step: f64::from(from) / f64::from(to),
            // Start HALF frames in, on the zeros below, so the first output is the first input.
            position: HALF as f64,
            history: vec![0.0; HALF * channels],
            cutoff: (f64::from(to) / f64::from(from)).min(1.0) * 0.97,
            passthrough: from == to,
        }
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    /// Appends the converted frames of `input` (interleaved) to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.passthrough {
            out.extend_from_slice(input);
            return;
        }
        self.history.extend_from_slice(input);
        let ch = self.channels;
        let frames = self.history.len() / ch;
        while self.position + (HALF as f64) < frames as f64 {
            let centre = self.position.floor();
            let fraction = self.position - centre;
            let centre = centre as isize;
            for c in 0..ch {
                let mut acc = 0.0f64;
                for k in -(HALF as isize) + 1..=HALF as isize {
                    let index = centre + k;
                    if index < 0 {
                        continue;
                    }
                    let x = k as f64 - fraction;
                    acc += f64::from(self.history[index as usize * ch + c]) * self.kernel(x);
                }
                out.push(acc as f32);
            }
            self.position += self.step;
        }
        // Keep HALF frames of history before the next output.
        let keep_from = (self.position.floor() as usize).saturating_sub(HALF);
        if keep_from > 0 {
            self.history.drain(..keep_from * ch);
            self.position -= keep_from as f64;
        }
    }

    /// The tail still inside the filter, at the end of the stream.
    pub fn finish(&mut self, out: &mut Vec<f32>) {
        if !self.passthrough {
            let zeros = vec![0.0; HALF * self.channels];
            self.process(&zeros, out);
        }
    }

    fn kernel(&self, x: f64) -> f64 {
        let width = HALF as f64;
        if x.abs() >= width {
            return 0.0;
        }
        let sinc = if x == 0.0 {
            1.0
        } else {
            let t = PI * self.cutoff * x;
            t.sin() / t
        };
        let n = (x + width) / (2.0 * width);
        let window = 0.42 - 0.5 * (2.0 * PI * n).cos() + 0.08 * (4.0 * PI * n).cos();
        self.cutoff * sinc * window
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, seconds: f64, hz: f64) -> Vec<f32> {
        let n = (f64::from(rate) * seconds) as usize;
        (0..n)
            .map(|i| (2.0 * PI * hz * i as f64 / f64::from(rate)).sin() as f32 * 0.5)
            .collect()
    }

    fn crossings(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
            .count()
    }

    #[test]
    fn a_tone_keeps_its_pitch_and_length() {
        let input = tone(44_100, 1.0, 440.0);
        let mut resampler = Resampler::new(44_100, 48_000, 1);
        let mut out = Vec::new();
        for chunk in input.chunks(1024) {
            resampler.process(chunk, &mut out);
        }
        resampler.finish(&mut out);
        assert!(out.len().abs_diff(48_000) <= 32, "{} samples", out.len());
        let c = crossings(&out[100..47_900]);
        assert!(c.abs_diff(876) <= 6, "{c} crossings");
        let peak = out[1000..47_000].iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.5).abs() < 0.02, "amplitude {peak}");
    }

    #[test]
    fn stereo_channels_stay_apart() {
        let left = tone(16_000, 0.5, 300.0);
        let mut input = Vec::new();
        for s in &left {
            input.extend_from_slice(&[*s, 0.0]);
        }
        let mut resampler = Resampler::new(16_000, 48_000, 2);
        let mut out = Vec::new();
        resampler.process(&input, &mut out);
        let right_peak = out
            .iter()
            .skip(1)
            .step_by(2)
            .fold(0.0f32, |m, s| m.max(s.abs()));
        let left_peak = out.iter().step_by(2).fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(right_peak < 1e-6, "right {right_peak}");
        assert!(left_peak > 0.45, "left {left_peak}");
    }

    #[test]
    fn equal_rates_pass_through() {
        let input = tone(48_000, 0.1, 440.0);
        let mut resampler = Resampler::new(48_000, 48_000, 1);
        let mut out = Vec::new();
        resampler.process(&input, &mut out);
        resampler.finish(&mut out);
        assert_eq!(out, input);
    }
}
