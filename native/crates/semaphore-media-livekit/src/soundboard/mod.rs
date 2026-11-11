//! W4: soundboard sounds, decoded and played on a track of their own.
//!
//! **Decoding.** Built in, with nothing added to the build: WAV (`wav`), Ogg Opus (`ogg`) and WebM
//! Opus (`webm`), the last two through the libopus libwebrtc already links (`opus`). MP3, AAC and
//! Vorbis need a [`SoundDecoder`] from the app (`EngineOptions::sound_decoder`), which the player
//! feature provides; without one they're refused with a sentence that names the format. The files
//! come from the server, so every parser checks every offset, and sizes, rates, channel counts
//! and lengths are capped before anything is allocated for them.
//!
//! **Playing.** One 10 ms frame at a time, paced by a timer, to the `soundboard` track's source
//! and to the mixer (so we hear it too, it follows deafen, and the echo canceller knows it). The
//! track is published on the first play of a call and stays for the call, as on the web.

mod ogg;
mod opus;
mod wav;
mod webm;

use crate::audio::FRAME_SAMPLES;
use crate::audio::SAMPLE_RATE;
use crate::audio::mixer::MixerInput;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// The web's `SOUNDBOARD_TRACK_NAME`: remote clients find the track by it.
pub const TRACK_NAME: &str = "soundboard";

/// The server takes at most 1 MiB; this leaves room and still bounds the work.
const MAX_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_SECONDS: u32 = 120;
pub(crate) const MIN_RATE: u32 = 8_000;
pub(crate) const MAX_RATE: u32 = 192_000;
pub(crate) const MAX_CHANNELS: u16 = 8;
/// Decoded sounds kept, by bytes of 48 kHz mono: about 5.8 minutes.
const CACHE_BYTES: usize = 32 * 1024 * 1024;

/// Decoded audio: interleaved samples in -1.0..=1.0.
#[derive(Debug, Clone, PartialEq)]
pub struct Pcm {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
}

/// Decodes what the built-in decoders don't (MP3, AAC, Vorbis). Called on a blocking thread with
/// the sound's file as uploaded; the engine checks and converts what it returns.
pub trait SoundDecoder: Send + Sync {
    fn decode(&self, bytes: &[u8]) -> Result<Pcm, String>;
}

#[derive(Debug, PartialEq)]
pub(crate) enum DecodeError {
    /// A real format we don't decode built in, by name.
    Unsupported(&'static str),
    /// Damaged, or not what it says, and why.
    Invalid(String),
    TooLong,
}

/// A built-in decoder.
type Decode = fn(&[u8]) -> Result<Pcm, DecodeError>;

fn sniff(bytes: &[u8]) -> Result<Decode, DecodeError> {
    let starts = |magic: &[u8]| bytes.starts_with(magic);
    if starts(b"RIFF") && bytes.get(8..12) == Some(b"WAVE") {
        return Ok(wav::decode);
    }
    if starts(b"OggS") {
        return Ok(ogg::decode);
    }
    if starts(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Ok(webm::decode);
    }
    if starts(b"ID3") {
        return Err(DecodeError::Unsupported("MP3"));
    }
    if bytes.get(4..8) == Some(b"ftyp") {
        return Err(DecodeError::Unsupported("AAC (M4A)"));
    }
    if let [0xFF, second, ..] = bytes
        && second & 0xE0 == 0xE0
    {
        // MPEG audio sync. Layer bits 00 are ADTS, which is AAC; the others are MP3's layers.
        return Err(DecodeError::Unsupported(if second & 0x06 == 0 {
            "AAC"
        } else {
            "MP3"
        }));
    }
    Err(DecodeError::Invalid(
        "it isn't a sound file this app knows".into(),
    ))
}

/// The sound as 48 kHz mono, or a sentence for the user.
pub(crate) fn decode(bytes: &[u8], extra: Option<&dyn SoundDecoder>) -> Result<Arc<[i16]>, String> {
    if bytes.len() > MAX_BYTES {
        return Err("This sound's file is too big to play".into());
    }
    let built_in = sniff(bytes).and_then(|decode| decode(bytes));
    let result = match (built_in, extra) {
        (Err(DecodeError::Unsupported(_)), Some(extra)) => match extra.decode(bytes) {
            Ok(pcm) => normalize(pcm),
            Err(why) => Err(DecodeError::Invalid(why)),
        },
        (built_in, _) => built_in.and_then(normalize),
    };
    result.map_err(|error| match error {
        DecodeError::Unsupported(name) => {
            format!("This sound is {name}, which this build of the app can't play")
        }
        DecodeError::Invalid(why) => format!("This sound can't be played: {why}"),
        DecodeError::TooLong => {
            format!("This sound is longer than {} minutes", MAX_SECONDS / 60)
        }
    })
}

/// Mixes down to mono and resamples (linearly: these are short effects) to 48 kHz.
fn normalize(pcm: Pcm) -> Result<Arc<[i16]>, DecodeError> {
    let channels = usize::from(pcm.channels);
    if channels == 0 || pcm.channels > MAX_CHANNELS {
        return Err(DecodeError::Invalid(
            "it has an impossible channel count".into(),
        ));
    }
    if !(MIN_RATE..=MAX_RATE).contains(&pcm.sample_rate) {
        return Err(DecodeError::Invalid(
            "it has an impossible sample rate".into(),
        ));
    }
    let frames = pcm.samples.len() / channels;
    if frames == 0 {
        return Err(DecodeError::Invalid("it has no audio".into()));
    }
    if frames > MAX_SECONDS as usize * pcm.sample_rate as usize {
        return Err(DecodeError::TooLong);
    }
    let mono: Vec<f32> = pcm
        .samples
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    let to_i16 = |sample: f32| {
        let sample = if sample.is_finite() { sample } else { 0.0 };
        (sample * 32_767.0).clamp(-32_768.0, 32_767.0) as i16
    };
    if pcm.sample_rate == SAMPLE_RATE {
        return Ok(mono.into_iter().map(to_i16).collect());
    }
    let step = f64::from(pcm.sample_rate) / f64::from(SAMPLE_RATE);
    let out_len = (frames as f64 / step).ceil() as usize;
    Ok((0..out_len)
        .map(|i| {
            let position = i as f64 * step;
            let index = position as usize;
            let fraction = (position - index as f64) as f32;
            let a = mono[index.min(frames - 1)];
            let b = mono[(index + 1).min(frames - 1)];
            to_i16(a + (b - a) * fraction)
        })
        .collect())
}

/// Decoded sounds by id, least recently played out first.
#[derive(Default)]
pub(crate) struct SoundCache {
    entries: HashMap<String, (Arc<[i16]>, u64)>,
    bytes: usize,
    clock: u64,
}

impl SoundCache {
    pub(crate) fn get(&mut self, id: &str) -> Option<Arc<[i16]>> {
        self.clock += 1;
        let clock = self.clock;
        self.entries.get_mut(id).map(|(sound, used)| {
            *used = clock;
            sound.clone()
        })
    }

    pub(crate) fn insert(&mut self, id: String, sound: Arc<[i16]>) {
        let size = sound.len() * 2;
        if size > CACHE_BYTES {
            return;
        }
        if let Some((old, _)) = self.entries.remove(&id) {
            self.bytes -= old.len() * 2;
        }
        while self.bytes + size > CACHE_BYTES {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, used))| *used)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            if let Some((old, _)) = self.entries.remove(&oldest) {
                self.bytes -= old.len() * 2;
            }
        }
        self.clock += 1;
        self.bytes += size;
        self.entries.insert(id, (sound, self.clock));
    }
}

/// Plays `sound` to the track's source and the local mixer, in real time, then returns.
pub(crate) async fn play(source: NativeAudioSource, sound: Arc<[i16]>, mut monitor: MixerInput) {
    let mut tick = tokio::time::interval(Duration::from_millis(10));
    // A late tick catches up, so the sound keeps its length.
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    for chunk in sound.chunks(FRAME_SAMPLES) {
        tick.tick().await;
        let mut frame = chunk.to_vec();
        frame.resize(FRAME_SAMPLES, 0);
        monitor.push(&frame);
        let frame = AudioFrame {
            data: Cow::Owned(frame),
            sample_rate: SAMPLE_RATE,
            num_channels: 1,
            samples_per_channel: FRAME_SAMPLES as u32,
        };
        if let Err(error) = source.capture_frame(&frame).await {
            log::warn!("soundboard frame refused: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(Result<Pcm, String>);

    impl SoundDecoder for Fake {
        fn decode(&self, _bytes: &[u8]) -> Result<Pcm, String> {
            self.0.clone()
        }
    }

    const MP3: &[u8] = b"ID3\x04\0\0\0\0\0\0";

    #[test]
    fn built_in_formats_decode_to_48k_mono() {
        let wav = wav::tests::wav16(2, 24_000, &[1000, 3000, 1000, 3000]);
        let sound = decode(&wav, None).unwrap();
        // Two frames at 24 kHz are four at 48 kHz, each the mix of the two channels.
        assert_eq!(sound.len(), 4);
        assert!(
            sound.iter().all(|&s| (1999..=2001).contains(&s)),
            "{sound:?}"
        );
        assert_eq!(
            decode(&ogg::tests::ogg_opus(2), None).unwrap().len(),
            24_000
        );
        assert!(decode(&webm::tests::webm_opus(b"A_OPUS", 0x80, false), None).is_ok());
    }

    #[test]
    fn other_formats_name_themselves_without_a_decoder() {
        let cases: [(&[u8], &str); 4] = [
            (MP3, "MP3"),
            (&[0xFF, 0xFB, 0x90, 0x00], "MP3"),
            (&[0xFF, 0xF1, 0x50, 0x80], "AAC"),
            (b"\0\0\0\x20ftypM4A ", "AAC (M4A)"),
        ];
        for (bytes, name) in cases {
            assert_eq!(
                decode(bytes, None).unwrap_err(),
                format!("This sound is {name}, which this build of the app can't play")
            );
        }
        let vorbis = ogg::tests::ogg(&[b"\x01vorbis....".to_vec()], &[0]);
        assert!(decode(&vorbis, None).unwrap_err().contains("Ogg Vorbis"));
        assert!(
            decode(b"hello", None)
                .unwrap_err()
                .starts_with("This sound can't be played")
        );
        assert!(decode(&[], None).is_err());
        assert!(decode(&vec![0; MAX_BYTES + 1], None).is_err());
    }

    #[test]
    fn a_decoder_from_the_app_takes_the_rest_and_is_checked() {
        let ok = Fake(Ok(Pcm {
            sample_rate: 44_100,
            channels: 1,
            samples: vec![0.5; 44_100],
        }));
        let sound = decode(MP3, Some(&ok)).unwrap();
        assert_eq!(sound.len(), 48_000);
        assert!(sound.iter().all(|&s| s == 16_383));
        // It isn't asked about what's built in, or about garbage.
        assert_eq!(
            decode(&ogg::tests::ogg_opus(1), Some(&ok)).unwrap().len(),
            24_000
        );
        assert!(decode(b"hello", Some(&ok)).is_err());

        let refused = Fake(Err("no frames".into()));
        assert_eq!(
            decode(MP3, Some(&refused)).unwrap_err(),
            "This sound can't be played: no frames"
        );
        let absurd = [
            Pcm {
                sample_rate: 0,
                channels: 1,
                samples: vec![0.0; 10],
            },
            Pcm {
                sample_rate: 48_000,
                channels: 0,
                samples: vec![0.0; 10],
            },
            Pcm {
                sample_rate: 48_000,
                channels: 99,
                samples: vec![0.0; 990],
            },
            Pcm {
                sample_rate: 48_000,
                channels: 1,
                samples: vec![],
            },
        ];
        for pcm in absurd {
            assert!(decode(MP3, Some(&Fake(Ok(pcm)))).is_err());
        }
        let long = Fake(Ok(Pcm {
            sample_rate: 8_000,
            channels: 1,
            samples: vec![0.0; 8_000 * MAX_SECONDS as usize + 1],
        }));
        assert!(
            decode(MP3, Some(&long))
                .unwrap_err()
                .contains("longer than")
        );
        let not_numbers = Fake(Ok(Pcm {
            sample_rate: 48_000,
            channels: 1,
            samples: vec![f32::NAN, f32::INFINITY, 4.0],
        }));
        assert_eq!(&*decode(MP3, Some(&not_numbers)).unwrap(), &[0, 0, 32_767]);
    }

    #[test]
    fn the_cache_lets_the_least_recently_played_go() {
        let mut cache = SoundCache::default();
        let big: Arc<[i16]> = vec![0; CACHE_BYTES / 2 / 3].into();
        cache.insert("a".into(), big.clone());
        cache.insert("b".into(), big.clone());
        cache.insert("c".into(), big.clone());
        assert!(cache.get("a").is_some());
        cache.insert("d".into(), big.clone());
        assert!(cache.get("b").is_none());
        assert!(cache.get("a").is_some() && cache.get("c").is_some() && cache.get("d").is_some());
        cache.insert("a".into(), big);
        assert_eq!(cache.bytes, 3 * (CACHE_BYTES / 2 / 3) * 2);
    }
}
