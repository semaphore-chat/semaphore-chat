//! `decode_audio` on the committed fixtures: mono 48 kHz out of mono, stereo and 16 kHz files,
//! and the length cap.

use semaphore_player::{DECODED_RATE, DecodeAudioError, decode_audio};
use std::time::Duration;

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

fn seconds(samples: &[f32]) -> f64 {
    samples.len() as f64 / f64::from(DECODED_RATE)
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0, |peak, s| peak.max(s.abs()))
}

const MAX: Duration = Duration::from_secs(120);

#[test]
fn an_mp3_decodes_to_a_second_of_mono_48k() {
    let samples = decode_audio(fixture("sine.mp3"), MAX).expect("decoded");
    let length = seconds(&samples);
    // MP3's encoder delay and padding add a frame or two.
    assert!((0.95..1.1).contains(&length), "{length} s");
    // lavfi's sine is at 1/8 of full scale.
    assert!(peak(&samples) > 0.08, "the tone is there");
    assert!(samples.iter().all(|s| (-1.0..=1.0).contains(s)));
}

#[test]
fn other_rates_and_formats_come_out_at_48k() {
    for name in ["sine.wav", "sine.flac", "vorbis.ogg", "opus.ogg"] {
        let samples = decode_audio(fixture(name), MAX).unwrap_or_else(|e| panic!("{name}: {e}"));
        let length = seconds(&samples);
        assert!((0.9..2.2).contains(&length), "{name}: {length} s");
        assert!(peak(&samples) > 0.08, "{name}: silent");
    }
}

#[test]
fn a_sound_past_the_limit_is_refused() {
    let limit = Duration::from_millis(500);
    assert_eq!(
        decode_audio(fixture("sine.mp3"), limit),
        Err(DecodeAudioError::TooLong(limit))
    );
}

#[test]
fn what_isnt_audio_is_refused() {
    assert!(matches!(
        decode_audio(b"definitely not a sound file".to_vec(), MAX),
        Err(DecodeAudioError::Media(_))
    ));
    assert!(decode_audio(fixture("truncated.mp4"), MAX).is_err());
}
