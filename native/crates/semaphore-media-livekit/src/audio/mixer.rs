//! Mixes remote tracks into the playout device, with one gain per person.

use super::apm::Apm;
use super::{Chunker, FRAME_SAMPLES};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// 200 ms: a scheduling hiccup shouldn't drop audio, and more than this is too late to be useful.
const RING_SAMPLES: usize = FRAME_SAMPLES * 20;
/// Past 60 ms queued, skip ahead. A track starts arriving before the device asks for it, and
/// without this that head start would become permanent latency.
const MAX_QUEUED_SAMPLES: usize = FRAME_SAMPLES * 6;

pub const DEFAULT_VOLUME_PERCENT: u32 = 100;
/// The web client's slider tops out here.
pub const MAX_VOLUME_PERCENT: u32 = 200;

struct Input {
    consumer: rtrb::Consumer<i16>,
    gain: Arc<AtomicU32>,
    /// The gain the last sample was played at, so a change ramps instead of clicking.
    last_gain: f32,
}

/// Fed by one track's stream task. Dropping it ends that input once it has drained.
pub struct MixerInput {
    producer: rtrb::Producer<i16>,
}

impl MixerInput {
    /// Drops what doesn't fit. Playout is the clock, so a full ring means nobody is listening.
    pub fn push(&mut self, samples: &[i16]) {
        let take = samples.len().min(self.producer.slots());
        if let Ok(mut chunk) = self.producer.write_chunk_uninit(take) {
            let (first, second) = chunk.as_mut_slices();
            let (head, tail) = samples[..take].split_at(first.len());
            for (slot, sample) in first.iter_mut().zip(head) {
                slot.write(*sample);
            }
            for (slot, sample) in second.iter_mut().zip(tail) {
                slot.write(*sample);
            }
            // SAFETY: both slices were fully written above.
            unsafe { chunk.commit_all() };
        }
    }
}

pub struct Mixer {
    /// Keyed by track sid: one person can have a mic and a screen-share track.
    inputs: Mutex<HashMap<String, Input>>,
    /// By identity, and outliving tracks, so a volume survives a reconnect.
    volumes: Mutex<HashMap<String, Arc<AtomicU32>>>,
    deafened: AtomicBool,
    render_state: Mutex<RenderState>,
}

struct RenderState {
    chunker: Chunker,
    scratch: Vec<i32>,
    apm: Option<Arc<Apm>>,
}

impl Default for Mixer {
    fn default() -> Self {
        Self {
            inputs: Mutex::default(),
            volumes: Mutex::default(),
            deafened: AtomicBool::new(false),
            render_state: Mutex::new(RenderState {
                chunker: Chunker::new(),
                scratch: Vec::new(),
                apm: None,
            }),
        }
    }
}

impl Mixer {
    pub fn set_apm(&self, apm: Option<Arc<Apm>>) {
        self.render_state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .apm = apm;
    }

    fn gain_cell(&self, identity: &str) -> Arc<AtomicU32> {
        self.volumes
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .entry(identity.to_owned())
            .or_insert_with(|| Arc::new(AtomicU32::new(DEFAULT_VOLUME_PERCENT)))
            .clone()
    }

    pub fn add_input(&self, track_sid: &str, identity: &str) -> MixerInput {
        let (producer, consumer) = rtrb::RingBuffer::new(RING_SAMPLES);
        let gain = self.gain_cell(identity);
        let last_gain = gain.load(Ordering::Relaxed) as f32 / 100.0;
        self.inputs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(
                track_sid.to_owned(),
                Input {
                    consumer,
                    gain,
                    last_gain,
                },
            );
        MixerInput { producer }
    }

    pub fn remove_input(&self, track_sid: &str) {
        self.inputs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(track_sid);
    }

    pub fn clear_inputs(&self) {
        self.inputs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
    }

    pub fn set_volume(&self, identity: &str, percent: u32) {
        self.gain_cell(identity)
            .store(percent.min(MAX_VOLUME_PERCENT), Ordering::Relaxed);
    }

    pub fn volume(&self, identity: &str) -> u32 {
        self.gain_cell(identity).load(Ordering::Relaxed)
    }

    pub fn set_deafened(&self, deafened: bool) {
        self.deafened.store(deafened, Ordering::Relaxed);
    }

    /// Called from the device thread, so it only ever waits on short critical sections.
    pub fn render(&self, out: &mut [i16]) {
        let deafened = self.deafened.load(Ordering::Relaxed);
        let mut state = self.render_state.lock().unwrap_or_else(|p| p.into_inner());
        let RenderState {
            chunker,
            scratch,
            apm,
        } = &mut *state;
        scratch.clear();
        scratch.resize(out.len(), 0);
        {
            let mut inputs = self.inputs.lock().unwrap_or_else(|p| p.into_inner());
            for input in inputs.values_mut() {
                let queued = input.consumer.slots();
                if queued > MAX_QUEUED_SAMPLES + out.len() {
                    let skip = queued - MAX_QUEUED_SAMPLES;
                    if let Ok(chunk) = input.consumer.read_chunk(skip) {
                        chunk.commit_all();
                    }
                }
                let take = out.len().min(input.consumer.slots());
                let target = input.gain.load(Ordering::Relaxed) as f32 / 100.0;
                let step = (target - input.last_gain) / out.len().max(1) as f32;
                let mut gain = input.last_gain;
                let Ok(chunk) = input.consumer.read_chunk(take) else {
                    continue;
                };
                for (mixed, sample) in scratch.iter_mut().zip(chunk) {
                    gain += step;
                    *mixed += (f32::from(sample) * gain) as i32;
                }
                input.last_gain = target;
            }
        }
        // Rings kept draining above while deafened: undeafening must not replay what was missed.
        for (slot, mixed) in out.iter_mut().zip(scratch.iter()) {
            *slot = if deafened {
                0
            } else {
                (*mixed).clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16
            };
        }
        // What the speakers actually play is what the mic could pick up, so that is what the echo
        // canceller gets to see, silence included.
        if let Some(apm) = apm.as_ref() {
            chunker.push(out, |frame| apm.process_render(frame));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(samples: &[i16]) -> f64 {
        let energy: f64 = samples.iter().map(|s| f64::from(*s).powi(2)).sum();
        (energy / samples.len() as f64).sqrt()
    }

    #[test]
    fn gain_scales_one_person_only_and_survives_their_track() {
        let mixer = Mixer::default();
        mixer.set_volume("a", 50);
        let mut a = mixer.add_input("TR_a", "a");
        a.push(&[10_000; 480]);
        let mut out = [0i16; 480];
        mixer.render(&mut out);
        assert_eq!(out[479], 5_000);

        mixer.remove_input("TR_a");
        let mut a2 = mixer.add_input("TR_a2", "a");
        let mut b = mixer.add_input("TR_b", "b");
        a2.push(&[10_000; 480]);
        b.push(&[1_000; 480]);
        mixer.render(&mut out);
        assert_eq!(out[479], 6_000, "a at 50% plus b at 100%");
    }

    #[test]
    fn boost_to_200_percent_clips_instead_of_wrapping() {
        let mixer = Mixer::default();
        mixer.set_volume("a", 500);
        assert_eq!(mixer.volume("a"), MAX_VOLUME_PERCENT);
        let mut a = mixer.add_input("TR_a", "a");
        a.push(&[30_000; 480]);
        let mut out = [0i16; 480];
        mixer.render(&mut out);
        assert_eq!(out[479], i16::MAX);
    }

    #[test]
    fn deafened_plays_silence_and_undeafening_does_not_replay_the_backlog() {
        let mixer = Mixer::default();
        let mut a = mixer.add_input("TR_a", "a");
        mixer.set_deafened(true);
        a.push(&[10_000; 480]);
        let mut out = [1i16; 480];
        mixer.render(&mut out);
        assert_eq!(rms(&out), 0.0);
        mixer.set_deafened(false);
        mixer.render(&mut out);
        assert_eq!(rms(&out), 0.0, "the deafened frame is gone");
    }

    #[test]
    fn a_track_that_started_early_does_not_keep_its_head_start_as_latency() {
        let mixer = Mixer::default();
        let mut a = mixer.add_input("TR_a", "a");
        a.push(&vec![1_000; RING_SAMPLES]);
        let mut out = [0i16; 480];
        mixer.render(&mut out);
        let inputs = mixer.inputs.lock().unwrap();
        assert!(inputs["TR_a"].consumer.slots() <= MAX_QUEUED_SAMPLES);
    }

    #[test]
    fn an_empty_ring_underruns_to_silence() {
        let mixer = Mixer::default();
        let _a = mixer.add_input("TR_a", "a");
        let mut out = [7i16; 480];
        mixer.render(&mut out);
        assert_eq!(rms(&out), 0.0);
    }
}
