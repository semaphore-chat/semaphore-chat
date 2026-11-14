//! W4: the settings page's mic test: the input's level for the meter, and optionally the mic played
//! back on the output (loopback), with the processing the call would use. Outside a call only:
//! joining one stops a running test (its `level()` is 0 from then on), so the test's streams and
//! the call's never run together and loopback can't feed the call.
//!
//! The level is the voice-activity level (`audio::vad::VoiceLevel`, 0..100) over 100, so the meter
//! and the threshold slider line up, as on the web. With loopback, what plays is handed to the
//! echo canceller as the far end, with the capture and render latencies as the call's mic gets
//! them, so a speaker next to the mic doesn't howl.

use crate::LiveKitEngine;
use crate::audio::apm::Apm;
use crate::audio::vad::VoiceLevel;
use crate::audio::{AudioStream, Chunker, ErrorCallback, FRAME_SAMPLES};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// 200 ms between the mic and the speakers at most; past that, the oldest goes.
const LOOPBACK_SAMPLES: usize = FRAME_SAMPLES * 20;

/// What the handle and the engine share: the engine stops it when a call starts.
pub(crate) struct TestShared {
    /// The level's `f32` bits, 0..100.
    level: AtomicU32,
    stopped: AtomicBool,
    /// The input first: it feeds the output's ring.
    streams: Mutex<Option<(AudioStream, Option<AudioStream>)>>,
}

impl TestShared {
    /// Closes the devices; from then on the level reads 0.
    pub(crate) fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        let streams = self
            .streams
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        drop(streams);
        self.level.store(0f32.to_bits(), Ordering::SeqCst);
    }
}

/// A running mic test. Dropping it stops the test and closes the mic (and the speakers).
pub struct InputTest {
    shared: Arc<TestShared>,
}

impl InputTest {
    /// The input's level now, 0.0 (silence) to 1.0, for `set_mic_level`. 0 once stopped.
    pub fn level(&self) -> f32 {
        if !self.is_running() {
            return 0.0;
        }
        f32::from_bits(self.shared.level.load(Ordering::Relaxed)) / 100.0
    }

    /// False once a call has started (or the test was otherwise stopped).
    pub fn is_running(&self) -> bool {
        !self.shared.stopped.load(Ordering::SeqCst)
    }
}

impl Drop for InputTest {
    fn drop(&mut self) {
        self.shared.stop();
    }
}

impl LiveKitEngine {
    /// Opens the selected input for a test. With `loopback`, it's also played on the selected
    /// output. Fails during a call, or when a device can't open, with why. A newer test stops an
    /// older one, as a call does.
    pub fn start_input_test(&self, loopback: bool) -> Result<InputTest, String> {
        let (io, input_device, output_device, processing, in_call) = self.input_test_setup();
        if in_call {
            return Err("the mic is in use by the call".into());
        }
        let apm = Arc::new(Apm::new(processing));
        let shared = Arc::new(TestShared {
            level: AtomicU32::new(0f32.to_bits()),
            stopped: AtomicBool::new(false),
            streams: Mutex::new(None),
        });
        let on_error: ErrorCallback = Arc::new(|error| log::warn!("mic test: {error}"));
        let render_latency = Arc::new(AtomicU32::new(0));

        let (output, mut ring) = if loopback {
            let (mut producer, mut consumer) = rtrb::RingBuffer::<i16>::new(LOOPBACK_SAMPLES);
            let far_end = apm.clone();
            let mut chunker = Chunker::new();
            let latency_out = render_latency.clone();
            let output = io.open_output(
                output_device.as_deref(),
                Box::new(move |out, latency| {
                    latency_out.store(latency, Ordering::Relaxed);
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

        let meter = Arc::downgrade(&shared);
        let mut voice = VoiceLevel::default();
        let mut chunker = Chunker::new();
        let input = io.open_input(
            input_device.as_deref(),
            Box::new(move |samples, capture_latency| {
                // As the call's mic: the APM's delay is both ways round.
                let delay = capture_latency + render_latency.load(Ordering::Relaxed);
                chunker.push(samples, |frame| {
                    apm.process_capture(frame, delay);
                    let level = voice.push(frame);
                    if let Some(shared) = meter.upgrade() {
                        shared.level.store(level.to_bits(), Ordering::Relaxed);
                    }
                    if let Some(push) = ring.as_mut() {
                        push(frame);
                    }
                });
            }),
            on_error,
        )?;
        *shared.streams.lock().unwrap_or_else(|p| p.into_inner()) = Some((input, output));
        self.track_input_test(&shared);
        Ok(InputTest { shared })
    }
}

#[cfg(test)]
mod tests {
    use crate::audio::apm::AudioProcessing;
    use crate::audio::virtual_io::VirtualIo;
    use crate::testing::{SpeakerTap, ToneMic};
    use crate::{EngineOptions, LiveKitEngine};
    use semaphore_core::platform::MediaEngine as _;
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
        // The loudest the output gets is the mic's own tone; wait until a whole window of it is
        // the tone (a run under load can start the speaker clock before the mic's, and a stalled
        // speaker drops samples, so early windows hold clicks and gaps at the same loudness).
        eventually("the speaker plays the mic's tone", || {
            tap.tone_at(440.0)
                .is_some_and(|(rms, share)| rms > 2000.0 && share > 0.5)
        });
        assert_eq!(io.open_streams(), 2);
        drop(test);
        eventually("both devices close", || io.open_streams() == 0);
        assert_eq!(io.opened_outputs().len(), 1);
    }

    #[test]
    fn joining_a_call_stops_the_mic_test() {
        let io = VirtualIo::new();
        let mut tone = ToneMic::new(440.0, 0.3);
        io.set_mic(Box::new(move |frame| tone.fill(frame)));
        let engine = engine(&io);
        let test = engine.start_input_test(true).unwrap();
        eventually("the test runs", || test.level() > 0.15);
        // Nothing listens there: the join fails, but joining at all ends the test.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let _ = runtime.block_on(engine.connect("ws://127.0.0.1:9".into(), "t".into(), 1));
        eventually("the test's devices close", || io.open_streams() == 0);
        assert_eq!(test.level(), 0.0);
        assert!(!test.is_running());
    }

    #[test]
    fn a_missing_device_says_why() {
        let io = VirtualIo::new();
        let engine = engine(&io);
        engine.select_input(Some("nope".into()));
        assert!(engine.start_input_test(false).is_err());
    }
}
