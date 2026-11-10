//! T11 participant. Prints JSON lines; `run.py` (host) and `scenario.py` (in the container) drive
//! it and apply the bars.
//!
//!   MODE=local   plays the call tone through the real cpal output, captures system audio, and
//!                judges the captured PCM itself. No LiveKit: for fast iteration.
//!   MODE=share   a real `LiveKitEngine` in a call: it plays the viewer's voice (the call tone)
//!                through cpal, captures system audio and publishes it as the screen share's audio.
//!   MODE=viewer  speaks the call tone into the room and judges the sharer's screen share audio,
//!                decoded, as other people would hear it.
//!   MODE=desktop like local, on a real desktop session: plays the call tone quietly and records
//!                the captured audio to RECORD (a WAV) for a person to listen to.
//!
//! Env: TONES=a:523,b:743 (name:Hz, judged in every window), CALL_HZ=743, DURATION_S=20,
//! INCLUDE_OWN=1 (negative control: also capture our own streams), REOPEN_AT_S (reopen our output
//! stream then: local reopens it, share switches the output to the "Rig headset" sink),
//! CALL_AMPLITUDE (default 0.25), LK_URL, LK_TOKEN.

use futures_util::StreamExt;
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::track::{LocalAudioTrack, LocalTrack, RemoteTrack, TrackSource};
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::audio_stream::native::NativeAudioStream;
use semaphore_core::platform::MediaEngine as _;
use semaphore_media_livekit::audio::cpal_io::CpalIo;
use semaphore_media_livekit::audio::system::{CaptureScope, SystemAudioCapture};
use semaphore_media_livekit::audio::{AudioIo, ErrorCallback};
use semaphore_media_livekit::testing::ToneMic;
use semaphore_media_livekit::{EngineOptions, LiveKitEngine};
use semaphore_sysaudio::PipeWireCapture;
use serde_json::{Map, Value, json};
use std::borrow::Cow;
use std::io::Write as _;
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const RATE: u32 = 48_000;
const SLOW_WINDOW: usize = 48_000;
const FAST_WINDOW: usize = 4_800;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

fn emit(line: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

struct JsonLog;

impl log::Log for JsonLog {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.target() == "sysaudio"
            || metadata.level() <= log::Level::Warn
            || env("LOG_ALL").is_some()
    }
    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            emit(json!({"ev":"log","t":now_ms(),"target":record.target(),
                "level":record.level().to_string(),"msg":record.args().to_string()}));
        }
    }
    fn flush(&self) {}
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn env_f64(name: &str, default: f64) -> f64 {
    env(name).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn tones() -> Vec<(String, f64)> {
    env("TONES")
        .unwrap_or_else(|| "a:523,b:743".into())
        .split(',')
        .map(|pair| {
            let (name, hz) = pair.split_once(':').expect("name:hz");
            (name.to_owned(), hz.parse().expect("hz"))
        })
        .collect()
}

/// Amplitude of the sine at `hz` (full scale 1.0), from a Hann-windowed Goertzel. A sine of
/// amplitude A gives |X| = A * N / 4 with a Hann window.
fn tone_amplitude(samples: &[f64], hann: &[f64], hz: f64) -> f64 {
    let omega = 2.0 * std::f64::consts::PI * hz / f64::from(RATE);
    let coefficient = 2.0 * omega.cos();
    let (mut previous, mut before) = (0.0, 0.0);
    for (sample, weight) in samples.iter().zip(hann) {
        let current = sample * weight + coefficient * previous - before;
        before = previous;
        previous = current;
    }
    let power = previous * previous + before * before - coefficient * previous * before;
    4.0 * power.max(0.0).sqrt() / samples.len() as f64
}

fn db(amplitude: f64) -> f64 {
    let value = 20.0 * amplitude.max(1e-12).log10();
    (value * 100.0).round() / 100.0
}

/// Tone levels per window, in dBFS. Slow windows (1 s, bins on every integer Hz) carry the
/// verdict; fast ones (100 ms) time onsets.
struct Judge {
    role: &'static str,
    span: &'static str,
    size: usize,
    tones: Vec<(String, f64)>,
    hann: Vec<f64>,
    left: Vec<f64>,
    right: Vec<f64>,
    frames: u64,
}

impl Judge {
    fn new(role: &'static str, span: &'static str, size: usize, tones: Vec<(String, f64)>) -> Self {
        let hann = (0..size)
            .map(|n| {
                0.5 - 0.5 * (2.0 * std::f64::consts::PI * n as f64 / (size as f64 - 1.0)).cos()
            })
            .collect();
        Self {
            role,
            span,
            size,
            tones,
            hann,
            left: Vec::with_capacity(size),
            right: Vec::with_capacity(size),
            frames: 0,
        }
    }

    /// Interleaved stereo, full scale 1.0.
    fn push(&mut self, interleaved: &[f64]) {
        for pair in interleaved.as_chunks::<2>().0 {
            self.left.push(pair[0]);
            self.right.push(pair[1]);
            self.frames += 1;
            if self.left.len() == self.size {
                self.window();
                self.left.clear();
                self.right.clear();
            }
        }
    }

    fn window(&self) {
        let mono: Vec<f64> = self
            .left
            .iter()
            .zip(&self.right)
            .map(|(l, r)| (l + r) / 2.0)
            .collect();
        let rms = (mono.iter().map(|s| s * s).sum::<f64>() / mono.len() as f64).sqrt();
        let mut levels = Map::new();
        let (mut left, mut right) = (Map::new(), Map::new());
        for (name, hz) in &self.tones {
            levels.insert(
                name.clone(),
                json!(db(tone_amplitude(&mono, &self.hann, *hz))),
            );
            if self.span == "slow" {
                left.insert(
                    name.clone(),
                    json!(db(tone_amplitude(&self.left, &self.hann, *hz))),
                );
                right.insert(
                    name.clone(),
                    json!(db(tone_amplitude(&self.right, &self.hann, *hz))),
                );
            }
        }
        let mut line = json!({"ev":"win","role":self.role,"span":self.span,"t":now_ms(),
            "frames":self.frames,"rms":db(rms * std::f64::consts::SQRT_2),"db":levels});
        if self.span == "slow" {
            line["l"] = Value::Object(left);
            line["r"] = Value::Object(right);
        }
        emit(line);
    }
}

/// Judges on its own thread, so the capture callback only copies.
fn spawn_judges(role: &'static str, record: Option<String>) -> mpsc::SyncSender<Vec<f64>> {
    let (tx, rx) = mpsc::sync_channel::<Vec<f64>>(256);
    std::thread::spawn(move || {
        let mut slow = Judge::new(role, "slow", SLOW_WINDOW, tones());
        let mut fast = Judge::new(role, "fast", FAST_WINDOW, tones());
        let mut wav = record.map(|path| Wav::create(&path).expect("RECORD is writable"));
        while let Ok(samples) = rx.recv() {
            slow.push(&samples);
            fast.push(&samples);
            if let Some(wav) = &mut wav {
                wav.write(&samples);
            }
        }
        if let Some(wav) = wav {
            wav.finish();
        }
    });
    tx
}

/// A 48 kHz stereo 16-bit WAV, header patched on finish.
struct Wav {
    file: std::fs::File,
    bytes: u32,
}

impl Wav {
    fn create(path: &str) -> std::io::Result<Self> {
        let mut file = std::fs::File::create(path)?;
        file.write_all(&[0u8; 44])?;
        Ok(Self { file, bytes: 0 })
    }

    fn write(&mut self, samples: &[f64]) {
        let data: Vec<u8> = samples
            .iter()
            .flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
            .collect();
        if self.file.write_all(&data).is_ok() {
            self.bytes += data.len() as u32;
        }
    }

    fn finish(mut self) {
        use std::io::{Seek, SeekFrom};
        let mut header = Vec::with_capacity(44);
        header.extend_from_slice(b"RIFF");
        header.extend_from_slice(&(36 + self.bytes).to_le_bytes());
        header.extend_from_slice(b"WAVEfmt ");
        header.extend_from_slice(&16u32.to_le_bytes());
        header.extend_from_slice(&1u16.to_le_bytes());
        header.extend_from_slice(&2u16.to_le_bytes());
        header.extend_from_slice(&RATE.to_le_bytes());
        header.extend_from_slice(&(RATE * 4).to_le_bytes());
        header.extend_from_slice(&4u16.to_le_bytes());
        header.extend_from_slice(&16u16.to_le_bytes());
        header.extend_from_slice(b"data");
        header.extend_from_slice(&self.bytes.to_le_bytes());
        let _ = self.file.seek(SeekFrom::Start(0));
        let _ = self.file.write_all(&header);
    }
}

fn capture() -> PipeWireCapture {
    if env("INCLUDE_OWN").is_some_and(|value| value == "1") {
        PipeWireCapture::negative_control()
    } else {
        PipeWireCapture::default()
    }
}

fn on_error(what: &'static str) -> ErrorCallback {
    Arc::new(move |message| emit(json!({"ev":"error","t":now_ms(),"what":what,"msg":message})))
}

/// CPU seconds used so far by the whole process and by the capture's threads.
fn cpu_seconds() -> (f64, f64) {
    let ticks = 100.0;
    let read = |path: &str| -> Option<f64> {
        let stat = std::fs::read_to_string(path).ok()?;
        let fields: Vec<&str> = stat.rsplit_once(')')?.1.split_whitespace().collect();
        Some((fields.get(11)?.parse::<f64>().ok()? + fields.get(12)?.parse::<f64>().ok()?) / ticks)
    };
    let process = read("/proc/self/stat").unwrap_or_default();
    let mut capture = 0.0;
    if let Ok(tasks) = std::fs::read_dir("/proc/self/task") {
        for task in tasks.flatten() {
            let path = task.path();
            let comm = std::fs::read_to_string(path.join("comm")).unwrap_or_default();
            // Our loop thread and libpipewire's data loop, where the process callback runs.
            if comm.starts_with("semaphore-sysau") || comm.starts_with("data-loop") {
                capture += read(&path.join("stat").to_string_lossy()).unwrap_or_default();
            }
        }
    }
    (process, capture)
}

fn emit_cpu(started: Instant) {
    let (process, capture) = cpu_seconds();
    emit(
        json!({"ev":"cpu","t":now_ms(),"wall_s":started.elapsed().as_secs_f64(),
        "process_s":process,"capture_s":capture}),
    );
}

fn open_call_output(
    io: &CpalIo,
    amplitude: f64,
) -> Result<semaphore_media_livekit::audio::AudioStream, String> {
    let mut tone = ToneMic::new(env_f64("CALL_HZ", 743.0), amplitude);
    io.open_output(
        None,
        Box::new(move |out, _| tone.fill(out)),
        on_error("call output"),
    )
}

/// local and desktop: our call tone out through cpal, system audio in, judged here.
fn run_local(record: Option<String>) {
    let duration = Duration::from_secs_f64(env_f64("DURATION_S", 20.0));
    let reopen_at = env("REOPEN_AT_S").and_then(|v| v.parse::<f64>().ok());
    let amplitude = env_f64("CALL_AMPLITUDE", 0.25);
    let io = CpalIo::default();
    emit(json!({"ev":"devices","t":now_ms(),"devices":format!("{:?}", io.devices())}));
    let mut output = Some(open_call_output(&io, amplitude).expect("call output opens"));
    emit(json!({"ev":"call_playing","t":now_ms(),"pid":std::process::id()}));

    let judges = spawn_judges("local", record);
    let capture = capture();
    emit(json!({"ev":"support","t":now_ms(),"support":format!("{:?}", capture.support())}));
    let stream = capture
        .start(
            CaptureScope::EverythingExceptOurs,
            Box::new(move |samples| {
                let _ = judges.try_send(samples.iter().map(|s| f64::from(*s)).collect());
            }),
            on_error("capture"),
        )
        .expect("capture starts");
    let started = Instant::now();
    emit(json!({"ev":"capture_started","t":now_ms()}));
    let mut reopened = false;
    while started.elapsed() < duration {
        if let Some(at) = reopen_at
            && !reopened
            && started.elapsed().as_secs_f64() >= at
        {
            output.take();
            output = Some(open_call_output(&io, amplitude).expect("call output reopens"));
            reopened = true;
            emit(json!({"ev":"call_reopened","t":now_ms()}));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    emit_cpu(started);
    drop(stream);
    drop(output);
    emit(json!({"ev":"done","t":now_ms()}));
}

async fn run_share() {
    let url = env("LK_URL").expect("LK_URL");
    let token = env("LK_TOKEN").expect("LK_TOKEN");
    let duration = Duration::from_secs_f64(env_f64("DURATION_S", 20.0));
    let reopen_at = env("REOPEN_AT_S").and_then(|v| v.parse::<f64>().ok());
    let engine = LiveKitEngine::new(EngineOptions {
        audio_io: Arc::new(CpalIo::default()),
        ..EngineOptions::default()
    });
    engine.connect(url, token).await.expect("sharer joins");
    emit(json!({"ev":"joined","t":now_ms(),"pid":std::process::id()}));
    let capture = capture();
    engine
        .start_system_audio(&capture)
        .expect("system audio starts");
    let started = Instant::now();
    emit(json!({"ev":"capture_started","t":now_ms()}));
    let mut reopened = false;
    while started.elapsed() < duration {
        if let Some(at) = reopen_at
            && !reopened
            && started.elapsed().as_secs_f64() >= at
        {
            let headset = engine
                .devices()
                .outputs
                .into_iter()
                .find(|device| device.name.contains("Rig headset"))
                .map(|device| device.id);
            emit(json!({"ev":"call_reopened","t":now_ms(),"device":headset}));
            engine.select_output(headset);
            reopened = true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    emit(json!({"ev":"dropped","t":now_ms(),"frames":engine.system_audio_dropped_frames()}));
    emit_cpu(started);
    engine.stop_system_audio();
    engine.disconnect().await;
    emit(json!({"ev":"done","t":now_ms()}));
}

async fn run_viewer() {
    let url = env("LK_URL").expect("LK_URL");
    let token = env("LK_TOKEN").expect("LK_TOKEN");
    let duration = Duration::from_secs_f64(env_f64("DURATION_S", 20.0));
    let mut options = RoomOptions::default();
    options.auto_subscribe = true;
    let (room, mut events) = Room::connect(&url, &token, options)
        .await
        .expect("viewer joins");
    emit(json!({"ev":"joined","t":now_ms()}));

    // The viewer's voice: what the sharer's client plays as call audio.
    let source = NativeAudioSource::new(AudioSourceOptions::default(), RATE, 1, 100);
    let voice = source.clone();
    let amplitude = env_f64("CALL_AMPLITUDE", 0.25);
    tokio::spawn(async move {
        let mut tone = ToneMic::new(env_f64("CALL_HZ", 743.0), amplitude);
        loop {
            let mut data = vec![0i16; 480];
            tone.fill(&mut data);
            let frame = AudioFrame {
                data: Cow::Owned(data),
                sample_rate: RATE,
                num_channels: 1,
                samples_per_channel: 480,
            };
            // Paces itself: blocks once the source's queue is full.
            if voice.capture_frame(&frame).await.is_err() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    });
    let track = LocalAudioTrack::create_audio_track("voice", RtcAudioSource::Native(source));
    room.local_participant()
        .publish_track(
            LocalTrack::Audio(track),
            TrackPublishOptions {
                source: TrackSource::Microphone,
                ..Default::default()
            },
        )
        .await
        .expect("voice publishes");

    let judges = Arc::new(Mutex::new(None::<mpsc::SyncSender<Vec<f64>>>));
    let deadline = tokio::time::sleep(duration);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            event = events.recv() => {
                let Some(event) = event else { break };
                if let RoomEvent::TrackSubscribed { track: RemoteTrack::Audio(track), publication, participant } = event {
                    let source = publication.source();
                    emit(json!({"ev":"track_subscribed","t":now_ms(),"from":participant.identity().to_string(),
                        "source":format!("{source:?}")}));
                    if source != TrackSource::ScreenshareAudio {
                        continue;
                    }
                    let tx = spawn_judges("viewer", None);
                    *judges.lock().unwrap_or_else(|p| p.into_inner()) = Some(tx.clone());
                    tokio::spawn(async move {
                        let mut stream = NativeAudioStream::new(track.rtc_track(), RATE as i32, 2);
                        let mut first = true;
                        while let Some(frame) = stream.next().await {
                            if first {
                                emit(json!({"ev":"first_frame","t":now_ms(),"channels":frame.num_channels}));
                                first = false;
                            }
                            let samples: Vec<f64> = if frame.num_channels == 1 {
                                frame.data.iter().flat_map(|s| { let v = f64::from(*s) / 32768.0; [v, v] }).collect()
                            } else {
                                frame.data.iter().map(|s| f64::from(*s) / 32768.0).collect()
                            };
                            let _ = tx.try_send(samples);
                        }
                    });
                }
            }
        }
    }
    let _ = room.close().await;
    emit(json!({"ev":"done","t":now_ms()}));
}

fn main() {
    log::set_logger(&JsonLog).expect("no logger set yet");
    log::set_max_level(if env("LOG_DEBUG").is_some() {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    });
    let mode = env("MODE").unwrap_or_else(|| "local".into());
    match mode.as_str() {
        "local" => run_local(None),
        "desktop" => run_local(env("RECORD")),
        "share" | "viewer" => {
            let runtime = tokio::runtime::Runtime::new().expect("runtime");
            runtime.block_on(async {
                if mode == "share" {
                    run_share().await
                } else {
                    run_viewer().await
                }
            });
        }
        other => panic!("unknown MODE {other}"),
    }
}
