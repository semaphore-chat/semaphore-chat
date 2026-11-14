//! A whole short file's audio at once, for the soundboard (W4): the first audio stream, mixed down
//! to mono and resampled to 48 kHz, with its length capped before and while it decodes.

use crate::resample::Resampler;
use crate::{Error, Frame, Kind, Media};
use std::fmt;
use std::time::Duration;

/// What [`decode_audio`] gives: mono samples at this rate.
pub const DECODED_RATE: u32 = 48_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeAudioError {
    /// The file has no audio stream, or its audio decoded to nothing.
    NoAudio,
    /// Longer than the caller's limit (said by the container, or found while decoding).
    TooLong(Duration),
    Media(Error),
}

impl From<Error> for DecodeAudioError {
    fn from(error: Error) -> Self {
        Self::Media(error)
    }
}

impl fmt::Display for DecodeAudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoAudio => f.write_str("the file has no audio"),
            Self::TooLong(max) => write!(f, "the sound is longer than {} seconds", max.as_secs()),
            Self::Media(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for DecodeAudioError {}

/// Decodes `bytes`' first audio stream to mono [`DECODED_RATE`] samples in -1.0..=1.0, refusing
/// anything longer than `max`. Blocking: run it off the UI thread and off async workers.
pub fn decode_audio(bytes: Vec<u8>, max: Duration) -> Result<Vec<f32>, DecodeAudioError> {
    let mut media = Media::open_bytes(bytes)?;
    let streams = media.streams();
    let index = streams
        .iter()
        .position(|stream| stream.kind == Kind::Audio)
        .ok_or(DecodeAudioError::NoAudio)?;
    // What the container says first: no work for a file that says it's too long.
    if streams[index]
        .duration
        .or_else(|| media.duration())
        .is_some_and(|length| length > max)
    {
        return Err(DecodeAudioError::TooLong(max));
    }
    media.enable(index)?;
    let cap = (max.as_secs_f64() * f64::from(DECODED_RATE)).ceil() as usize;
    let mut out: Vec<f32> = Vec::new();
    let mut mono: Vec<f32> = Vec::new();
    let mut resampler: Option<(u32, Resampler)> = None;
    while let Some(frame) = media.next_frame()? {
        let Frame::Audio(audio) = frame else {
            continue;
        };
        let channels = audio.channels as usize;
        if channels == 0 || audio.sample_rate == 0 {
            continue;
        }
        mono.clear();
        mono.extend(
            audio
                .samples
                .chunks_exact(channels)
                .map(|at| at.iter().sum::<f32>() / channels as f32),
        );
        // A rate change mid-file (rare, but MP3 allows it) starts a new resampler.
        match &mut resampler {
            Some((rate, resampler)) if *rate == audio.sample_rate => {
                resampler.process(&mono, &mut out)
            }
            _ => {
                if let Some((_, mut old)) = resampler.take() {
                    old.finish(&mut out);
                }
                let mut fresh = Resampler::new(audio.sample_rate, DECODED_RATE, 1);
                fresh.process(&mono, &mut out);
                resampler = Some((audio.sample_rate, fresh));
            }
        }
        // A container that lied about its length stops here, not at the end of the file.
        if out.len() > cap {
            return Err(DecodeAudioError::TooLong(max));
        }
    }
    if let Some((_, mut resampler)) = resampler {
        resampler.finish(&mut out);
    }
    // An AAC stream the decoder turned out not to be able to play as LC (implicit SBR, say) is
    // unsupported, not a short sound.
    if media.refused_audio().is_some() {
        return Err(DecodeAudioError::Media(Error::UnsupportedCodec));
    }
    // The filter's tail may run a few samples past the limit.
    out.truncate(cap);
    if out.is_empty() {
        return Err(DecodeAudioError::NoAudio);
    }
    for sample in &mut out {
        *sample = if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
    }
    Ok(out)
}
