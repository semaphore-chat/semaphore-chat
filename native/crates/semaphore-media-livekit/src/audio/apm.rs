//! libwebrtc's audio processing on our capture path. It exposes echo cancellation, gain control,
//! a high-pass filter and noise suppression. Voice isolation, which the web settings offer, is a
//! browser feature with no counterpart here.

use super::{FRAME_SAMPLES, SAMPLE_RATE};
use livekit::webrtc::native::apm::AudioProcessingModule;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioProcessing {
    pub echo_cancellation: bool,
    pub noise_suppression: bool,
    pub auto_gain_control: bool,
    pub high_pass_filter: bool,
}

impl Default for AudioProcessing {
    /// What the web client's capture asks for.
    fn default() -> Self {
        Self {
            echo_cancellation: true,
            noise_suppression: true,
            auto_gain_control: true,
            high_pass_filter: true,
        }
    }
}

impl AudioProcessing {
    pub const OFF: Self = Self {
        echo_cancellation: false,
        noise_suppression: false,
        auto_gain_control: false,
        high_pass_filter: false,
    };

    fn any(self) -> bool {
        self != Self::OFF
    }
}

struct Module(AudioProcessingModule);
// SAFETY: libwebrtc documents AudioProcessing as usable from its capture and render threads. The
// binding only lacks the marker, and we serialize every call with the mutex below regardless.
unsafe impl Send for Module {}

/// Shared by the capture and playout sides, which are what echo cancellation correlates.
pub struct Apm {
    module: Option<Mutex<Module>>,
}

impl Apm {
    pub fn new(processing: AudioProcessing) -> Self {
        Self {
            module: processing.any().then(|| {
                Mutex::new(Module(AudioProcessingModule::new(
                    processing.echo_cancellation,
                    processing.auto_gain_control,
                    processing.high_pass_filter,
                    processing.noise_suppression,
                )))
            }),
        }
    }

    /// One 10 ms mic frame, in place. `delay_ms` is the device latency both ways, a hint the echo
    /// canceller refines by itself.
    pub fn process_capture(&self, frame: &mut [i16], delay_ms: u32) {
        debug_assert_eq!(frame.len(), FRAME_SAMPLES);
        if let Some(module) = &self.module {
            let mut module = module.lock().unwrap_or_else(|p| p.into_inner());
            let _ = module.0.set_stream_delay_ms(delay_ms as i32);
            if let Err(error) = module.0.process_stream(frame, SAMPLE_RATE as i32, 1) {
                log::warn!("apm capture: {}", error.message);
            }
        }
    }

    /// One 10 ms frame of what the speakers are about to play.
    pub fn process_render(&self, frame: &mut [i16]) {
        debug_assert_eq!(frame.len(), FRAME_SAMPLES);
        if let Some(module) = &self.module {
            let mut module = module.lock().unwrap_or_else(|p| p.into_inner());
            if let Err(error) = module
                .0
                .process_reverse_stream(frame, SAMPLE_RATE as i32, 1)
            {
                log::warn!("apm render: {}", error.message);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! The real libwebrtc module with synthetic signals, no devices. Offline, so it runs faster
    //! than real time, which is fine: the APM only sees frame counts.

    use super::*;

    /// Noise whose loudness rises and falls like speech. AEC3 and the noise suppressor both treat
    /// a steady signal differently from this, which is the point of using it.
    struct Speechy {
        state: u64,
        n: u64,
    }

    impl Speechy {
        fn new(seed: u64) -> Self {
            Self { state: seed, n: 0 }
        }

        fn frame(&mut self, peak: f64) -> Vec<i16> {
            (0..FRAME_SAMPLES)
                .map(|_| {
                    self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1);
                    let noise = ((self.state >> 33) as f64 / f64::from(u32::MAX >> 1)) * 2.0 - 1.0;
                    // A 4 Hz syllable envelope.
                    let t = self.n as f64 / f64::from(SAMPLE_RATE);
                    let envelope = (0.5 + 0.5 * (t * 4.0 * std::f64::consts::TAU).sin()).powi(2);
                    self.n += 1;
                    (noise * envelope * peak * f64::from(i16::MAX)) as i16
                })
                .collect()
        }
    }

    fn rms(samples: &[i16]) -> f64 {
        let energy: f64 = samples.iter().map(|s| f64::from(*s).powi(2)).sum();
        (energy / samples.len().max(1) as f64).sqrt()
    }

    fn db(after: f64, before: f64) -> f64 {
        20.0 * (after.max(1.0) / before.max(1.0)).log10()
    }

    fn only(echo: bool, ns: bool, agc: bool) -> AudioProcessing {
        AudioProcessing {
            echo_cancellation: echo,
            noise_suppression: ns,
            auto_gain_control: agc,
            high_pass_filter: false,
        }
    }

    /// The speakers play far-end speech, and the mic picks it up 30 ms later and 12 dB down. With
    /// the far end as the reverse stream, the echo must mostly vanish once AEC3 has converged.
    fn echo_residual(processing: AudioProcessing) -> (f64, f64) {
        let apm = Apm::new(processing);
        let mut far = Speechy::new(1);
        let mut history: std::collections::VecDeque<Vec<i16>> = Default::default();
        let (mut in_rms, mut out_rms) = (Vec::new(), Vec::new());
        // 12 s; only the last 4 s count, so convergence isn't being measured.
        for index in 0..1200 {
            let mut render = far.frame(0.5);
            history.push_back(render.clone());
            apm.process_render(&mut render);
            let mut capture: Vec<i16> = if history.len() > 3 {
                history.pop_front().unwrap().iter().map(|s| s / 4).collect()
            } else {
                vec![0; FRAME_SAMPLES]
            };
            if index >= 800 {
                in_rms.extend_from_slice(&capture);
            }
            apm.process_capture(&mut capture, 30);
            if index >= 800 {
                out_rms.extend_from_slice(&capture);
            }
        }
        (rms(&in_rms), rms(&out_rms))
    }

    #[test]
    fn echo_cancellation_removes_the_far_end_from_the_mic() {
        let (before, after) = echo_residual(only(true, false, false));
        let cancelled = db(after, before);
        println!("echo: {before:.0} -> {after:.0} rms, {cancelled:.1} dB");
        assert!(cancelled < -20.0, "only {cancelled:.1} dB");
        let (before, after) = echo_residual(AudioProcessing::OFF);
        assert_eq!(before.round(), after.round(), "off really is off");
    }

    #[test]
    fn noise_suppression_lowers_steady_noise() {
        let apm = Apm::new(only(false, true, false));
        let mut state = 7u64;
        let mut noise = || {
            (0..FRAME_SAMPLES)
                .map(|_| {
                    state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                    ((((state >> 33) as f64 / f64::from(u32::MAX >> 1)) * 2.0 - 1.0) * 2000.0)
                        as i16
                })
                .collect::<Vec<i16>>()
        };
        let (mut before, mut after) = (Vec::new(), Vec::new());
        for index in 0..500 {
            let mut frame = noise();
            if index >= 300 {
                before.extend_from_slice(&frame);
            }
            apm.process_capture(&mut frame, 0);
            if index >= 300 {
                after.extend_from_slice(&frame);
            }
        }
        let reduced = db(rms(&after), rms(&before));
        println!(
            "steady noise: {:.0} -> {:.0} rms, {reduced:.1} dB",
            rms(&before),
            rms(&after)
        );
        assert!(reduced < -6.0, "only {reduced:.1} dB");
    }

    #[test]
    fn gain_control_brings_up_a_quiet_talker() {
        let apm = Apm::new(only(false, false, true));
        let mut talker = Speechy::new(3);
        let (mut before, mut after) = (Vec::new(), Vec::new());
        // AGC2 adapts slowly on purpose.
        for index in 0..1500 {
            let mut frame = talker.frame(0.02);
            if index >= 1000 {
                before.extend_from_slice(&frame);
            }
            apm.process_capture(&mut frame, 0);
            if index >= 1000 {
                after.extend_from_slice(&frame);
            }
        }
        let gained = db(rms(&after), rms(&before));
        println!(
            "quiet talker: {:.0} -> {:.0} rms, {gained:.1} dB",
            rms(&before),
            rms(&after)
        );
        assert!(gained > 3.0, "only {gained:.1} dB");
    }

    /// Why the tone tests run with processing off.
    #[test]
    fn the_default_chain_damages_a_steady_tone() {
        let apm = Apm::new(AudioProcessing::default());
        let mut tone = crate::testing::ToneMic::new(523.0, 0.2);
        let (mut before, mut after) = (Vec::new(), Vec::new());
        for index in 0..500 {
            let mut frame = vec![0i16; FRAME_SAMPLES];
            tone.fill(&mut frame);
            if index >= 300 {
                before.extend_from_slice(&frame);
            }
            apm.process_capture(&mut frame, 0);
            if index >= 300 {
                after.extend_from_slice(&frame);
            }
        }
        let reduced = db(rms(&after), rms(&before));
        println!(
            "steady tone through defaults: {:.0} -> {:.0} rms, {reduced:.1} dB",
            rms(&before),
            rms(&after)
        );
        assert!(reduced < -6.0, "only {reduced:.1} dB");
    }

    #[test]
    fn off_is_a_passthrough() {
        let apm = Apm::new(AudioProcessing::OFF);
        let mut frame = vec![1234i16; FRAME_SAMPLES];
        apm.process_capture(&mut frame, 0);
        assert!(frame.iter().all(|sample| *sample == 1234));
    }
}
