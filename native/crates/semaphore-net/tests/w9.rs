//! W9 over the real transports: what the connection probe learns about a fresh instance, accepting
//! an invite with an existing account, and read receipts, by `Core` on `HttpBackend` and
//! `SocketRealtime` against `semaphore-fake-server`'s showcase.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{LoadState, SessionState};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, ScenarioSource};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use serde_json::json;

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
pub struct Recorder(Mutex<Vec<CoreEvent>>);
impl EventSink for Recorder {
    fn on_event(&self, event: CoreEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Recorder {
    /// Whether any event so far matches, for a test waiting on a list without polling core's view.
    pub fn saw(&self, predicate: impl Fn(&CoreEvent) -> bool) -> bool {
        self.0.lock().unwrap().iter().any(predicate)
    }
}

pub struct Client {
    pub core: Core,
    pub events: Arc<Recorder>,
}

/// A core on the real transports, with its socket connected.
pub async fn client() -> Client {
    // reqwest 0.13 builds a client over rustls without a provider; the transport picks ring.
    let _ = rustls::crypto::ring::default_provider().install_default();
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
    Client { core, events }
}

pub async fn signed_in(server: &FakeServer, username: &str) -> Client {
    let client = client().await;
    client
        .core
        .sign_in(server.base_url(), username.into(), "pw".into())
        .await
        .unwrap();
    until("sign-in", || {
        matches!(client.core.session(), SessionState::SignedIn { .. })
    })
    .await;
    until("the socket", || {
        client.core.connection() == ConnectionState::Connected
    })
    .await;
    client
}

pub async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

/// Posts a fake-server control, as the wire tests do when a scenario needs a state the fixture
/// doesn't have.
pub async fn control(server: &FakeServer, name: &str, body: serde_json::Value) {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let response = reqwest::Client::new()
        .post(format!("{}/__control/{name}", server.base_url()))
        .json(&body)
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(response.status().as_u16(), 200);
}

// --- The connection probe's setup status -------------------------------------------------------

#[tokio::test]
async fn the_probe_says_an_instance_with_no_users_needs_setup() {
    let server = server().await;
    control(&server, "onboarding", json!({ "needsSetup": true })).await;
    let client = client().await;
    let info = client
        .core
        .probe_server(server.base_url())
        .await
        .expect("the server answers");
    assert!(info.needs_setup);
    assert_ne!(
        info.registration,
        semaphore_core::model::RegistrationMode::Closed
    );

    // The same server with its users back needs no setup, and the probe still answers the rest.
    control(&server, "onboarding", json!({ "needsSetup": false })).await;
    let info = client
        .core
        .probe_server(server.base_url())
        .await
        .expect("the server answers");
    assert!(!info.needs_setup);
    assert_eq!(info.url, server.base_url());
}

#[tokio::test]
async fn a_signed_in_client_reads_a_ready_probe_as_usual() {
    let server = server().await;
    let client = signed_in(&server, "me").await;
    // A probe while signed in still reports the instance, as the settings screen asks.
    let info = client
        .core
        .probe_server(server.base_url())
        .await
        .expect("the server answers");
    assert!(!info.needs_setup);
    assert!(matches!(
        client.core.session(),
        SessionState::SignedIn { .. }
    ));
}

// --- Invites over the real client --------------------------------------------------------------

#[tokio::test]
async fn joining_an_invite_as_an_existing_account_over_http() {
    let server = server().await;
    let couch = semaphore_fake_server::entity_uuid("c-couch");
    let synth = semaphore_fake_server::entity_uuid("c-synth");
    server.sign_in_as("mateo", &semaphore_fake_server::entity_uuid("u-mateo"));
    let mut seed = semaphore_fake_server::InviteSeed::new("JOINME");
    seed.community_ids = vec![couch.clone(), synth.clone()];
    server.seed_invite(seed);
    let client = signed_in(&server, "mateo").await;

    let join = client
        .core
        .accept_invite("JOINME".into())
        .await
        .expect("the invite is accepted");
    assert_eq!(join.joined.len(), 1, "the one they weren't in");
    assert_eq!(join.joined[0].id, couch);
    assert_eq!(join.joined[0].name, "Couch Co-op");
    assert_eq!(join.skipped.len(), 1);
    assert_eq!(join.skipped[0].id, synth);
    assert_eq!(
        join.skipped[0].reason,
        semaphore_core::model::InviteSkipReason::AlreadyMember
    );

    // A code the server won't honour fails with its message.
    let failure = client.core.accept_invite("GONE".into()).await.unwrap_err();
    let semaphore_core::platform::CoreError::Failed { message } = failure else {
        panic!("a refusal is a failure");
    };
    assert!(
        message.ends_with("No invite found for the provided code."),
        "{message}"
    );
}

#[tokio::test]
async fn an_unusable_invite_preview_carries_the_servers_reason() {
    let server = server().await;
    let mut seed = semaphore_fake_server::InviteSeed::new("OFF");
    seed.disabled = true;
    server.seed_invite(seed);
    let client = client().await;
    client.core.probe_server(server.base_url()).await.unwrap();
    client.core.invite_preview("OFF".into());
    until("the invite", || {
        client.core.invite_preview("OFF".into()).state == LoadState::Ready
    })
    .await;
    let view = client.core.invite_preview("OFF".into());
    assert_eq!(view.invite, None);
    assert_eq!(
        view.reason.as_deref(),
        Some("This invite has been disabled.")
    );
}

#[tokio::test]
async fn an_open_instance_registers_without_a_code_and_a_closed_one_asks_nothing() {
    let open_server = server().await;
    control(
        &open_server,
        "public_settings",
        json!({ "registrationMode": "OPEN" }),
    )
    .await;
    let open = client().await;
    let info = open
        .core
        .probe_server(open_server.base_url())
        .await
        .expect("the server answers");
    assert_eq!(
        info.registration,
        semaphore_core::model::RegistrationMode::Open
    );
    open.core
        .register(semaphore_core::model::RegisterForm {
            username: "newbie".into(),
            password: "a long password".into(),
            email: None,
            invite_code: String::new(),
        })
        .await
        .expect("an open instance takes an account");
    until("sign-in", || {
        matches!(open.core.session(), SessionState::SignedIn { .. })
    })
    .await;

    // A closed instance refuses here: no `POST /api/users` reaches the server.
    let closed_server = server().await;
    control(
        &closed_server,
        "public_settings",
        json!({ "registrationMode": "CLOSED" }),
    )
    .await;
    let closed = client().await;
    closed
        .core
        .probe_server(closed_server.base_url())
        .await
        .expect("the server answers");
    let failure = closed
        .core
        .register(semaphore_core::model::RegisterForm {
            username: "hopeful".into(),
            password: "a long password".into(),
            email: None,
            invite_code: String::new(),
        })
        .await
        .unwrap_err();
    assert!(matches!(
        failure,
        semaphore_core::platform::CoreError::Failed { .. }
    ));
    let recorded = closed_server.requests();
    let sign_ups = recorded.iter().filter(|record| match record {
        semaphore_fake_server::Record::Http { method, path, .. } => {
            method == "POST" && path == "/api/users"
        }
        _ => false,
    });
    assert_eq!(sign_ups.count(), 0, "a closed instance is never asked");
}

// --- Read receipts over HTTP and the socket ----------------------------------------------------

#[tokio::test]
async fn a_dms_seen_by_comes_over_http_and_moves_with_the_socket() {
    let server = server().await;
    let dm = semaphore_fake_server::entity_uuid("dm-priya");
    let pri = semaphore_fake_server::entity_uuid("u-priya");
    let conversation = semaphore_core::model::Conversation::DirectMessage { id: dm.clone() };
    // Read after sc-msg-59 (21 September, 20:32) and before sc-dm-priya-copy (22 September).
    let early = semaphore_fake_server::message_uuid("sc-msg-59");
    let late = semaphore_fake_server::message_uuid("sc-dm-priya-copy");
    control(
        &server,
        "read_receipt",
        json!({ "dmGroupId": dm, "userId": pri, "at": "2026-09-21T21:00:00Z" }),
    )
    .await;

    let client = signed_in(&server, "me").await;
    client
        .core
        .open_conversation(conversation.clone())
        .await
        .expect("the DM opens");
    until("the DM's rows", || {
        client.events.saw(|event| {
            matches!(
                event,
                CoreEvent::MessagesChanged { conversation: changed, ops }
                    if *changed == conversation
                        && ops.iter().any(|op| matches!(op, semaphore_core::model::ListOp::Reset { .. }))
            )
        })
    })
    .await;

    until("the peer reads", || {
        client.core.dm_peer_reads(dm.clone()).state == LoadState::Ready
    })
    .await;
    let peers = client.core.dm_peer_reads(dm.clone());
    assert_eq!(peers.peers.len(), 1);
    assert_eq!(peers.peers[0].user.id, pri);
    assert_eq!(peers.peers[0].user.username, "pri");

    let seen = client.core.seen_by(conversation.clone(), early);
    assert_eq!((seen.count, seen.more), (1, 0));
    let unseen = client.core.seen_by(conversation.clone(), late.clone());
    assert_eq!(unseen.count, 0);

    // The peer reads on: `readReceiptUpdated` moves their watermark, with no read of ours.
    control(
        &server,
        "read_receipt",
        json!({ "dmGroupId": dm, "userId": pri, "messageId": late, "at": "2026-09-22T20:00:00Z" }),
    )
    .await;
    until("the new watermark", || {
        client
            .core
            .seen_by(conversation.clone(), late.clone())
            .count
            == 1
    })
    .await;
    let seen = client.core.seen_by(conversation, late);
    assert_eq!(seen.readers[0].id, pri);
}

#[tokio::test]
async fn a_channels_seen_by_asks_the_readers_route() {
    let server = server().await;
    let channel = semaphore_fake_server::entity_uuid("cc-general");
    let pri = semaphore_fake_server::entity_uuid("u-priya");
    let message = semaphore_fake_server::message_uuid("sc-msg-1");
    control(
        &server,
        "read_receipt",
        json!({ "channelId": channel, "userId": pri, "at": "2026-09-23T01:00:00Z" }),
    )
    .await;
    let client = signed_in(&server, "me").await;
    let conversation = semaphore_core::model::Conversation::Channel { id: channel };
    until("the readers", || {
        let view = client.core.seen_by(conversation.clone(), message.clone());
        view.state != LoadState::Loading
    })
    .await;
    let seen = client.core.seen_by(conversation, message);
    assert_eq!(seen.state, LoadState::Ready);
    assert_eq!(seen.count, 1, "pri read past it; me is left out");
    assert_eq!(seen.readers[0].id, pri);
}

// --- Notifications read on view ----------------------------------------------------------------

#[tokio::test]
async fn opening_a_conversation_reads_its_notifications_over_http() {
    let server = server().await;
    let dm = semaphore_fake_server::entity_uuid("dm-priya");
    let client = signed_in(&server, "me").await;
    client
        .core
        .open_conversation(semaphore_core::model::Conversation::DirectMessage { id: dm.clone() })
        .await
        .expect("the DM opens");

    let conversation = semaphore_core::model::Conversation::DirectMessage { id: dm.clone() };
    until("the DM's notifications read", || {
        let rows = client.core.notifications().rows;
        let for_dm: Vec<_> = rows
            .iter()
            .filter(|row| row.link.conversation == conversation)
            .collect();
        !for_dm.is_empty() && for_dm.iter().all(|row| row.read)
    })
    .await;
    let rows = client.core.notifications().rows;
    assert!(
        rows.iter().any(|row| !row.read),
        "the other conversations' stay unread"
    );
}

// --- The pre-join over HTTP --------------------------------------------------------------------

#[tokio::test]
async fn a_voice_channels_prejoin_reads_who_is_here_over_http() {
    let server = server().await;
    let community = semaphore_fake_server::entity_uuid("c-couch");
    let channel = semaphore_fake_server::entity_uuid("vc-squad");
    let client = signed_in(&server, "me").await;
    until("the pre-join", || {
        let view = client
            .core
            .voice_prejoin(community.clone(), channel.clone());
        view.state == LoadState::Ready && !view.channel_name.is_empty()
    })
    .await;
    let view = client.core.voice_prejoin(community, channel);
    assert_eq!(view.channel_name, "Squad Up");
    assert_eq!(view.mode, semaphore_core::model::VoiceJoinMode::Full);
    assert_eq!(view.timed_out_until_ms, None);
    assert_eq!(view.connected_elsewhere, None);
    assert_eq!(view.users.len(), 2, "dropbear and pri are in it");
    assert_eq!(view.users[0].username, "dropbear");
}
