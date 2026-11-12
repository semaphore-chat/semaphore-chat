//! W6-B over the real transports: the users list, one user, the owner role, ban, password and
//! delete, by `Core` on `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`'s
//! showcase. A second client, signed in as another user, shows what the change does to them.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{AdminUserQuery, LoadState, SessionState};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, ScenarioSource, entity_uuid};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};

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
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

async fn signed_in(server: &FakeServer) -> Client {
    signed_in_as(server, "me").await
}

async fn signed_in_as(server: &FakeServer, username: &str) -> Client {
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
    Client { core }
}

fn usernames(client: &Client, query: &AdminUserQuery) -> Vec<String> {
    client
        .core
        .admin_users(query.clone())
        .rows
        .into_iter()
        .map(|row| row.user.username)
        .collect()
}

async fn loaded(client: &Client, query: &AdminUserQuery) {
    until("the users list", || {
        client.core.admin_users(query.clone()).state == LoadState::Ready
    })
    .await;
}

#[tokio::test]
async fn the_owner_lists_searches_and_pages_users() {
    let server = server().await;
    let owner = signed_in(&server).await;
    let query = AdminUserQuery::default();
    owner.core.admin_users(query.clone());
    loaded(&owner, &query).await;
    let first = usernames(&owner, &query);
    assert!(first.contains(&"alexk".to_owned()), "{first:?}");
    assert!(first.contains(&"pri".to_owned()), "{first:?}");

    // Every page until the server says none follow.
    let mut pages = 0;
    while owner.core.admin_users(query.clone()).more {
        owner
            .core
            .load_more_admin_users(query.clone())
            .await
            .unwrap();
        pages += 1;
        assert!(pages < 20, "the pages end");
    }
    let all = usernames(&owner, &query);
    assert!(all.len() >= first.len());
    assert!(all.contains(&"alexk".to_owned()) && all.contains(&"gracie".to_owned()));

    // The search reaches the server: only the match comes back.
    let search = AdminUserQuery {
        search: "pri".into(),
        ..AdminUserQuery::default()
    };
    owner.core.admin_users(search.clone());
    loaded(&owner, &search).await;
    let found = usernames(&owner, &search);
    assert_eq!(found, ["pri"], "{found:?}");

    // The owner filter: just the instance owner.
    let owners = AdminUserQuery {
        owners: Some(true),
        ..AdminUserQuery::default()
    };
    owner.core.admin_users(owners.clone());
    loaded(&owner, &owners).await;
    assert_eq!(usernames(&owner, &owners), ["alexk"]);

    // Nobody is banned yet.
    let banned = AdminUserQuery {
        banned: Some(true),
        ..AdminUserQuery::default()
    };
    owner.core.admin_users(banned.clone());
    loaded(&owner, &banned).await;
    assert!(usernames(&owner, &banned).is_empty());
}

fn is_banned(client: &Client, query: &AdminUserQuery, username: &str) -> Option<bool> {
    client
        .core
        .admin_users(query.clone())
        .rows
        .iter()
        .find(|row| row.user.username == username)
        .map(|row| row.banned)
}

#[tokio::test]
async fn the_owner_bans_and_unbans_a_user() {
    let server = server().await;
    let owner = signed_in(&server).await;
    server.sign_in_as("pri", &id("u-priya"));
    let priya = signed_in_as(&server, "pri").await;
    let query = AdminUserQuery::default();
    owner.core.admin_users(query.clone());
    loaded(&owner, &query).await;
    assert_eq!(is_banned(&owner, &query, "pri"), Some(false));

    owner.core.ban_user(id("u-priya")).await.unwrap();
    until("the ban", || is_banned(&owner, &query, "pri") == Some(true)).await;
    // The banned user's session is over: the server refuses its next request.
    priya.core.admin_users(query.clone());
    until("their sign-out", || {
        priya.core.session() == SessionState::SignedOut
    })
    .await;

    owner.core.unban_user(id("u-priya")).await.unwrap();
    until("the unban", || {
        is_banned(&owner, &query, "pri") == Some(false)
    })
    .await;
}

#[tokio::test]
async fn the_owner_resets_a_password() {
    let server = server().await;
    let owner = signed_in(&server).await;
    server.sign_in_as("pri", &id("u-priya"));
    let priya = signed_in_as(&server, "pri").await;

    // A short one is refused here, in the backend's words, and sends nothing.
    let refused = owner
        .core
        .reset_user_password(id("u-priya"), "short".into())
        .await;
    assert_eq!(
        match refused {
            Err(CoreError::Failed { message }) => message,
            other => panic!("{other:?}"),
        },
        "Password must be at least 8 characters"
    );

    owner
        .core
        .reset_user_password(id("u-priya"), "a long enough password".into())
        .await
        .unwrap();
    // Their sessions ended with it: the next request signs them out.
    priya.core.admin_users(AdminUserQuery::default());
    until("their sign-out", || {
        priya.core.session() == SessionState::SignedOut
    })
    .await;
}

#[tokio::test]
async fn the_owner_deletes_a_user() {
    let server = server().await;
    let owner = signed_in(&server).await;
    let query = AdminUserQuery::default();
    owner.core.admin_users(query.clone());
    loaded(&owner, &query).await;
    assert!(usernames(&owner, &query).contains(&"diego".to_owned()));

    owner.core.delete_user(id("u-diego")).await.unwrap();
    assert!(
        !usernames(&owner, &query).contains(&"diego".to_owned()),
        "gone at once"
    );
    until("the list from the server", || {
        !usernames(&owner, &query).contains(&"diego".to_owned())
    })
    .await;
    owner.core.admin_user(id("u-diego"));
    until("its read fails as missing", || {
        matches!(
            owner.core.admin_user(id("u-diego")).state,
            LoadState::Failed { .. }
        )
    })
    .await;
}

#[tokio::test]
async fn a_plain_user_is_refused() {
    let server = server().await;
    server.sign_in_as("pri", &id("u-priya"));
    let priya = signed_in_as(&server, "pri").await;
    let query = AdminUserQuery::default();
    priya.core.admin_users(query.clone());
    until("the refusal", || {
        matches!(
            priya.core.admin_users(query.clone()).state,
            LoadState::Failed { .. }
        )
    })
    .await;
    let view = priya.core.admin_users(query.clone());
    let LoadState::Failed { error } = view.state else {
        panic!("{view:?}")
    };
    assert_eq!(error.message, "FORBIDDEN (403): Forbidden resource");

    // A change is refused here, in the backend's words, before anything is sent.
    priya.core.instance_permissions();
    until("their instance roles", || {
        priya.core.instance_permissions().state == LoadState::Ready
    })
    .await;
    let result = priya.core.ban_user(id("u-marcus")).await;
    assert_eq!(
        match result {
            Err(CoreError::Failed { message }) => message,
            other => panic!("{other:?}"),
        },
        "You don't have permission to do that"
    );
}
