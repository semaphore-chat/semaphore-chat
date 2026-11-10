//! U11's proof rig. Everything here runs against a real LiveKit server (`scripts/lk-stack.sh`).
//!
//!   voice_rig publish <room> <cameras> <screens>   real simulcast VP8 from generated video
//!   voice_rig participant                          one peer for the rejoin runs: JSON lines on stdout
//!   voice_rig bench <room> <out.json> <seconds> <rounds>
//!                                                  what each receive policy costs this process
//!   voice_rig shot <room> <w> <h> <layout> <out.png>  real frames through the real renderer, offscreen
//!   voice_rig window <room> <seconds> [--rgba]     a real window under a real event loop
//!
//! Lives in `examples/` so the media crate's own deps stay free of GPUI.

#[path = "common/token.rs"]
mod token;

use anyhow::{Context as _, Result, bail};
use gpui_kit::assets::Assets;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use livekit::options::{
    DegradationPreference, TrackPublishOptions, VideoCodec, VideoEncoding, VideoPreset,
};
use livekit::track::{LocalTrack, LocalVideoTrack, TrackSource};
use livekit::webrtc::prelude::{RtcVideoSource, VideoResolution};
use livekit::webrtc::video_frame::{I420Buffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::{Room, RoomOptions};
use semaphore_core::platform::MediaEngine;
use semaphore_media_livekit::audio::apm::AudioProcessing;
use semaphore_media_livekit::audio::virtual_io::VirtualIo;
use semaphore_media_livekit::testing::{SpeakerTap, ToneMic};
use semaphore_media_livekit::{
    ConnectionQualityView, EngineOptions, LiveKitEngine, MediaSnapshot, VideoDemand, VideoFrameRef,
    VideoSink,
};
use semaphore_ui::voice::{
    QualityLevel, TileDemand, VideoFrames, VideoPath, VoiceController, VoiceStage, VoiceStageModel,
    video_window_options,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("{name} is required"))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

/// Generated video an encoder has to work for: scrolling noise and a moving block, in a hue per
/// publisher, with `index + 1` white squares in the corner to tell them apart by eye.
struct Pattern {
    texture: Vec<u8>,
    texture_w: usize,
    texture_h: usize,
    width: usize,
    height: usize,
    u: u8,
    v: u8,
    index: usize,
    frame: usize,
}

impl Pattern {
    fn new(width: usize, height: usize, index: usize) -> Self {
        let (texture_w, texture_h) = (width * 2, height * 2);
        let mut state = 0x9E37_79B9_7F4A_7C15u64.wrapping_mul(index as u64 + 1);
        let mut texture = vec![0u8; texture_w * texture_h];
        // Smooth blobs plus fine noise, roughly what a webcam gives after denoise, so the encoder
        // spends bits like it does on a person, not like it does on static.
        for row in 0..texture_h {
            for col in 0..texture_w {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                let noise = (state >> 61) as f32;
                let blob = ((col as f32 / 37.).sin() * (row as f32 / 23.).cos() + 1.) * 60.;
                texture[row * texture_w + col] = (60. + blob + noise) as u8;
            }
        }
        let angle = index as f32 * 2.399963;
        Self {
            texture,
            texture_w,
            texture_h,
            width,
            height,
            u: (128. + 70. * angle.cos()) as u8,
            v: (128. + 70. * angle.sin()) as u8,
            index,
            frame: 0,
        }
    }

    fn fill(&mut self, buffer: &mut I420Buffer) {
        let (stride_y, _, _) = buffer.strides();
        let (y, u, v) = buffer.data_mut();
        let frame = self.frame;
        self.frame += 1;
        let dx = (frame * 3) % (self.texture_w - self.width);
        let dy = (frame * 2) % (self.texture_h - self.height);
        for row in 0..self.height {
            let source = (row + dy) * self.texture_w + dx;
            y[row * stride_y as usize..][..self.width]
                .copy_from_slice(&self.texture[source..source + self.width]);
        }
        // A bright block doing laps, as a moving subject would.
        let block = self.height / 5;
        let lap = 2 * (self.width - block);
        let position = (frame * 7) % lap;
        let x = if position < self.width - block {
            position
        } else {
            lap - position
        };
        let top = self.height / 2 - block / 2;
        for row in top..top + block {
            y[row * stride_y as usize + x..][..block].fill(230);
        }
        // Which publisher is this.
        let square = self.height / 16;
        for n in 0..=self.index {
            let left = square + n * square * 3 / 2;
            for row in square..square * 2 {
                y[row * stride_y as usize + left..][..square].fill(255);
            }
        }
        u.fill(self.u);
        v.fill(self.v);
    }
}

struct Publisher {
    identity: String,
    width: u32,
    height: u32,
    fps: u32,
    screen: bool,
}

async fn publish_one(
    url: String,
    room_name: String,
    publisher: Publisher,
    index: usize,
) -> Result<Room> {
    let token = token::dev_token(&room_name, &publisher.identity, &publisher.identity);
    let mut options = RoomOptions::default();
    options.auto_subscribe = false;
    options.dynacast = true;
    let (room, _events) = Room::connect(&url, &token, options).await?;
    let source = NativeVideoSource::new(
        VideoResolution {
            width: publisher.width,
            height: publisher.height,
        },
        publisher.screen,
    );
    let track = LocalVideoTrack::create_video_track(
        if publisher.screen { "screen" } else { "camera" },
        RtcVideoSource::Native(source.clone()),
    );
    // The numbers from docs-site/docs/architecture/voice-video-quality.md.
    let publish_options = if publisher.screen {
        TrackPublishOptions {
            source: TrackSource::Screenshare,
            video_codec: VideoCodec::VP8,
            simulcast: true,
            video_encoding: Some(VideoEncoding {
                max_bitrate: 9_000_000,
                max_framerate: 60.0,
            }),
            simulcast_layers: Some(vec![
                VideoPreset::new(publisher.width / 4, publisher.height / 4, 400_000, 15.0),
                VideoPreset::new(publisher.width / 2, publisher.height / 2, 1_900_000, 30.0),
            ]),
            // On a shared machine libwebrtc's CPU adaptation otherwise cut this share from 57 fps
            // to 16 over a run, and the bench would have credited that to the policy under test.
            degradation_preference: Some(DegradationPreference::MaintainFramerateAndResolution),
            ..Default::default()
        }
    } else {
        TrackPublishOptions {
            source: TrackSource::Camera,
            video_codec: VideoCodec::VP8,
            simulcast: true,
            video_encoding: Some(VideoEncoding {
                max_bitrate: 1_700_000,
                max_framerate: 30.0,
            }),
            degradation_preference: Some(DegradationPreference::MaintainFramerateAndResolution),
            ..Default::default()
        }
    };
    room.local_participant()
        .publish_track(LocalTrack::Video(track), publish_options)
        .await?;
    let (width, height, fps) = (publisher.width, publisher.height, publisher.fps);
    std::thread::spawn(move || {
        let mut pattern = Pattern::new(width as usize, height as usize, index);
        let period = Duration::from_secs_f64(1.0 / f64::from(fps));
        let mut next = Instant::now();
        let mut buffer = I420Buffer::new(width, height);
        loop {
            pattern.fill(&mut buffer);
            let timestamp_us = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_micros() as i64);
            let frame = VideoFrame {
                rotation: VideoRotation::VideoRotation0,
                timestamp_us,
                frame_metadata: None,
                buffer,
            };
            source.capture_frame(&frame);
            buffer = frame.buffer;
            // Pacing a capture clock.
            next += period;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                next = now;
            }
        }
    });
    Ok(room)
}

fn publish(room: &str, cameras: usize, screens: usize) -> Result<()> {
    let url = env("LK_URL")?;
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        let mut rooms = Vec::new();
        for index in 0..cameras + screens {
            let screen = index >= cameras;
            let publisher = if screen {
                Publisher {
                    identity: format!("screen-{}", index - cameras + 1),
                    width: 1920,
                    height: 1080,
                    fps: 60,
                    screen: true,
                }
            } else {
                Publisher {
                    identity: format!("cam-{}", index + 1),
                    width: 1280,
                    height: 720,
                    fps: 30,
                    screen: false,
                }
            };
            let joined = publish_one(url.clone(), room.to_owned(), publisher, index).await?;
            rooms.push(joined);
        }
        println!("publishing {} tracks", rooms.len());
        // Run until killed: the orchestrator owns our lifetime.
        std::future::pending::<()>().await;
        Ok(())
    })
}

/// One peer of the rejoin runs. Hears by tone and says so, four times a second.
fn participant() -> Result<()> {
    let (url, room, identity) = (env("LK_URL")?, env("LK_ROOM")?, env("IDENTITY")?);
    let hz: f64 = env("HZ")?.parse()?;
    let others: Vec<(String, f64)> = env("TONES")?
        .split(',')
        .filter_map(|pair| {
            let (name, value) = pair.split_once(':')?;
            Some((name.to_owned(), value.parse().ok()?))
        })
        .collect();
    let tap = SpeakerTap::new(9600);
    // REAL=1 uses the machine's actual sound devices, through cpal, for `proof.py real-audio`.
    let engine = if std::env::var("REAL").is_ok_and(|value| value == "1") {
        LiveKitEngine::new(EngineOptions {
            processing: AudioProcessing::OFF,
            device_poll: Duration::from_millis(500),
            ..EngineOptions::default()
        })
    } else {
        let io = VirtualIo::new();
        let mut tone = ToneMic::new(hz, 0.2);
        io.set_mic(Box::new(move |frame| tone.fill(frame)));
        let sink = tap.clone();
        io.set_speaker(Box::new(move |frame| sink.push(frame)));
        LiveKitEngine::new(EngineOptions {
            audio_io: Arc::new(io),
            processing: AudioProcessing::OFF,
            ..EngineOptions::default()
        })
    };
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(engine.connect(url, token::dev_token(&room, &identity, &identity), 1))?;
    let want_video = std::env::var("WANT_VIDEO").is_ok_and(|value| value == "1");
    let started = Instant::now();
    loop {
        let snapshot = engine.snapshot();
        if want_video {
            engine.set_video_demands(demands_for_all(&snapshot, 640, 360));
        }
        let heard: serde_json::Map<String, serde_json::Value> = others
            .iter()
            .map(|(name, hz)| (name.clone(), serde_json::json!(tap.rms_at(*hz).round())))
            .collect();
        let video: serde_json::Map<String, serde_json::Value> = engine
            .video_stats()
            .into_iter()
            .map(|stats| (stats.identity, serde_json::json!(stats.frames)))
            .collect();
        println!(
            "{}",
            serde_json::json!({
                "t": now_ms(),
                "uptime_s": started.elapsed().as_secs(),
                "status": format!("{:?}", snapshot.voice.status),
                "rejoins": snapshot.rejoins,
                "heard": heard,
                "video": video,
                "people": snapshot.voice.participants.len(),
                "last_error": snapshot.last_error,
                "audio_error": snapshot.audio_error,
                "output_latency_ms": engine.output_latency_ms(),
                "inputs": snapshot.devices.inputs.iter().map(|d| (d.id.clone(), d.name.clone(), d.is_default)).collect::<Vec<_>>(),
                "outputs": snapshot.devices.outputs.iter().map(|d| (d.id.clone(), d.name.clone(), d.is_default)).collect::<Vec<_>>(),
            })
        );
        // A reporting interval.
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn demands_for_all(snapshot: &MediaSnapshot, width: u32, height: u32) -> Vec<VideoDemand> {
    snapshot
        .voice
        .participants
        .iter()
        .flat_map(|person| [&person.camera, &person.screen_share])
        .flatten()
        .map(|track| VideoDemand {
            track_sid: track.track_sid.clone(),
            width_px: width,
            height_px: height,
            focused: false,
        })
        .collect()
}

/// utime + stime of this process, in seconds of one core.
fn cpu_seconds() -> Result<f64> {
    let stat = std::fs::read_to_string("/proc/self/stat")?;
    let tail = stat.rsplit_once(") ").context("stat format")?.1;
    let fields: Vec<&str> = tail.split(' ').collect();
    let ticks: f64 = fields[11].parse::<f64>()? + fields[12].parse::<f64>()?;
    Ok(ticks / 100.0)
}

/// CPU per thread name, so decode can be told from everything else.
fn thread_cpu() -> HashMap<String, f64> {
    let mut totals = HashMap::new();
    let Ok(tasks) = std::fs::read_dir("/proc/self/task") else {
        return totals;
    };
    for task in tasks.flatten() {
        let Ok(stat) = std::fs::read_to_string(task.path().join("stat")) else {
            continue;
        };
        let Some((head, tail)) = stat.rsplit_once(") ") else {
            continue;
        };
        let name = head.split_once(" (").map_or("?", |(_, name)| name);
        // Decoders are numbered per stream; the family is what matters.
        let family: String = name.trim_end_matches(|c: char| c.is_ascii_digit()).into();
        let fields: Vec<&str> = tail.split(' ').collect();
        let ticks =
            fields[11].parse::<f64>().unwrap_or(0.0) + fields[12].parse::<f64>().unwrap_or(0.0);
        *totals.entry(family).or_insert(0.0) += ticks / 100.0;
    }
    totals
}

/// What `bench` receives into: the frame is converted and handed over, and no further.
struct CountingSink;
impl VideoSink for CountingSink {
    fn on_frame(&self, _: &str, _: &VideoFrameRef<'_>) {}
    fn on_track_ended(&self, _: &str) {}
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Want {
    Off,
    Low,
    Medium,
    High,
}

impl Want {
    /// A tile size whose layer is this one, through the same rule the UI uses.
    fn demand(self, sid: &str, width: u32, height: u32) -> Option<VideoDemand> {
        let scale = match self {
            Self::Off => return None,
            Self::Low => 0.2,
            Self::Medium => 0.45,
            Self::High => 1.0,
        };
        Some(VideoDemand {
            track_sid: sid.to_owned(),
            width_px: (f64::from(width) * scale) as u32,
            height_px: (f64::from(height) * scale) as u32,
            focused: false,
        })
    }

    fn expected_height(self, full: u32) -> Option<u32> {
        match self {
            Self::Off => None,
            Self::Low => Some(full / 4),
            Self::Medium => Some(full / 2),
            Self::High => Some(full),
        }
    }
}

struct Condition {
    name: &'static str,
    cameras: Want,
    screen: Want,
    /// How many cameras get `cameras`; the rest are off screen.
    visible_cameras: usize,
}

const CONDITIONS: [Condition; 8] = [
    // T1's load: the worst case.
    Condition {
        name: "all_high",
        cameras: Want::High,
        screen: Want::High,
        visible_cameras: 9,
    },
    // A 3x3 grid on a 1080p screen, with the share on stage.
    Condition {
        name: "tiles_medium_share_high",
        cameras: Want::Medium,
        screen: Want::High,
        visible_cameras: 9,
    },
    // The stage layout's strip: thumbnails around a share.
    Condition {
        name: "tiles_low_share_high",
        cameras: Want::Low,
        screen: Want::High,
        visible_cameras: 9,
    },
    // A strip of which only 4 fit, the rest scrolled away.
    Condition {
        name: "4_tiles_low_share_high",
        cameras: Want::Low,
        screen: Want::High,
        visible_cameras: 4,
    },
    // No share: a plain nine-way call.
    Condition {
        name: "tiles_high_no_share",
        cameras: Want::High,
        screen: Want::Off,
        visible_cameras: 9,
    },
    Condition {
        name: "tiles_medium_no_share",
        cameras: Want::Medium,
        screen: Want::Off,
        visible_cameras: 9,
    },
    Condition {
        name: "tiles_low_no_share",
        cameras: Want::Low,
        screen: Want::Off,
        visible_cameras: 9,
    },
    // Nothing on screen: what a paused call costs.
    Condition {
        name: "all_off_screen",
        cameras: Want::Off,
        screen: Want::Off,
        visible_cameras: 0,
    },
];

fn bench(room: &str, out: &str, seconds: u64, rounds: usize) -> Result<()> {
    let url = env("LK_URL")?;
    let engine = Arc::new(LiveKitEngine::new(EngineOptions {
        audio_io: Arc::new(VirtualIo::new()),
        processing: AudioProcessing::OFF,
        ..EngineOptions::default()
    }));
    engine.set_video_sink(Arc::new(CountingSink));
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(engine.connect(url, token::dev_token(room, "bench", "bench"), 1))?;
    eprintln!("joined; waiting for 9 cameras and a share");
    let deadline = Instant::now() + Duration::from_secs(120);
    let snapshot = loop {
        let snapshot = engine.snapshot();
        let cameras = snapshot
            .voice
            .participants
            .iter()
            .filter(|p| p.camera.is_some())
            .count();
        let screens = snapshot
            .voice
            .participants
            .iter()
            .filter(|p| p.screen_share.is_some())
            .count();
        if cameras >= 9 && screens >= 1 {
            break snapshot;
        }
        if Instant::now() > deadline {
            bail!("only {cameras} cameras and {screens} shares after 120 s");
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let cameras: Vec<_> = snapshot
        .voice
        .participants
        .iter()
        .filter_map(|p| p.camera.clone())
        .collect();
    let screen = snapshot
        .voice
        .participants
        .iter()
        .find_map(|p| p.screen_share.clone())
        .context("a share")?;

    let mut results = Vec::new();
    for round in 0..rounds {
        for condition in &CONDITIONS {
            let mut demands = Vec::new();
            for track in cameras.iter().take(condition.visible_cameras) {
                demands.extend(condition.cameras.demand(
                    &track.track_sid,
                    track.width,
                    track.height,
                ));
            }
            demands.extend(
                condition
                    .screen
                    .demand(&screen.track_sid, screen.width, screen.height),
            );
            engine.set_video_demands(demands);

            // Bounded wait on the condition itself: the decoder really is outputting the asked-for
            // size for every track, and anything off screen has stopped.
            let expected: HashMap<String, Option<u32>> = cameras
                .iter()
                .enumerate()
                .map(|(index, track)| {
                    let want = if index < condition.visible_cameras {
                        condition.cameras
                    } else {
                        Want::Off
                    };
                    (track.track_sid.clone(), want.expected_height(track.height))
                })
                .chain(std::iter::once((
                    screen.track_sid.clone(),
                    condition.screen.expected_height(screen.height),
                )))
                .collect();
            let settle_started = Instant::now();
            let mut settled = false;
            let mut previous: HashMap<String, u64> = HashMap::new();
            while settle_started.elapsed() < Duration::from_secs(45) {
                std::thread::sleep(Duration::from_millis(500));
                let stats = engine.video_stats();
                let mut good = true;
                for (sid, want) in &expected {
                    let found = stats.iter().find(|s| &s.track_sid == sid);
                    let frames = found.map_or(0, |s| s.frames);
                    let moved = frames > previous.get(sid).copied().unwrap_or(0);
                    good &= match want {
                        Some(height) => moved && found.is_some_and(|s| s.height == *height),
                        None => !moved,
                    };
                    previous.insert(sid.clone(), frames);
                }
                if good {
                    settled = true;
                    break;
                }
            }
            let settle_ms = settle_started.elapsed().as_millis() as u64;
            // Lets rate control and the SFU's forwarder ramp up on the new layers, so the window
            // measures the steady state and not the climb.
            std::thread::sleep(Duration::from_secs(5));

            let before_cpu = cpu_seconds()?;
            let before_threads = thread_cpu();
            let before_frames: HashMap<String, u64> = engine
                .video_stats()
                .into_iter()
                .map(|s| (s.track_sid, s.frames))
                .collect();
            let before_bytes = runtime.block_on(engine.inbound_video_bytes());
            let started = Instant::now();
            // The measurement window, sliced so a cost that changes over time shows as a trend and
            // not as round-to-round noise.
            let mut cpu_series = Vec::new();
            for _ in 0..seconds.div_ceil(5) {
                let slice_start = cpu_seconds()?;
                let slice_clock = Instant::now();
                std::thread::sleep(Duration::from_secs(5));
                let share = (cpu_seconds()? - slice_start) / slice_clock.elapsed().as_secs_f64();
                cpu_series.push((share * 1000.0).round() / 10.0);
            }
            let elapsed = started.elapsed().as_secs_f64();
            let cpu = (cpu_seconds()? - before_cpu) / elapsed;
            let after_threads = thread_cpu();
            let mut by_thread: Vec<(String, f64)> = after_threads
                .iter()
                .map(|(name, total)| {
                    (
                        name.clone(),
                        (total - before_threads.get(name).copied().unwrap_or(0.0)) / elapsed,
                    )
                })
                .filter(|(_, share)| *share > 0.005)
                .collect();
            by_thread.sort_by(|a, b| b.1.total_cmp(&a.1));
            let after_bytes = runtime.block_on(engine.inbound_video_bytes());
            let stats = engine.video_stats();
            let fps_of = |sid: &str| {
                let frames = stats
                    .iter()
                    .find(|s| s.track_sid == sid)
                    .map_or(0, |s| s.frames);
                (frames - before_frames.get(sid).copied().unwrap_or(0)) as f64 / elapsed
            };
            let camera_fps: Vec<f64> = cameras.iter().map(|t| fps_of(&t.track_sid)).collect();
            let camera_heights: Vec<u32> = cameras
                .iter()
                .map(|t| {
                    stats
                        .iter()
                        .find(|s| s.track_sid == t.track_sid)
                        .map_or(0, |s| s.height)
                })
                .collect();
            let mbps: f64 = after_bytes
                .iter()
                .map(|(sid, bytes)| {
                    bytes.saturating_sub(before_bytes.get(sid).copied().unwrap_or(0))
                })
                .sum::<u64>() as f64
                * 8.0
                / 1_000_000.0
                / elapsed;
            let line = serde_json::json!({
                "round": round,
                "condition": condition.name,
                "settled": settled,
                "settle_ms": settle_ms,
                "cpu_percent_of_core": (cpu * 1000.0).round() / 10.0,
                "cpu_series": cpu_series,
                "by_thread": by_thread.iter().take(8).map(|(n, c)| (n.clone(), (c * 1000.0).round() / 10.0)).collect::<Vec<_>>(),
                "camera_fps": camera_fps.iter().map(|f| (f * 10.0).round() / 10.0).collect::<Vec<_>>(),
                "camera_heights": camera_heights,
                "screen_fps": (fps_of(&screen.track_sid) * 10.0).round() / 10.0,
                "screen_height": stats.iter().find(|s| s.track_sid == screen.track_sid).map_or(0, |s| s.height),
                "inbound_mbps": (mbps * 100.0).round() / 100.0,
                "loadavg": std::fs::read_to_string("/proc/loadavg").unwrap_or_default().trim(),
            });
            println!("{line}");
            results.push(line);
            std::fs::write(out, serde_json::to_string_pretty(&results)?)?;
        }
    }
    runtime.block_on(engine.disconnect());
    Ok(())
}

/// The adapters the real app needs too. U13: this is all of the wiring.
struct FramesSink(Arc<VideoFrames>);
impl VideoSink for FramesSink {
    fn on_frame(&self, track_sid: &str, frame: &VideoFrameRef<'_>) {
        self.0.push(
            track_sid,
            &Nv12Frame {
                width: frame.width,
                height: frame.height,
                y: frame.y,
                y_stride: frame.y_stride,
                uv: frame.uv,
                uv_stride: frame.uv_stride,
            },
        );
    }
    fn on_track_ended(&self, track_sid: &str) {
        self.0.end(track_sid);
    }
}

struct EngineController(Arc<LiveKitEngine>);
impl VoiceController for EngineController {
    fn set_muted(&self, muted: bool) {
        self.0.set_muted(muted);
    }
    fn set_deafened(&self, deafened: bool) {
        self.0.set_deafened(deafened);
    }
    fn leave(&self) {
        let engine = self.0.clone();
        std::thread::spawn(move || {
            if let Ok(runtime) = tokio::runtime::Runtime::new() {
                runtime.block_on(engine.disconnect());
            }
        });
    }
    fn set_video_demands(&self, demands: Vec<TileDemand>) {
        self.0.set_video_demands(
            demands
                .into_iter()
                .map(|demand| VideoDemand {
                    track_sid: demand.track_sid,
                    width_px: demand.width_px,
                    height_px: demand.height_px,
                    focused: demand.focused,
                })
                .collect(),
        );
    }
}

fn to_model(snapshot: &MediaSnapshot, channel: &str) -> VoiceStageModel {
    let level = |quality: ConnectionQualityView| match quality {
        ConnectionQualityView::Unknown => QualityLevel::Unknown,
        ConnectionQualityView::Excellent => QualityLevel::Excellent,
        ConnectionQualityView::Good => QualityLevel::Good,
        ConnectionQualityView::Poor => QualityLevel::Poor,
        ConnectionQualityView::Lost => QualityLevel::Lost,
    };
    VoiceStageModel {
        voice: snapshot.voice.clone(),
        channel_name: channel.to_owned(),
        is_dm: false,
        quality: snapshot
            .quality
            .iter()
            .map(|(id, q)| (id.clone(), level(*q)))
            .collect(),
        local_quality: level(snapshot.local_quality),
        reconnect_attempt: snapshot.rejoin_attempt,
        ptt: None,
        always_show_overlays: true,
        system_audio: false,
        system_audio_error: None,
    }
}

fn viewer_engine() -> Result<(Arc<LiveKitEngine>, tokio::runtime::Runtime)> {
    let engine = Arc::new(LiveKitEngine::new(EngineOptions {
        audio_io: Arc::new(VirtualIo::new()),
        processing: AudioProcessing::OFF,
        ..EngineOptions::default()
    }));
    Ok((engine, tokio::runtime::Runtime::new()?))
}

/// Real frames through the real renderer. Asserts that every tile on screen is getting frames of
/// the layer its size calls for, and off-screen ones none.
fn shot(room: &str, width: f32, height: f32, layout: &str, out: &str) -> Result<()> {
    let (engine, runtime) = viewer_engine()?;
    let url = env("LK_URL")?;
    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    cx.update(gpui_kit::init);
    let controller: Arc<dyn VoiceController> = Arc::new(EngineController(engine.clone()));
    let frames_slot = std::rc::Rc::new(std::cell::RefCell::new(None));
    let stage_slot = frames_slot.clone();
    let engine_for_window = engine.clone();
    let (handle, stage) = cx.update(|cx| {
        gpui_kit::open_window(
            video_window_options(WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Default::default(),
                    size: size(px(width), px(height)),
                })),
                focus: false,
                show: false,
                ..Default::default()
            }),
            cx,
            |window, cx| {
                let frames = VideoFrames::for_window(window);
                engine_for_window.set_video_sink(Arc::new(FramesSink(frames.clone())));
                *stage_slot.borrow_mut() = Some(frames.path());
                cx.new(|cx| {
                    VoiceStage::new(VoiceStageModel::default(), frames, controller, window, cx)
                })
            },
        )
    })?;
    eprintln!("video path: {:?}", frames_slot.borrow());
    runtime.block_on(engine.connect(url, token::dev_token(room, "viewer", "Viewer"), 1))?;

    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        let snapshot = engine.snapshot();
        let mut model = to_model(&snapshot, "general-voice");
        if layout == "grid-no-share" {
            for person in &mut model.voice.participants {
                person.screen_share = None;
            }
            model
                .voice
                .participants
                .retain(|person| person.camera.is_some() || person.is_self);
        }
        cx.update(|cx| stage.update(cx, |stage, cx| stage.set_model(model.clone(), cx)));
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))?;

        // Done when everything that should show a frame has been drawing for a moment.
        let stats = engine.video_stats();
        let wanted: usize = model
            .voice
            .participants
            .iter()
            .flat_map(|person| [&person.camera, &person.screen_share])
            .flatten()
            .count();
        let moving = stats
            .iter()
            .filter(|s| s.frames > 45 || (s.is_screen_share && s.frames > 90))
            .count();
        // Only what fits on screen is ever received: 9 in a desktop grid, 4 and a share around a
        // stage, 3 rows on a phone.
        let minimum_tiles: usize = if width < 768.0 {
            3
        } else if layout == "grid-no-share" {
            9
        } else {
            5
        };
        if wanted >= 9 && moving >= minimum_tiles.min(wanted) {
            break;
        }
        if Instant::now() > deadline {
            let frames: Vec<_> = stats
                .iter()
                .map(|s| (s.identity.clone(), s.frames, s.height))
                .collect();
            bail!("frames never settled: {wanted} tracks wanted, {frames:?}");
        }
        std::thread::sleep(Duration::from_millis(33));
    }
    // A last draw, with the newest frames.
    cx.update_window(handle, |_, window, cx| window.render_frame(cx))?;
    let image = cx
        .capture_screenshot(handle)
        .context("offscreen rendering")?;
    image.save(out).with_context(|| format!("writing {out}"))?;
    let stats: Vec<_> = engine
        .video_stats()
        .into_iter()
        .map(|s| serde_json::json!({"who": s.identity, "frames": s.frames, "h": s.height, "screen": s.is_screen_share}))
        .collect();
    println!(
        "{}",
        serde_json::json!({"png": out, "w": image.width(), "h": image.height(), "tracks": stats})
    );
    runtime.block_on(engine.disconnect());
    Ok(())
}

/// A real window on a real event loop, so the redraw task actually runs. Counts what gets drawn.
fn window(room: &str, seconds: u64, rgba: bool) -> Result<()> {
    let (engine, runtime) = viewer_engine()?;
    let url = env("LK_URL")?;
    let room = room.to_owned();
    let draws = Arc::new(AtomicU64::new(0));
    application().with_assets(Assets).run(move |cx| {
        gpui_kit::init(cx);
        let engine_for_window = engine.clone();
        let controller: Arc<dyn VoiceController> = Arc::new(EngineController(engine.clone()));
        let draws_in_root = draws.clone();
        let (_window, root) = gpui_kit::open_window(
            video_window_options(WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Default::default(),
                    size: size(px(1280.), px(720.)),
                })),
                ..Default::default()
            }),
            cx,
            |window, cx| {
                let frames = if rgba {
                    VideoFrames::with_path(window, VideoPath::RgbaFallback)
                } else {
                    VideoFrames::for_window(window)
                };
                eprintln!("video path: {:?}", frames.path());
                engine_for_window.set_video_sink(Arc::new(FramesSink(frames.clone())));
                let stage = cx.new(|cx| {
                    VoiceStage::new(VoiceStageModel::default(), frames, controller, window, cx)
                });
                cx.new(|_| CountingRoot { stage, draws: draws_in_root })
            },
        )
        .expect("the window opens");

        runtime
            .block_on(engine.connect(url.clone(), token::dev_token(&room, "window-viewer", "Viewer"), 1))
            .expect("joins");
        let engine = engine.clone();
        let draws = draws.clone();
        let started = Instant::now();
        cx.spawn(async move |cx| {
            let mut last_report = Instant::now();
            let mut last_draws = 0;
            loop {
                cx.background_executor().timer(Duration::from_millis(50)).await;
                let snapshot = engine.snapshot();
                let model = to_model(&snapshot, "general-voice");
                let root = root.clone();
                cx.update(|cx| {
                    root.update(cx, |root, cx| {
                        root.stage.update(cx, |stage, cx| stage.set_model(model, cx));
                    });
                });
                if last_report.elapsed() >= Duration::from_secs(5) {
                    let total = draws.load(Ordering::Relaxed);
                    let frames: Vec<_> = engine
                        .video_stats()
                        .into_iter()
                        .map(|s| (s.identity, s.frames, s.height))
                        .collect();
                    println!(
                        "{}",
                        serde_json::json!({
                            "t": started.elapsed().as_secs(),
                            "draw_fps": (total - last_draws) as f64 / last_report.elapsed().as_secs_f64(),
                            "tracks": frames,
                        })
                    );
                    last_draws = total;
                    last_report = Instant::now();
                }
                if started.elapsed() >= Duration::from_secs(seconds) {
                    cx.update(|cx| cx.quit());
                    return;
                }
            }
        })
        .detach();
    });
    Ok(())
}

struct CountingRoot {
    stage: Entity<VoiceStage>,
    draws: Arc<AtomicU64>,
}

impl Render for CountingRoot {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let draws = self.draws.clone();
        div().size_full().child(self.stage.clone()).child(
            canvas(
                |_, _, _| (),
                move |_, _, _, _| {
                    draws.fetch_add(1, Ordering::Relaxed);
                },
            )
            .absolute()
            .size_0(),
        )
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["publish", room, cameras, screens] => publish(room, cameras.parse()?, screens.parse()?),
        ["participant"] => participant(),
        ["bench", room, out, seconds, rounds] => {
            bench(room, out, seconds.parse()?, rounds.parse()?)
        }
        ["shot", room, width, height, layout, out] => {
            shot(room, width.parse()?, height.parse()?, layout, out)
        }
        ["window", room, seconds] => window(room, seconds.parse()?, false),
        ["window", room, seconds, "--rgba"] => window(room, seconds.parse()?, true),
        _ => bail!("see the top of examples/voice_rig.rs for usage"),
    }
}
