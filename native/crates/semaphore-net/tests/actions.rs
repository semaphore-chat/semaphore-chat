//! W1 part A over the real transports: edit, react, pin, a moderator's removal and a delete, by
//! `Core` on `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`. Every backend call
//! part A uses is made here, so none is left to the trait's "unsupported" default.

mod common;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::backend::ModerationBackend;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{Conversation, ListOp, MessageRow, SessionState};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, Record, ScenarioSource};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};

const CHANNEL: &str = "channel-13";
const MINE: &str = "00000000-0000-4000-8000-000000000202";
const THEIRS: &str = "00000000-0000-4000-8000-000000000053";

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

/// The rows a UI would show, built from `MessagesChanged` ops.
fn rows(events: &Recorder, conversation: &Conversation) -> Vec<MessageRow> {
    let mut rows: Vec<MessageRow> = Vec::new();
    for event in events.0.lock().unwrap().iter() {
        let CoreEvent::MessagesChanged {
            conversation: changed,
            ops,
        } = event
        else {
            continue;
        };
        if changed != conversation {
            continue;
        }
        for op in ops {
            match op {
                ListOp::Reset { rows: new } => rows = new.clone(),
                ListOp::Insert { index, rows: new } => {
                    rows.splice(*index as usize..*index as usize, new.clone());
                }
                ListOp::Remove { index, count } => {
                    rows.drain(*index as usize..(*index + *count) as usize);
                }
                ListOp::Replace { index, rows: new } => {
                    for (offset, row) in new.iter().enumerate() {
                        rows[*index as usize + offset] = row.clone();
                    }
                }
            }
        }
    }
    rows
}

fn row(events: &Recorder, conversation: &Conversation, id: &str) -> Option<MessageRow> {
    rows(events, conversation)
        .into_iter()
        .find(|row| row.id.as_deref() == Some(id))
}

/// Each operation the fake answered, with its statuses.
fn answered(server: &FakeServer) -> HashMap<&'static str, HashSet<u16>> {
    let mut seen: HashMap<&'static str, HashSet<u16>> = HashMap::new();
    for record in server.requests() {
        if let Record::Http {
            operation: Some(operation),
            status,
            ..
        } = record
        {
            seen.entry(operation).or_default().insert(status);
        }
    }
    seen
}

#[tokio::test]
async fn edit_react_pin_remove_and_delete_over_the_wire() {
    let server = FakeServer::start(ScenarioSource::Named("big-community"))
        .await
        .expect("the scenario loads");
    // Reactions type the message id as a UUID.
    assert!(server.rename_message("msg-202", MINE));
    assert!(server.rename_message("msg-53", THEIRS));
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
    core.sign_in(server.base_url(), "me".into(), "pw".into())
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
    let channel = Conversation::Channel { id: CHANNEL.into() };
    core.open_conversation(channel.clone()).await.unwrap();
    until("the rows", || row(&events, &channel, MINE).is_some()).await;

    // Edit, keeping formatting.
    let mut draft = core.edit_draft(MINE.into()).expect("a draft");
    draft.text = "**edited** over the wire".into();
    core.edit_message(MINE.into(), draft, None).await.unwrap();
    let edited = row(&events, &channel, MINE).unwrap();
    assert_eq!(edited.display, "edited over the wire");
    assert!(edited.segs[0].style.bold);
    assert!(edited.edited && !edited.edit_pending);

    // React and take it back.
    core.add_reaction(THEIRS.into(), "🔥".into()).await.unwrap();
    until("the reaction", || {
        row(&events, &channel, THEIRS)
            .is_some_and(|row| row.reactions.iter().any(|r| r.emoji == "🔥" && r.me))
    })
    .await;
    core.remove_reaction(THEIRS.into(), "🔥".into())
        .await
        .unwrap();
    until("the reaction gone", || {
        row(&events, &channel, THEIRS)
            .is_some_and(|row| row.reactions.iter().all(|r| r.emoji != "🔥"))
    })
    .await;

    // Pin; the list follows. Unpin.
    core.pin_message(THEIRS.into(), Some("keep".into()))
        .await
        .unwrap();
    until("the pin listed", || {
        core.pinned_messages(CHANNEL.into())
            .rows
            .iter()
            .any(|pin| pin.row.id.as_deref() == Some(THEIRS))
    })
    .await;
    assert!(row(&events, &channel, THEIRS).unwrap().pinned);
    core.unpin_message(THEIRS.into(), None).await.unwrap();
    until("the pin unlisted", || {
        let list = core.pinned_messages(CHANNEL.into());
        !list.rows.is_empty()
            && list
                .rows
                .iter()
                .all(|pin| pin.row.id.as_deref() != Some(THEIRS))
    })
    .await;

    // A moderator's removal: the row stays, removed, text and reason kept, after the server's
    // `deleteMessage` and the read that follows it.
    core.delete_message(THEIRS.into(), Some("spam".into()))
        .await
        .unwrap();
    until("the read after deleteMessage", || {
        answered(&server)
            .get("MessagesController_findOne")
            .is_some_and(|statuses| statuses.contains(&200))
    })
    .await;
    until("the removed row settled", || {
        row(&events, &channel, THEIRS)
            .is_some_and(|row| row.removed && row.removed_reason.as_deref() == Some("spam"))
    })
    .await;
    assert!(!row(&events, &channel, THEIRS).unwrap().display.is_empty());

    // The author's own delete: gone, and the read after the event finds nothing.
    core.delete_message(MINE.into(), None).await.unwrap();
    assert!(row(&events, &channel, MINE).is_none());
    until("the 404 after deleteMessage", || {
        answered(&server)
            .get("MessagesController_findOne")
            .is_some_and(|statuses| statuses.contains(&404))
    })
    .await;
    assert!(row(&events, &channel, MINE).is_none());

    // The scenario's user is an instance owner, whom core never asks for roles: the call itself.
    let roles =
        ModerationBackend::roles_controller_get_my_roles_for_channel(&backend, CHANNEL.into())
            .await
            .unwrap();
    assert!(roles.roles.iter().any(|role| !role.actions.is_empty()));

    let seen = answered(&server);
    for (operation, status) in [
        ("MessagesController_update", 200),
        ("MessagesController_addReaction", 201),
        ("MessagesController_removeReaction", 200),
        ("ModerationController_pinMessage", 200),
        ("ModerationController_unpinMessage", 200),
        ("ModerationController_getPinnedMessages", 200),
        ("RolesController_getMyRolesForChannel", 200),
        ("ModerationController_deleteMessageAsMod", 200),
        ("MessagesController_findOne", 200),
        ("MessagesController_remove", 204),
    ] {
        assert!(
            seen.get(operation)
                .is_some_and(|statuses| statuses.contains(&status)),
            "{operation} {status}: {seen:?}"
        );
    }
    core.shutdown();
}
