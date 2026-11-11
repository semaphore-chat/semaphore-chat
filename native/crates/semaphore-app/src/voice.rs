//! Voice: the LiveKit engine wired to core and to the stage.
//!
//! - The engine reports to core: a task forwards `LiveKitEngine::subscribe()` to
//!   `Core::ingest_media` with the call number each report carries.
//! - Rejoins get fresh tokens from `Core::voice_token`, on the net runtime where reqwest lives.
//! - The presence heartbeat: `Core::refresh_voice_presence` on an interval for the app's life.
//! - Frames go from the engine's media threads straight into the window's `VideoFrames`.
//! - The stage's buttons come back here as a `VoiceController`.

use crate::runtime::{Activity, Exec};
use semaphore_core::Core;
use semaphore_core::model::VideoDemand;
use semaphore_core::platform::CoreError;
use semaphore_media_livekit::audio::AudioDevices;
use semaphore_media_livekit::{LiveKitEngine, TokenSource, VideoFrameRef, VideoSink};
use semaphore_ui::voice::{TileDemand, VideoFrames, VoiceController};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

/// How often the server hears this client is still in its call. Its presence TTL is 90 s.
pub const HEARTBEAT: Duration = Duration::from_secs(30);

/// Fresh tokens for the engine's rejoins, from core, on the net runtime.
struct CoreTokens {
    core: Arc<Core>,
    net: tokio::runtime::Handle,
}

impl TokenSource for CoreTokens {
    fn token(&self) -> Pin<Box<dyn Future<Output = Result<String, CoreError>> + Send>> {
        let core = self.core.clone();
        let task = self.net.spawn(async move { core.voice_token().await });
        Box::pin(async move {
            task.await.map_err(|error| CoreError::Failed {
                message: error.to_string(),
            })?
        })
    }
}

/// Frames into whichever window's `VideoFrames` is attached. None until the window exists.
#[derive(Default)]
pub struct FramesSink {
    frames: RwLock<Option<Arc<VideoFrames>>>,
}

impl FramesSink {
    pub fn attach(&self, frames: Arc<VideoFrames>) {
        *self.frames.write().unwrap_or_else(|p| p.into_inner()) = Some(frames);
    }

    fn frames(&self) -> Option<Arc<VideoFrames>> {
        self.frames
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
}

impl VideoSink for FramesSink {
    fn on_frame(&self, track_sid: &str, frame: &VideoFrameRef<'_>) {
        if let Some(frames) = self.frames() {
            frames.push(
                track_sid,
                &gpui_kit::Nv12Frame {
                    width: frame.width,
                    height: frame.height,
                    y: frame.y,
                    y_stride: frame.y_stride,
                    uv: frame.uv,
                    uv_stride: frame.uv_stride,
                },
            );
        }
    }

    fn on_track_ended(&self, track_sid: &str) {
        if let Some(frames) = self.frames() {
            frames.end(track_sid);
        }
    }
}

/// Wires an engine to core. Call once, from the thread that built them, before any join.
pub fn wire(
    engine: &Arc<LiveKitEngine>,
    core: &Arc<Core>,
    net: &tokio::runtime::Runtime,
    heartbeat: Duration,
    activity: Arc<Activity>,
) -> Arc<FramesSink> {
    engine.set_token_source(Arc::new(CoreTokens {
        core: core.clone(),
        net: net.handle().clone(),
    }));
    let sink = Arc::new(FramesSink::default());
    engine.set_video_sink(sink.clone());

    let mut reports = engine.subscribe();
    let forwarded = core.clone();
    net.spawn(async move {
        loop {
            let (call, voice) = {
                let snapshot = reports.borrow_and_update();
                (snapshot.call, snapshot.voice.clone())
            };
            forwarded.ingest_media(call, voice);
            activity.bump();
            if reports.changed().await.is_err() {
                return;
            }
        }
    });

    let beating = core.clone();
    net.spawn(async move {
        let mut interval = tokio::time::interval(heartbeat);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            // Nothing outside a connected call, so a plain timer is enough.
            beating.refresh_voice_presence().await;
        }
    });
    sink
}

/// What the app shows of the audio share, beside core's view of the call.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ShareState {
    pub on: bool,
    pub error: Option<String>,
}

/// Asks of the voice UI the app answers on its own thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceRequest {
    /// The share changed, or failed: draw again.
    Redraw,
    OpenDevices,
}

/// The stage's buttons. Mute, deafen, leave and tiles go through core; push-to-talk, devices and the
/// audio share are the engine's alone.
pub struct AppVoice {
    pub core: Arc<Core>,
    pub engine: Arc<LiveKitEngine>,
    pub exec: Exec,
    pub share: Arc<Mutex<ShareState>>,
    pub requests: async_channel::Sender<VoiceRequest>,
}

impl AppVoice {
    pub fn share(&self) -> ShareState {
        self.share.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn devices(&self) -> AudioDevices {
        self.engine.devices()
    }

    /// Stops sharing, as a call ending does.
    pub fn stop_share(&self) {
        self.engine.stop_system_audio();
        *self.share.lock().unwrap_or_else(|p| p.into_inner()) = ShareState::default();
    }
}

impl VoiceController for AppVoice {
    fn set_muted(&self, muted: bool) {
        let core = self.core.clone();
        self.exec.fire(async move {
            let _ = core.set_muted(muted).await;
        });
    }

    fn set_deafened(&self, deafened: bool) {
        let core = self.core.clone();
        self.exec.fire(async move {
            if let Err(error) = core.set_deafened(deafened).await {
                log::warn!("deafening: {error}");
            }
        });
    }

    fn leave(&self) {
        self.stop_share();
        let core = self.core.clone();
        self.exec.fire(async move {
            if let Err(error) = core.leave_voice().await {
                log::warn!("leaving voice: {error}");
            }
        });
    }

    fn set_video_demands(&self, demands: Vec<TileDemand>) {
        let demands: Vec<VideoDemand> = demands;
        self.core.set_video_demands(demands);
    }

    fn ptt_pressed(&self, pressed: bool) {
        self.engine.set_ptt_pressed(pressed);
    }

    fn open_settings(&self) {
        let _ = self.requests.try_send(VoiceRequest::OpenDevices);
    }

    /// Off the UI thread: opening a PipeWire capture can take a moment.
    fn set_system_audio(&self, on: bool) {
        let (engine, share, requests) = (
            self.engine.clone(),
            self.share.clone(),
            self.requests.clone(),
        );
        self.exec.handle().spawn_blocking(move || {
            let next = if on {
                let started = match semaphore_sysaudio::platform_capture() {
                    Some(capture) => engine.start_system_audio(&*capture),
                    None => Err("this platform can't capture system audio".into()),
                };
                match started {
                    Ok(()) => ShareState {
                        on: true,
                        error: None,
                    },
                    Err(error) => {
                        log::warn!("sharing audio: {error}");
                        ShareState {
                            on: false,
                            error: Some(error),
                        }
                    }
                }
            } else {
                engine.stop_system_audio();
                ShareState::default()
            };
            *share.lock().unwrap_or_else(|p| p.into_inner()) = next;
            let _ = requests.try_send(VoiceRequest::Redraw);
        });
    }
}
