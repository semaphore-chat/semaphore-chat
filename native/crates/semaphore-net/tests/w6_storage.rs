//! W6-C over the real transports: the per-user storage list, quotas and recalculation, by `Core`
//! on `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`'s showcase.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::backend::AdminStorageBackend;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{AdminActionKind, LoadState, SessionState};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, Record, ScenarioSource, entity_uuid};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

#[derive(Default)]
struct MemSecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemSecrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        Ok(self.0.lock().unwrap().get(&key).cloned())
    }
    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().insert(key, value);
        Ok(())
    }
    fn delete(&self, key: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().remove(&key);
        Ok(())
    }
}

struct WallClock;
impl Clock for WallClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64)
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<CoreEvent>>);
impl EventSink for Recorder {
    fn on_event(&self, event: CoreEvent) {
        self.0.lock().unwrap().push(event);
    }
}

struct Client {
    core: Core,
    backend: HttpBackend,
}

async fn signed_in(server: &FakeServer, username: &str) -> Client {
    let backend = HttpBackend::new(Arc::new(MemSecrets::default()));
    let mut config = SocketConfig::new("unused");
    config.reconnect_delay = Duration::from_millis(50);
    let realtime = SocketRealtime::new(config, backend.clone());
    let events = Arc::new(Recorder::default());
    let core = Core::with_services(
        Arc::new(WallClock),
        events,
        Services {
            backend: Arc::new(backend.clone()),
            realtime: realtime.clone(),
            media: None,
        },
    );
    realtime.attach(core.clone());
    let driver = core.clone();
    tokio::spawn(async move { driver.drive().await });
    core.sign_in(server.base_url(), username.into(), "pw".into())
        .await
        .unwrap();
    until("sign-in", || {
        matches!(core.session(), SessionState::SignedIn { .. })
    })
    .await;
    until("the socket", || {
        core.connection() == ConnectionState::Connected
    })
    .await;
    Client { core, backend }
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

/// Sets used bytes for users through the fake's control.
async fn set_usage(server: &FakeServer, usage: Value) {
    // reqwest 0.13 builds a client over rustls without a provider; the transport picks ring.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let response = reqwest::Client::new()
        .post(format!("{}/__control/storage_usage", server.base_url()))
        .json(&usage)
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(response.status().as_u16(), 200);
}

/// How many storage list pages the server has answered.
fn list_requests(server: &FakeServer) -> usize {
    server
        .requests()
        .iter()
        .filter(|record| {
            matches!(
                record,
                Record::Http { method, path, .. }
                    if method == "GET" && path == "/api/storage/users"
            )
        })
        .count()
}

#[tokio::test]
async fn the_owner_pages_through_storage_and_sets_a_quota() {
    let server = server().await;
    // Priya uses exactly 8% of the default quota; Marcus about 89%.
    let mut usage = serde_json::Map::new();
    usage.insert(id("u-priya"), json!(4_294_967_296i64));
    usage.insert(id("u-marcus"), json!(48_000_000_000i64));
    set_usage(&server, Value::Object(usage)).await;

    let me = signed_in(&server, "me").await;
    me.core.admin_storage(0);
    until("the storage list", || {
        me.core.admin_storage(0).state == LoadState::Ready
    })
    .await;
    let view = me.core.admin_storage(0);
    assert_eq!(
        (view.rows.len() as u64, view.total, view.more),
        (13, 13, false)
    );
    assert!(!view.op.busy && view.op.error.is_none());

    // Most used first, then everyone else (a tie broken by id).
    assert_eq!(view.rows[0].username, "dropbear");
    assert_eq!(view.rows[0].quota_bytes, 53_687_091_200);
    assert_eq!(view.rows[0].percent_used, 89.41);
    assert_eq!(view.rows[1].username, "pri");
    assert_eq!(view.rows[1].percent_used, 8.0);
    assert_eq!(view.rows[0].file_count, 0);

    // One page of 13: nothing left to read.
    me.core.load_more_storage(0).await.unwrap();
    assert_eq!(list_requests(&server), 1, "no next page to ask for");

    // A filter reads its own list.
    me.core.admin_storage(50);
    until("the filtered list", || {
        me.core.admin_storage(50).state == LoadState::Ready
    })
    .await;
    let filtered = me.core.admin_storage(50);
    assert_eq!(
        filtered
            .rows
            .iter()
            .map(|row| row.username.as_str())
            .collect::<Vec<_>>(),
        ["dropbear"]
    );
    assert_eq!((filtered.total, filtered.more), (1, false));

    // A quota change lands on the list that showed her, and on the server.
    me.core
        .set_user_quota(id("u-priya"), 8_589_934_592)
        .await
        .unwrap();
    let view = me.core.admin_storage(0);
    let row = view
        .rows
        .iter()
        .find(|row| row.user_id == id("u-priya"))
        .expect("the user stays in the list");
    assert_eq!((row.quota_bytes, row.percent_used), (8_589_934_592, 50.0));
    let filtered = me.core.admin_storage(50);
    assert!(
        filtered.rows.iter().all(|row| row.user_id != id("u-priya")),
        "a list that didn't show her doesn't grow a row"
    );
    assert!(!view.op.busy);
    let outcome = view
        .op
        .finished
        .iter()
        .find(|outcome| outcome.action.kind == AdminActionKind::SetUserQuota)
        .expect("the change ended on the list's op");
    assert_eq!(
        outcome.action.target_id.as_deref(),
        Some(id("u-priya").as_str())
    );
    assert!(outcome.error.is_none());

    // The one-user read (no command uses it yet) answers the same row.
    let stats = me
        .backend
        .storage_quota_controller_get_user_storage_stats(id("u-priya"))
        .await
        .unwrap();
    assert_eq!(
        (stats.quota_bytes, stats.percent_used),
        (8_589_934_592, 50.0)
    );

    // Another device on the same account reads what the server kept.
    let other = signed_in(&server, "me").await;
    other.core.admin_storage(0);
    until("the storage list again", || {
        other.core.admin_storage(0).state == LoadState::Ready
    })
    .await;
    let row = other
        .core
        .admin_storage(0)
        .rows
        .into_iter()
        .find(|row| row.user_id == id("u-priya"))
        .expect("the user is listed");
    assert_eq!((row.quota_bytes, row.percent_used), (8_589_934_592, 50.0));
}

#[tokio::test]
async fn a_plain_user_is_refused() {
    let server = server().await;
    server.sign_in_as("pri", &id("u-priya"));
    let priya = signed_in(&server, "pri").await;

    priya.core.admin_storage(0);
    until("the refusal", || {
        matches!(priya.core.admin_storage(0).state, LoadState::Failed { .. })
    })
    .await;
    let view = priya.core.admin_storage(0);
    match view.state {
        LoadState::Failed { error } => assert!(
            error.message.contains("FORBIDDEN") && error.message.contains("Forbidden resource"),
            "{error:?}"
        ),
        other => panic!("expected a failed read, got {other:?}"),
    }
    assert!(view.rows.is_empty(), "nothing was read");

    assert!(
        priya
            .core
            .set_user_quota(id("u-priya"), 1_000)
            .await
            .is_err()
    );
    let view = priya.core.admin_storage(0);
    let state = view
        .op
        .actions
        .iter()
        .find(|state| state.action.kind == AdminActionKind::SetUserQuota)
        .expect("the refusal shows on the list's op");
    let error = state.error.as_ref().expect("the refusal shows");
    assert_eq!(error.code, "FORBIDDEN");
    assert!(error.message.contains("Forbidden resource"), "{error:?}");

    assert!(
        priya
            .backend
            .storage_quota_controller_get_user_storage_stats(id("u-priya"))
            .await
            .is_err()
    );
}
