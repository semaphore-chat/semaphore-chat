//! T7 participant. Publishes a sine at its own frequency, opens an audio stream for every track
//! it subscribes to, and judges each one by tone (Goertzel), not by connection state. Prints JSON
//! lines; `run.py` applies the faults and reads the verdict from these lines.
//!
//!   LK_URL LK_TOKEN IDENTITY TONES=a:523,b:743,c:1013 [REJOIN=1]
//!
//! With REJOIN=1, an engine that gives up (the SDK's 60 s budget) is followed by a new
//! `Room::connect`. That loop is the part of a real session the SDK doesn't do.

use futures_util::StreamExt;
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::track::{LocalAudioTrack, LocalTrack, RemoteTrack, TrackSource};
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::audio_stream::native::NativeAudioStream;
use serde_json::{Value, json};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SAMPLE_RATE: u32 = 48_000;
const FRAME_SAMPLES: usize = 480;
const WINDOW_SAMPLES: usize = 4800;
/// Peak amplitude 0.3 of full scale is an RMS of about 7,000.
const MIN_RMS: f64 = 500.0;
/// The expected tone's share of the window's energy.
const MIN_TONE_SHARE: f64 = 0.5;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn emit(line: Value) {
    println!("{line}");
}

struct SdkLog;
impl log::Log for SdkLog {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Warn && metadata.target().starts_with("livekit")
    }
    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            emit(
                json!({"ev":"sdk_log","t":now_ms(),"lvl":record.level().as_str(),"msg":record.args().to_string()}),
            );
        }
    }
    fn flush(&self) {}
}

/// Energy at `hz` as a share of the window's total, from the Goertzel recurrence.
fn tone_share(samples: &[f64], hz: f64, total_energy: f64) -> f64 {
    let omega = 2.0 * std::f64::consts::PI * hz / f64::from(SAMPLE_RATE);
    let coefficient = 2.0 * omega.cos();
    let (mut previous, mut before) = (0.0, 0.0);
    for sample in samples {
        let current = sample + coefficient * previous - before;
        before = previous;
        previous = current;
    }
    let power = previous * previous + before * before - coefficient * previous * before;
    // A pure sine's bin power is total_energy * N / 2.
    power / (total_energy * samples.len() as f64 / 2.0)
}

/// Whether a window carries `expected`, and no other participant's tone instead.
fn judge(samples: &[f64], expected: f64, others: &[f64]) -> (bool, f64, f64) {
    let energy: f64 = samples.iter().map(|sample| sample * sample).sum();
    let rms = (energy / samples.len() as f64).sqrt();
    if rms < MIN_RMS {
        return (false, rms, 0.0);
    }
    let share = tone_share(samples, expected, energy);
    let imposter = others
        .iter()
        .any(|hz| tone_share(samples, *hz, energy) > share);
    (share >= MIN_TONE_SHARE && !imposter, rms, share)
}

async fn publish_tone(room: &Room, source: &NativeAudioSource) -> Result<(), RoomError> {
    let track = LocalAudioTrack::create_audio_track("tone", RtcAudioSource::Native(source.clone()));
    room.local_participant()
        .publish_track(
            LocalTrack::Audio(track),
            TrackPublishOptions {
                source: TrackSource::Microphone,
                ..Default::default()
            },
        )
        .await?;
    Ok(())
}

fn spawn_tone_source(source: NativeAudioSource, hz: f64) {
    tokio::spawn(async move {
        let step = 2.0 * std::f64::consts::PI * hz / f64::from(SAMPLE_RATE);
        let mut phase = 0.0f64;
        loop {
            let mut data = vec![0i16; FRAME_SAMPLES];
            for sample in &mut data {
                *sample = (phase.sin() * 0.3 * f64::from(i16::MAX)) as i16;
                phase += step;
            }
            phase %= 2.0 * std::f64::consts::PI;
            let frame = AudioFrame {
                data: Cow::Owned(data),
                sample_rate: SAMPLE_RATE,
                num_channels: 1,
                samples_per_channel: FRAME_SAMPLES as u32,
            };
            // Paces itself: this blocks once the source's queue is full.
            if let Err(error) = source.capture_frame(&frame).await {
                emit(json!({"ev":"capture_error","t":now_ms(),"msg":error.to_string()}));
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    });
}

fn spawn_listener(
    track: RemoteAudioTrack,
    from: String,
    track_sid: String,
    expected: f64,
    others: Vec<f64>,
    stream_id: u64,
) {
    tokio::spawn(async move {
        let mut stream = NativeAudioStream::new(track.rtc_track(), SAMPLE_RATE as i32, 1);
        let mut window = Vec::with_capacity(WINDOW_SAMPLES);
        let mut good = false;
        let (mut good_windows, mut bad_windows) = (0u64, 0u64);
        let mut last_tally = now_ms();
        while let Some(frame) = stream.next().await {
            window.extend(frame.data.iter().map(|sample| f64::from(*sample)));
            while window.len() >= WINDOW_SAMPLES {
                let (is_good, rms, share) = judge(&window[..WINDOW_SAMPLES], expected, &others);
                window.drain(..WINDOW_SAMPLES);
                if is_good {
                    good_windows += 1
                } else {
                    bad_windows += 1
                }
                if is_good != good {
                    good = is_good;
                    emit(
                        json!({"ev":"tone","t":now_ms(),"from":from,"stream":stream_id,"sid":track_sid,"good":good,
                        "rms":rms.round(),"share":(share * 100.0).round() / 100.0}),
                    );
                }
            }
            if now_ms() - last_tally >= 1000 {
                last_tally = now_ms();
                emit(
                    json!({"ev":"tally","t":last_tally,"from":from,"stream":stream_id,"good":good_windows,"bad":bad_windows}),
                );
            }
        }
        emit(
            json!({"ev":"stream_end","t":now_ms(),"from":from,"stream":stream_id,"sid":track_sid,"good_windows":good_windows,"bad_windows":bad_windows}),
        );
    });
}

async fn run_session(
    url: &str,
    token: &str,
    tones: &HashMap<String, f64>,
    source: &NativeAudioSource,
    streams: &Arc<AtomicU64>,
) -> Result<String, RoomError> {
    let mut options = RoomOptions::default();
    options.auto_subscribe = true;
    let (room, mut events) = Room::connect(url, token, options).await?;
    publish_tone(&room, source).await?;
    emit(
        json!({"ev":"joined","t":now_ms(),"sid":room.local_participant().sid().to_string(),
        "remotes":room.remote_participants().keys().map(|identity| identity.to_string()).collect::<Vec<_>>()}),
    );
    while let Some(event) = events.recv().await {
        let t = now_ms();
        match event {
            RoomEvent::TrackSubscribed {
                track,
                publication,
                participant,
            } => {
                let from = participant.identity().to_string();
                emit(
                    json!({"ev":"track_subscribed","t":t,"from":from,"sid":publication.sid().to_string(),"participant_sid":participant.sid().to_string()}),
                );
                if let RemoteTrack::Audio(track) = track {
                    let Some(expected) = tones.get(&from).copied() else {
                        continue;
                    };
                    let others = tones
                        .iter()
                        .filter(|(identity, _)| **identity != from)
                        .map(|(_, hz)| *hz)
                        .collect();
                    let id = streams.fetch_add(1, Ordering::Relaxed);
                    spawn_listener(
                        track,
                        from,
                        publication.sid().to_string(),
                        expected,
                        others,
                        id,
                    );
                }
            }
            RoomEvent::TrackUnsubscribed {
                publication,
                participant,
                ..
            } => emit(
                json!({"ev":"track_unsubscribed","t":t,"from":participant.identity().to_string(),"sid":publication.sid().to_string()}),
            ),
            RoomEvent::TrackSubscriptionFailed {
                participant,
                error,
                track_sid,
            } => emit(
                json!({"ev":"subscription_failed","t":t,"from":participant.identity().to_string(),"sid":track_sid.to_string(),"error":error.to_string()}),
            ),
            RoomEvent::TrackUnpublished {
                publication,
                participant,
            } => emit(
                json!({"ev":"track_unpublished","t":t,"from":participant.identity().to_string(),"sid":publication.sid().to_string()}),
            ),
            RoomEvent::ParticipantConnected(participant) => emit(
                json!({"ev":"participant_connected","t":t,"who":participant.identity().to_string(),"sid":participant.sid().to_string()}),
            ),
            RoomEvent::ParticipantDisconnected(participant) => emit(
                json!({"ev":"participant_disconnected","t":t,"who":participant.identity().to_string(),"sid":participant.sid().to_string()}),
            ),
            RoomEvent::LocalTrackRepublished {
                previous_sid,
                publication,
                ..
            } => emit(
                json!({"ev":"local_republished","t":t,"previous":previous_sid.to_string(),"sid":publication.sid().to_string()}),
            ),
            RoomEvent::ConnectionStateChanged(state) => {
                emit(json!({"ev":"conn_state","t":t,"state":format!("{state:?}")}))
            }
            RoomEvent::Reconnecting => emit(json!({"ev":"reconnecting","t":t})),
            RoomEvent::Reconnected => emit(
                json!({"ev":"reconnected","t":t,"sid":room.local_participant().sid().to_string()}),
            ),
            RoomEvent::Disconnected { reason } => {
                emit(json!({"ev":"disconnected","t":t,"reason":format!("{reason:?}")}));
                return Ok(format!("{reason:?}"));
            }
            _ => {}
        }
    }
    Ok("event channel closed".into())
}

#[tokio::main]
async fn main() {
    log::set_logger(&SdkLog).expect("no logger set yet");
    log::set_max_level(log::LevelFilter::Warn);
    let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"));
    let (url, token, identity) = (var("LK_URL"), var("LK_TOKEN"), var("IDENTITY"));
    let rejoin = std::env::var("REJOIN").is_ok_and(|value| value == "1");
    let tones: HashMap<String, f64> = var("TONES")
        .split(',')
        .map(|pair| {
            let (name, hz) = pair.split_once(':').expect("identity:hz");
            (name.to_owned(), hz.parse().expect("hz"))
        })
        .collect();
    let my_hz = tones[&identity];
    let source = NativeAudioSource::new(AudioSourceOptions::default(), SAMPLE_RATE, 1, 100);
    spawn_tone_source(source.clone(), my_hz);
    let streams = Arc::new(AtomicU64::new(0));
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = async {
            loop {
                match run_session(&url, &token, &tones, &source, &streams).await {
                    Ok(reason) => emit(json!({"ev":"session_over","t":now_ms(),"reason":reason})),
                    Err(error) => emit(json!({"ev":"join_failed","t":now_ms(),"error":error.to_string()})),
                }
                if !rejoin { break; }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        } => {}
    }
}
