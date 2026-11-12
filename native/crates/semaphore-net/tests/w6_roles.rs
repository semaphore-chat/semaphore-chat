//! W6-E over the real transports: instance roles, by `Core` on `HttpBackend` and
//! `SocketRealtime` against `semaphore-fake-server`'s showcase.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{InstanceRoleDraft, LoadState, SessionState};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, ScenarioSource, entity_uuid};
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
    Client {
        core,
        backend,
        events,
    }
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

/// The signed-in client's bearer, as the fake's sockets and routes read it.
fn bearer(client: &Client) -> String {
    format!(
        "Bearer {}",
        client.backend.access_token().expect("a signed-in token")
    )
}

/// Posts `body` as `client` and answers the status and the body.
async fn post(server: &FakeServer, client: &Client, path: &str, body: Value) -> (u16, Value) {
    let response = reqwest::Client::new()
        .post(format!("{}{path}", server.base_url()))
        .header("Authorization", bearer(client))
        .json(&body)
        .send()
        .await
        .expect("the fake answers");
    let status = response.status().as_u16();
    let value = response.json().await.unwrap_or(Value::Null);
    (status, value)
}

fn draft(name: &str, actions: &[&str]) -> InstanceRoleDraft {
    InstanceRoleDraft {
        name: name.into(),
        actions: actions.iter().map(|action| (*action).to_owned()).collect(),
    }
}

#[tokio::test]
async fn the_owner_creates_edits_and_deletes_an_instance_role() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    me.core.instance_roles();
    until("the roles", || {
        me.core.instance_roles().state == LoadState::Ready
    })
    .await;
    let view = me.core.instance_roles();
    let names: Vec<&str> = view.roles.iter().map(|role| role.name.as_str()).collect();
    assert_eq!(names, ["Instance Admin", "Community Creator"]);
    let admin = &view.roles[0];
    assert!(admin.is_default, "the default admin role");
    assert_eq!(admin.position, 10);
    assert_eq!(admin.actions.len(), 12);
    assert!(admin.editable && !admin.deletable);
    assert!(view.roles[1].editable && view.roles[1].deletable);
    assert_eq!(view.grantable.len(), 12, "the owner may grant everything");

    let role_id = me
        .core
        .create_instance_role(draft("Builders", &["READ_USER", "UPDATE_USER"]))
        .await
        .unwrap();
    let view = me.core.instance_roles();
    let created = view.roles.iter().find(|role| role.id == role_id).unwrap();
    assert_eq!(
        (created.name.as_str(), created.position, created.is_default),
        ("Builders", 30, false),
        "the highest position plus ten"
    );
    assert_eq!(created.actions, ["READ_USER", "UPDATE_USER"]);
    assert!(created.editable && created.deletable);

    me.core
        .update_instance_role(role_id.clone(), draft("Deployers", &["READ_USER"]))
        .await
        .unwrap();
    let view = me.core.instance_roles();
    let updated = view.roles.iter().find(|role| role.id == role_id).unwrap();
    assert_eq!(updated.name, "Deployers");
    assert_eq!(updated.actions, ["READ_USER"]);

    me.core.instance_role_users(role_id.clone());
    until("the role's users", || {
        me.core.instance_role_users(role_id.clone()).state == LoadState::Ready
    })
    .await;
    assert!(
        me.core
            .instance_role_users(role_id.clone())
            .users
            .is_empty()
    );

    me.core.delete_instance_role(role_id.clone()).await.unwrap();
    assert!(
        !me.core
            .instance_roles()
            .roles
            .iter()
            .any(|role| role.id == role_id),
        "deleted"
    );
}

#[tokio::test]
async fn assigning_a_role_gives_its_actions() {
    let server = server().await;
    let owner = signed_in(&server, "me").await;
    owner.core.instance_roles();
    until("the roles", || {
        owner.core.instance_roles().state == LoadState::Ready
    })
    .await;
    let admin = owner
        .core
        .instance_roles()
        .roles
        .into_iter()
        .find(|role| role.name == "Instance Admin")
        .expect("the default admin role");
    let (status, body) = post(
        &server,
        &owner,
        &format!("/api/roles/instance/{}/assign", admin.id),
        json!({ "userId": id("u-priya") }),
    )
    .await;
    assert_eq!(status, 204, "{body}");

    server.sign_in_as("pri", &id("u-priya"));
    let priya = signed_in(&server, "pri").await;
    priya.core.instance_permissions();
    until("her permissions", || {
        priya.core.instance_permissions().state == LoadState::Ready
    })
    .await;
    let caps = priya.core.instance_permissions().admin;
    assert!(caps.users_read, "{caps:?}");
    assert!(caps.users_update && caps.settings_write, "the whole role");
    assert!(caps.full_authority && !caps.is_owner);

    // And the role list is hers to read, with both roles editable.
    priya.core.instance_roles();
    until("her roles", || {
        priya.core.instance_roles().state == LoadState::Ready
    })
    .await;
    let view = priya.core.instance_roles();
    assert_eq!(view.roles.len(), 2);
    assert!(view.roles.iter().all(|role| role.editable));
    assert_eq!(view.grantable.len(), 12);
}

#[tokio::test]
async fn a_plain_user_is_refused() {
    let server = server().await;
    server.sign_in_as("pri", &id("u-priya"));
    let priya = signed_in(&server, "pri").await;
    priya.core.instance_roles();
    until("the refusal", || {
        matches!(priya.core.instance_roles().state, LoadState::Failed { .. })
    })
    .await;
    match priya.core.instance_roles().state {
        LoadState::Failed { error } => {
            assert!(
                error.message.contains("FORBIDDEN") && error.message.contains("Forbidden resource"),
                "{error:?}"
            );
        }
        other => panic!("expected a failed read, got {other:?}"),
    }

    // A draft is refused before it's sent: she holds no instance admin action.
    match priya
        .core
        .create_instance_role(draft("Mine", &["READ_USER"]))
        .await
    {
        Err(CoreError::Failed { message }) => assert_eq!(
            message,
            "Cannot grant permissions you do not have: READ_USER"
        ),
        other => panic!("expected a refusal, got {other:?}"),
    }
}
