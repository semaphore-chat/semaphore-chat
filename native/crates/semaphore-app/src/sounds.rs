//! The app's own sounds: the notification sounds the web plays (`useSound.ts`'s `channelMessage`,
//! `directMessage` and `mention`) and W4's call cues core decides (`CoreEvent::Sound`: joins,
//! leaves, connected, disconnected, the ring, call ended), from the same WAV files.
//!
//! - **Where they go:** through the call's [`AudioIo`] (cpal in the app, the rig's virtual device in
//!   rigs and tests, so nothing there reaches a real speaker), on the output the voice settings
//!   chose. Mono 48 kHz, as every `AudioIo` takes it.
//! - **The ring** loops on a stream of its own, every 3.5 s as on the web, until core stops it, so
//!   the other sounds neither cut it nor wait for it.
//! - **One at a time:** a new sound stops the one playing. A stream is opened per sound and dropped
//!   once it has played, so no device stays open between sounds.
//! - **Never in the way:** [`Sounds::play`] only queues for the sounds' own thread (opening a device
//!   can take a while). If opening fails, that is logged once and the app carries on silently.
//!
//! - **Previews** (W5, the soundboard tab's play button): a decoded sound ([`Sounds::play_pcm`]) on
//!   a stream of its own, so a message's sound doesn't cut it; one at a time, a new one replacing
//!   it, until it ends or [`Sounds::stop_preview`].
//!
//! The WAV reader is ours and small: RIFF with a `fmt ` chunk of 16-bit integer PCM, any rate and
//! channel count (mixed down, resampled linearly), which is what the bundled files are.

use semaphore_core::model::{NotifySound, SoundCue};
use semaphore_media_livekit::audio::{AudioIo, AudioStream, SAMPLE_RATE};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

const CHANNEL_MESSAGE: &[u8] = include_bytes!("../assets/sounds/pluck.wav");
const DIRECT_MESSAGE: &[u8] = include_bytes!("../assets/sounds/asc-minor-third.wav");
const MENTION: &[u8] = include_bytes!("../assets/sounds/asc-triad.wav");
const USER_JOINED: &[u8] = include_bytes!("../assets/sounds/asc-fourth.wav");
const USER_LEFT: &[u8] = include_bytes!("../assets/sounds/desc-fourth.wav");
const CONNECTED: &[u8] = include_bytes!("../assets/sounds/asc-fifth.wav");
const DISCONNECTED: &[u8] = include_bytes!("../assets/sounds/desc-fifth.wav");
const INCOMING_CALL: &[u8] = include_bytes!("../assets/sounds/asc-arpeggio.wav");
const CALL_ENDED: &[u8] = include_bytes!("../assets/sounds/desc-arpeggio.wav");

/// The file a notification sound plays, as the web maps them.
pub fn file_for(sound: NotifySound) -> &'static [u8] {
    match sound {
        NotifySound::Default => CHANNEL_MESSAGE,
        NotifySound::Dm => DIRECT_MESSAGE,
        NotifySound::Mention => MENTION,
    }
}

/// 16-bit PCM from a WAV file: its rate, and the samples mixed down to mono.
pub fn read_wav(bytes: &[u8]) -> Result<(u32, Vec<i16>), String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a RIFF WAVE file".into());
    }
    let u16_at = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let u32_at =
        |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let mut format: Option<(u16, u32)> = None;
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32_at(at + 4) as usize;
        let body = at + 8;
        let end = body.checked_add(size).filter(|&end| end <= bytes.len());
        let Some(end) = end else {
            return Err("a chunk runs past the end of the file".into());
        };
        match id {
            b"fmt " => {
                if size < 16 {
                    return Err("the fmt chunk is too short".into());
                }
                let (tag, channels, rate, bits) = (
                    u16_at(body),
                    u16_at(body + 2),
                    u32_at(body + 4),
                    u16_at(body + 14),
                );
                // 1: integer PCM. 0xFFFE (extensible) is PCM too when it says so; ours aren't.
                if tag != 1 || bits != 16 || channels == 0 || rate == 0 {
                    return Err(format!(
                        "only 16-bit PCM is read (format {tag}, {bits} bits, {channels} channels)"
                    ));
                }
                format = Some((channels, rate));
            }
            b"data" => {
                let Some((channels, rate)) = format else {
                    return Err("the data chunk comes before fmt".into());
                };
                let channels = usize::from(channels);
                let frames = size / (2 * channels);
                let samples = (0..frames)
                    .map(|frame| {
                        let sum: i32 = (0..channels)
                            .map(|channel| {
                                let at = body + (frame * channels + channel) * 2;
                                i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]))
                            })
                            .sum();
                        (sum / channels as i32) as i16
                    })
                    .collect();
                return Ok((rate, samples));
            }
            _ => {}
        }
        // Chunks are padded to an even size.
        at = end + (size & 1);
    }
    Err("no data chunk".into())
}

/// `samples` at `from` Hz, at `to` Hz, by linear interpolation.
pub fn resample(samples: &[i16], from: u32, to: u32) -> Vec<i16> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let out_len = (samples.len() as u64 * u64::from(to) / u64::from(from)) as usize;
    let step = f64::from(from) / f64::from(to);
    (0..out_len)
        .map(|index| {
            let position = index as f64 * step;
            let left = position.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let fraction = position - left as f64;
            let value =
                f64::from(samples[left]) * (1. - fraction) + f64::from(samples[right]) * fraction;
            value.round() as i16
        })
        .collect()
}

/// What the sounds' thread plays: a notification's sound or one of core's cues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Sound {
    Notify(NotifySound),
    Cue(SoundCue),
}

/// Every sound with a file, for decoding once at the thread's start.
const ALL: [Sound; 9] = [
    Sound::Notify(NotifySound::Default),
    Sound::Notify(NotifySound::Dm),
    Sound::Notify(NotifySound::Mention),
    Sound::Cue(SoundCue::UserJoined),
    Sound::Cue(SoundCue::UserLeft),
    Sound::Cue(SoundCue::Connected),
    Sound::Cue(SoundCue::Disconnected),
    Sound::Cue(SoundCue::IncomingRingStart),
    Sound::Cue(SoundCue::CallEnded),
];

/// The file a sound plays, as the web's `useSound.ts` maps them. `IncomingRingStop` has none: it
/// stops the ring.
pub fn sound_file(sound: Sound) -> Option<&'static [u8]> {
    Some(match sound {
        Sound::Notify(sound) => file_for(sound),
        Sound::Cue(SoundCue::UserJoined) => USER_JOINED,
        Sound::Cue(SoundCue::UserLeft) => USER_LEFT,
        Sound::Cue(SoundCue::Connected) => CONNECTED,
        Sound::Cue(SoundCue::Disconnected) => DISCONNECTED,
        Sound::Cue(SoundCue::IncomingRingStart) => INCOMING_CALL,
        Sound::Cue(SoundCue::CallEnded) => CALL_ENDED,
        Sound::Cue(SoundCue::IncomingRingStop) => return None,
    })
}

/// How often the ring starts again while a call rings: the web's `RING_INTERVAL_MS`.
pub const RING_PERIOD_MS: u64 = 3_500;

/// A bundled sound, ready for an `AudioIo`.
fn clip(sound: Sound) -> Arc<[i16]> {
    let Some(bytes) = sound_file(sound) else {
        return Arc::from(Vec::new());
    };
    match read_wav(bytes) {
        Ok((rate, samples)) => resample(&samples, rate, SAMPLE_RATE).into(),
        Err(error) => {
            log::warn!("sounds: the bundled {sound:?} sound can't be read: {error}");
            Arc::from(Vec::new())
        }
    }
}

enum Command {
    Play {
        sound: Sound,
        device: Option<String>,
    },
    /// The ring, again every `RING_PERIOD_MS` until `StopRing`, beside whatever else plays.
    Ring {
        device: Option<String>,
    },
    StopRing,
    /// The stream of this play has given all its samples.
    Done(u64),
    /// A decoded sound (48 kHz mono) on the preview's own stream, replacing the one there.
    Preview {
        id: u64,
        samples: Arc<[i16]>,
        device: Option<String>,
    },
    StopPreview,
    /// The preview `id` has given all its samples.
    PreviewDone(u64),
    Quit,
}

/// Plays the app's sounds. See the module docs.
pub struct Sounds {
    commands: mpsc::Sender<Command>,
    /// Core's cues as they were asked for, for the rig: (cue, times).
    played: Mutex<Vec<(SoundCue, usize)>>,
    ringing: AtomicBool,
    /// The preview playing (0: none), cleared by the thread once it has played out.
    preview: Arc<AtomicU64>,
    /// Previews asked for, for the rig.
    previews: AtomicUsize,
    next_preview: AtomicU64,
}

impl Sounds {
    pub fn start(io: Arc<dyn AudioIo>) -> Self {
        let (commands, receiver) = mpsc::channel();
        let looped = commands.clone();
        let preview = Arc::new(AtomicU64::new(0));
        let playing = preview.clone();
        let spawned = std::thread::Builder::new()
            .name("sounds".into())
            .spawn(move || run(io, looped, receiver, playing));
        if let Err(error) = spawned {
            log::warn!("sounds: cannot start their thread: {error}");
        }
        Self {
            commands,
            played: Mutex::default(),
            ringing: AtomicBool::new(false),
            preview,
            previews: AtomicUsize::new(0),
            next_preview: AtomicU64::new(1),
        }
    }

    /// A decoded sound, `samples` of mono at `rate` Hz, on `device` (`None`: the default output):
    /// the soundboard's preview. It replaces the preview playing, and plays beside the other
    /// sounds. Nothing (empty, or no rate) stops the one playing.
    pub fn play_pcm(&self, rate: u32, samples: &[i16], device: Option<String>) {
        if rate == 0 || samples.is_empty() {
            self.stop_preview();
            return;
        }
        let id = self.next_preview.fetch_add(1, Ordering::Relaxed);
        self.previews.fetch_add(1, Ordering::Relaxed);
        self.preview.store(id, Ordering::Relaxed);
        let samples: Arc<[i16]> = resample(samples, rate, SAMPLE_RATE).into();
        let _ = self.commands.send(Command::Preview {
            id,
            samples,
            device,
        });
    }

    /// Stops the preview, if one plays: leaving the soundboard tab, signing out.
    pub fn stop_preview(&self) {
        self.preview.store(0, Ordering::Relaxed);
        let _ = self.commands.send(Command::StopPreview);
    }

    /// A preview is playing.
    pub fn previewing(&self) -> bool {
        self.preview.load(Ordering::Relaxed) != 0
    }

    /// How many previews were asked for.
    pub fn previews(&self) -> usize {
        self.previews.load(Ordering::Relaxed)
    }

    /// Plays `sound` on `device` (`None`: the default output), stopping any sound playing.
    pub fn play(&self, sound: NotifySound, device: Option<String>) {
        let _ = self.commands.send(Command::Play {
            sound: Sound::Notify(sound),
            device,
        });
    }

    /// Core's cue (`CoreEvent::Sound`): a one-shot sound, or the ring started or stopped. The ring
    /// plays beside the one-shot sounds, so a message's sound doesn't cut it.
    pub fn cue(&self, cue: SoundCue, device: Option<String>) {
        {
            let mut played = self.played.lock().unwrap_or_else(|p| p.into_inner());
            match played.iter_mut().find(|(seen, _)| *seen == cue) {
                Some((_, times)) => *times += 1,
                None => played.push((cue, 1)),
            }
        }
        let command = match cue {
            SoundCue::IncomingRingStart => {
                self.ringing.store(true, Ordering::Relaxed);
                Command::Ring { device }
            }
            SoundCue::IncomingRingStop => {
                self.ringing.store(false, Ordering::Relaxed);
                Command::StopRing
            }
            cue => Command::Play {
                sound: Sound::Cue(cue),
                device,
            },
        };
        let _ = self.commands.send(command);
    }

    /// Stops the ring whatever core said last: signed out.
    pub fn stop_ring(&self) {
        self.ringing.store(false, Ordering::Relaxed);
        let _ = self.commands.send(Command::StopRing);
    }

    /// How often `cue` was asked for.
    pub fn played(&self, cue: SoundCue) -> usize {
        self.played
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .find(|(seen, _)| *seen == cue)
            .map_or(0, |(_, times)| *times)
    }

    /// The ring is looping.
    pub fn ringing(&self) -> bool {
        self.ringing.load(Ordering::Relaxed)
    }
}

impl Drop for Sounds {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Quit);
    }
}

fn run(
    io: Arc<dyn AudioIo>,
    commands: mpsc::Sender<Command>,
    receiver: mpsc::Receiver<Command>,
    previewing: Arc<AtomicU64>,
) {
    let clips: Vec<(Sound, Arc<[i16]>)> =
        ALL.into_iter().map(|sound| (sound, clip(sound))).collect();
    let samples_of = |sound: Sound| {
        clips
            .iter()
            .find(|(kind, _)| *kind == sound)
            .map(|(_, samples)| samples.clone())
            .filter(|samples| !samples.is_empty())
    };
    let mut playing: Option<(u64, AudioStream)> = None;
    let mut ring: Option<AudioStream> = None;
    let mut preview: Option<(u64, AudioStream)> = None;
    let mut plays = 0u64;
    let mut warned = false;
    let on_error: semaphore_media_livekit::audio::ErrorCallback =
        Arc::new(|error| log::debug!("sounds: the output stopped: {error}"));
    let mut open =
        |device: Option<&str>, feed: semaphore_media_livekit::audio::OutputCallback| match io
            .open_output(device, feed, on_error.clone())
        {
            Ok(stream) => Some(stream),
            Err(error) => {
                if !warned {
                    warned = true;
                    log::warn!("sounds: no output for the app's sounds: {error}");
                }
                None
            }
        };
    for command in receiver {
        match command {
            Command::Quit => break,
            Command::Done(play) => {
                if playing
                    .as_ref()
                    .is_some_and(|(current, _)| *current == play)
                {
                    playing = None;
                }
            }
            Command::StopRing => drop(ring.take()),
            Command::StopPreview => drop(preview.take()),
            Command::PreviewDone(id) => {
                if preview.as_ref().is_some_and(|(current, _)| *current == id) {
                    preview = None;
                }
                // Unless another has started since.
                let _ = previewing.compare_exchange(id, 0, Ordering::Relaxed, Ordering::Relaxed);
            }
            Command::Preview {
                id,
                samples,
                device,
            } => {
                drop(preview.take());
                let done = commands.clone();
                let mut position = 0usize;
                let mut told = false;
                let feed = Box::new(move |out: &mut [i16], _ahead: u32| {
                    for sample in out.iter_mut() {
                        *sample = samples.get(position).copied().unwrap_or(0);
                        position += 1;
                    }
                    if position >= samples.len() && !told {
                        told = true;
                        let _ = done.send(Command::PreviewDone(id));
                    }
                });
                match open(device.as_deref(), feed) {
                    Some(stream) => preview = Some((id, stream)),
                    None => {
                        let _ = previewing.compare_exchange(
                            id,
                            0,
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                        );
                    }
                }
            }
            Command::Ring { device } => {
                drop(ring.take());
                let Some(samples) = samples_of(Sound::Cue(SoundCue::IncomingRingStart)) else {
                    continue;
                };
                let period = (SAMPLE_RATE as u64 * RING_PERIOD_MS / 1000) as usize;
                let period = period.max(samples.len());
                let mut position = 0usize;
                let feed = Box::new(move |out: &mut [i16], _ahead: u32| {
                    for sample in out.iter_mut() {
                        *sample = samples.get(position).copied().unwrap_or(0);
                        position = (position + 1) % period;
                    }
                });
                if let Some(stream) = open(device.as_deref(), feed) {
                    drop(ring.replace(stream));
                }
            }
            Command::Play { sound, device } => {
                // One at a time: the last one stops first.
                playing = None;
                plays += 1;
                let play = plays;
                let Some(samples) = samples_of(sound) else {
                    continue;
                };
                let done = commands.clone();
                let mut position = 0usize;
                let mut told = false;
                let feed = Box::new(move |out: &mut [i16], _ahead: u32| {
                    for sample in out.iter_mut() {
                        *sample = samples.get(position).copied().unwrap_or(0);
                        position += 1;
                    }
                    if position >= samples.len() && !told {
                        told = true;
                        let _ = done.send(Command::Done(play));
                    }
                });
                if let Some(stream) = open(device.as_deref(), feed) {
                    playing = Some((play, stream));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_media_livekit::audio::virtual_io::VirtualIo;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    fn wav(channels: u16, rate: u32, samples: &[i16]) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * u32::from(channels) * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        // An odd-sized chunk we skip, padded.
        out.extend_from_slice(b"LIST");
        out.extend_from_slice(&3u32.to_le_bytes());
        out.extend_from_slice(&[1, 2, 3, 0]);
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn the_bundled_sounds_read_as_mono_16_bit_at_44_1_khz() {
        for (sound, bytes) in [
            (NotifySound::Default, 14112),
            (NotifySound::Dm, 23814),
            (NotifySound::Mention, 30870),
        ] {
            let (rate, samples) = read_wav(file_for(sound)).unwrap();
            assert_eq!(rate, 44_100);
            assert_eq!(samples.len(), bytes / 2, "{sound:?}");
            assert!(samples.iter().any(|&s| s != 0), "{sound:?} is silent");
        }
    }

    #[test]
    fn every_cue_but_the_ring_stop_has_a_readable_sound() {
        for sound in ALL {
            let (_, samples) = read_wav(sound_file(sound).unwrap()).unwrap();
            assert!(samples.iter().any(|&s| s != 0), "{sound:?} is silent");
        }
        assert!(sound_file(Sound::Cue(SoundCue::IncomingRingStop)).is_none());
    }

    /// The ring has a stream of its own: a message's sound beside it opens another, and the ring
    /// keeps going (it gives sound again after its period) until it's stopped.
    #[test]
    fn the_ring_loops_beside_other_sounds_until_stopped() {
        let io = Arc::new(VirtualIo::new());
        let heard = Arc::new(Mutex::new(0usize));
        let counter = heard.clone();
        io.set_speaker(Box::new(move |frame: &[i16]| {
            *counter.lock().unwrap() += frame.iter().filter(|&&s| s != 0).count();
        }));
        let sounds = Sounds::start(io.clone());
        sounds.cue(SoundCue::IncomingRingStart, None);
        sounds.play(NotifySound::Dm, None);
        assert!(sounds.ringing());
        assert_eq!(sounds.played(SoundCue::IncomingRingStart), 1);
        let deadline = Instant::now() + Duration::from_secs(10);
        while io.opened_outputs().len() < 2 {
            assert!(
                Instant::now() < deadline,
                "the ring and the sound didn't both open"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        sounds.cue(SoundCue::IncomingRingStop, None);
        assert!(!sounds.ringing());
        assert_eq!(sounds.played(SoundCue::IncomingRingStop), 1);
        assert_eq!(sounds.played(SoundCue::Connected), 0);
    }

    #[test]
    fn stereo_is_mixed_down_and_odd_chunks_are_skipped() {
        let (rate, samples) = read_wav(&wav(2, 8000, &[100, 300, -50, -150])).unwrap();
        assert_eq!((rate, samples), (8000, vec![200, -100]));
    }

    #[test]
    fn what_is_not_16_bit_pcm_is_refused() {
        assert!(read_wav(b"nope").is_err());
        let mut eight_bit = wav(1, 8000, &[1, 2]);
        eight_bit[34] = 8;
        assert!(read_wav(&eight_bit).unwrap_err().contains("16-bit"));
        let mut short = wav(1, 8000, &[1, 2]);
        short.truncate(short.len() - 1);
        assert!(read_wav(&short).unwrap_err().contains("past the end"));
    }

    #[test]
    fn resampling_keeps_the_length_in_proportion_and_the_ends() {
        let up = resample(&[0, 1000, 2000, 3000], 44_100, 48_000);
        assert_eq!(up.len(), 4);
        assert_eq!((up[0], *up.last().unwrap()), (0, 2756));
        let ramp: Vec<i16> = (0..441).map(|i| i as i16).collect();
        let out = resample(&ramp, 44_100, 48_000);
        assert_eq!(out.len(), 480);
        assert!(out.windows(2).all(|pair| pair[0] <= pair[1]));
        assert_eq!(resample(&ramp, 48_000, 48_000), ramp);
    }

    /// A preview plays on a stream of its own (on the device asked for), a new one replaces it,
    /// and it ends by itself or when stopped.
    #[test]
    fn a_preview_plays_once_replaces_the_last_and_stops() {
        let io = Arc::new(VirtualIo::new());
        let heard = Arc::new(Mutex::new(0usize));
        let counter = heard.clone();
        io.set_speaker(Box::new(move |frame: &[i16]| {
            *counter.lock().unwrap() += frame.iter().filter(|&&s| s != 0).count();
        }));
        let sounds = Sounds::start(io.clone());
        let wait = |what: &str, done: &dyn Fn() -> bool| {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !done() {
                assert!(Instant::now() < deadline, "{what}");
                std::thread::sleep(Duration::from_millis(10));
            }
        };
        // 0.1 s at 24 kHz: resampled to 48 kHz, played, then done by itself.
        sounds.play_pcm(24_000, &[1000; 2_400], None);
        assert!(sounds.previewing());
        wait("the preview never played", &|| {
            *heard.lock().unwrap() >= 4_000
        });
        wait("the preview never ended", &|| !sounds.previewing());
        assert_eq!(sounds.previews(), 1);
        // A long one, replaced by another on the device asked for, then stopped.
        sounds.play_pcm(48_000, &[1000; 480_000], None);
        sounds.play_pcm(48_000, &[1000; 480_000], Some("spk-0".into()));
        assert!(sounds.previewing());
        wait("both previews didn't open", &|| {
            io.opened_outputs().len() >= 3
        });
        assert_eq!(io.opened_outputs().last(), Some(&Some("spk-0".to_owned())));
        sounds.stop_preview();
        assert!(!sounds.previewing());
        assert_eq!(sounds.previews(), 3);
        // Nothing to play stops what plays and counts as no preview.
        sounds.play_pcm(48_000, &[], None);
        sounds.play_pcm(0, &[1], None);
        assert_eq!(sounds.previews(), 3);
        assert!(!sounds.previewing());
    }

    /// The virtual device, never a real one: what it heard, until it has heard `count` samples
    /// that aren't silence.
    #[test]
    fn a_sound_plays_on_the_virtual_device_and_a_failing_device_is_quiet() {
        let io = Arc::new(VirtualIo::new());
        let heard = Arc::new(Mutex::new(0usize));
        let counter = heard.clone();
        io.set_speaker(Box::new(move |frame: &[i16]| {
            *counter.lock().unwrap() += frame.iter().filter(|&&s| s != 0).count();
        }));
        let sounds = Sounds::start(io.clone());
        sounds.play(NotifySound::Dm, Some("no-such-device".into()));
        sounds.play(NotifySound::Dm, None);
        let deadline = Instant::now() + Duration::from_secs(10);
        while *heard.lock().unwrap() < 1000 {
            assert!(Instant::now() < deadline, "the sound never played");
            std::thread::sleep(Duration::from_millis(10));
        }
        // The one on the missing device was refused (logged once); only the default output opened.
        assert_eq!(io.opened_outputs(), vec![None]);
    }
}
