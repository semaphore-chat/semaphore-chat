//! W6-D over the real transports: every community with its counts and force delete, and the
//! instance invites, by `Core` on `HttpBackend` and `SocketRealtime` against
//! `semaphore-fake-server`'s showcase. A second client, signed in as a member, watches the socket.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    InstanceInviteDraft, InviteCommunity, LoadState, RemovalCause, SessionState,
};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, QueryKey, Services};
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
    events: Arc<Recorder>,
}

impl Client {
    fn removals(&self) -> Vec<(String, RemovalCause)> {
        self.events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                CoreEvent::CommunityRemoved {
                    community_id,
                    cause,
                    ..
                } => Some((community_id.clone(), cause.clone())),
                _ => None,
            })
            .collect()
    }
}

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

fn names(client: &Client, search: &str) -> Vec<String> {
    client
        .core
        .admin_communities(search.into())
        .rows
        .into_iter()
        .map(|row| row.name)
        .collect()
}

#[tokio::test]
async fn the_owner_lists_and_pages_communities() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    me.core.admin_communities(String::new());
    until("the list", || {
        me.core.admin_communities(String::new()).state == LoadState::Ready
    })
    .await;
    let view = me.core.admin_communities(String::new());
    // Every community has the same createdAt: the id breaks the tie.
    assert_eq!(
        view.rows
            .iter()
            .map(|row| row.name.as_str())
            .collect::<Vec<_>>(),
        ["Lumen Studio", "Couch Co-op", "Trailheads", "Synth Club"]
    );
    let counts: Vec<(usize, i64, i64)> = view
        .rows
        .iter()
        .map(|row| {
            (
                row.id.len(),
                row.member_count as i64,
                row.channel_count as i64,
            )
        })
        .collect();
    assert_eq!(
        view.rows
            .iter()
            .map(|row| (row.name.as_str(), row.member_count, row.channel_count))
            .collect::<Vec<_>>(),
        [
            ("Lumen Studio", 13, 7),
            ("Couch Co-op", 12, 6),
            ("Trailheads", 7, 4),
            ("Synth Club", 5, 3),
        ],
        "{counts:?}"
    );
    assert!(
        view.rows.iter().all(|row| row.id.len() == 36),
        "the ids are the server's"
    );
    assert!(!view.more && !view.loading_more, "{view:?}");
    me.core
        .load_more_admin_communities(String::new())
        .await
        .unwrap();
    assert_eq!(names(&me, "").len(), 4, "one page: nothing more to read");

    // A search is its own list, matched without case.
    me.core.admin_communities("LUMEN".into());
    until("the search", || {
        me.core.admin_communities("LUMEN".into()).state == LoadState::Ready
    })
    .await;
    assert_eq!(names(&me, "LUMEN"), ["Lumen Studio"]);
    assert!(names(&me, "nothing").is_empty());

    // The detail adds the messages.
    let couch = id("c-couch");
    me.core.admin_community(couch.clone());
    until("the detail", || {
        me.core.admin_community(couch.clone()).state == LoadState::Ready
    })
    .await;
    let view = me.core.admin_community(couch);
    assert_eq!(view.message_count, 21);
    let row = view.community.expect("the detail's row");
    assert_eq!(
        (row.name.as_str(), row.member_count, row.channel_count),
        ("Couch Co-op", 12, 6)
    );
}

#[tokio::test]
async fn the_owner_force_deletes_a_community_and_its_members_hear_it() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    server.sign_in_as("samira-login", &id("u-samira"));
    let samira = signed_in(&server, "samira-login").await;
    until("both rails", || {
        me.core.communities().len() == 4 && samira.core.communities().len() == 4
    })
    .await;
    me.core.admin_communities(String::new());
    until("the list", || {
        me.core.admin_communities(String::new()).state == LoadState::Ready
    })
    .await;

    let couch = id("c-couch");
    me.core.force_delete_community(couch.clone()).await.unwrap();
    assert!(
        !me.core
            .admin_communities(String::new())
            .rows
            .iter()
            .any(|row| row.id == couch),
        "gone here at once"
    );
    assert!(!me.core.communities().iter().any(|c| c.id == couch));

    until("their removal", || !samira.removals().is_empty()).await;
    assert_eq!(
        samira.removals(),
        [(couch.clone(), RemovalCause::Deleted)],
        "the member is told"
    );
    until("their rail", || {
        !samira.core.communities().iter().any(|c| c.id == couch)
    })
    .await;
    assert!(me.removals().is_empty(), "the deleter isn't told");
}

#[tokio::test]
async fn the_owner_creates_and_deletes_an_instance_invite() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    me.core.admin_invites();
    until("the invites", || {
        me.core.admin_invites().state == LoadState::Ready
    })
    .await;
    assert!(me.core.admin_invites().rows.is_empty());

    let couch = id("c-couch");
    let code = me
        .core
        .create_instance_invite(InstanceInviteDraft {
            community_ids: vec![couch.clone()],
            max_uses: Some(3),
            valid_until_ms: None,
        })
        .await
        .unwrap();
    let view = me.core.admin_invites();
    assert_eq!(view.rows.len(), 1, "the new invite shows at once");
    let row = &view.rows[0];
    assert_eq!(row.code, code);
    assert_eq!((row.uses, row.max_uses), (0, Some(3)));
    assert_eq!(
        row.communities,
        [InviteCommunity {
            id: couch.clone(),
            name: "Couch Co-op".into(),
        }],
        "named from the rail"
    );
    assert!(
        row.created_by.is_none(),
        "the create's own answer names no creator"
    );

    // Another device reads what the server kept.
    let other = signed_in(&server, "me").await;
    other.core.admin_invites();
    until("the invites elsewhere", || {
        let view = other.core.admin_invites();
        view.state == LoadState::Ready && !view.rows.is_empty()
    })
    .await;
    let theirs = other.core.admin_invites();
    assert_eq!(
        theirs
            .rows
            .iter()
            .map(|row| row.code.as_str())
            .collect::<Vec<_>>(),
        [code.as_str()]
    );
    assert!(
        theirs.rows[0].created_by.is_some(),
        "the list names who made it"
    );

    me.core.delete_instance_invite(code.clone()).await.unwrap();
    assert!(me.core.admin_invites().rows.is_empty());
    // No socket event covers these: another device sees it on its next read.
    other
        .core
        .invalidate(&QueryKey::new(&["inviteControllerGetInvites.admin"]));
    until("it gone everywhere", || {
        other.core.admin_invites().rows.is_empty()
    })
    .await;
}

#[tokio::test]
async fn a_plain_user_is_refused() {
    let server = server().await;
    server.sign_in_as("pri", &id("u-priya"));
    let pri = signed_in(&server, "pri").await;

    pri.core.admin_communities(String::new());
    until("the list's refusal", || {
        matches!(
            pri.core.admin_communities(String::new()).state,
            LoadState::Failed { .. }
        )
    })
    .await;
    let view = pri.core.admin_communities(String::new());
    match view.state {
        LoadState::Failed { error } => assert!(
            error.message.contains("FORBIDDEN") && error.message.contains("Forbidden resource"),
            "{error:?}"
        ),
        other => panic!("expected a failed read, got {other:?}"),
    }
    assert!(view.rows.is_empty(), "nothing was read");

    let couch = id("c-couch");
    pri.core.admin_community(couch.clone());
    until("the detail's refusal", || {
        matches!(
            pri.core.admin_community(couch.clone()).state,
            LoadState::Failed { .. }
        )
    })
    .await;
    pri.core.admin_invites();
    until("the invites' refusal", || {
        matches!(pri.core.admin_invites().state, LoadState::Failed { .. })
    })
    .await;
    let refused = pri.core.force_delete_community(couch).await.unwrap_err();
    match refused {
        CoreError::Failed { message } => {
            assert!(message.contains("Forbidden resource"), "{message}")
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert_eq!(
        pri.core
            .admin_invites()
            .op
            .error
            .as_ref()
            .map(|error| error.code.as_str()),
        None,
        "a read's refusal isn't an action's"
    );
}
