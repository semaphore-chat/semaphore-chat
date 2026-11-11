//! Real SFU, real libwebrtc, real Opus; only the sound card is virtual. A person counts as heard
//! when their own frequency comes out of the mixer, not when the connection says so.
//!
//!   native/crates/semaphore-media-livekit/proof/test-voice.sh
//!
//! Each test skips, loudly, without `LK_URL`, because `cargo test` alone has no server.

#[path = "../examples/common/server_api.rs"]
mod server_api;
#[path = "../examples/common/token.rs"]
mod token;

use semaphore_core::model::VoiceStatus;
use semaphore_core::platform::MediaEngine;
use semaphore_media_livekit::audio::apm::AudioProcessing;
use semaphore_media_livekit::audio::virtual_io::VirtualIo;
use semaphore_media_livekit::testing::{SpeakerTap, ToneMic};
use semaphore_media_livekit::{EngineOptions, LiveKitEngine, MediaSnapshot};
use std::sync::Arc;
use std::time::{Duration, Instant};

const WINDOW: usize = 9600; // 200 ms
const AMPLITUDE: f64 = 0.2;
const HEARD_RMS: f64 = 800.0;
const SILENT_RMS: f64 = 80.0;

fn room_name(test: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    format!("u11-{test}-{nanos}")
}

struct Peer {
    engine: LiveKitEngine,
    io: VirtualIo,
    tap: SpeakerTap,
    identity: String,
}

impl Peer {
    async fn join(url: &str, room: &str, identity: &str, hz: f64) -> Self {
        Self::join_with(url, room, identity, hz, Duration::from_millis(200)).await
    }

    async fn join_with(url: &str, room: &str, identity: &str, hz: f64, poll: Duration) -> Self {
        let io = VirtualIo::new();
        let mut tone = ToneMic::new(hz, AMPLITUDE);
        io.set_mic(Box::new(move |frame| tone.fill(frame)));
        let tap = SpeakerTap::new(WINDOW);
        let sink = tap.clone();
        io.set_speaker(Box::new(move |frame| sink.push(frame)));
        let engine = LiveKitEngine::new(EngineOptions {
            audio_io: Arc::new(io.clone()),
            // Noise suppression treats a steady sine as noise and removes it: see `apm.rs`'s tests.
            processing: AudioProcessing::OFF,
            device_poll: poll,
            ..EngineOptions::default()
        });
        let token = token::dev_token(room, identity, identity);
        engine
            .connect(url.to_owned(), token, 1)
            .await
            .expect("joins");
        Self {
            engine,
            io,
            tap,
            identity: identity.to_owned(),
        }
    }

    fn snapshot(&self) -> MediaSnapshot {
        self.engine.snapshot()
    }
}

async fn eventually(what: &str, deadline: Duration, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while started.elapsed() < deadline {
        if check() {
            println!("{what}: {} ms", started.elapsed().as_millis());
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{what}: still false after {deadline:?}");
}

/// True for the whole of `hold`, as a bounded check that something stays so.
async fn holds(what: &str, hold: Duration, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while started.elapsed() < hold {
        assert!(check(), "{what}: broke after {:?}", started.elapsed());
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

macro_rules! server {
    () => {
        match std::env::var("LK_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("SKIPPED: no LK_URL");
                return;
            }
        }
    };
}

const WAIT: Duration = Duration::from_secs(15);

#[tokio::test(flavor = "multi_thread")]
async fn everyone_hears_everyone_by_tone_and_leaving_ends_it() {
    let url = server!();
    let room = room_name("tone");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    let c = Peer::join(&url, &room, "c", 1013.0).await;

    eventually("all six pairs audible", WAIT, || {
        a.tap.rms_at(743.0) > HEARD_RMS
            && a.tap.rms_at(1013.0) > HEARD_RMS
            && b.tap.rms_at(523.0) > HEARD_RMS
            && b.tap.rms_at(1013.0) > HEARD_RMS
            && c.tap.rms_at(523.0) > HEARD_RMS
            && c.tap.rms_at(743.0) > HEARD_RMS
    })
    .await;
    assert!(a.tap.rms_at(523.0) < SILENT_RMS, "nobody hears themselves");

    let snapshot = a.snapshot();
    assert_eq!(snapshot.voice.status, VoiceStatus::Connected);
    assert_eq!(snapshot.voice.participants.len(), 3);
    assert!(snapshot.voice.participants[0].is_self);

    c.engine.disconnect().await;
    eventually("c's tone stops for a", WAIT, || {
        a.tap.rms_at(1013.0) < SILENT_RMS
    })
    .await;
    eventually("c leaves a's view", WAIT, || {
        a.snapshot().voice.participants.len() == 2
    })
    .await;
    assert_eq!(c.snapshot().voice.status, VoiceStatus::Disconnected);
    assert!(a.tap.rms_at(743.0) > HEARD_RMS, "b is unaffected");
}

#[tokio::test(flavor = "multi_thread")]
async fn mute_silences_the_mic_for_others_and_shows_in_their_view() {
    let url = server!();
    let room = room_name("mute");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("b hears a", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;

    a.engine.set_muted(true);
    eventually("a is silent for b", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    eventually("b's view shows a muted", WAIT, || {
        b.snapshot()
            .voice
            .participants
            .iter()
            .any(|p| p.identity == a.identity && p.muted)
    })
    .await;
    assert!(a.snapshot().voice.muted);
    holds("b still hears nothing of a", Duration::from_secs(1), || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    assert!(
        a.tap.rms_at(743.0) > HEARD_RMS,
        "a's own hearing is untouched"
    );

    a.engine.set_muted(false);
    eventually("a is back for b", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn deafen_silences_playout_mutes_the_mic_and_undeafen_restores_both() {
    let url = server!();
    let room = room_name("deafen");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("both hear", WAIT, || {
        a.tap.rms_at(743.0) > HEARD_RMS && b.tap.rms_at(523.0) > HEARD_RMS
    })
    .await;

    a.engine.set_deafened(true);
    eventually("a hears nothing", WAIT, || a.tap.rms_at(743.0) < SILENT_RMS).await;
    eventually("b no longer hears a", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    eventually("b's view shows a deafened", WAIT, || {
        b.snapshot()
            .voice
            .participants
            .iter()
            .any(|p| p.identity == "a" && p.deafened && p.muted)
    })
    .await;

    a.engine.set_deafened(false);
    eventually("a hears again and b hears a", WAIT, || {
        a.tap.rms_at(743.0) > HEARD_RMS && b.tap.rms_at(523.0) > HEARD_RMS
    })
    .await;
    eventually("b's view clears", WAIT, || {
        b.snapshot()
            .voice
            .participants
            .iter()
            .any(|p| p.identity == "a" && !p.deafened)
    })
    .await;

    // Muted before deafening stays muted after, like the web client.
    a.engine.set_muted(true);
    a.engine.set_deafened(true);
    a.engine.set_deafened(false);
    assert!(a.snapshot().voice.muted);
}

#[tokio::test(flavor = "multi_thread")]
async fn per_user_volume_scales_one_person_and_survives_a_republish() {
    let url = server!();
    let room = room_name("volume");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    let c = Peer::join(&url, &room, "c", 1013.0).await;
    eventually("c hears a and b", WAIT, || {
        c.tap.rms_at(523.0) > HEARD_RMS && c.tap.rms_at(743.0) > HEARD_RMS
    })
    .await;
    let settle = Duration::from_secs(1);

    let measure = async |hz: f64| {
        // Lets the 200 ms window fill with audio at the new gain. It's a measurement window, not a
        // wait for anything to happen.
        tokio::time::sleep(settle).await;
        c.tap.rms_at(hz)
    };
    let full = measure(523.0).await;
    let b_full = measure(743.0).await;

    c.engine.set_participant_volume("a", 50);
    let half = measure(523.0).await;
    println!("a at 100% {full:.0}, 50% {half:.0}");
    assert!((half / full - 0.5).abs() < 0.12, "{half} vs {full}");
    let b_now = measure(743.0).await;
    assert!(
        (b_now / b_full - 1.0).abs() < 0.12,
        "b moved: {b_now} vs {b_full}"
    );

    c.engine.set_participant_volume("a", 200);
    let double = measure(523.0).await;
    println!("a at 200% {double:.0}");
    assert!((double / full - 2.0).abs() < 0.3, "{double} vs {full}");

    c.engine.set_participant_volume("a", 0);
    let zero = measure(523.0).await;
    println!("a at 0% {zero:.0}");
    assert!(zero < SILENT_RMS);

    // The same person's new track, here a leave and a join, keeps the choice.
    a.engine.disconnect().await;
    eventually("a is gone", WAIT, || {
        c.snapshot().voice.participants.len() == 2
    })
    .await;
    a.engine
        .connect(url.clone(), token::dev_token(&room, "a", "a"), 1)
        .await
        .unwrap();
    eventually("a is back", WAIT, || {
        c.snapshot().voice.participants.len() == 3
    })
    .await;
    holds("a stays at 0%", Duration::from_secs(2), || {
        c.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    assert_eq!(c.engine.participant_volume("a"), 0);
    drop(b);
}

#[tokio::test(flavor = "multi_thread")]
async fn speaking_follows_the_mic_for_self_and_others() {
    let url = server!();
    let room = room_name("speaking");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    b.engine.set_muted(true);
    eventually("b sees a speaking", WAIT, || {
        b.snapshot()
            .voice
            .participants
            .iter()
            .any(|p| p.identity == "a" && p.speaking)
    })
    .await;
    eventually("a sees itself speaking", WAIT, || {
        a.snapshot()
            .voice
            .participants
            .iter()
            .any(|p| p.is_self && p.speaking)
    })
    .await;
    a.engine.set_muted(true);
    eventually("speaking clears on mute", WAIT, || {
        b.snapshot().voice.participants.iter().all(|p| !p.speaking)
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn push_to_talk_opens_the_mic_only_while_held() {
    let url = server!();
    let room = room_name("ptt");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("b hears a", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;

    a.engine.set_ptt_mode(true);
    eventually("released: silent", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    a.engine.set_ptt_pressed(true);
    eventually("held: audible", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
    a.engine.set_ptt_pressed(false);
    eventually("released again: silent", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    a.engine.set_ptt_mode(false);
    eventually("open mic again", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn devices_hot_plug_switch_and_fall_back_during_a_call() {
    let url = server!();
    let room = room_name("devices");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("b hears a", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
    assert_eq!(a.engine.devices().inputs.len(), 1);

    a.io.plug_in("usb-headset-mic", true);
    a.io.plug_in("usb-headset-out", false);
    eventually("the headset shows up", WAIT, || {
        let devices = a.snapshot().devices;
        devices.inputs.iter().any(|d| d.id == "usb-headset-mic")
            && devices.outputs.iter().any(|d| d.id == "usb-headset-out")
    })
    .await;

    a.engine.select_input(Some("usb-headset-mic".into()));
    a.engine.select_output(Some("usb-headset-out".into()));
    assert_eq!(
        a.io.opened_inputs().last().unwrap().as_deref(),
        Some("usb-headset-mic")
    );
    assert_eq!(
        a.io.opened_outputs().last().unwrap().as_deref(),
        Some("usb-headset-out")
    );
    eventually("b still hears a on the new mic", WAIT, || {
        b.tap.rms_at(523.0) > HEARD_RMS
    })
    .await;
    eventually("a still hears b on the new output", WAIT, || {
        a.tap.rms_at(743.0) > HEARD_RMS
    })
    .await;

    a.io.unplug("usb-headset-mic");
    a.io.unplug("usb-headset-out");
    eventually("both fall back to the default", WAIT, || {
        a.io.opened_inputs().last().unwrap().is_none()
            && a.io.opened_outputs().last().unwrap().is_none()
    })
    .await;
    eventually("the call carries on both ways", WAIT, || {
        b.tap.rms_at(523.0) > HEARD_RMS && a.tap.rms_at(743.0) > HEARD_RMS
    })
    .await;
    assert_eq!(a.snapshot().voice.status, VoiceStatus::Connected);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_late_joiner_is_heard_and_hears_those_already_there() {
    let url = server!();
    let room = room_name("late");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    eventually("a is alone and connected", WAIT, || {
        a.snapshot().voice.status == VoiceStatus::Connected
    })
    .await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("both directions", WAIT, || {
        a.tap.rms_at(743.0) > HEARD_RMS && b.tap.rms_at(523.0) > HEARD_RMS
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_second_session_for_the_same_user_ends_the_first_without_a_fight() {
    let url = server!();
    let room = room_name("duplicate");
    let first = Peer::join(&url, &room, "same-user", 523.0).await;
    let listener = Peer::join(&url, &room, "listener", 743.0).await;
    eventually("the listener hears the first session", WAIT, || {
        listener.tap.rms_at(523.0) > HEARD_RMS
    })
    .await;

    // The same person, on another machine.
    let second = Peer::join(&url, &room, "same-user", 1013.0).await;
    eventually("the first session is over", WAIT, || {
        first.snapshot().voice.status == VoiceStatus::Disconnected
    })
    .await;
    assert_eq!(first.snapshot().rejoins, 0);
    assert!(
        first
            .snapshot()
            .last_error
            .unwrap_or_default()
            .contains("DuplicateIdentity")
    );

    eventually("the listener hears the second session", WAIT, || {
        listener.tap.rms_at(1013.0) > HEARD_RMS
    })
    .await;
    // Rejoining here would throw the second session out in turn: it has to stay up.
    holds("the second session stays", Duration::from_secs(3), || {
        second.snapshot().voice.status == VoiceStatus::Connected
            && first.snapshot().voice.status == VoiceStatus::Disconnected
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn changing_processing_applies_to_a_live_mic() {
    let url = server!();
    let room = room_name("processing");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    // The tone's full level: a sine at 0.2 of full scale has an RMS of 4634. "Heard" alone could be
    // a window still half empty, which is no reference to compare against.
    let whole = 4000.0;
    eventually("b hears a at full level", WAIT, || {
        b.tap.rms_at(523.0) > whole
    })
    .await;

    // Noise suppression eats a steady tone, which makes it a visible probe that the chain is live.
    a.engine.set_processing(AudioProcessing::default());
    eventually(
        "a's tone is suppressed for b",
        Duration::from_secs(10),
        || b.tap.rms_at(523.0) < 2300.0,
    )
    .await;
    a.engine.set_processing(AudioProcessing::OFF);
    eventually("a's tone is whole again", Duration::from_secs(10), || {
        b.tap.rms_at(523.0) > whole
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_room_with_no_sound_card_still_joins_and_says_why() {
    let url = server!();
    let room = room_name("nocard");
    let io = VirtualIo::default(); // No devices at all.
    let engine = LiveKitEngine::new(EngineOptions {
        audio_io: Arc::new(io),
        processing: AudioProcessing::OFF,
        ..EngineOptions::default()
    });
    engine
        .connect(url, token::dev_token(&room, "a", "a"), 1)
        .await
        .expect("a call needs no sound card");
    let snapshot = engine.snapshot();
    assert_eq!(snapshot.voice.status, VoiceStatus::Connected);
    assert!(snapshot.audio_error.is_some());
}

/// A mono 48 kHz WAV of `hz` for `seconds`.
fn tone_wav(hz: f64, seconds: f64) -> Vec<u8> {
    let mut tone = ToneMic::new(hz, AMPLITUDE);
    let mut samples = vec![0i16; (48_000.0 * seconds) as usize];
    tone.fill(&mut samples);
    let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    let mut wav = b"RIFF".to_vec();
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&48_000u32.to_le_bytes());
    wav.extend_from_slice(&96_000u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);
    wav
}

const SOUND_HZ: f64 = 1_499.0;

#[tokio::test(flavor = "multi_thread")]
async fn the_soundboard_goes_out_on_its_own_track_past_mute_and_push_to_talk() {
    let url = server!();
    let room = room_name("soundboard");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("b hears a", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
    // Neither the mic's mute nor push to talk holds the soundboard back.
    a.engine.set_muted(true);
    a.engine.set_ptt_mode(true);
    eventually("a's mic is silent", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;

    a.engine
        .play_soundboard("s-1".into(), tone_wav(SOUND_HZ, 20.0))
        .await
        .expect("plays");
    assert_eq!(a.snapshot().voice.local.soundboard.as_deref(), Some("s-1"));
    eventually("b hears the sound", WAIT, || {
        b.tap.rms_at(SOUND_HZ) > HEARD_RMS
    })
    .await;
    eventually("a hears it too", WAIT, || {
        a.tap.rms_at(SOUND_HZ) > HEARD_RMS
    })
    .await;
    assert!(b.tap.rms_at(523.0) < SILENT_RMS, "the mic stayed shut");

    // Deafened, my own copy goes quiet; theirs doesn't.
    a.engine.set_deafened(true);
    eventually("a's copy is silent", WAIT, || {
        a.tap.rms_at(SOUND_HZ) < SILENT_RMS
    })
    .await;
    assert!(b.tap.rms_at(SOUND_HZ) > HEARD_RMS);
    a.engine.set_deafened(false);

    a.engine.stop_soundboard();
    assert_eq!(a.snapshot().voice.local.soundboard, None);
    eventually("stopping silences it", WAIT, || {
        b.tap.rms_at(SOUND_HZ) < SILENT_RMS
    })
    .await;

    // A short one ends by itself and says so; the second play reuses the track (and the cache).
    let short = tone_wav(SOUND_HZ, 1.0);
    a.engine
        .play_soundboard("s-2".into(), short.clone())
        .await
        .unwrap();
    eventually("the short one is heard", WAIT, || {
        b.tap.rms_at(SOUND_HZ) > HEARD_RMS
    })
    .await;
    eventually("it ends", WAIT, || {
        a.snapshot().voice.local.soundboard.is_none()
    })
    .await;
    a.engine
        .play_soundboard("s-2".into(), Vec::new())
        .await
        .expect("from the cache");
    eventually("it ends again", WAIT, || {
        a.snapshot().voice.local.soundboard.is_none()
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sound_that_cant_be_decoded_says_why_and_nothing_plays() {
    let url = server!();
    let room = room_name("badsound");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let error = a
        .engine
        .play_soundboard("mp3".into(), b"ID3\x04\0\0\0\0\0\0".to_vec())
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "This sound is MP3, which this build of the app can't play"
    );
    assert!(
        a.engine
            .play_soundboard("junk".into(), b"junk".to_vec())
            .await
            .is_err()
    );
    assert_eq!(a.snapshot().voice.local.soundboard, None);
    a.engine.disconnect().await;
    assert!(
        a.engine
            .play_soundboard("x".into(), tone_wav(440.0, 0.1))
            .await
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_voice_activity_threshold_gates_a_quiet_mic() {
    let url = server!();
    let room = room_name("vad");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("b hears a", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
    // a's 0.2 tone is about 22 on the web's scale.
    a.engine.set_vad_threshold(60);
    eventually("below the threshold: silent", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    holds("it stays shut", Duration::from_secs(1), || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    a.engine.set_vad_threshold(10);
    eventually("above it: heard", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
    // Push to talk ignores it.
    a.engine.set_vad_threshold(60);
    a.engine.set_ptt_mode(true);
    a.engine.set_ptt_pressed(true);
    eventually("held: heard despite the threshold", WAIT, || {
        b.tap.rms_at(523.0) > HEARD_RMS
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn diagnostics_describe_the_call() {
    let url = server!();
    let room = room_name("diagnostics");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("b hears a", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
    let first = a.engine.diagnostics().await.expect("in a call");
    println!("{first:?}");
    assert!(!first.candidate_types.is_empty());
    assert_eq!(first.audio_codec.as_deref(), Some("opus"));
    assert_eq!(first.bitrate_in_kbps, None);
    // Bitrates are measured between two reads: this is the measurement window, not a wait.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let second = a.engine.diagnostics().await.expect("in a call");
    println!("{second:?}");
    // ICE measures a round trip within seconds of connecting.
    let started = Instant::now();
    while a
        .engine
        .diagnostics()
        .await
        .and_then(|d| d.rtt_ms)
        .is_none()
    {
        assert!(
            started.elapsed() < WAIT,
            "no round trip time after {WAIT:?}"
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    assert!(second.bitrate_in_kbps.is_some_and(|kbps| kbps > 0));
    assert!(second.bitrate_out_kbps.is_some_and(|kbps| kbps > 0));
    a.engine.disconnect().await;
    assert_eq!(a.engine.diagnostics().await, None);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_mute_holds_against_every_local_change_from_any_thread() {
    let url = server!();
    let room = room_name("servermute");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    eventually("b hears a", WAIT, || b.tap.rms_at(523.0) > HEARD_RMS).await;
    let mic = server_api::track_sids(&url, &room, "a", "MICROPHONE");
    assert_eq!(mic.len(), 1, "{mic:?}");
    server_api::mute_published_track(&url, &room, "a", &mic[0], true);
    eventually("the server mute silences a", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    eventually("a sees itself server-muted", WAIT, || {
        a.snapshot()
            .voice
            .participants
            .iter()
            .any(|p| p.is_self && p.server_muted && p.muted)
    })
    .await;

    // Every setter short of the user unmuting, from a thread with no runtime, as the UI's thread
    // calls them.
    let engine = &a.engine;
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                engine.set_vad_threshold(5);
                engine.set_vad_threshold(0);
                engine.set_ptt_mode(true);
                engine.set_ptt_pressed(true);
                engine.set_ptt_pressed(false);
                engine.set_ptt_mode(false);
                engine.set_deafened(true);
                engine.set_deafened(false);
                engine.set_muted(true);
            })
            .join()
            .expect("no setter panics off the runtime");
    });
    holds(
        "none of that undoes the server mute",
        Duration::from_millis(1500),
        || b.tap.rms_at(523.0) < SILENT_RMS,
    )
    .await;

    // Core says it's lifted (LiveKit's dev server, like the default, refuses a remote unmute):
    // still muted until the user unmutes, as on the web.
    a.engine.set_server_muted(false);
    holds(
        "lifting it opens nothing by itself",
        Duration::from_millis(1000),
        || b.tap.rms_at(523.0) < SILENT_RMS,
    )
    .await;
    a.engine.set_muted(false);
    eventually("the user's unmute is heard", WAIT, || {
        b.tap.rms_at(523.0) > HEARD_RMS
    })
    .await;

    // A server mute core reports, with no LiveKit event, holds the same way.
    a.engine.set_server_muted(true);
    eventually("core's server mute silences a", WAIT, || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
    a.engine.set_ptt_mode(true);
    a.engine.set_ptt_pressed(true);
    holds("and holds", Duration::from_millis(1000), || {
        b.tap.rms_at(523.0) < SILENT_RMS
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn stopping_a_sound_that_is_still_starting_cancels_it() {
    let url = server!();
    let room = room_name("pendingstop");
    let a = Peer::join(&url, &room, "a", 523.0).await;
    let b = Peer::join(&url, &room, "b", 743.0).await;
    a.engine.set_muted(true);
    eventually("b hears a peer", WAIT, || {
        b.snapshot().voice.participants.len() == 2
    })
    .await;
    // The first play decodes and publishes the track before it starts: stop lands in that window.
    let (played, ()) = tokio::join!(
        a.engine
            .play_soundboard("pending".into(), tone_wav(SOUND_HZ, 3.0)),
        async {
            tokio::task::yield_now().await;
            a.engine.stop_soundboard();
        }
    );
    println!("the cancelled play: {played:?}");
    holds("nothing plays", Duration::from_secs(2), || {
        a.snapshot().voice.local.soundboard.is_none()
            && b.tap.rms_at(SOUND_HZ) < SILENT_RMS
            && a.tap.rms_at(SOUND_HZ) < SILENT_RMS
    })
    .await;
    // The next play still works.
    a.engine
        .play_soundboard("pending".into(), tone_wav(SOUND_HZ, 3.0))
        .await
        .unwrap();
    eventually("b hears the next one", WAIT, || {
        b.tap.rms_at(SOUND_HZ) > HEARD_RMS
    })
    .await;
    assert_eq!(
        server_api::track_sids(&url, &room, "a", "UNKNOWN").len(),
        1,
        "one soundboard track"
    );
}
