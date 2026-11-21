//! The mobile apps' native library: `semaphore-ffi`'s core, built over the real transports.
//!
//! `semaphore-ffi` stays core-only, so it builds anywhere with no C toolchain. This crate links
//! `semaphore-net` (which compiles ring) and builds what a working core needs: the secret-backed
//! `HttpBackend`, the `SocketRealtime` socket, and a Tokio runtime that both run on. It then hands
//! the core to `semaphore-ffi` with [`SemaphoreCore::with_runtime`], which spawns core's driver
//! there and runs every command there too.
//!
//! The app loads this one library. Its UniFFI exports and `semaphore-ffi`'s end up in the same
//! `.so` (the `pub use` below keeps ffi's linked), and `uniffi-bindgen --library` writes the
//! Kotlin for both crates from it: `uniffi.semaphore` (the core) and `uniffi.semaphore_mobile`
//! (this file).
//!
//! Nothing here is Kotlin-only: a Swift app uses the same `start`, the same foreign traits and
//! the same `MobileHost`.
//!
//! What the host does with it:
//! - implements [`SecretStore`] (Android: Keystore-sealed files), `WallClock` and `CoreListener`;
//! - calls [`start`] once, off the main thread or from a coroutine, and keeps the [`MobileHost`];
//! - if [`MobileHost::last_server`] names a server, calls `restore_session` with it;
//! - maps its lifecycle onto `suspend`/`resume`/`network_changed`, and calls
//!   [`MobileHost::flush`] with a short bound when it goes to the background, while the OS still
//!   counts it as visible: once backgrounded it may end the process without another word;
//! - may ask [`MobileHost::secret_store_failure`] whether persistence was lost, to say so.
//!
//! The server signed in to is remembered here, in `data_dir`, as the desktop app does, so a
//! Swift app gets the same for free.

uniffi::setup_scaffolding!("semaphore_mobile");

/// Linked into this library so its exports (the whole core surface) are in the same `.so`.
pub use semaphore_ffi;

use semaphore_core::model::{SessionState, ViewKey};
use semaphore_core::platform::{
    Clock, CoreError, CoreEvent, EventSink, SecretStore as CoreSecretStore,
};
use semaphore_core::realtime::Realtime as _;
use semaphore_core::{Core, Services};
use semaphore_ffi::{CoreListener, SemaphoreCore, WallClock};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{ClientInfo, HttpBackend, SocketRealtime};
use std::io::Write as _;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The file in `data_dir` that names the server signed in to last. Not a secret: the token is in
/// the secret store. The desktop app's name for the same file.
pub const LAST_SERVER_FILE: &str = "last-server";

/// Keeps secrets between runs: the refresh token per server, and this install's device id.
///
/// Called on a thread of the library's own, never the UI thread, one call at a time. `save` and
/// `delete` must be durable when they return: the refresh token rotates on every refresh, and the
/// server treats an old one presented again as theft and ends the session. A process killed
/// after a rotation must still find the new token next time.
#[uniffi::export(with_foreign)]
pub trait SecretStore: Send + Sync {
    fn load(&self, key: String) -> Result<Option<String>, SecretStoreError>;
    fn save(&self, key: String, value: String) -> Result<(), SecretStoreError>;
    fn delete(&self, key: String) -> Result<(), SecretStoreError>;
}

/// A [`SecretStore`] that failed. It costs the session its persistence, not its function.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum SecretStoreError {
    // Not `message`: uniffi 0.32's Kotlin template clashes with Throwable.message.
    #[error("{reason}")]
    Failed { reason: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for SecretStoreError {
    fn from(error: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::Failed {
            reason: error.reason,
        }
    }
}

/// Why [`start`] failed. The OS refusing a thread or the runtime, or a user agent the server would refuse.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum StartError {
    #[error("{reason}")]
    Failed { reason: String },
}

/// What the host knows about itself.
#[derive(Debug, Clone, uniffi::Record)]
pub struct MobileConfig {
    /// A private directory of the app's that survives restarts (Android: `noBackupFilesDir`).
    pub data_dir: String,
    /// `User-Agent` on every request, e.g. `Semaphore-Android/0.1.0 (Android 15)`. Must be
    /// non-empty visible ASCII: [`start`] fails otherwise ([`ClientInfo::mobile`]).
    pub user_agent: String,
    /// How this install shows in its owner's sessions list. Anything the platform has: it is
    /// normalised and percent-encoded by `semaphore-net` ([`ClientInfo::mobile`]).
    pub device_name: String,
    /// This build's version, for diagnostics reports.
    pub app_version: String,
}

/// How long [`MobileHost::shutdown`] waits for a token refresh in flight.
const REFRESH_WAIT: Duration = Duration::from_secs(3);

/// The running core and what it runs on.
#[derive(uniffi::Object)]
pub struct MobileHost {
    core: Arc<SemaphoreCore>,
    backend: HttpBackend,
    realtime: Arc<SocketRealtime>,
    remember: Arc<Remember>,
    runtime: Mutex<Option<tokio::runtime::Runtime>>,
    last_server: Option<String>,
    store_failure: Arc<Mutex<Option<String>>>,
}

/// Builds the core over the real transports, and starts its driver.
///
/// Reading the device id and the last server's refresh token waits on `secrets`, so this does its
/// work on a thread of its own and is safe to await from the UI thread's coroutine scope.
#[uniffi::export]
pub async fn start(
    config: MobileConfig,
    secrets: Arc<dyn SecretStore>,
    clock: Arc<dyn WallClock>,
    listener: Arc<dyn CoreListener>,
) -> Result<Arc<MobileHost>, StartError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("semaphore-start".into())
        .spawn(move || {
            let _ = sender.send(build(config, secrets, clock, listener));
        })
        .map_err(|error| StartError::Failed {
            reason: format!("cannot start a thread: {error}"),
        })?;
    receiver.await.unwrap_or_else(|_| {
        Err(StartError::Failed {
            reason: "starting the core panicked".to_owned(),
        })
    })
}

fn build(
    config: MobileConfig,
    secrets: Arc<dyn SecretStore>,
    clock: Arc<dyn WallClock>,
    listener: Arc<dyn CoreListener>,
) -> Result<Arc<MobileHost>, StartError> {
    semaphore_net::install_crypto_provider();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        // Plenty for one user's REST calls and one socket, as on desktop.
        .worker_threads(2)
        .thread_name("semaphore-net")
        .enable_all()
        .build()
        .map_err(|error| StartError::Failed {
            reason: format!("cannot start the runtime: {error}"),
        })?;
    let data_dir = PathBuf::from(config.data_dir);
    let last_server = read_last_server(&data_dir);
    let client = ClientInfo::mobile(config.user_agent, config.device_name).map_err(|error| {
        StartError::Failed {
            reason: format!("invalid client identity: {error}"),
        }
    })?;
    let store_failure = Arc::new(Mutex::new(None));
    let backend = HttpBackend::restoring(
        Arc::new(Secrets {
            store: secrets,
            failure: store_failure.clone(),
        }),
        last_server.clone(),
        client,
    );
    let realtime = SocketRealtime::new(SocketConfig::new("unused"), backend.clone());
    let remember = Arc::new(Remember {
        core: Mutex::new(None),
        backend: backend.clone(),
        data_dir,
        runtime: runtime.handle().clone(),
        remembered: Mutex::new(last_server.clone()),
        writing: Mutex::new(()),
    });
    let core = Core::with_services(
        Arc::new(ForeignClock(clock)),
        Arc::new(Sink {
            listener,
            remember: remember.clone(),
        }),
        Services {
            backend: Arc::new(backend.clone()),
            realtime: realtime.clone(),
            // No voice on mobile yet: `join_voice` is unavailable.
            media: None,
        },
    );
    realtime.attach(core.clone());
    core.set_app_version(config.app_version);
    *lock(&remember.core) = Some(core.clone());
    let core = SemaphoreCore::with_runtime(core, runtime.handle().clone());
    Ok(Arc::new(MobileHost {
        core,
        backend,
        realtime,
        remember,
        runtime: Mutex::new(Some(runtime)),
        last_server,
        store_failure,
    }))
}

#[uniffi::export]
impl MobileHost {
    /// The core: every command and every view.
    pub fn core(&self) -> Arc<SemaphoreCore> {
        self.core.clone()
    }

    /// The server signed in to last, as it was at start: pass it to `restore_session`.
    pub fn last_server(&self) -> Option<String> {
        self.last_server.clone()
    }

    /// Waits until every secret written so far has reached the [`SecretStore`], or `timeout_ms`
    /// passes, and says which. Call it when the app goes to the background. Blocks: not on the UI
    /// thread.
    pub fn flush(&self, timeout_ms: u32) -> bool {
        self.backend
            .flush(Duration::from_millis(u64::from(timeout_ms)))
    }

    /// The first failure of the [`SecretStore`] since start, if any: the session then won't
    /// survive a restart (and the device id may be new each start). Logged at error level once,
    /// too. For the host to say so; nothing else changes.
    pub fn secret_store_failure(&self) -> Option<String> {
        lock(&self.store_failure).clone()
    }

    /// Stops everything `start` began. Not a sign-out: the stored session stays for the next
    /// start. Every command after this fails with `Unavailable`. Blocks for a few seconds at
    /// most: not on the UI thread. Safe from a listener callback (a thread of the runtime it
    /// stops), where it does the work on a thread of its own and waits for it; safe to call twice.
    ///
    /// In order:
    /// 1. core's driver ends;
    /// 2. a token refresh in flight is waited for, up to 3 s, and no new one may start: a refresh
    ///    the server has answered has queued its new token's write by then;
    /// 3. the socket is told to leave (its clean goodbye is best effort: the runtime stops next);
    /// 4. the runtime stops, dropping every command still running;
    /// 5. the secret store's queue is drained, up to 3 s.
    ///
    /// So the newest refresh token reaches the store, unless a refresh takes longer than 3 s to
    /// finish (that one is dropped, and the next start may present a token the server has
    /// rotated away, which ends the session) or the store itself takes longer than 3 s.
    pub fn shutdown(&self) {
        if tokio::runtime::Handle::try_current().is_ok() {
            // Inside a runtime (a listener callback, on this runtime's worker): blocking on the
            // runtime here would panic. Our worker waits; stopping the runtime waits for it at
            // most 2 s.
            std::thread::scope(|scope| {
                let stopping = std::thread::Builder::new()
                    .name("semaphore-shutdown".into())
                    .spawn_scoped(scope, || self.shutdown_outside_runtime());
                match stopping {
                    Ok(stopping) => {
                        if stopping.join().is_err() {
                            log::error!("shutting down panicked");
                        }
                    }
                    Err(error) => log::error!("cannot start a thread to shut down: {error}"),
                }
            });
        } else {
            self.shutdown_outside_runtime();
        }
    }
}

impl MobileHost {
    fn shutdown_outside_runtime(&self) {
        let runtime = lock(&self.runtime).take();
        let Some(runtime) = runtime else {
            return;
        };
        self.core.core().shutdown();
        let backend = self.backend.clone();
        let realtime = self.realtime.clone();
        // `disconnect` may spawn, so it runs inside the runtime.
        let paused = runtime.block_on(async move {
            let paused = backend.pause_refreshes(REFRESH_WAIT).await;
            realtime.disconnect();
            paused
        });
        if paused.is_none() {
            log::warn!("a token refresh was still running at shutdown; its new token may be lost");
        }
        runtime.shutdown_timeout(Duration::from_secs(2));
        if !self.backend.flush(Duration::from_secs(3)) {
            log::warn!("the secret store didn't finish its writes before shutdown");
        }
        self.release();
        drop(paused);
    }

    /// Breaks the references back to the core (the socket's and the remembered server's), so the
    /// core, the backend and its store thread are freed once the host's last handle goes.
    fn release(&self) {
        self.realtime.detach();
        lock(&self.remember.core).take();
    }
}

impl Drop for MobileHost {
    fn drop(&mut self) {
        if let Some(runtime) = lock(&self.runtime).take() {
            self.core.core().shutdown();
            // Never blocks, so it's safe on a runtime thread too.
            runtime.shutdown_background();
        }
        self.release();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The server signed in to last, if any.
pub fn read_last_server(data_dir: &Path) -> Option<String> {
    std::fs::read_to_string(data_dir.join(LAST_SERVER_FILE))
        .ok()
        .map(|text| text.trim().to_owned())
        .filter(|url| !url.is_empty())
}

/// Durable when it returns `Ok`: the temp file is synced before it replaces the old one, and
/// the directory after, so a power loss leaves the old name or the new one, never an empty file.
pub fn write_last_server(data_dir: &Path, url: &str) -> std::io::Result<()> {
    let path = data_dir.join(LAST_SERVER_FILE);
    let temp = data_dir.join(format!("{LAST_SERVER_FILE}.tmp"));
    std::fs::create_dir_all(data_dir)?;
    let mut file = std::fs::File::create(&temp)?;
    file.write_all(format!("{url}\n").as_bytes())?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&temp, &path)?;
    // The rename itself, on filesystems that need the directory synced for it. Not every
    // platform can open a directory; the file's own sync above is what matters most.
    if let Ok(dir) = std::fs::File::open(data_dir) {
        let _ = dir.sync_all();
    }
    Ok(())
}

/// Remembers the server once a session on it is signed in: desktop's `remember_server`.
struct Remember {
    /// Set right after the core is built, before anything can sign in; cleared at shutdown,
    /// because the core holds this (through its sink) and would otherwise never be freed.
    core: Mutex<Option<Core>>,
    backend: HttpBackend,
    data_dir: PathBuf,
    runtime: tokio::runtime::Handle,
    /// The server last written to the file: set only once a write has succeeded, so a failed one
    /// is tried again at the next session change.
    remembered: Mutex<Option<String>>,
    /// One write at a time, so the newest always lands last.
    writing: Mutex<()>,
}

impl Remember {
    fn session_changed(self: &Arc<Self>) {
        let Some(core) = lock(&self.core).clone() else {
            return;
        };
        if !matches!(core.session(), SessionState::SignedIn { .. }) {
            return;
        }
        if self.backend.server_url().is_none()
            || lock(&self.remembered).as_deref() == self.backend.server_url().as_deref()
        {
            return;
        }
        // Off the caller's thread, which may be the UI's. One job at a time, each writing the
        // server signed in to when it runs, so two quick changes can't land out of order.
        let this = self.clone();
        // Detached: the job holds its own Arc, and a runtime already shut down just drops it.
        drop(self.runtime.spawn_blocking(move || {
            let _writing = lock(&this.writing);
            let Some(url) = this.backend.server_url() else {
                return;
            };
            if lock(&this.remembered).as_deref() == Some(url.as_str()) {
                return;
            }
            match write_last_server(&this.data_dir, &url) {
                Ok(()) => *lock(&this.remembered) = Some(url),
                Err(error) => log::warn!("cannot remember the server for next time: {error}"),
            }
        }));
    }
}

/// Core's events to the host's listener, and the session's to [`Remember`].
struct Sink {
    listener: Arc<dyn CoreListener>,
    remember: Arc<Remember>,
}

impl EventSink for Sink {
    fn on_event(&self, event: CoreEvent) {
        let session = matches!(
            event,
            CoreEvent::ViewChanged {
                view: ViewKey::Session
            }
        );
        // A foreign listener that throws arrives here as a panic (UniFFI's callback contract).
        // Catch it, so it costs that one event and not core's delivery or the task it ran on.
        if let Err(panic) =
            std::panic::catch_unwind(AssertUnwindSafe(|| self.listener.on_event(event)))
        {
            log::error!(
                "the app's listener failed on an event, which is lost: {}",
                panic_message(panic.as_ref())
            );
        }
        if session {
            self.remember.session_changed();
        }
    }
}

struct ForeignClock(Arc<dyn WallClock>);

impl Clock for ForeignClock {
    fn now_ms(&self) -> u64 {
        self.0.now_ms()
    }
}

fn panic_message(panic: &(dyn std::any::Any + Send)) -> &str {
    panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("no message")
}

/// The host's store, as `HttpBackend` asks for it. Its first failure is kept for
/// [`MobileHost::secret_store_failure`] and logged at error level; `HttpBackend` logs each one
/// as a warning, and carries on without persistence.
struct Secrets {
    store: Arc<dyn SecretStore>,
    failure: Arc<Mutex<Option<String>>>,
}

impl Secrets {
    fn failed(&self, what: &str, error: SecretStoreError) -> CoreError {
        let mut failure = lock(&self.failure);
        if failure.is_none() {
            log::error!(
                "the secret store failed to {what}: {error}. The session won't survive a restart."
            );
            *failure = Some(format!("{what}: {error}"));
        }
        CoreError::Failed {
            message: error.to_string(),
        }
    }
}

impl CoreSecretStore for Secrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        self.store
            .load(key)
            .map_err(|error| self.failed("load", error))
    }
    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.store
            .save(key, value)
            .map_err(|error| self.failed("save", error))
    }
    fn delete(&self, key: String) -> Result<(), CoreError> {
        self.store
            .delete(key)
            .map_err(|error| self.failed("delete", error))
    }
}

/// The Android app's entry point into rustls-platform-verifier.
#[cfg(target_os = "android")]
mod android {
    use jni::EnvUnowned;
    use jni::errors::ThrowRuntimeExAndDefault;
    use jni::objects::JObject;

    /// `NativeLib.nativeInit(applicationContext)`: sends this library's `log` records to logcat
    /// (tag `semaphore`) with a panic hook that logs there too, then gives
    /// rustls-platform-verifier the JVM and the application `Context` it needs to read the system
    /// trust store. `NativeLib.init` calls it once, before anything builds a TLS client; calling
    /// it again does nothing more.
    ///
    /// A JNI failure throws a `RuntimeException` into Kotlin rather than aborting.
    #[unsafe(no_mangle)]
    pub extern "system" fn Java_app_semaphorechat_android_NativeLib_nativeInit<'caller>(
        mut unowned_env: EnvUnowned<'caller>,
        _this: JObject<'caller>,
        context: JObject<'caller>,
    ) {
        install_logging();
        unowned_env
            .with_env(|env| semaphore_net::init_android(env, context))
            .resolve::<ThrowRuntimeExAndDefault>();
    }

    fn install_logging() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            android_logger::init_once(
                android_logger::Config::default()
                    .with_max_level(log::LevelFilter::Info)
                    .with_tag("semaphore"),
            );
            // Logcat has no stderr: without this a panic (a listener that threw, a bug) leaves
            // no trace. The default hook still runs after.
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                log::error!("panic: {info}");
                previous(info);
            }));
        });
    }
}
