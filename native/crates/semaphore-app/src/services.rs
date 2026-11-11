//! Building core and its transports, off the main thread.
//!
//! `HttpBackend::new` blocks until the secret store has read this install's device id, which on a
//! locked keyring means until its unlock prompt is answered. So the window opens first, on a splash,
//! and everything here is built on a thread of its own, then handed to the main thread.

use crate::runtime::{Activity, Exec, net_runtime};
use crate::voice::{self, FramesSink};
use semaphore_core::platform::{Clock, ScreenCapture, SecretStore};
use semaphore_core::realtime::Realtime as _;
use semaphore_core::{Core, CoreEvent, EventSink, Services as CoreServices};
use semaphore_media_livekit::audio::AudioIo;
use semaphore_media_livekit::{DesktopScreenCapture, EngineOptions, LiveKitEngine, VideoSources};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// The file that names the server signed in to last. Not a secret: the token is in the keyring.
const LAST_SERVER_FILE: &str = "last-server";

/// The server signed in to last, if any.
pub fn read_last_server(data_dir: &Path) -> Option<String> {
    std::fs::read_to_string(data_dir.join(LAST_SERVER_FILE))
        .ok()
        .map(|text| text.trim().to_owned())
        .filter(|url| !url.is_empty())
}

/// Remembers the server for the next start.
pub fn write_last_server(data_dir: &Path, url: &str) {
    let written = std::fs::create_dir_all(data_dir)
        .and_then(|()| std::fs::write(data_dir.join(LAST_SERVER_FILE), format!("{url}\n")));
    if let Err(error) = written {
        log::warn!("cannot remember the server for next time: {error}");
    }
}

/// Core's events, on their way to the main thread. Never blocks: whatever thread changed core
/// state, possibly the main thread itself, only queues here.
struct ChannelSink {
    sender: async_channel::Sender<CoreEvent>,
    activity: Arc<Activity>,
}

impl EventSink for ChannelSink {
    fn on_event(&self, event: CoreEvent) {
        let _ = self.sender.try_send(event);
        self.activity.bump();
    }
}

pub struct Services {
    pub core: Arc<Core>,
    pub exec: Exec,
    pub backend: HttpBackend,
    /// The server signed in to last, read before the backend was built.
    pub last_server: Option<String>,
    pub data_dir: PathBuf,
    pub engine: Arc<LiveKitEngine>,
    /// Where the engine's frames go once the window's `VideoFrames` is attached.
    pub frames: Arc<FramesSink>,
    /// Who picks what to share, and what there is.
    pub screens: Arc<dyn ScreenCapture>,
    /// Where sound goes: the call's, and the app's own sounds (`sounds`). The rig's virtual device
    /// in rigs and tests.
    pub audio: Arc<dyn AudioIo>,
    realtime: Arc<SocketRealtime>,
    runtime: Option<tokio::runtime::Runtime>,
}

impl Services {
    /// Ends core's driver and the socket, stops the runtime, then waits for the secret store. A
    /// sign-out is not implied: the stored session stays for the next start.
    ///
    /// In that order: once the runtime has stopped nothing can rotate the refresh token again, and
    /// a rotation that finished has already queued its write, so waiting on the store last is what
    /// keeps the newest token. Losing it would present an old one next time, which the server's
    /// reuse detection treats as theft and ends the session.
    pub fn shutdown(&mut self) {
        // Closing the window during a call leaves it, so the server drops this client from the
        // roster now rather than when presence expires.
        if self.core.voice().channel_id.is_some()
            && let Some(runtime) = &self.runtime
        {
            // Leaving stops the camera and the screen share with it.
            let core = self.core.clone();
            let left = runtime.block_on(async move {
                tokio::time::timeout(Duration::from_secs(2), core.leave_voice()).await
            });
            if !matches!(left, Ok(Ok(()))) {
                log::warn!("leaving the call at exit didn't finish: {left:?}");
            }
        }
        self.core.shutdown();
        let realtime = self.realtime.clone();
        if let Some(runtime) = self.runtime.take() {
            // `disconnect` may spawn, so it runs inside the runtime.
            runtime.block_on(async move { realtime.disconnect() });
            runtime.shutdown_timeout(Duration::from_secs(2));
        }
        if !self.backend.flush(Duration::from_secs(3)) {
            log::warn!("the secret store didn't finish its writes before exit");
        }
    }
}

impl Drop for Services {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

pub struct Started {
    pub services: async_channel::Receiver<Services>,
    pub events: async_channel::Receiver<CoreEvent>,
}

/// Starts building on a thread of its own. The events channel exists at once, so nothing core says
/// while starting is lost.
pub struct StartOptions {
    pub secrets: Arc<dyn SecretStore>,
    pub clock: Arc<dyn Clock>,
    pub data_dir: PathBuf,
    pub audio: Option<Arc<dyn AudioIo>>,
    pub heartbeat: Duration,
    /// Cameras and screens: `None` for the platform's, or the rig's fakes.
    pub video_sources: Option<Arc<dyn VideoSources>>,
    /// The screen list for our picker: `None` for the platform's.
    pub screen_capture: Option<Arc<dyn ScreenCapture>>,
}

pub fn start(options: StartOptions, activity: Arc<Activity>) -> Started {
    let StartOptions {
        secrets,
        clock,
        data_dir,
        audio,
        heartbeat,
        video_sources,
        screen_capture,
    } = options;
    let (events_sender, events) = async_channel::unbounded();
    let (services_sender, services) = async_channel::bounded(1);
    std::thread::Builder::new()
        .name("semaphore-start".into())
        .spawn(move || {
            semaphore_net::install_crypto_provider();
            let runtime = net_runtime();
            let last_server = read_last_server(&data_dir);
            // Reads the device id and the last server's refresh token in one wait on the store.
            let backend = HttpBackend::restoring(secrets, last_server.clone());
            let realtime = SocketRealtime::new(SocketConfig::new("unused"), backend.clone());
            // Its own runtime: the SDK spawns on whatever runtime it was entered from.
            let mut engine_options = EngineOptions::default();
            if let Some(audio) = audio {
                engine_options.audio_io = audio;
            }
            let audio = engine_options.audio_io.clone();
            if let Some(sources) = video_sources {
                engine_options.video_sources = sources;
            }
            // A screen share carries the system's audio: everything but our own call.
            engine_options.system_audio = semaphore_sysaudio::platform_capture().map(Arc::from);
            let screens: Arc<dyn ScreenCapture> =
                screen_capture.unwrap_or_else(|| Arc::new(DesktopScreenCapture));
            let engine = Arc::new(LiveKitEngine::new(engine_options));
            let sink = Arc::new(ChannelSink {
                sender: events_sender,
                activity: activity.clone(),
            });
            let core = Arc::new(Core::with_services(
                clock,
                sink,
                CoreServices {
                    backend: Arc::new(backend.clone()),
                    realtime: realtime.clone(),
                    media: Some(engine.clone()),
                },
            ));
            realtime.attach((*core).clone());
            let frames = voice::wire(&engine, &core, &runtime, heartbeat, activity.clone());
            let driver = core.clone();
            runtime.spawn(async move { driver.drive().await });
            let services = Services {
                core,
                exec: Exec::new(runtime.handle().clone(), activity.clone()),
                backend,
                last_server,
                data_dir,
                engine,
                frames,
                screens,
                audio,
                realtime,
                runtime: Some(runtime),
            };
            if services_sender.send_blocking(services).is_err() {
                log::warn!("the app went away while it was starting");
            }
            activity.bump();
        })
        .expect("the OS starts a thread");
    Started { services, events }
}
