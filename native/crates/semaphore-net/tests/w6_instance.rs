//! W6-A over the real transports: the admin dashboard and instance settings, by `Core` on
//! `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`'s showcase.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    AttentionId, AttentionSeverity, InstanceSettingsPatch, LoadState, RegistrationMode,
    SessionState,
};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, QueryKey, Services};
use semaphore_fake_server::{FakeServer, ScenarioSource, entity_uuid};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

const SETTINGS_KEY: &str = "instanceControllerGetSettings";

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
    #[allow(dead_code)]
    events: Arc<Recorder>,
}

/// Signed in as `username` (the scenario's `me` unless `sign_in_as` named it), socket connected.
async fn signed_in(server: &FakeServer, username: &str) -> Client {
    let backend = HttpBackend::new(Arc::new(MemSecrets::default()));
    let mut config = SocketConfig::new("unused");
    config.reconnect_delay = Duration::from_millis(50);
    let realtime = SocketRealtime::new(config, backend.clone());
    let events = Arc::new(Recorder::default());
    let core = Core::with_services(
        Arc::new(WallClock),
        events.clone(),
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
    Client { core, events }
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

#[tokio::test]
async fn the_owner_reads_and_changes_instance_settings() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    me.core.instance_settings();
    until("the settings", || {
        me.core.instance_settings().state == LoadState::Ready
    })
    .await;
    let view = me.core.instance_settings();
    assert_eq!(view.name, "Semaphore Chat");
    assert_eq!(view.description, None);
    assert_eq!(view.registration, RegistrationMode::InviteOnly);
    assert_eq!(view.default_quota_bytes, 53_687_091_200);
    assert_eq!(view.max_file_bytes, 524_288_000);
    assert!(!view.op.busy && view.op.error.is_none());

    me.core
        .update_instance_settings(InstanceSettingsPatch {
            name: Some("Lumen Chat".into()),
            registration: Some(RegistrationMode::Open),
            ..Default::default()
        })
        .await
        .unwrap();
    let view = me.core.instance_settings();
    assert_eq!(view.name, "Lumen Chat");
    assert_eq!(view.registration, RegistrationMode::Open);
    assert!(!view.op.busy && view.op.error.is_none());

    // Another device on the same account reads what the server kept.
    let other = signed_in(&server, "me").await;
    other.core.instance_settings();
    until("the settings again", || {
        other.core.instance_settings().state == LoadState::Ready
    })
    .await;
    let view = other.core.instance_settings();
    assert_eq!(view.name, "Lumen Chat");
    assert_eq!(view.registration, RegistrationMode::Open);

    // And this device reads them again from the server.
    me.core.invalidate(&QueryKey::new(&[SETTINGS_KEY]));
    until("the settings to read again", || {
        me.core.instance_settings().state == LoadState::Ready
    })
    .await;
    assert_eq!(me.core.instance_settings().name, "Lumen Chat");
}

#[tokio::test]
async fn the_dashboard_arrives_over_http() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    me.core.admin_dashboard();
    until("the dashboard", || {
        let view = me.core.admin_dashboard();
        view.state == LoadState::Ready
            && view.storage.is_some()
            && view.livekit_configured.is_some()
    })
    .await;
    let view = me.core.admin_dashboard();
    let stats = view.stats.as_ref().expect("the stats arrived");
    assert_eq!(
        (
            stats.total_users,
            stats.total_communities,
            stats.total_channels,
            stats.total_messages,
            stats.active_invites,
            stats.banned_users,
        ),
        (13, 4, 20, 79, 1, 0)
    );
    let storage = view.storage.as_ref().expect("the storage arrived");
    assert_eq!(storage.server.disk_used_percent, 50.0);
    assert_eq!(
        storage.server.disk_used_bytes * 2,
        storage.server.disk_total_bytes
    );
    assert_eq!(storage.total_users, 13);
    assert_eq!(storage.default_quota_bytes, 53_687_091_200);
    assert_eq!(storage.max_file_bytes, 524_288_000);
    assert!(!storage.by_kind.is_empty());
    assert_eq!(view.livekit_configured, Some(true));
    // Half a disk and LiveKit configured: only the user over quota needs attention.
    assert_eq!(view.attention.len(), 1, "{view:?}");
    let item = &view.attention[0];
    assert_eq!(item.id, AttentionId::OverQuota);
    assert_eq!(item.severity, AttentionSeverity::Warning);
    assert_eq!(item.title, "1 user is over 90% of their storage quota");
}

#[tokio::test]
async fn a_user_without_the_action_is_refused() {
    let server = server().await;
    server.sign_in_as("pri", &id("u-priya"));
    let priya = signed_in(&server, "pri").await;
    priya.core.instance_settings();
    until("the refusal", || {
        matches!(
            priya.core.instance_settings().state,
            LoadState::Failed { .. }
        )
    })
    .await;
    let view = priya.core.instance_settings();
    match view.state {
        LoadState::Failed { error } => {
            assert!(
                error.message.contains("FORBIDDEN") && error.message.contains("Forbidden resource"),
                "{error:?}"
            );
        }
        other => panic!("expected a failed read, got {other:?}"),
    }
    assert_eq!(view.name, "", "nothing was read");
}
