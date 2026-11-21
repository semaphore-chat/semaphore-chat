//! `semaphore-mobile` end to end: `start`, then the exported `SemaphoreCore` over the real
//! transports, against `semaphore-fake-server`'s showcase on loopback.
//!
//! The test thread plays the foreign app. It has no Tokio runtime: every async export is awaited
//! with [`block_on`], a plain thread-parking executor, and every sync export is called straight
//! from the thread, exactly as Kotlin or Swift would. A command that needed the caller to be
//! inside a runtime would panic here.

use semaphore_core::model::{Conversation, ListOp, RestoreOutcome, SessionState};
use semaphore_core::{ConnectionState, CoreError, CoreEvent, NetworkState};
use semaphore_fake_server::{FakeServer, Record, ScenarioSource, entity_uuid};
use semaphore_ffi::{CoreListener, SemaphoreCore, WallClock};
use semaphore_mobile::{
    LAST_SERVER_FILE, MobileConfig, MobileHost, SecretStore, SecretStoreError, start,
};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// ----- the foreign side --------------------------------------------------------------------------

struct ThreadWaker(std::thread::Thread);

impl Wake for ThreadWaker {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

/// Runs a future to the end on this thread, with no runtime: how a foreign caller awaits.
fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(ThreadWaker(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
            return output;
        }
        std::thread::park_timeout(Duration::from_millis(50));
    }
}

/// Polls once, then gives up on it: a cancelled coroutine.
fn poll_once_and_drop<F: Future>(future: F) {
    let waker = Waker::from(Arc::new(ThreadWaker(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    let _ = future.as_mut().poll(&mut context);
}

/// Waits for a condition, polling, for at most 10 s.
fn until(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[derive(Default)]
struct MemSecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemSecrets {
    fn load(&self, key: String) -> Result<Option<String>, SecretStoreError> {
        Ok(self.0.lock().unwrap().get(&key).cloned())
    }
    fn save(&self, key: String, value: String) -> Result<(), SecretStoreError> {
        self.0.lock().unwrap().insert(key, value);
        Ok(())
    }
    fn delete(&self, key: String) -> Result<(), SecretStoreError> {
        self.0.lock().unwrap().remove(&key);
        Ok(())
    }
}

/// A store that fails every call, as a broken Keystore would.
struct FailingSecrets;

impl SecretStore for FailingSecrets {
    fn load(&self, _key: String) -> Result<Option<String>, SecretStoreError> {
        Err(failed())
    }
    fn save(&self, _key: String, _value: String) -> Result<(), SecretStoreError> {
        Err(failed())
    }
    fn delete(&self, _key: String) -> Result<(), SecretStoreError> {
        Err(failed())
    }
}

fn failed() -> SecretStoreError {
    SecretStoreError::Failed {
        reason: "the keystore is broken".into(),
    }
}

impl MemSecrets {
    fn refresh_token(&self, server: &Server) -> Option<String> {
        self.0
            .lock()
            .unwrap()
            .get(&format!("refresh-token:{}", server.url()))
            .cloned()
    }
}

struct SystemClock;
impl WallClock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64)
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<CoreEvent>>);
impl CoreListener for Recorder {
    fn on_event(&self, event: CoreEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Recorder {
    /// Whether any row that reached `conversation` reads `text`.
    fn saw_row(&self, conversation: &Conversation, text: &str) -> bool {
        self.0.lock().unwrap().iter().any(|event| match event {
            CoreEvent::MessagesChanged {
                conversation: changed,
                ops,
            } if changed == conversation => ops.iter().any(|op| match op {
                ListOp::Reset { rows }
                | ListOp::Insert { rows, .. }
                | ListOp::Replace { rows, .. } => rows.iter().any(|row| row.display == text),
                _ => false,
            }),
            _ => false,
        })
    }
}

// ----- the rig -----------------------------------------------------------------------------------

/// The fake server, on a runtime of its own that the test thread never enters.
struct Server {
    server: FakeServer,
    runtime: tokio::runtime::Runtime,
}

impl Server {
    fn start() -> Self {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        let server = runtime
            .block_on(FakeServer::start(ScenarioSource::Named("showcase")))
            .expect("the scenario loads");
        Self { server, runtime }
    }

    fn url(&self) -> String {
        self.server.base_url()
    }

    /// How many requests of this operation the server has answered with this status.
    fn answered(&self, operation: &str, status: u16) -> usize {
        self.server
            .requests()
            .iter()
            .filter(|record| {
                matches!(record, Record::Http { operation: Some(op), status: answered, .. }
                    if *op == operation && *answered == status)
            })
            .count()
    }

    /// Another member posts in a channel (the fake server's `post_as` control).
    fn post_as(&self, channel: &str, author: &str, text: &str) {
        let url = format!("{}/__control/post_as", self.url());
        let body = serde_json::json!({
            "channelId": entity_uuid(channel),
            "authorId": entity_uuid(author),
            "text": text,
        });
        let status = self.runtime.block_on(async move {
            reqwest::Client::new()
                .post(url)
                .json(&body)
                .send()
                .await
                .unwrap()
                .status()
        });
        assert!(status.is_success(), "post_as: {status}");
    }
}

static DIRS: AtomicU64 = AtomicU64::new(0);

fn fresh_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "semaphore-mobile-test-{}-{}",
        std::process::id(),
        DIRS.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

struct App {
    host: Arc<MobileHost>,
    core: Arc<SemaphoreCore>,
    events: Arc<Recorder>,
}

fn launch(dir: &std::path::Path, secrets: Arc<MemSecrets>) -> App {
    launch_with(dir, secrets, Arc::new(Recorder::default()))
}

fn launch_with(dir: &std::path::Path, secrets: Arc<dyn SecretStore>, events: Arc<Recorder>) -> App {
    launch_listening(dir, secrets, events.clone(), events)
}

fn launch_listening(
    dir: &std::path::Path,
    secrets: Arc<dyn SecretStore>,
    events: Arc<Recorder>,
    listener: Arc<dyn CoreListener>,
) -> App {
    let host = block_on(start(
        MobileConfig {
            data_dir: dir.to_string_lossy().into_owned(),
            user_agent: "Semaphore-Test/1.0 (JVM)".into(),
            device_name: "Test phone\r\n".into(),
            app_version: "0.0.0-test".into(),
        },
        secrets,
        Arc::new(SystemClock),
        listener,
    ))
    .expect("the core starts");
    let core = host.core();
    App { host, core, events }
}

fn sign_in(app: &App, server: &Server) {
    block_on(app.core.sign_in(server.url(), "me".into(), "pw".into())).expect("signed in");
    wait_signed_in_and_connected(app);
}

fn wait_signed_in_and_connected(app: &App) {
    until("sign-in", || {
        matches!(app.core.session(), SessionState::SignedIn { .. })
    });
    until("the socket", || {
        app.core.connection() == ConnectionState::Connected
    });
}

// ----- tests -------------------------------------------------------------------------------------

#[test]
fn signs_in_lists_communities_and_hears_a_live_message() {
    let server = Server::start();
    let app = launch(&fresh_dir(), Arc::new(MemSecrets::default()));
    sign_in(&app, &server);

    until("the communities", || !app.core.communities().is_empty());
    let channel = Conversation::Channel {
        id: entity_uuid("cc-general"),
    };
    block_on(app.core.open_conversation(channel.clone())).expect("the channel opens");

    server.post_as("cc-general", "u-priya", "hello from the fake server");
    until("the live message", || {
        app.events.saw_row(&channel, "hello from the fake server")
    });
    app.host.shutdown();
}

#[test]
fn the_next_start_restores_the_session_on_the_remembered_server() {
    let server = Server::start();
    let dir = fresh_dir();
    let secrets = Arc::new(MemSecrets::default());

    let first = launch(&dir, secrets.clone());
    assert_eq!(first.host.last_server(), None);
    sign_in(&first, &server);
    until("the server to be remembered", || {
        semaphore_mobile::read_last_server(&dir).as_deref() == Some(server.url().as_str())
    });
    first.host.shutdown();
    drop(first);

    let second = launch(&dir, secrets);
    let last = second.host.last_server().expect("a remembered server");
    assert_eq!(last, server.url());
    assert_eq!(
        block_on(second.core.restore_session(last)),
        Ok(RestoreOutcome::SignedIn)
    );
    wait_signed_in_and_connected(&second);
    until("the communities", || !second.core.communities().is_empty());
    assert!(dir.join(LAST_SERVER_FILE).exists());
    second.host.shutdown();
}

#[test]
fn lifecycle_calls_from_a_thread_with_no_runtime_reach_the_socket() {
    let server = Server::start();
    let app = launch(&fresh_dir(), Arc::new(MemSecrets::default()));
    sign_in(&app, &server);

    // Each of these reaches the socket, which spawns: outside the runtime that would panic.
    app.core.suspend();
    assert_eq!(app.core.connection(), ConnectionState::Suspended);
    app.core.resume();
    wait_signed_in_and_connected(&app);

    app.core.network_changed(NetworkState::Unavailable);
    until("offline", || {
        app.core.connection() == ConnectionState::Offline
    });
    app.core.network_changed(NetworkState::Available);
    wait_signed_in_and_connected(&app);
    app.host.shutdown();
}

#[test]
fn a_command_whose_caller_gives_up_still_runs_to_the_end() {
    let server = Server::start();
    let app = launch(&fresh_dir(), Arc::new(MemSecrets::default()));
    // A cancelled coroutine drops the future after its first poll: the sign-in goes on.
    poll_once_and_drop(app.core.sign_in(server.url(), "me".into(), "pw".into()));
    wait_signed_in_and_connected(&app);
    app.host.shutdown();
}

#[test]
fn after_shutdown_commands_are_unavailable_and_nothing_panics() {
    let server = Server::start();
    let app = launch(&fresh_dir(), Arc::new(MemSecrets::default()));
    sign_in(&app, &server);
    app.host.shutdown();
    // A second shutdown does nothing.
    app.host.shutdown();

    let result = block_on(app.core.sign_in(server.url(), "me".into(), "pw".into()));
    assert!(
        matches!(result, Err(CoreError::Unavailable { .. })),
        "{result:?}"
    );
    // Views still read; lifecycle calls on a stopped runtime are no-ops, not panics.
    let _ = app.core.communities();
    app.core.suspend();
    let _ = app.core.resume();
    let _ = app.core.network_changed(NetworkState::Available);
    // The service-less `drive` contract: a networked core drives itself, so this returns at once.
    block_on(app.core.drive());
}

#[test]
fn the_secrets_reach_the_hosts_store() {
    let server = Server::start();
    let secrets = Arc::new(MemSecrets::default());
    let app = launch(&fresh_dir(), secrets.clone());
    sign_in(&app, &server);
    app.host.shutdown();
    let stored = secrets.0.lock().unwrap();
    let key = format!("refresh-token:{}", server.url());
    assert!(stored.contains_key(&key), "stored: {:?}", stored.keys());
}

#[test]
fn a_user_agent_the_server_would_refuse_fails_start() {
    let result = block_on(start(
        MobileConfig {
            data_dir: fresh_dir().to_string_lossy().into_owned(),
            user_agent: "Semaphore-Test/é".into(),
            device_name: "Test phone".into(),
            app_version: "0.0.0-test".into(),
        },
        Arc::new(MemSecrets::default()),
        Arc::new(SystemClock),
        Arc::new(Recorder::default()),
    ));
    let Err(error) = result else {
        panic!("a non-ASCII user agent must not start the core");
    };
    assert!(error.to_string().contains("user agent"), "{error}");
}

// ----- review fixes: retries, rotation, failures, shutdown --------------------------------------

#[test]
fn a_failed_communities_fetch_comes_back_on_the_retry_timer_without_a_reconnect() {
    let server = Server::start();
    // No socket at all, so no new connection can be what retries it.
    server.server.refuse_connections(true);
    // A 429 is transient: retried after about a second.
    server
        .server
        .fail_route("CommunityController_findAllMine", 429, "RATE_LIMITED");
    let app = launch(&fresh_dir(), Arc::new(MemSecrets::default()));
    block_on(app.core.sign_in(server.url(), "me".into(), "pw".into())).expect("signed in");
    until("sign-in", || {
        matches!(app.core.session(), SessionState::SignedIn { .. })
    });
    until("the failed fetch", || {
        server.answered("CommunityController_findAllMine", 429) == 1
    });
    // The screen read it once and shows the failure; nothing reads it again.
    assert!(app.core.communities().is_empty());
    until("the retry", || {
        server.answered("CommunityController_findAllMine", 200) == 1
    });
    until("the communities", || !app.core.communities().is_empty());
    assert_ne!(app.core.connection(), ConnectionState::Connected);
    app.host.shutdown();
}

#[test]
fn with_rotation_every_restore_stores_the_new_token_and_a_third_start_restores() {
    let server = Server::start();
    server.server.rotate_refresh_tokens(true);
    let dir = fresh_dir();
    let secrets = Arc::new(MemSecrets::default());

    let first = launch(&dir, secrets.clone());
    sign_in(&first, &server);
    first.host.shutdown();
    drop(first);
    let signed_in = secrets.refresh_token(&server).expect("stored at sign-in");

    let mut previous = signed_in;
    for start in ["second", "third"] {
        let app = launch(&dir, secrets.clone());
        let last = app.host.last_server().expect("a remembered server");
        assert_eq!(
            block_on(app.core.restore_session(last)),
            Ok(RestoreOutcome::SignedIn),
            "the {start} start restores"
        );
        wait_signed_in_and_connected(&app);
        app.host.shutdown();
        let stored = secrets.refresh_token(&server).expect("still stored");
        assert_ne!(
            stored, previous,
            "the {start} start stored the rotated token"
        );
        previous = stored;
    }
    assert!(server.server.refresh_rotations() >= 2);
}

#[test]
fn a_refresh_token_the_server_never_issued_is_refused_and_forgotten() {
    let server = Server::start();
    server.server.rotate_refresh_tokens(true);
    let dir = fresh_dir();
    semaphore_mobile::write_last_server(&dir, &server.url()).unwrap();
    let secrets = Arc::new(MemSecrets::default());
    secrets.0.lock().unwrap().insert(
        format!("refresh-token:{}", server.url()),
        "garbage-never-issued".into(),
    );

    let app = launch(&dir, secrets.clone());
    let last = app.host.last_server().expect("a remembered server");
    assert_eq!(
        block_on(app.core.restore_session(last)),
        Ok(RestoreOutcome::Refused)
    );
    assert!(app.host.flush(3_000));
    assert_eq!(
        secrets.refresh_token(&server),
        None,
        "the refused token is deleted"
    );
    app.host.shutdown();
}

#[test]
fn a_failing_secret_store_costs_persistence_not_the_session() {
    let server = Server::start();
    let dir = fresh_dir();
    let first = launch_with(
        &dir,
        Arc::new(FailingSecrets),
        Arc::new(Recorder::default()),
    );
    // The device id's read failed at start already.
    let failure = first.host.secret_store_failure().expect("reported");
    assert!(failure.contains("the keystore is broken"), "{failure}");
    sign_in(&first, &server);
    until("the communities", || !first.core.communities().is_empty());
    until("the server to be remembered", || {
        semaphore_mobile::read_last_server(&dir).is_some()
    });
    first.host.shutdown();
    drop(first);

    let second = launch_with(
        &dir,
        Arc::new(FailingSecrets),
        Arc::new(Recorder::default()),
    );
    let last = second
        .host
        .last_server()
        .expect("the server is still remembered");
    assert_eq!(
        block_on(second.core.restore_session(last)),
        Ok(RestoreOutcome::NoSession)
    );
    assert!(second.host.secret_store_failure().is_some());
    second.host.shutdown();
}

#[test]
fn a_working_store_reports_no_failure() {
    let server = Server::start();
    let app = launch(&fresh_dir(), Arc::new(MemSecrets::default()));
    sign_in(&app, &server);
    app.host.shutdown();
    assert_eq!(app.host.secret_store_failure(), None);
}

#[test]
fn a_shutdown_while_a_rotation_is_answered_keeps_the_rotated_token() {
    let server = Server::start();
    server.server.rotate_refresh_tokens(true);
    let dir = fresh_dir();
    let secrets = Arc::new(MemSecrets::default());
    let first = launch(&dir, secrets.clone());
    sign_in(&first, &server);
    first.host.shutdown();
    drop(first);

    let second = launch(&dir, secrets.clone());
    // The server rotates, then holds its answer: shutdown starts with the new token on the wire.
    server
        .server
        .hold_responses("AuthController_refresh", Some(Duration::from_secs(1)));
    let rotations = server.server.refresh_rotations();
    poll_once_and_drop(second.core.restore_session(server.url()));
    until("the rotation", || {
        server.server.refresh_rotations() == rotations + 1
    });
    second.host.shutdown();
    drop(second);
    server.server.hold_responses("AuthController_refresh", None);

    let third = launch(&dir, secrets);
    assert_eq!(
        block_on(third.core.restore_session(server.url())),
        Ok(RestoreOutcome::SignedIn),
        "the token rotated during shutdown was kept"
    );
    third.host.shutdown();
}

/// Throws (panics, as UniFFI turns a foreign exception into) on its first event.
struct ThrowsFirst {
    thrown: AtomicBool,
    events: Arc<Recorder>,
}

impl CoreListener for ThrowsFirst {
    fn on_event(&self, event: CoreEvent) {
        if !self.thrown.swap(true, Ordering::SeqCst) {
            panic!("the listener threw");
        }
        self.events.on_event(event);
    }
}

#[test]
fn a_listener_that_throws_loses_that_event_and_nothing_else() {
    let server = Server::start();
    let events = Arc::new(Recorder::default());
    let listener = Arc::new(ThrowsFirst {
        thrown: AtomicBool::new(false),
        events: events.clone(),
    });
    let app = launch_listening(
        &fresh_dir(),
        Arc::new(MemSecrets::default()),
        events,
        listener.clone(),
    );
    sign_in(&app, &server);
    assert!(listener.thrown.load(Ordering::SeqCst));
    let channel = Conversation::Channel {
        id: entity_uuid("cc-general"),
    };
    block_on(app.core.open_conversation(channel.clone())).expect("the channel opens");
    server.post_as("cc-general", "u-priya", "still delivered");
    until("the live message", || {
        app.events.saw_row(&channel, "still delivered")
    });
    app.host.shutdown();
}

/// Shuts the host down from inside its callback, once signed in: on a runtime worker.
#[derive(Default)]
struct ShutsDown {
    host: Mutex<Option<Arc<MobileHost>>>,
    core: Mutex<Option<Arc<SemaphoreCore>>>,
    done: AtomicBool,
}

impl CoreListener for ShutsDown {
    fn on_event(&self, event: CoreEvent) {
        let signed_in = matches!(
            event,
            CoreEvent::ConnectionChanged {
                state: ConnectionState::Connected
            }
        );
        if signed_in && let Some(host) = self.host.lock().unwrap().take() {
            host.shutdown();
            self.done.store(true, Ordering::SeqCst);
        }
    }
}

#[test]
fn shutdown_from_a_listener_callback_does_not_panic() {
    let server = Server::start();
    let listener = Arc::new(ShutsDown::default());
    let app = launch_listening(
        &fresh_dir(),
        Arc::new(MemSecrets::default()),
        Arc::new(Recorder::default()),
        listener.clone(),
    );
    *listener.host.lock().unwrap() = Some(app.host.clone());
    *listener.core.lock().unwrap() = Some(app.core.clone());
    block_on(app.core.sign_in(server.url(), "me".into(), "pw".into())).expect("signed in");
    until("the shutdown from the callback", || {
        listener.done.load(Ordering::SeqCst)
    });
    let result = block_on(app.core.sign_in(server.url(), "me".into(), "pw".into()));
    assert!(
        matches!(result, Err(CoreError::Unavailable { .. })),
        "{result:?}"
    );
    listener.core.lock().unwrap().take();
}

#[test]
fn after_shutdown_and_drop_the_core_and_its_store_are_freed() {
    let server = Server::start();
    let secrets = Arc::new(MemSecrets::default());
    let app = launch(&fresh_dir(), secrets.clone());
    sign_in(&app, &server);
    assert!(Arc::strong_count(&secrets) > 1, "the store thread holds it");
    app.host.shutdown();
    drop(app);
    // The store thread ends once the last backend handle goes, and drops its Arc then.
    until("the store to be released", || {
        Arc::strong_count(&secrets) == 1
    });
}

#[test]
fn the_exported_shutdown_is_refused_on_a_networked_core() {
    let app = launch(&fresh_dir(), Arc::new(MemSecrets::default()));
    assert!(matches!(
        app.core.shutdown(),
        Err(CoreError::Unavailable { .. })
    ));
    app.host.shutdown();
}

#[test]
fn the_last_server_file_is_replaced_whole() {
    let dir = fresh_dir();
    semaphore_mobile::write_last_server(&dir, "https://one.example").unwrap();
    semaphore_mobile::write_last_server(&dir, "https://two.example").unwrap();
    assert_eq!(
        semaphore_mobile::read_last_server(&dir).as_deref(),
        Some("https://two.example")
    );
    assert!(!dir.join(format!("{LAST_SERVER_FILE}.tmp")).exists());
}
