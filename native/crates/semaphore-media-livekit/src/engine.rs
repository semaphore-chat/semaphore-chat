//! The voice session: join, leave, mic, mute, deafen, per-person volume, devices, speaking, video
//! demand, and rejoining when the SDK gives up.
//!
//! **Why an app-level rejoin.** The SDK retries a dead connection for about 60 s and then emits
//! `Disconnected` and stops. T7 proved that a longer outage (a laptop lid, a train) otherwise ends
//! the call silently, so this crate treats any disconnect it didn't ask for as "try again".

use crate::VideoSink;
use crate::audio::apm::{Apm, AudioProcessing};
use crate::audio::cpal_io::CpalIo;
use crate::audio::mixer::{MAX_VOLUME_PERCENT, Mixer, MixerInput};
use crate::audio::system::{
    CaptureScope, STEREO_FRAME_SAMPLES, SYSTEM_AUDIO_CHANNELS, StereoChunker, SystemAudioCapture,
};
use crate::audio::{
    AudioDevices, AudioIo, AudioStream, Chunker, ErrorCallback, FRAME_SAMPLES, SAMPLE_RATE,
};
use crate::video::local::{
    Capturing, FramePipeline, VideoCaptureSource, VideoSources, may_publish,
};
use crate::video::platform::{PlatformVideoSources, uses_portal};
use crate::video::publish::{
    self, ScreenSharePublish, ShareResolution, camera_publish_options, fit_capture,
};
use crate::video::{TrackCounters, TrackVideoStats, VideoDemand, layer_for, pump_frames};
use async_trait::async_trait;
use futures_util::StreamExt;
use livekit::options::{AudioEncoding, TrackPublishOptions};
use livekit::participant::ConnectionQuality;
use livekit::prelude::*;
use livekit::track::{
    LocalAudioTrack, LocalTrack, LocalVideoTrack, RemoteAudioTrack, RemoteTrack, TrackDimension,
    TrackSource, VideoQuality,
};
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::audio_stream::native::NativeAudioStream;
use livekit::webrtc::video_source::RtcVideoSource;
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::{DisconnectReason, Room, RoomEvent, RoomOptions};
use livekit_protocol::TrackSource as ProtoSource;
use semaphore_core::CoreError;
pub use semaphore_core::model::ConnectionQuality as ConnectionQualityView;
use semaphore_core::model::{
    LocalMediaView, LocalShare, ParticipantView, ScreenShareRequest, UserView, VideoTrackView,
    ViewKey, VoiceStatus, VoiceView,
};
use semaphore_core::platform::{CoreEvent, EventSink, MediaEngine, ScreenShareStarted};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

fn failed(message: impl ToString) -> CoreError {
    CoreError::Failed {
        message: message.to_string(),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

/// The web client's "Microphone quality" setting, with the same numbers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MicPreset {
    Standard,
    #[default]
    High,
    Music,
}

impl MicPreset {
    fn encoding(self) -> (u64, bool) {
        match self {
            Self::Standard => (48_000, true),
            Self::High => (96_000, true),
            Self::Music => (128_000, false),
        }
    }
}

fn quality_view(quality: ConnectionQuality) -> ConnectionQualityView {
    match quality {
        ConnectionQuality::Excellent => ConnectionQualityView::Excellent,
        ConnectionQuality::Good => ConnectionQualityView::Good,
        ConnectionQuality::Poor => ConnectionQualityView::Poor,
        ConnectionQuality::Lost => ConnectionQualityView::Lost,
    }
}

/// Everything a voice UI draws. `voice` is what goes to `Core::ingest_media`; the rest is for this
/// crate's rigs, and for settings that don't pass through core.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MediaSnapshot {
    /// Which `connect` this report belongs to: core's number for the call. Goes with `voice` to
    /// `Core::ingest_media`, so a report from an earlier call, or one core never saw begin, can't
    /// be mistaken for this one's.
    pub call: u64,
    pub voice: VoiceView,
    /// By identity. Absent until the server has said.
    pub quality: HashMap<String, ConnectionQualityView>,
    pub local_quality: ConnectionQualityView,
    /// App-level rejoins since `connect`, so 0 means the SDK handled everything.
    pub rejoins: u32,
    /// Which attempt a rejoin is on while one runs, for "Reconnecting voice (3)...".
    pub rejoin_attempt: Option<u32>,
    pub devices: AudioDevices,
    /// The mic or speakers couldn't open. The call goes on without them.
    pub audio_error: Option<String>,
    /// The last reason a rejoin failed, for "Reconnecting" to explain itself.
    pub last_error: Option<String>,
}

/// Mints a new token for a rejoin, because the one from `connect` may have expired by then. Without
/// one, the engine reuses that token, and a server that refuses it ends the call.
pub trait TokenSource: Send + Sync {
    fn token(&self) -> Pin<Box<dyn Future<Output = Result<String, CoreError>> + Send>>;
}

#[derive(Debug, Clone, Copy)]
pub struct RejoinPolicy {
    pub first_delay: Duration,
    pub max_delay: Duration,
    /// Consecutive failures before giving up when there's no `TokenSource`: past this the token has
    /// surely expired or been revoked. With one, the engine keeps trying until `disconnect`.
    pub attempts_without_token_source: u32,
}

impl Default for RejoinPolicy {
    fn default() -> Self {
        Self {
            first_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(15),
            attempts_without_token_source: 20,
        }
    }
}

pub struct EngineOptions {
    pub audio_io: Arc<dyn AudioIo>,
    pub processing: AudioProcessing,
    pub mic_preset: MicPreset,
    pub rejoin: RejoinPolicy,
    pub device_poll: Duration,
    /// Cameras and screens: libwebrtc's by default, fakes in tests.
    pub video_sources: Arc<dyn VideoSources>,
    /// The system audio a screen share sends when asked to. `None`: asking for it fails, and the
    /// screen is shared without it. The app passes `semaphore_sysaudio::platform_capture()`.
    pub system_audio: Option<Arc<dyn SystemAudioCapture>>,
}

impl Default for EngineOptions {
    fn default() -> Self {
        Self {
            audio_io: Arc::new(CpalIo::default()),
            processing: AudioProcessing::default(),
            mic_preset: MicPreset::default(),
            rejoin: RejoinPolicy::default(),
            device_poll: Duration::from_secs(2),
            video_sources: Arc::new(PlatformVideoSources),
            system_audio: None,
        }
    }
}

struct VideoPump {
    identity: String,
    is_screen_share: bool,
    counters: Arc<TrackCounters>,
    task: JoinHandle<()>,
}

/// `LiveKitEngine::choices`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineChoices {
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub camera_device: Option<String>,
    pub ptt_mode: bool,
    pub preset: MicPreset,
    pub processing: AudioProcessing,
}

/// What the user asked for. Outlives any one `Room`, so a rejoin puts it all back.
#[derive(Default)]
struct Wanted {
    muted: bool,
    /// Whether the mic was muted when deafen went on, which is what undeafening restores.
    muted_before_deafen: bool,
    deafened: bool,
    ptt_mode: bool,
    ptt_pressed: bool,
    input_device: Option<String>,
    output_device: Option<String>,
    demands: HashMap<String, VideoDemand>,
    preset: MicPreset,
    /// A camera's unique id from `cameras()`, or `None` for the first one.
    camera_device: Option<String>,
}

impl Wanted {
    fn mic_open(&self) -> bool {
        !self.muted && (!self.ptt_mode || self.ptt_pressed)
    }
}

struct Session {
    leave: watch::Sender<bool>,
    task: JoinHandle<()>,
    device_task: JoinHandle<()>,
    mic_pump: JoinHandle<()>,
}

struct Inner {
    runtime: tokio::runtime::Handle,
    io: Arc<dyn AudioIo>,
    processing: Mutex<AudioProcessing>,
    apm: Mutex<Option<Arc<Apm>>>,
    rejoin_policy: RejoinPolicy,
    device_poll: Duration,
    mixer: Arc<Mixer>,
    wanted: Mutex<Wanted>,
    room: RwLock<Option<Arc<Room>>>,
    mic_source: Mutex<Option<NativeAudioSource>>,
    mic_tx: Mutex<Option<mpsc::Sender<Vec<i16>>>>,
    /// Closed while muted: audio stops here, ahead of the encoder.
    mic_gate: Arc<AtomicBool>,
    /// Latency of the render side, read by the capture side as the APM's delay hint.
    render_latency: Arc<AtomicU32>,
    input_stream: Mutex<Option<AudioStream>>,
    output_stream: Mutex<Option<AudioStream>>,
    /// A stream died; the device watcher reopens it.
    input_lost: Arc<AtomicBool>,
    output_lost: Arc<AtomicBool>,
    audio_tasks: Mutex<HashMap<String, JoinHandle<()>>>,
    video_pumps: Mutex<HashMap<String, VideoPump>>,
    video_sink: RwLock<Option<Arc<dyn VideoSink>>>,
    /// What we last told the SFU per track, so a layer isn't re-requested on every UI frame.
    applied_quality: Mutex<HashMap<String, VideoQuality>>,
    speaking: Mutex<HashSet<String>>,
    snapshot: watch::Sender<MediaSnapshot>,
    event_sink: RwLock<Option<Arc<dyn EventSink>>>,
    token_source: RwLock<Option<Arc<dyn TokenSource>>>,
    session: tokio::sync::Mutex<Option<Session>>,
    /// The screen share's system audio, while it runs. Outlives a `Room`, so a rejoin republishes.
    system_audio: Mutex<Option<SystemAudioShare>>,
    /// 10 ms system audio frames dropped because the publisher fell behind, since the engine began.
    system_audio_dropped: Arc<AtomicU64>,
    video_sources: Arc<dyn VideoSources>,
    system_audio_capture: Option<Arc<dyn SystemAudioCapture>>,
    camera: Mutex<Option<LocalVideo>>,
    screen: Mutex<Option<LocalVideo>>,
    /// One camera or screen change at a time.
    local_ops: tokio::sync::Mutex<()>,
    /// `drop_room_for_test`: the room is treated as lost, and the engine rejoins.
    lose_room: tokio::sync::Notify,
    next_capture: AtomicU64,
}

struct SystemAudioShare {
    source: NativeAudioSource,
    _capture: AudioStream,
    pump: JoinHandle<()>,
}

/// Our camera or screen while it runs. Outlives a `Room`, so a rejoin republishes it.
struct LocalVideo {
    /// Which capture this is, so a late "ended" from an earlier one stops nothing.
    id: u64,
    kind: TrackSource,
    source: NativeVideoSource,
    options: TrackPublishOptions,
    /// The publication's sid in the current room, for the preview and the participant view.
    sid: Arc<Mutex<Option<String>>>,
    _capture: Capturing,
}

impl LocalVideo {
    fn track_name(&self) -> &'static str {
        if self.kind == TrackSource::Screenshare {
            "screen_share"
        } else {
            "camera"
        }
    }
}

/// How long a source may take to give its first frame. A system picker waits for the user.
const FIRST_FRAME: Duration = Duration::from_secs(10);
const FIRST_FRAME_AFTER_PICKER: Duration = Duration::from_secs(300);

pub struct LiveKitEngine {
    inner: Arc<Inner>,
    // Declared after `inner`, and shut down in the background so dropping the engine from async
    // code doesn't panic.
    runtime: Option<tokio::runtime::Runtime>,
}

impl Default for LiveKitEngine {
    fn default() -> Self {
        Self::new(EngineOptions::default())
    }
}

impl Drop for LiveKitEngine {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

impl LiveKitEngine {
    pub fn new(options: EngineOptions) -> Self {
        // The SDK spawns on the ambient tokio runtime from its callbacks, and GPUI doesn't run one.
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .thread_name("semaphore-media")
            .enable_all()
            .build()
            .expect("the media runtime starts");
        let (snapshot, _) = watch::channel(MediaSnapshot::default());
        let wanted = Wanted {
            preset: options.mic_preset,
            ..Wanted::default()
        };
        Self {
            inner: Arc::new(Inner {
                runtime: runtime.handle().clone(),
                io: options.audio_io,
                processing: Mutex::new(options.processing),
                apm: Mutex::new(None),
                rejoin_policy: options.rejoin,
                device_poll: options.device_poll,
                mixer: Arc::new(Mixer::default()),
                wanted: Mutex::new(wanted),
                room: RwLock::new(None),
                mic_source: Mutex::new(None),
                mic_tx: Mutex::new(None),
                mic_gate: Arc::new(AtomicBool::new(true)),
                render_latency: Arc::new(AtomicU32::new(0)),
                input_stream: Mutex::new(None),
                output_stream: Mutex::new(None),
                input_lost: Arc::new(AtomicBool::new(false)),
                output_lost: Arc::new(AtomicBool::new(false)),
                audio_tasks: Mutex::default(),
                video_pumps: Mutex::default(),
                video_sink: RwLock::new(None),
                applied_quality: Mutex::default(),
                speaking: Mutex::default(),
                snapshot,
                event_sink: RwLock::new(None),
                token_source: RwLock::new(None),
                session: tokio::sync::Mutex::new(None),
                system_audio: Mutex::new(None),
                system_audio_dropped: Arc::new(AtomicU64::new(0)),
                video_sources: options.video_sources,
                system_audio_capture: options.system_audio,
                camera: Mutex::new(None),
                screen: Mutex::new(None),
                local_ops: tokio::sync::Mutex::new(()),
                lose_room: tokio::sync::Notify::new(),
                next_capture: AtomicU64::new(1),
            }),
            runtime: Some(runtime),
        }
    }

    /// Set this before `connect`. Frames only flow to a track that is also demanded.
    pub fn set_video_sink(&self, sink: Arc<dyn VideoSink>) {
        *self
            .inner
            .video_sink
            .write()
            .unwrap_or_else(|p| p.into_inner()) = Some(sink);
    }

    /// Told `ViewChanged { Voice }` whenever `snapshot()` would read differently.
    pub fn set_event_sink(&self, sink: Arc<dyn EventSink>) {
        *self
            .inner
            .event_sink
            .write()
            .unwrap_or_else(|p| p.into_inner()) = Some(sink);
    }

    pub fn set_token_source(&self, source: Arc<dyn TokenSource>) {
        *self
            .inner
            .token_source
            .write()
            .unwrap_or_else(|p| p.into_inner()) = Some(source);
    }

    pub fn snapshot(&self) -> MediaSnapshot {
        self.inner.snapshot.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<MediaSnapshot> {
        self.inner.snapshot.subscribe()
    }

    pub fn set_muted(&self, muted: bool) {
        let _enter = self.inner.runtime.enter();
        lock(&self.inner.wanted).muted = muted;
        self.inner.apply_mic_state();
        self.inner.publish_snapshot();
    }

    /// Deafening mutes the mic too, and undeafening restores what it was, like the web client.
    pub fn set_deafened(&self, deafened: bool) {
        let _enter = self.inner.runtime.enter();
        {
            let mut wanted = lock(&self.inner.wanted);
            if wanted.deafened == deafened {
                return;
            }
            wanted.deafened = deafened;
            if deafened {
                wanted.muted_before_deafen = wanted.muted;
                wanted.muted = true;
            } else {
                wanted.muted = wanted.muted_before_deafen;
            }
        }
        self.inner.mixer.set_deafened(deafened);
        self.inner.apply_mic_state();
        self.inner.send_deafen_metadata();
        self.inner.publish_snapshot();
    }

    /// With push-to-talk on, the mic only opens while `set_ptt_pressed(true)` holds. Catching the
    /// key press while the app is in the background is the platform layer's job.
    pub fn set_ptt_mode(&self, enabled: bool) {
        let _enter = self.inner.runtime.enter();
        lock(&self.inner.wanted).ptt_mode = enabled;
        self.inner.apply_mic_state();
        self.inner.publish_snapshot();
    }

    pub fn set_ptt_pressed(&self, pressed: bool) {
        let _enter = self.inner.runtime.enter();
        lock(&self.inner.wanted).ptt_pressed = pressed;
        self.inner.apply_mic_state();
        self.inner.publish_snapshot();
    }

    /// 0 to 200, by identity. Survives the person's track ending, and a rejoin.
    pub fn set_participant_volume(&self, identity: &str, percent: u32) {
        self.inner
            .mixer
            .set_volume(identity, percent.min(MAX_VOLUME_PERCENT));
    }

    pub fn participant_volume(&self, identity: &str) -> u32 {
        self.inner.mixer.volume(identity)
    }

    /// Applies at the next join, like the web setting.
    pub fn set_mic_preset(&self, preset: MicPreset) {
        lock(&self.inner.wanted).preset = preset;
    }

    /// Takes effect for the mic and playout at once, without dropping the call.
    pub fn set_processing(&self, processing: AudioProcessing) {
        *lock(&self.inner.processing) = processing;
        if self.inner.input_stream_open() {
            let apm = Arc::new(Apm::new(processing));
            *lock(&self.inner.apm) = Some(apm.clone());
            self.inner.mixer.set_apm(Some(apm));
            // The mic's callback holds the module it was opened with.
            self.inner.input_lost.store(true, Ordering::Relaxed);
            self.inner.reopen_lost_streams();
        }
    }

    /// Starts capturing system audio (everything but our own call) and publishes it as the screen
    /// share's audio track, in stereo with no voice processing, as the web client does. Works
    /// before or during a call; a rejoin republishes it.
    pub fn start_system_audio(&self, capture: &dyn SystemAudioCapture) -> Result<(), String> {
        self.inner.start_system_audio(capture)
    }

    pub fn system_audio_dropped_frames(&self) -> u64 {
        self.inner.system_audio_dropped.load(Ordering::Relaxed)
    }

    /// Stops the capture and unpublishes the track. Nothing is left in the OS audio graph.
    pub fn stop_system_audio(&self) {
        self.inner.stop_system_audio();
    }

    /// Tests and rigs: closes the room as if the network had dropped it for good, so the engine
    /// rejoins as it would after the SDK gives up.
    #[doc(hidden)]
    pub fn drop_room_for_test(&self) {
        self.inner.lose_room.notify_one();
    }

    /// Cameras for a settings list: unique id and name.
    pub fn cameras(&self) -> Vec<(String, String)> {
        self.inner.video_sources.cameras()
    }

    /// The camera to use from the next `set_camera(true)`; `None` for the first one.
    pub fn select_camera(&self, device: Option<String>) {
        lock(&self.inner.wanted).camera_device = device;
    }

    /// What the settings set: devices, processing, push-to-talk mode and the mic preset, as the
    /// engine holds them now. For a settings screen to show, and for rigs to check.
    pub fn choices(&self) -> EngineChoices {
        let wanted = lock(&self.inner.wanted);
        EngineChoices {
            input_device: wanted.input_device.clone(),
            output_device: wanted.output_device.clone(),
            camera_device: wanted.camera_device.clone(),
            ptt_mode: wanted.ptt_mode,
            preset: wanted.preset,
            processing: *lock(&self.inner.processing),
        }
    }

    pub fn output_latency_ms(&self) -> u32 {
        self.inner.render_latency.load(Ordering::Relaxed)
    }

    pub fn devices(&self) -> AudioDevices {
        self.inner.io.devices().unwrap_or_default()
    }

    /// `None` follows the system default. Switches a live call over.
    pub fn select_input(&self, device: Option<String>) {
        lock(&self.inner.wanted).input_device = device;
        self.inner.input_lost.store(true, Ordering::Relaxed);
        self.inner.reopen_lost_streams();
    }

    pub fn select_output(&self, device: Option<String>) {
        lock(&self.inner.wanted).output_device = device;
        self.inner.output_lost.store(true, Ordering::Relaxed);
        self.inner.reopen_lost_streams();
    }

    /// The video tiles on screen right now. Everything else is paused at the SFU.
    pub fn set_video_demands(&self, demands: Vec<VideoDemand>) {
        let _enter = self.inner.runtime.enter();
        lock(&self.inner.wanted).demands = demands
            .into_iter()
            .map(|demand| (demand.track_sid.clone(), demand))
            .collect();
        self.inner.apply_video_demands();
    }

    pub fn video_stats(&self) -> Vec<TrackVideoStats> {
        lock(&self.inner.video_pumps)
            .iter()
            .map(|(sid, pump)| TrackVideoStats {
                track_sid: sid.clone(),
                identity: pump.identity.clone(),
                is_screen_share: pump.is_screen_share,
                frames: pump.counters.frames.load(Ordering::Relaxed),
                width: pump.counters.width.load(Ordering::Relaxed),
                height: pump.counters.height.load(Ordering::Relaxed),
            })
            .collect()
    }

    /// Inbound bytes per video track from WebRTC's stats, so a rig can check what really arrived.
    pub async fn inbound_video_bytes(&self) -> HashMap<String, u64> {
        let inner = self.inner.clone();
        let task = self.inner.runtime.spawn(async move {
            let Some(room) = inner.current_room() else {
                return HashMap::new();
            };
            let mut totals = HashMap::new();
            for participant in room.remote_participants().values() {
                for (sid, publication) in participant.track_publications() {
                    let Some(RemoteTrack::Video(track)) = publication.track() else {
                        continue;
                    };
                    if let Ok(stats) = track.get_stats().await {
                        let bytes = stats
                            .iter()
                            .filter_map(|stat| match stat {
                                livekit::webrtc::stats::RtcStats::InboundRtp(inbound) => {
                                    Some(inbound.inbound.bytes_received)
                                }
                                _ => None,
                            })
                            .sum();
                        totals.insert(sid.to_string(), bytes);
                    }
                }
            }
            totals
        });
        task.await.unwrap_or_default()
    }
}

#[async_trait]
impl MediaEngine for LiveKitEngine {
    /// Returns once joined, with the mic published if there is one. A failure here isn't retried:
    /// the app is still on its join screen and can say so. Only a call in progress rejoins.
    async fn connect(&self, url: String, token: String, call: u64) -> Result<(), CoreError> {
        let inner = self.inner.clone();
        self.inner
            .runtime
            .spawn(async move { inner.join(url, token, call).await })
            .await
            .map_err(failed)?
    }

    async fn disconnect(&self) {
        let inner = self.inner.clone();
        let _ = self
            .inner
            .runtime
            .spawn(async move { inner.leave().await })
            .await;
    }

    fn set_muted(&self, muted: bool) {
        LiveKitEngine::set_muted(self, muted);
    }

    fn set_deafened(&self, deafened: bool) {
        LiveKitEngine::set_deafened(self, deafened);
    }

    fn set_video_demands(&self, demands: Vec<VideoDemand>) {
        LiveKitEngine::set_video_demands(self, demands);
    }

    async fn set_camera(&self, on: bool) -> Result<(), CoreError> {
        let inner = self.inner.clone();
        self.inner
            .runtime
            .spawn(async move { inner.set_camera(on).await })
            .await
            .map_err(failed)?
            .map_err(failed)
    }

    async fn start_screen_share(
        &self,
        request: ScreenShareRequest,
    ) -> Result<ScreenShareStarted, CoreError> {
        let inner = self.inner.clone();
        self.inner
            .runtime
            .spawn(async move { inner.start_screen_share(request).await })
            .await
            .map_err(failed)?
            .map_err(failed)
    }

    async fn stop_screen_share(&self) {
        let inner = self.inner.clone();
        let _ = self
            .inner
            .runtime
            .spawn(async move { inner.stop_screen_share().await })
            .await;
    }
}

fn room_options() -> RoomOptions {
    let mut options = RoomOptions::default();
    // We subscribe by hand: mics always, video only once a tile on screen asks for it. Otherwise
    // every camera in the room would decode at its top layer from the moment we join.
    options.auto_subscribe = false;
    // Layers nobody asks for aren't encoded, which matters to whoever is on the other end of this.
    options.dynacast = true;
    // Adaptive stream starts video paused and expects sizes from attached elements. We have no
    // elements: `VideoDemand` drives layers and pausing explicitly.
    options.adaptive_stream = false;
    options
}

impl Inner {
    fn start_system_audio(&self, capture: &dyn SystemAudioCapture) -> Result<(), String> {
        self.stop_system_audio();
        let source = NativeAudioSource::new(
            // Music and game sound, not speech: no echo cancelling, suppression or gain.
            AudioSourceOptions::default(),
            SAMPLE_RATE,
            SYSTEM_AUDIO_CHANNELS as u32,
            SYSTEM_AUDIO_QUEUE_MS,
        );
        let (frames_tx, frames_rx) = mpsc::channel::<Vec<i16>>(16);
        let mut chunker = StereoChunker::new();
        let dropped = self.system_audio_dropped.clone();
        let on_audio = Box::new(move |samples: &[f32]| {
            chunker.push(samples, |frame| {
                // Full means the pump is behind by 160 ms: dropping 10 ms beats growing latency.
                if frames_tx.try_send(frame.to_vec()).is_err() {
                    dropped.fetch_add(1, Ordering::Relaxed);
                }
            });
        });
        let on_error: ErrorCallback =
            Arc::new(|message| log::warn!("system audio capture: {message}"));
        let capture = capture.start(CaptureScope::EverythingExceptOurs, on_audio, on_error)?;
        let pump = self
            .runtime
            .spawn(pump_system_audio(source.clone(), frames_rx));
        *lock(&self.system_audio) = Some(SystemAudioShare {
            source: source.clone(),
            _capture: capture,
            pump,
        });
        if let Some(room) = self.current_room() {
            self.runtime
                .spawn(async move { publish_system_audio(&room, source).await });
        }
        Ok(())
    }

    /// Stops the capture and unpublishes the track. Nothing is left in the OS audio graph.
    fn stop_system_audio(&self) {
        let Some(share) = lock(&self.system_audio).take() else {
            return;
        };
        share.pump.abort();
        if let Some(room) = self.current_room() {
            self.runtime.spawn(async move {
                unpublish_system_audio(&room).await;
            });
        }
    }

    /// How far ahead of the speakers the mixer is working right now.
    fn current_room(&self) -> Option<Arc<Room>> {
        self.room.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn set_room(&self, room: Option<Arc<Room>>) {
        *self.room.write().unwrap_or_else(|p| p.into_inner()) = room;
    }

    fn input_stream_open(&self) -> bool {
        lock(&self.input_stream).is_some()
    }

    async fn join(self: Arc<Self>, url: String, token: String, call: u64) -> Result<(), CoreError> {
        // Whatever the last call reports on its way out is still stamped with its own number.
        self.clone().leave().await;
        self.update_snapshot(|snapshot| snapshot.call = call);
        self.set_status(VoiceStatus::Connecting, None);
        let (room, events) = match Room::connect(&url, &token, room_options()).await {
            Ok(connected) => connected,
            Err(error) => {
                self.set_status(VoiceStatus::Disconnected, Some(error.to_string()));
                return Err(failed(error));
            }
        };
        let room = Arc::new(room);

        let (mic_tx, mic_rx) = mpsc::channel::<Vec<i16>>(32);
        let source = NativeAudioSource::new(
            // Processing is ours, ahead of this source.
            AudioSourceOptions::default(),
            SAMPLE_RATE,
            1,
            100,
        );
        *lock(&self.mic_source) = Some(source.clone());
        let mic_pump = tokio::spawn(pump_mic(source, mic_rx));
        self.start_audio(mic_tx);

        self.set_room(Some(room.clone()));
        if let Err(error) = self.setup_room(&room).await {
            let _ = room.close().await;
            self.set_room(None);
            self.stop_audio();
            mic_pump.abort();
            self.set_status(VoiceStatus::Disconnected, Some(error.clone()));
            return Err(failed(error));
        }
        self.set_status(VoiceStatus::Connected, None);

        let (leave, leave_rx) = watch::channel(false);
        let task = tokio::spawn(self.clone().supervise(room, events, url, token, leave_rx));
        let device_task = tokio::spawn(self.clone().watch_devices());
        *self.session.lock().await = Some(Session {
            leave,
            task,
            device_task,
            mic_pump,
        });
        Ok(())
    }

    async fn leave(self: Arc<Self>) {
        let Some(session) = self.session.lock().await.take() else {
            return;
        };
        let _ = session.leave.send(true);
        session.device_task.abort();
        let _ = session.task.await;
        session.mic_pump.abort();
        // Leaving the call ends the share's audio, the camera and the screen with it.
        if let Some(share) = lock(&self.system_audio).take() {
            share.pump.abort();
        }
        self.drop_local_video();
        self.clear_media();
        self.stop_audio();
        lock(&self.applied_quality).clear();
        lock(&self.speaking).clear();
        self.set_status(VoiceStatus::Disconnected, None);
    }

    /// Publishes our mic and subscribes to what's there. Run for each new `Room`.
    async fn setup_room(self: &Arc<Self>, room: &Arc<Room>) -> Result<(), String> {
        lock(&self.applied_quality).clear();
        let source = lock(&self.mic_source).clone();
        if let Some(source) = source {
            let track =
                LocalAudioTrack::create_audio_track("microphone", RtcAudioSource::Native(source));
            let preset = lock(&self.wanted).preset;
            let (max_bitrate, dtx) = preset.encoding();
            room.local_participant()
                .publish_track(
                    LocalTrack::Audio(track),
                    TrackPublishOptions {
                        source: TrackSource::Microphone,
                        audio_encoding: Some(AudioEncoding { max_bitrate }),
                        dtx,
                        red: true,
                        ..Default::default()
                    },
                )
                .await
                .map_err(|error| error.to_string())?;
        }
        self.send_deafen_metadata();
        self.apply_mic_state();
        let system_audio = lock(&self.system_audio)
            .as_ref()
            .map(|share| share.source.clone());
        if let Some(source) = system_audio {
            publish_system_audio(room, source).await;
        }
        // A rejoin puts the camera and the screen back.
        for slot in [&self.camera, &self.screen] {
            let video = lock(slot).as_ref().map(|video| {
                (
                    video.track_name(),
                    video.source.clone(),
                    video.options.clone(),
                    video.sid.clone(),
                )
            });
            if let Some((name, source, options, sid)) = video {
                // The old room's sid is gone with it: the preview moves to the new one.
                let old = lock(&sid).take();
                if let Some(old) = old {
                    self.notify_track_ended(&old);
                }
                if let Err(error) = publish_video(room, name, source, options, &sid).await {
                    log::warn!("republishing {name} failed: {error}");
                }
            }
        }
        self.subscribe_to_everything_audible(room);
        self.apply_video_demands();
        Ok(())
    }

    /// Runs until `disconnect`, rejoining across any disconnect we didn't ask for.
    async fn supervise(
        self: Arc<Self>,
        room: Arc<Room>,
        events: mpsc::UnboundedReceiver<RoomEvent>,
        url: String,
        token: String,
        mut leave: watch::Receiver<bool>,
    ) {
        let mut room = room;
        let mut events = events;
        let mut token = token;
        loop {
            match self
                .run_room(&room, &mut events, &mut token, &mut leave)
                .await
            {
                RoomEnd::Left => {
                    let _ = room.close().await;
                    self.set_room(None);
                    return;
                }
                RoomEnd::Ended(reason) => {
                    self.end_call(reason);
                    return;
                }
                RoomEnd::Lost => {}
            }
            // The room is dead, so everything hanging off it is. Its tasks would only ever wait.
            self.clear_media();
            self.set_room(None);
            self.set_status(VoiceStatus::Reconnecting, None);
            let Some((next_room, next_events)) = self.rejoin(&url, &mut token, &mut leave).await
            else {
                if !*leave.borrow() {
                    self.end_call("the server kept refusing us".to_owned());
                }
                return;
            };
            room = next_room;
            events = next_events;
            self.update_snapshot(|snapshot| {
                snapshot.rejoins += 1;
                snapshot.rejoin_attempt = None;
            });
            self.set_status(VoiceStatus::Connected, None);
        }
    }

    /// The call is over and no one here asked for that.
    fn end_call(&self, reason: String) {
        if let Some(share) = lock(&self.system_audio).take() {
            share.pump.abort();
        }
        self.drop_local_video();
        self.clear_media();
        self.set_room(None);
        self.stop_audio();
        self.set_status(VoiceStatus::Disconnected, Some(reason));
    }

    /// `None` means the user left meanwhile, or the server has refused us for too long.
    async fn rejoin(
        self: &Arc<Self>,
        url: &str,
        token: &mut String,
        leave: &mut watch::Receiver<bool>,
    ) -> Option<(Arc<Room>, mpsc::UnboundedReceiver<RoomEvent>)> {
        let policy = self.rejoin_policy;
        let mut delay = policy.first_delay;
        let mut failures = 0u32;
        loop {
            if *leave.borrow() {
                return None;
            }
            self.update_snapshot(|snapshot| snapshot.rejoin_attempt = Some(failures + 1));
            let source = self
                .token_source
                .read()
                .unwrap_or_else(|p| p.into_inner())
                .clone();
            if let Some(source) = &source {
                match source.token().await {
                    Ok(fresh) => *token = fresh,
                    Err(error) => log::warn!("rejoin: no fresh token: {error}"),
                }
            }
            // A connect can take its whole timeout, and hanging up mustn't wait for that.
            let attempt = tokio::select! {
                attempt = Room::connect(url, token, room_options()) => attempt,
                _ = leave.changed() => return None,
            };
            let error = match attempt {
                Ok((room, events)) => {
                    let room = Arc::new(room);
                    self.set_room(Some(room.clone()));
                    match self.setup_room(&room).await {
                        Ok(()) => return Some((room, events)),
                        Err(error) => {
                            let _ = room.close().await;
                            self.set_room(None);
                            error
                        }
                    }
                }
                Err(error) => error.to_string(),
            };
            failures += 1;
            log::warn!("rejoin attempt {failures} failed: {error}");
            self.update_snapshot(|snapshot| snapshot.last_error = Some(error.clone()));
            if source.is_none() && failures >= policy.attempts_without_token_source {
                return None;
            }
            // ±20% so a room that lost the same server doesn't come back in step.
            let jitter = f64::from(jitter_percent(80, 120)) / 100.0;
            tokio::select! {
                _ = tokio::time::sleep(delay.mul_f64(jitter)) => {}
                _ = leave.changed() => return None,
            }
            delay = (delay * 2).min(policy.max_delay);
        }
    }

    async fn run_room(
        self: &Arc<Self>,
        room: &Arc<Room>,
        events: &mut mpsc::UnboundedReceiver<RoomEvent>,
        token: &mut String,
        leave: &mut watch::Receiver<bool>,
    ) -> RoomEnd {
        self.publish_snapshot();
        loop {
            let event = tokio::select! {
                event = events.recv() => event,
                _ = leave.changed() => return RoomEnd::Left,
                _ = self.lose_room.notified() => {
                    let _ = room.close().await;
                    return RoomEnd::Lost;
                }
            };
            let Some(event) = event else {
                return RoomEnd::Lost;
            };
            match event {
                RoomEvent::TrackPublished { publication, .. } => {
                    if publication.kind() == TrackKind::Audio {
                        publication.set_subscribed(true);
                    }
                    self.apply_video_demands();
                }
                RoomEvent::TrackSubscribed {
                    track,
                    publication,
                    participant,
                } => match track {
                    RemoteTrack::Audio(track) => {
                        self.start_audio_track(track, publication.sid().to_string(), participant);
                    }
                    RemoteTrack::Video(track) => {
                        let sid = publication.sid().to_string();
                        let counters = Arc::new(TrackCounters::default());
                        let sink = self
                            .video_sink
                            .read()
                            .unwrap_or_else(|p| p.into_inner())
                            .clone();
                        let task =
                            tokio::spawn(pump_frames(track, sid.clone(), sink, counters.clone()));
                        if let Some(old) = lock(&self.video_pumps).insert(
                            sid.clone(),
                            VideoPump {
                                identity: participant.identity().to_string(),
                                is_screen_share: publication.source() == TrackSource::Screenshare,
                                counters,
                                task,
                            },
                        ) {
                            old.task.abort();
                        }
                        // A layer asked for before the track existed may have been forgotten.
                        lock(&self.applied_quality).remove(&sid);
                        self.apply_video_demands();
                    }
                },
                RoomEvent::TrackUnsubscribed { publication, .. } => {
                    self.stop_track(&publication.sid().to_string());
                }
                RoomEvent::TrackUnpublished { publication, .. } => {
                    self.stop_track(&publication.sid().to_string());
                }
                RoomEvent::ParticipantDisconnected(participant) => {
                    lock(&self.speaking).remove(&participant.identity().to_string());
                }
                RoomEvent::ActiveSpeakersChanged { speakers } => {
                    *lock(&self.speaking) = speakers
                        .iter()
                        .map(|speaker| speaker.identity().to_string())
                        .collect();
                }
                RoomEvent::TokenRefreshed { token: fresh } => *token = fresh,
                RoomEvent::Reconnecting => self.set_status(VoiceStatus::Reconnecting, None),
                RoomEvent::Reconnected => {
                    self.set_status(VoiceStatus::Connected, None);
                    // The SDK's full reconnect doesn't tell the new server session about tracks we
                    // subscribed to by hand, and every layer choice went with the old one.
                    lock(&self.applied_quality).clear();
                    self.subscribe_to_everything_audible(room);
                    self.apply_video_demands();
                }
                RoomEvent::Disconnected { reason } => {
                    log::info!("room disconnected: {reason:?}");
                    return if server_meant_it(reason) {
                        RoomEnd::Ended(format!("{reason:?}"))
                    } else {
                        RoomEnd::Lost
                    };
                }
                _ => {}
            }
            self.publish_snapshot();
        }
    }

    fn subscribe_to_everything_audible(&self, room: &Room) {
        for participant in room.remote_participants().values() {
            for publication in participant.track_publications().values() {
                if publication.kind() == TrackKind::Audio {
                    publication.set_subscribed(true);
                }
            }
        }
    }

    fn start_audio_track(
        &self,
        track: RemoteAudioTrack,
        sid: String,
        participant: RemoteParticipant,
    ) {
        let identity = participant.identity().to_string();
        let input = self.mixer.add_input(&sid, &identity);
        let task = tokio::spawn(pump_track_audio(track, input));
        if let Some(old) = lock(&self.audio_tasks).insert(sid, task) {
            old.abort();
        }
    }

    fn stop_track(&self, sid: &str) {
        self.mixer.remove_input(sid);
        if let Some(task) = lock(&self.audio_tasks).remove(sid) {
            task.abort();
        }
        if let Some(pump) = lock(&self.video_pumps).remove(sid) {
            pump.task.abort();
            self.notify_track_ended(sid);
        }
        lock(&self.applied_quality).remove(sid);
    }

    fn notify_track_ended(&self, sid: &str) {
        if let Some(sink) = self
            .video_sink
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
        {
            sink.on_track_ended(sid);
        }
    }

    /// Everything tied to the room's tracks, but not the devices or what the user wants.
    fn clear_media(&self) {
        self.mixer.clear_inputs();
        for (_, task) in lock(&self.audio_tasks).drain() {
            task.abort();
        }
        let pumps: Vec<_> = lock(&self.video_pumps).drain().collect();
        for (sid, pump) in pumps {
            pump.task.abort();
            self.notify_track_ended(&sid);
        }
        lock(&self.speaking).clear();
    }

    /// Mutes the publication, for the SFU and other people's UIs, and closes the gate in front of
    /// the encoder, so a muted mic's audio isn't even handed to WebRTC.
    fn apply_mic_state(&self) {
        let open = lock(&self.wanted).mic_open();
        self.mic_gate.store(open, Ordering::Relaxed);
        let Some(room) = self.current_room() else {
            return;
        };
        for publication in room.local_participant().track_publications().values() {
            if publication.source() == TrackSource::Microphone && publication.is_muted() == open {
                if open {
                    publication.unmute();
                } else {
                    publication.mute();
                }
            }
        }
    }

    /// `{ isDeafened }` in the participant metadata is what the web client's tiles read.
    fn send_deafen_metadata(&self) {
        let Some(room) = self.current_room() else {
            return;
        };
        let deafened = lock(&self.wanted).deafened;
        let local = room.local_participant();
        let mut metadata: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&local.metadata()).unwrap_or_default();
        metadata.insert("isDeafened".into(), deafened.into());
        let text = serde_json::Value::Object(metadata).to_string();
        self.runtime.spawn(async move {
            if let Err(error) = local.set_metadata(text).await {
                // Tokens without `canUpdateOwnMetadata` land here. Only other people's badges suffer.
                log::warn!("couldn't publish deafen state: {error}");
            }
        });
    }

    fn apply_video_demands(&self) {
        let Some(room) = self.current_room() else {
            return;
        };
        let demands = lock(&self.wanted).demands.clone();
        let mut applied = lock(&self.applied_quality);
        for participant in room.remote_participants().values() {
            for (sid, publication) in participant.track_publications() {
                if publication.kind() != TrackKind::Video {
                    continue;
                }
                let sid = sid.to_string();
                match demands.get(&sid) {
                    Some(demand) => {
                        if !publication.is_desired() {
                            publication.set_subscribed(true);
                        }
                        if publication.is_subscribed() && !publication.is_enabled() {
                            publication.set_enabled(true);
                            // SDK: re-enabling sends the track's full dimensions, which resets the
                            // SFU to the top layer, so the choice below must go out again after it.
                            applied.remove(&sid);
                        }
                        if !publication.simulcasted() {
                            continue;
                        }
                        let TrackDimension(width, height) = publication.dimension();
                        let quality = layer_for(
                            width,
                            height,
                            demand.width_px,
                            demand.height_px,
                            demand.focused,
                        );
                        if applied.get(&sid) != Some(&quality) {
                            publication.set_video_quality(quality);
                            applied.insert(sid, quality);
                        }
                    }
                    None => {
                        // Pause rather than unsubscribe. Tiles flap as a strip scrolls, and resuming
                        // is one signal message, against a renegotiation for a new subscription.
                        if publication.is_subscribed() && publication.is_enabled() {
                            publication.set_enabled(false);
                        } else if publication.is_desired() && !publication.is_subscribed() {
                            publication.set_subscribed(false);
                        }
                        applied.remove(&sid);
                    }
                }
            }
        }
    }

    fn start_audio(&self, mic_tx: mpsc::Sender<Vec<i16>>) {
        let processing = *lock(&self.processing);
        let apm = Arc::new(Apm::new(processing));
        *lock(&self.apm) = Some(apm.clone());
        self.mixer.set_apm(Some(apm));
        self.open_output();
        self.open_input(mic_tx);
    }

    fn stop_audio(&self) {
        *lock(&self.input_stream) = None;
        *lock(&self.output_stream) = None;
        *lock(&self.mic_source) = None;
        *lock(&self.mic_tx) = None;
        self.mixer.set_apm(None);
        *lock(&self.apm) = None;
    }

    fn open_input(&self, mic_tx: mpsc::Sender<Vec<i16>>) {
        *lock(&self.mic_tx) = Some(mic_tx.clone());
        let device = lock(&self.wanted).input_device.clone();
        let gate = self.mic_gate.clone();
        let apm = lock(&self.apm).clone();
        let render_latency = self.render_latency.clone();
        let lost = self.input_lost.clone();
        let on_error: ErrorCallback = Arc::new(move |error| {
            log::warn!("mic stream lost: {error}");
            lost.store(true, Ordering::Relaxed);
        });
        let mut chunker = Chunker::new();
        let result = self.io.open_input(
            device.as_deref(),
            Box::new(move |samples, capture_latency| {
                let delay = capture_latency + render_latency.load(Ordering::Relaxed);
                chunker.push(samples, |frame| {
                    // Always through the APM, so the echo canceller stays converged during mute.
                    if let Some(apm) = &apm {
                        apm.process_capture(frame, delay);
                    }
                    if gate.load(Ordering::Relaxed) {
                        // Never block the device thread: a full queue drops 10 ms instead.
                        let _ = mic_tx.try_send(frame.to_vec());
                    }
                });
            }),
            on_error,
        );
        self.record_stream(result, &self.input_stream, "microphone");
    }

    fn open_output(&self) {
        let device = lock(&self.wanted).output_device.clone();
        let mixer = self.mixer.clone();
        let render_latency = self.render_latency.clone();
        let lost = self.output_lost.clone();
        let on_error: ErrorCallback = Arc::new(move |error| {
            log::warn!("speaker stream lost: {error}");
            lost.store(true, Ordering::Relaxed);
        });
        let result = self.io.open_output(
            device.as_deref(),
            Box::new(move |out, latency| {
                render_latency.store(latency, Ordering::Relaxed);
                mixer.render(out);
            }),
            on_error,
        );
        self.record_stream(result, &self.output_stream, "speakers");
    }

    /// A call with no sound card still shows video and chat, so this reports rather than fails.
    fn record_stream(
        &self,
        result: Result<AudioStream, String>,
        slot: &Mutex<Option<AudioStream>>,
        what: &str,
    ) {
        match result {
            Ok(stream) => {
                *lock(slot) = Some(stream);
                self.update_snapshot(|snapshot| snapshot.audio_error = None);
            }
            Err(error) => {
                log::warn!("couldn't open {what}: {error}");
                *lock(slot) = None;
                self.update_snapshot(|snapshot| {
                    snapshot.audio_error = Some(format!("{what}: {error}"));
                });
            }
        }
    }

    fn reopen_lost_streams(&self) {
        if self.input_lost.swap(false, Ordering::Relaxed) {
            *lock(&self.input_stream) = None;
            let tx = lock(&self.mic_tx).clone();
            if let Some(tx) = tx {
                self.open_input(tx);
            }
        }
        if self.output_lost.swap(false, Ordering::Relaxed) && lock(&self.apm).is_some() {
            *lock(&self.output_stream) = None;
            self.open_output();
        }
    }

    /// Hot-plug. Neither cpal nor the SDK has a device-changed event we can trust everywhere, so
    /// this polls: a plugged-in headset shows in the list within `device_poll`, and if the device
    /// in use goes away the call falls back to the system default.
    async fn watch_devices(self: Arc<Self>) {
        let mut interval = tokio::time::interval(self.device_poll);
        let mut last: Option<AudioDevices> = None;
        loop {
            interval.tick().await;
            let io = self.io.clone();
            let Ok(Ok(devices)) = tokio::task::spawn_blocking(move || io.devices()).await else {
                continue;
            };
            if last.as_ref() != Some(&devices) {
                let default_changed = last.as_ref().is_some_and(|previous| {
                    default_of(&previous.inputs) != default_of(&devices.inputs)
                        || default_of(&previous.outputs) != default_of(&devices.outputs)
                });
                {
                    let mut wanted = lock(&self.wanted);
                    if let Some(id) = wanted.input_device.clone()
                        && !devices.inputs.iter().any(|device| device.id == id)
                    {
                        log::info!("selected mic {id} is gone, using the default");
                        wanted.input_device = None;
                        self.input_lost.store(true, Ordering::Relaxed);
                    }
                    if let Some(id) = wanted.output_device.clone()
                        && !devices.outputs.iter().any(|device| device.id == id)
                    {
                        log::info!("selected speakers {id} are gone, using the default");
                        wanted.output_device = None;
                        self.output_lost.store(true, Ordering::Relaxed);
                    }
                    if default_changed {
                        // A stream on "the default" must move when the default does.
                        if wanted.input_device.is_none() {
                            self.input_lost.store(true, Ordering::Relaxed);
                        }
                        if wanted.output_device.is_none() {
                            self.output_lost.store(true, Ordering::Relaxed);
                        }
                    }
                }
                self.update_snapshot(|snapshot| snapshot.devices = devices.clone());
                last = Some(devices);
            }
            self.reopen_lost_streams();
        }
    }

    fn set_status(&self, status: VoiceStatus, error: Option<String>) {
        self.update_snapshot(|snapshot| {
            snapshot.voice.status = status;
            if status == VoiceStatus::Connected {
                snapshot.last_error = None;
            } else if error.is_some() {
                snapshot.last_error = error;
            }
        });
        self.publish_snapshot();
    }

    fn update_snapshot(&self, change: impl FnOnce(&mut MediaSnapshot)) {
        let changed = self.snapshot.send_if_modified(|snapshot| {
            let before = snapshot.clone();
            change(snapshot);
            snapshot.voice.reconnect_attempt = snapshot.rejoin_attempt;
            snapshot.voice.error = snapshot.last_error.clone();
            before != *snapshot
        });
        if changed {
            self.notify_view_changed();
        }
    }

    fn notify_view_changed(&self) {
        if let Some(sink) = self
            .event_sink
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
        {
            sink.on_event(CoreEvent::ViewChanged {
                view: ViewKey::Voice,
            });
        }
    }

    /// Rebuilds the view from the room. Cheap enough to do per event, and it can't drift.
    fn publish_snapshot(&self) {
        let room = self.current_room();
        let wanted_muted;
        let wanted_deafened;
        {
            let wanted = lock(&self.wanted);
            wanted_muted = !wanted.mic_open();
            wanted_deafened = wanted.deafened;
        }
        let speaking = lock(&self.speaking).clone();
        let local_media = self.local_media(room.as_deref());
        let (own_camera, own_screen) = room
            .as_deref()
            .map(|room| self.local_tracks(room))
            .unwrap_or_default();
        self.update_snapshot(|snapshot| {
            snapshot.voice.muted = wanted_muted;
            snapshot.voice.deafened = wanted_deafened;
            snapshot.voice.local = local_media;
            let Some(room) = &room else {
                snapshot.voice.participants.clear();
                // A rejoin is still this call, in this channel.
                if snapshot.voice.status != VoiceStatus::Reconnecting {
                    snapshot.voice.channel_id = None;
                }
                snapshot.quality.clear();
                snapshot.local_quality = ConnectionQualityView::Unknown;
                return;
            };
            snapshot.voice.channel_id = Some(room.name());
            let local = room.local_participant();
            let local_identity = local.identity().to_string();
            let mut people = vec![ParticipantView {
                identity: local_identity.clone(),
                user: user_view(&local_identity, &local.name()),
                is_self: true,
                speaking: speaking.contains(&local_identity),
                muted: wanted_muted,
                deafened: wanted_deafened,
                camera: own_camera,
                screen_share: own_screen,
                quality: quality_view(local.connection_quality()),
            }];
            snapshot.local_quality = quality_view(local.connection_quality());
            snapshot.quality.clear();
            let mut remote: Vec<ParticipantView> = room
                .remote_participants()
                .values()
                .map(|participant| {
                    let identity = participant.identity().to_string();
                    snapshot.quality.insert(
                        identity.clone(),
                        quality_view(participant.connection_quality()),
                    );
                    remote_view(participant, speaking.contains(&identity), identity)
                })
                .collect();
            remote.sort_by(|a, b| a.identity.cmp(&b.identity));
            people.extend(remote);
            snapshot.voice.participants = people;
        });
    }
}

#[derive(Debug, PartialEq, Eq)]
enum RoomEnd {
    /// We asked to leave.
    Left,
    /// The network or the server failed: worth rejoining.
    Lost,
    /// Someone decided this: rejoining would fight them.
    Ended(String),
}

/// A kick has to stick, a deleted room is gone, and with a second session for the same user, the
/// two clients would otherwise take turns throwing each other out forever.
fn server_meant_it(reason: DisconnectReason) -> bool {
    matches!(
        reason,
        DisconnectReason::ClientInitiated
            | DisconnectReason::DuplicateIdentity
            | DisconnectReason::ParticipantRemoved
            | DisconnectReason::RoomDeleted
            | DisconnectReason::RoomClosed
    )
}

fn default_of(devices: &[crate::audio::AudioDevice]) -> Option<&str> {
    devices
        .iter()
        .find(|device| device.is_default)
        .map(|device| device.id.as_str())
}

fn jitter_percent(low: u32, high: u32) -> u32 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.subsec_nanos());
    low + nanos % (high - low + 1)
}

fn user_view(identity: &str, name: &str) -> UserView {
    UserView {
        id: identity.to_owned(),
        username: identity.to_owned(),
        display_name: (!name.is_empty()).then(|| name.to_owned()),
        avatar_file_id: None,
    }
}

fn remote_view(
    participant: &RemoteParticipant,
    speaking: bool,
    identity: String,
) -> ParticipantView {
    let mut mic_live = false;
    let mut camera = None;
    let mut screen_share = None;
    for (sid, publication) in participant.track_publications() {
        let TrackDimension(width, height) = publication.dimension();
        let video = || VideoTrackView {
            track_sid: sid.to_string(),
            width,
            height,
        };
        match publication.source() {
            TrackSource::Microphone => mic_live = !publication.is_muted(),
            TrackSource::Camera if !publication.is_muted() => camera = Some(video()),
            TrackSource::Screenshare if !publication.is_muted() => screen_share = Some(video()),
            _ => {}
        }
    }
    let deafened = serde_json::from_str::<serde_json::Value>(&participant.metadata())
        .ok()
        .and_then(|metadata| metadata.get("isDeafened")?.as_bool())
        .unwrap_or(false);
    ParticipantView {
        user: user_view(&identity, &participant.name()),
        identity,
        is_self: false,
        speaking,
        muted: !mic_live,
        deafened,
        camera,
        screen_share,
        quality: quality_view(participant.connection_quality()),
    }
}

async fn pump_mic(source: NativeAudioSource, mut frames: mpsc::Receiver<Vec<i16>>) {
    while let Some(data) = frames.recv().await {
        let frame = AudioFrame {
            data: Cow::Owned(data),
            sample_rate: SAMPLE_RATE,
            num_channels: 1,
            samples_per_channel: FRAME_SAMPLES as u32,
        };
        if let Err(error) = source.capture_frame(&frame).await {
            log::warn!("mic frame refused: {error}");
        }
    }
}

/// 50 ms: enough to ride out one late capture quantum, and libwebrtc sends silence when it runs dry.
const SYSTEM_AUDIO_QUEUE_MS: u32 = 50;

async fn pump_system_audio(source: NativeAudioSource, mut frames: mpsc::Receiver<Vec<i16>>) {
    while let Some(data) = frames.recv().await {
        let frame = AudioFrame {
            data: Cow::Owned(data),
            sample_rate: SAMPLE_RATE,
            num_channels: SYSTEM_AUDIO_CHANNELS as u32,
            samples_per_channel: (STEREO_FRAME_SAMPLES / SYSTEM_AUDIO_CHANNELS) as u32,
        };
        if let Err(error) = source.capture_frame(&frame).await {
            log::warn!("system audio frame refused: {error}");
        }
    }
}

/// The web client's `SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS`: 128 kbps, no DTX (it would gate quiet
/// passages), RED on.
async fn publish_system_audio(room: &Room, source: NativeAudioSource) {
    let track =
        LocalAudioTrack::create_audio_track("screen_share_audio", RtcAudioSource::Native(source));
    let published = room
        .local_participant()
        .publish_track(
            LocalTrack::Audio(track),
            TrackPublishOptions {
                source: TrackSource::ScreenshareAudio,
                audio_encoding: Some(AudioEncoding {
                    max_bitrate: 128_000,
                }),
                dtx: false,
                red: true,
                ..Default::default()
            },
        )
        .await;
    if let Err(error) = published {
        log::warn!("system audio publish failed: {error}");
    }
}

async fn unpublish_system_audio(room: &Room) {
    let local = room.local_participant();
    let sids: Vec<_> = local
        .track_publications()
        .values()
        .filter(|publication| publication.source() == TrackSource::ScreenshareAudio)
        .map(|publication| publication.sid())
        .collect();
    for sid in sids {
        if let Err(error) = local.unpublish_track(&sid).await {
            log::warn!("system audio unpublish failed: {error}");
        }
    }
}

async fn pump_track_audio(track: RemoteAudioTrack, mut input: MixerInput) {
    let mut stream = NativeAudioStream::new(track.rtc_track(), SAMPLE_RATE as i32, 1);
    while let Some(frame) = stream.next().await {
        input.push(&frame.data);
    }
}

/// Our camera and screen share.
impl Inner {
    async fn set_camera(self: Arc<Self>, on: bool) -> Result<(), String> {
        let _one_at_a_time = self.local_ops.lock().await;
        if !on {
            self.stop_video(TrackSource::Camera).await;
            return Ok(());
        }
        if lock(&self.camera).is_some() {
            return Ok(());
        }
        let room = self.current_room().ok_or("not in a call")?;
        let permission = room.local_participant().permission();
        if !may_publish(permission.as_ref(), ProtoSource::Camera) {
            return Err("this call doesn't let you send video".into());
        }
        let device = lock(&self.wanted).camera_device.clone();
        let source = self.video_sources.camera(device.as_deref())?;
        let video = self
            .clone()
            .start_video(source, TrackSource::Camera, None)
            .await?;
        self.go_live(&room, &self.camera, video).await
    }

    async fn start_screen_share(
        self: Arc<Self>,
        request: ScreenShareRequest,
    ) -> Result<ScreenShareStarted, String> {
        let _one_at_a_time = self.local_ops.lock().await;
        self.stop_system_audio();
        self.stop_video(TrackSource::Screenshare).await;
        let room = self.current_room().ok_or("not in a call")?;
        let permission = room.local_participant().permission();
        if !may_publish(permission.as_ref(), ProtoSource::ScreenShare) {
            return Err("this call doesn't let you share your screen".into());
        }
        let source = self.video_sources.screen(&request)?;
        let video = self
            .clone()
            .start_video(source, TrackSource::Screenshare, Some(&request))
            .await?;
        self.go_live(&room, &self.screen, video).await?;
        // The screen is shared either way; its audio only if it starts.
        let audio = request.audio.then(|| match &self.system_audio_capture {
            Some(capture) => self.start_system_audio(capture.as_ref()),
            None => Err("sharing system audio isn't available here".into()),
        });
        if let Some(Err(error)) = &audio {
            log::warn!("screen share audio: {error}");
        }
        self.publish_snapshot();
        Ok(ScreenShareStarted { audio })
    }

    async fn stop_screen_share(self: Arc<Self>) {
        let _one_at_a_time = self.local_ops.lock().await;
        self.stop_system_audio();
        self.stop_video(TrackSource::Screenshare).await;
    }

    /// Starts `source` and waits for its first frame, whose size sets what is sent.
    async fn start_video(
        self: Arc<Self>,
        source: Box<dyn VideoCaptureSource>,
        kind: TrackSource,
        screen: Option<&ScreenShareRequest>,
    ) -> Result<LocalVideo, String> {
        let id = self.next_capture.fetch_add(1, Ordering::Relaxed);
        let resolution = screen.map_or(ShareResolution::P720, |request| request.resolution);
        let fps = screen.map(|request| publish::normalize_fps(request.fps));
        let sid = Arc::new(Mutex::new(None::<String>));
        let preview = self
            .video_sink
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        type First = Result<(NativeVideoSource, (u32, u32)), String>;
        let (first_tx, first_rx) = tokio::sync::oneshot::channel::<First>();
        let first = Arc::new(Mutex::new(Some(first_tx)));
        let mut pipeline: Option<FramePipeline> = None;
        let frame_first = first.clone();
        let frame_sid = sid.clone();
        let frame_runtime = self.runtime.clone();
        let on_frame = Box::new(move |frame: crate::video::local::SourceFrame<'_>| {
            let pipeline = pipeline.get_or_insert_with(|| {
                // The source spawns its keepalive on the ambient runtime; this is a capture thread.
                let _runtime = frame_runtime.enter();
                let (width, height) = frame.size();
                let target = if kind == TrackSource::Camera {
                    fit_capture(width, height, ShareResolution::P720)
                } else {
                    fit_capture(width, height, resolution)
                };
                let pipeline = FramePipeline::new(
                    target,
                    kind == TrackSource::Screenshare,
                    preview.clone(),
                    frame_sid.clone(),
                );
                if let Some(first) = lock(&frame_first).take() {
                    let _ = first.send(Ok((pipeline.source(), target)));
                }
                pipeline
            });
            pipeline.push(frame);
        });
        let weak = Arc::downgrade(&self);
        let runtime = self.runtime.clone();
        let on_ended = Box::new(move |why: String| {
            // Before the first frame, the start fails with why (a cancelled picker).
            if let Some(first) = lock(&first).take() {
                let _ = first.send(Err(why));
                return;
            }
            if let Some(inner) = weak.upgrade() {
                runtime.spawn(async move { inner.local_ended(kind, id, why).await });
            }
        });
        let capture = source.start(on_frame, on_ended)?;
        let wait = if screen.is_some() && uses_portal() {
            FIRST_FRAME_AFTER_PICKER
        } else {
            FIRST_FRAME
        };
        let (source, (width, height)) = match tokio::time::timeout(wait, first_rx).await {
            Ok(Ok(first)) => first?,
            Ok(Err(_)) => return Err("the capture stopped before its first frame".into()),
            Err(_) => return Err("no picture came in time".into()),
        };
        let options = match fps {
            Some(fps) => ScreenSharePublish::new(width, height, fps).track_publish_options(),
            None => camera_publish_options(),
        };
        log::info!(
            "{kind:?}: sending {width}x{height}, top layer {:?}",
            options.video_encoding
        );
        Ok(LocalVideo {
            id,
            kind,
            source,
            options,
            sid,
            _capture: capture,
        })
    }

    /// Keeps `video` in its slot and publishes it. In the slot first, so a rejoin meanwhile
    /// republishes it; a leave meanwhile takes it, and the start fails.
    async fn go_live(
        &self,
        room: &Arc<Room>,
        slot: &Mutex<Option<LocalVideo>>,
        video: LocalVideo,
    ) -> Result<(), String> {
        let (id, name, source, options, sid) = (
            video.id,
            video.track_name(),
            video.source.clone(),
            video.options.clone(),
            video.sid.clone(),
        );
        *lock(slot) = Some(video);
        let published = publish_video(room, name, source, options, &sid).await;
        let still_ours = lock(slot).as_ref().is_some_and(|video| video.id == id);
        let same_room = self
            .current_room()
            .is_some_and(|current| Arc::ptr_eq(&current, room));
        let result = match (published, still_ours, same_room) {
            (_, false, _) => Err("the call ended while it was starting".to_owned()),
            (Ok(()), true, _) | (Err(_), true, false) => Ok(()),
            (Err(error), true, true) => {
                lock(slot).take();
                Err(error)
            }
        };
        self.publish_snapshot();
        result
    }

    /// Unpublishes and stops one of them. Nothing happens if it isn't running.
    async fn stop_video(&self, kind: TrackSource) {
        let slot = if kind == TrackSource::Camera {
            &self.camera
        } else {
            &self.screen
        };
        let Some(video) = lock(slot).take() else {
            return;
        };
        if let Some(room) = self.current_room() {
            unpublish_source(&room, kind).await;
        }
        let sid = lock(&video.sid).take();
        drop(video);
        if let Some(sid) = sid {
            self.notify_track_ended(&sid);
        }
        self.publish_snapshot();
    }

    /// The call is over: the captures stop. The room's tracks go with the room.
    fn drop_local_video(&self) {
        for slot in [&self.camera, &self.screen] {
            let video = lock(slot).take();
            if let Some(sid) = video.as_ref().and_then(|video| lock(&video.sid).take()) {
                self.notify_track_ended(&sid);
            }
        }
    }

    /// A capture stopped on its own. The screen's audio goes with it.
    async fn local_ended(self: Arc<Self>, kind: TrackSource, id: u64, why: String) {
        let _one_at_a_time = self.local_ops.lock().await;
        let slot = if kind == TrackSource::Camera {
            &self.camera
        } else {
            &self.screen
        };
        if lock(slot).as_ref().is_none_or(|video| video.id != id) {
            return;
        }
        log::info!("{kind:?} ended: {why}");
        if kind == TrackSource::Screenshare {
            self.stop_system_audio();
        }
        self.stop_video(kind).await;
    }

    /// What we send, for the report: what runs, and what the room allows.
    fn local_media(&self, room: Option<&Room>) -> LocalMediaView {
        let on = |running: bool| {
            if running {
                LocalShare::On
            } else {
                LocalShare::Off
            }
        };
        let permission = room.and_then(|room| room.local_participant().permission());
        LocalMediaView {
            camera: on(lock(&self.camera).is_some()),
            screen: on(lock(&self.screen).is_some()),
            screen_audio: on(lock(&self.system_audio).is_some()),
            may_camera: room.is_some() && may_publish(permission.as_ref(), ProtoSource::Camera),
            may_share: room.is_some() && may_publish(permission.as_ref(), ProtoSource::ScreenShare),
        }
    }

    /// Our own camera and screen as tiles: the publications in the room, under their sids.
    fn local_tracks(&self, room: &Room) -> (Option<VideoTrackView>, Option<VideoTrackView>) {
        let (mut camera, mut screen) = (None, None);
        for (sid, publication) in room.local_participant().track_publications() {
            let TrackDimension(width, height) = publication.dimension();
            let view = || VideoTrackView {
                track_sid: sid.to_string(),
                width,
                height,
            };
            match publication.source() {
                TrackSource::Camera => camera = Some(view()),
                TrackSource::Screenshare => screen = Some(view()),
                _ => {}
            }
        }
        (camera, screen)
    }
}

async fn publish_video(
    room: &Room,
    name: &str,
    source: NativeVideoSource,
    options: TrackPublishOptions,
    sid: &Mutex<Option<String>>,
) -> Result<(), String> {
    let track = LocalVideoTrack::create_video_track(name, RtcVideoSource::Native(source));
    let publication = room
        .local_participant()
        .publish_track(LocalTrack::Video(track), options)
        .await
        .map_err(|error| error.to_string())?;
    *lock(sid) = Some(publication.sid().to_string());
    Ok(())
}

async fn unpublish_source(room: &Room, source: TrackSource) {
    let local = room.local_participant();
    let sids: Vec<_> = local
        .track_publications()
        .values()
        .filter(|publication| publication.source() == source)
        .map(|publication| publication.sid())
        .collect();
    for sid in sids {
        if let Err(error) = local.unpublish_track(&sid).await {
            log::warn!("unpublishing {source:?} failed: {error}");
        }
    }
}
