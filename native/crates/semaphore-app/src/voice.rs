//! Voice: the LiveKit engine wired to core and to the stage.
//!
//! - The engine reports to core: a task forwards `LiveKitEngine::subscribe()` to
//!   `Core::ingest_media` with the call number each report carries.
//! - Rejoins get fresh tokens from `Core::voice_token`, on the net runtime where reqwest lives.
//! - The presence heartbeat: `Core::refresh_voice_presence` on an interval for the app's life.
//! - Frames go from the engine's media threads straight into the window's `VideoFrames`.
//! - The stage's buttons come back here as a `VoiceController`.

use crate::runtime::{Activity, Exec};
use crate::settings::ShareSettings;
use semaphore_core::Core;
use semaphore_core::model::{LocalShare, VideoDemand};
use semaphore_core::platform::{CaptureSource, CoreError, PickerKind, ScreenCapture};
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

/// Asks of the voice UI the app answers on its own thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceRequest {
    /// Something the bar shows changed: draw again.
    Redraw,
    OpenDevices,
    /// The narrow bar's "more".
    OpenMore,
    /// Our own picker (X11, Windows): open it, loading, while the sources are listed.
    OpenPicker,
    /// The sources for the picker, or why they couldn't be listed.
    PickerSources(Result<Vec<CaptureSource>, String>),
}

/// The stage's buttons. Mute, deafen, leave, tiles, the camera and the screen share go through core;
/// push-to-talk and devices are the engine's alone.
pub struct AppVoice {
    pub core: Arc<Core>,
    pub engine: Arc<LiveKitEngine>,
    pub exec: Exec,
    /// Who picks what to share: the system's portal, or our picker over this list.
    pub screens: Arc<dyn ScreenCapture>,
    /// The saved resolution, frame rate and audio switch for screen shares.
    pub share_settings: Mutex<ShareSettings>,
    pub requests: async_channel::Sender<VoiceRequest>,
}

impl AppVoice {
    pub fn devices(&self) -> AudioDevices {
        self.engine.devices()
    }

    pub fn share_settings(&self) -> ShareSettings {
        *self
            .share_settings
            .lock()
            .unwrap_or_else(|p| p.into_inner())
    }

    pub fn set_share_settings(&self, settings: ShareSettings) {
        *self
            .share_settings
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = settings;
    }

    /// Starts a share of this source (`None`: the system's picker chooses), with the saved settings.
    pub fn start_share(&self, source_id: Option<String>) {
        let request = self.share_settings().request(source_id);
        let core = self.core.clone();
        self.exec.fire(async move {
            if let Err(error) = core.start_screen_share(request).await {
                log::warn!("sharing the screen: {error}");
            }
        });
    }

    /// Lists screens and windows for our picker, off the UI thread: thumbnails take a moment.
    pub fn list_sources(&self) {
        let (screens, requests) = (self.screens.clone(), self.requests.clone());
        // Fired, so the activity the rig waits on moves once the list is in.
        self.exec.fire(async move {
            let listed = tokio::task::spawn_blocking(move || {
                screens
                    .sources(semaphore_ui::voice::THUMBNAIL_PX)
                    .map_err(|error| error.to_string())
            })
            .await
            .unwrap_or_else(|error| Err(error.to_string()));
            let _ = requests.try_send(VoiceRequest::PickerSources(listed));
        });
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

    fn open_more(&self) {
        let _ = self.requests.try_send(VoiceRequest::OpenMore);
    }

    fn set_camera(&self, on: bool) {
        let core = self.core.clone();
        self.exec.fire(async move {
            if let Err(error) = core.set_camera(on).await {
                log::warn!("camera: {error}");
            }
        });
    }

    /// On: stop. Off or failed: the portal straight away on Wayland, our picker elsewhere.
    fn toggle_screen_share(&self) {
        match self.core.voice().local.screen {
            LocalShare::On => {
                let core = self.core.clone();
                self.exec.fire(async move {
                    let _ = core.stop_screen_share().await;
                });
            }
            // The bar doesn't offer this, but a stale click mustn't start a second share.
            LocalShare::Starting => {}
            LocalShare::Off | LocalShare::Failed { .. } => match self.screens.picker() {
                PickerKind::System => self.start_share(None),
                PickerKind::Listed => {
                    let _ = self.requests.try_send(VoiceRequest::OpenPicker);
                    self.list_sources();
                }
            },
        }
    }
}
