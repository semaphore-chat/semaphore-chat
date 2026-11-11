//! W4: the settings page's mic test: the input's level for the meter, and optionally the mic played
//! back on the output (loopback), with the processing the call would use. Outside a call only.
//!
//! The level is the voice-activity level (`audio::vad::VoiceLevel`, 0..100) over 100, so the meter
//! and the threshold slider line up, as on the web. With loopback, what plays is handed to the
//! echo canceller as the far end, so a speaker next to the mic doesn't howl.

use crate::LiveKitEngine;
use crate::audio::apm::Apm;
use crate::audio::vad::VoiceLevel;
use crate::audio::{AudioStream, Chunker, ErrorCallback, FRAME_SAMPLES};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// 200 ms between the mic and the speakers at most; past that, the oldest goes.
const LOOPBACK_SAMPLES: usize = FRAME_SAMPLES * 20;

/// A running mic test. Dropping it stops the test and closes the mic (and the speakers).
pub struct InputTest {
    level: Arc<AtomicU32>,
    // The input first: it feeds the output's ring.
    _input: AudioStream,
    _output: Option<AudioStream>,
}

impl InputTest {
    /// The input's level now, 0.0 (silence) to 1.0, for `set_mic_level`.
    pub fn level(&self) -> f32 {
        self.level.load(Ordering::Relaxed) as f32 / 100.0
    }
}

impl LiveKitEngine {
    /// Opens the selected input for a test. With `loopback`, it's also played on the selected
    /// output. Fails during a call, or when a device can't open, with why.
    pub fn start_input_test(&self, loopback: bool) -> Result<InputTest, String> {
        let (io, input_device, output_device, processing, in_call) = self.input_test_setup();
        if in_call {
            return Err("the mic is in use by the call".into());
        }
        let apm = Arc::new(Apm::new(processing));
        let level = Arc::new(AtomicU32::new(0));
        let on_error: ErrorCallback = Arc::new(|error| log::warn!("mic test: {error}"));

        let (output, mut ring) = if loopback {
            let (mut producer, mut consumer) = rtrb::RingBuffer::<i16>::new(LOOPBACK_SAMPLES);
            let far_end = apm.clone();
            let mut chunker = Chunker::new();
            let output = io.open_output(
                output_device.as_deref(),
                Box::new(move |out, _latency| {
                    for slot in out.iter_mut() {
                        *slot = consumer.pop().unwrap_or(0);
                    }
                    chunker.push(out, |frame| far_end.process_render(frame));
                }),
                on_error.clone(),
            )?;
            // On the mic's thread. Only the speakers' side can drop the oldest, so a full ring
            // (the speakers stalled) drops the newest instead.
            let push = move |frame: &[i16]| {
                for &sample in frame {
                    if producer.push(sample).is_err() {
                        break;
                    }
                }
            };
            (Some(output), Some(push))
        } else {
            (None, None)
        };

        let meter = level.clone();
        let mut voice = VoiceLevel::default();
        let mut chunker = Chunker::new();
        let input = io.open_input(
            input_device.as_deref(),
            Box::new(move |samples, latency| {
                chunker.push(samples, |frame| {
                    apm.process_capture(frame, latency);
                    meter.store(u32::from(voice.push(frame)), Ordering::Relaxed);
                    if let Some(push) = ring.as_mut() {
                        push(frame);
                    }
                });
            }),
            on_error,
        )?;
        Ok(InputTest {
            level,
            _input: input,
            _output: output,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::audio::apm::AudioProcessing;
    use crate::audio::virtual_io::VirtualIo;
    use crate::testing::{SpeakerTap, ToneMic};
    use crate::{EngineOptions, LiveKitEngine};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn engine(io: &VirtualIo) -> LiveKitEngine {
        LiveKitEngine::new(EngineOptions {
            audio_io: Arc::new(io.clone()),
            // A steady tone is "noise" to noise suppression.
            processing: AudioProcessing::OFF,
            ..EngineOptions::default()
        })
    }

    /// Polls `check` until it holds, for at most 5 s.
    fn eventually(what: &str, mut check: impl FnMut() -> bool) {
        let started = Instant::now();
        while !check() {
            assert!(started.elapsed() < Duration::from_secs(5), "{what}");
            // A bounded poll of the condition.
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn the_meter_follows_the_mic_and_nothing_plays_without_loopback() {
        let io = VirtualIo::new();
        let mut tone = ToneMic::new(440.0, 0.3);
        io.set_mic(Box::new(move |frame| tone.fill(frame)));
        let engine = engine(&io);
        let test = engine.start_input_test(false).unwrap();
        // A 0.3 tone at 440 Hz is about 24 on the web's scale.
        eventually("the level rises", || test.level() > 0.15);
        assert!(test.level() <= 1.0);
        assert_eq!(io.opened_inputs().len(), 1);
        assert!(io.opened_outputs().is_empty());
    }

    #[test]
    fn loopback_plays_the_mic_and_dropping_it_closes_both() {
        let io = VirtualIo::new();
        let mut tone = ToneMic::new(440.0, 0.3);
        io.set_mic(Box::new(move |frame| tone.fill(frame)));
        let tap = SpeakerTap::new(4800);
        let speaker = tap.clone();
        io.set_speaker(Box::new(move |frame| speaker.push(frame)));
        let engine = engine(&io);
        let test = engine.start_input_test(true).unwrap();
        eventually("the speaker plays the mic", || tap.rms_at(440.0) > 2000.0);
        assert!(tap.share_at(440.0) > 0.5);
        assert_eq!(io.open_streams(), 2);
        drop(test);
        eventually("both devices close", || io.open_streams() == 0);
        assert_eq!(io.opened_outputs().len(), 1);
    }

    #[test]
    fn a_missing_device_says_why() {
        let io = VirtualIo::new();
        let engine = engine(&io);
        engine.select_input(Some("nope".into()));
        assert!(engine.start_input_test(false).is_err());
    }
}
