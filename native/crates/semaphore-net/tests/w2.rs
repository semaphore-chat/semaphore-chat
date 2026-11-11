//! W2 over the real transports: DMs, friends, notifications, settings, channel levels, idle and a
//! DM conversation, by `Core` on `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`.
//! Every backend call W2 added is made here and answered with a success, so none is left to the
//! trait's "unsupported" default and every shape goes through real serialization.

mod common;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use futures_util::{SinkExt, StreamExt};
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    Conversation, ListOp, LoadState, MessageDraft, MessageRow, NotificationSettingsPatch,
    NotifyLevel, SessionState, ViewKey,
};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, Record, ScenarioSource, entity_uuid};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

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

impl Recorder {
    fn all(&self) -> Vec<CoreEvent> {
        self.0.lock().unwrap().clone()
    }
}

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

fn by_text(events: &Recorder, conversation: &Conversation, text: &str) -> Option<MessageRow> {
    rows(events, conversation)
        .into_iter()
        .find(|row| row.display == text)
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

fn draft(text: &str) -> MessageDraft {
    MessageDraft {
        text: text.into(),
        ..MessageDraft::default()
    }
}

struct Rig {
    server: FakeServer,
    core: Core,
    events: Arc<Recorder>,
}

async fn rig() -> Rig {
    let server = FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads");
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
    Rig {
        server,
        core,
        events,
    }
}

/// Another user's socket, as the fake allows: `userId` in the handshake makes it theirs.
struct Peer {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    next_ack: u64,
}

impl Peer {
    async fn connect(base_url: &str, user_id: &str) -> Self {
        let url = format!(
            "{}/socket.io/?EIO=4&transport=websocket",
            base_url.replacen("http", "ws", 1)
        );
        let (mut socket, _) = tokio_tungstenite::connect_async(url)
            .await
            .expect("the fake accepts a socket");
        let open = socket.next().await.unwrap().unwrap();
        assert!(open.to_text().unwrap().starts_with('0'));
        let auth = json!({ "token": "Bearer test-token", "protocol": 2, "userId": user_id });
        socket
            .send(Message::text(format!("40{auth}")))
            .await
            .unwrap();
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            if frame.to_text().unwrap().starts_with("40") {
                break;
            }
        }
        Self {
            socket,
            next_ack: 1,
        }
    }

    /// Sends an event and reads until its ack.
    async fn emit(&mut self, name: &str, payload: Value) -> Value {
        let ack = self.next_ack;
        self.next_ack += 1;
        self.socket
            .send(Message::text(format!("42{ack}{}", json!([name, payload]))))
            .await
            .unwrap();
        loop {
            let frame = self.socket.next().await.unwrap().unwrap();
            let text = frame.to_text().unwrap().to_owned();
            if text == "2" {
                self.socket.send(Message::text("3")).await.unwrap();
                continue;
            }
            if let Some(rest) = text.strip_prefix(&format!("43{ack}")) {
                let args: Vec<Value> = serde_json::from_str(rest).unwrap();
                return args.into_iter().next().unwrap_or(Value::Null);
            }
        }
    }
}

#[tokio::test]
async fn every_w2_call_over_the_wire() {
    let Rig {
        server,
        core,
        events,
    } = rig().await;
    let me = entity_uuid("me");
    let priya = entity_uuid("u-priya");
    let marcus = entity_uuid("u-marcus");
    let zara = entity_uuid("u-zara");

    // --- DMs ---
    core.dm_list();
    until("the DM list", || core.dm_list().state == LoadState::Ready).await;
    let list = core.dm_list();
    assert_eq!(list.rows.len(), 5);
    assert_eq!(list.rows[0].id, entity_uuid("dm-priya"));
    assert!(
        list.rows
            .iter()
            .all(|row| row.members.iter().all(|m| m.id != me))
    );
    let found = core.search_users("pri".into(), Some(5)).await.unwrap();
    assert!(found.iter().any(|user| user.id == priya), "{found:?}");
    assert!(found.iter().all(|user| user.id != me));

    let existing = core.create_dm(vec![priya.clone()], None).await.unwrap();
    assert_eq!(
        existing,
        entity_uuid("dm-priya"),
        "an existing 1:1 comes back"
    );
    assert_eq!(core.dm_list().rows.len(), 5);
    let trio = core
        .create_dm(vec![priya.clone(), marcus.clone()], Some("Trio".into()))
        .await
        .unwrap();
    let row = core.dm(trio.clone()).unwrap();
    assert!(row.is_group && row.name.as_deref() == Some("Trio"));
    assert_eq!(core.dm_list().rows[0].id, trio);
    core.add_dm_members(trio.clone(), vec![zara.clone()])
        .await
        .unwrap();
    assert_eq!(core.dm(trio.clone()).unwrap().members.len(), 3);
    let refused = core
        .add_dm_members(entity_uuid("dm-priya"), vec![zara.clone()])
        .await;
    assert!(refused.is_err(), "a 1:1 can't grow");
    core.leave_dm(trio.clone()).await.unwrap();
    assert!(core.dm(trio).is_none());

    // --- Friends ---
    core.friends();
    until("friends", || core.friends().state == LoadState::Ready).await;
    let view = core.friends();
    assert_eq!(view.friends.len(), 5);
    assert_eq!(view.incoming.len(), 1);
    assert_eq!(view.incoming[0].user.id, entity_uuid("u-chloe"));
    assert_eq!(view.outgoing[0].user.id, entity_uuid("u-tomas"));
    let incoming = view.incoming[0].friendship_id.clone();
    let outgoing = view.outgoing[0].friendship_id.clone();
    assert!(matches!(
        core.friendship_status(entity_uuid("u-chloe"))
            .await
            .unwrap(),
        semaphore_core::model::FriendshipState::RequestReceived { .. }
    ));
    core.cancel_friend_request(outgoing).await.unwrap();
    core.send_friend_request(zara.clone()).await.unwrap();
    core.accept_friend_request(incoming).await.unwrap();
    until("friends read again", || {
        let view = core.friends();
        view.friends.len() == 6 && view.incoming.is_empty() && view.outgoing.len() == 1
    })
    .await;
    let zara_request = core.friends().outgoing[0].friendship_id.clone();
    core.cancel_friend_request(zara_request).await.unwrap();
    let marcus_friendship = core
        .friends()
        .friends
        .iter()
        .find(|friend| friend.user.id == marcus)
        .unwrap()
        .friendship_id
        .clone();
    core.remove_friend(marcus_friendship).await.unwrap();
    core.send_friend_request(marcus.clone()).await.unwrap();
    // Marcus says no, from his side: a decline is the receiver's.
    until("the request to marcus", || {
        core.friends().outgoing.len() == 1
    })
    .await;
    let error = core
        .decline_friend_request(core.friends().outgoing[0].friendship_id.clone())
        .await;
    assert!(error.is_err(), "only the receiver declines");

    // --- Notifications ---
    core.notifications();
    until("the centre", || {
        core.notifications().state == LoadState::Ready
    })
    .await;
    let list = core.notifications();
    assert_eq!(list.rows.len(), 10, "the dismissed row left out");
    assert!(!list.has_more, "a short page");
    core.load_more_notifications().await.unwrap();
    let unread = list.rows.iter().find(|row| !row.read).unwrap().id.clone();
    let before = core.badge_count();
    assert!(before > 0);
    core.mark_notification_read(unread.clone()).await.unwrap();
    until("the read event", || {
        core.notifications()
            .rows
            .iter()
            .any(|row| row.id == unread && row.read)
            && core.badge_count() == before - 1
    })
    .await;
    let dismissed = list.rows[0].id.clone();
    core.dismiss_notification(dismissed.clone()).await.unwrap();
    assert!(
        core.notifications()
            .rows
            .iter()
            .all(|row| row.id != dismissed)
    );
    core.mark_all_notifications_read().await.unwrap();
    until("everything read", || {
        core.badge_count() == 0 && core.notifications().rows.iter().all(|row| row.read)
    })
    .await;
    // The second page asks for no `unreadOnly`, which the server would read as true.
    assert!(server.requests().iter().all(|record| match record {
        Record::Http { path, .. } => !path.contains("unreadOnly"),
        _ => true,
    }));

    // --- Settings and levels ---
    core.notification_settings();
    until("settings", || {
        core.notification_settings().state == LoadState::Ready
    })
    .await;
    core.update_notification_settings(NotificationSettingsPatch {
        dnd: Some(true),
        dnd_start: Some("22:00".into()),
        dnd_end: Some("07:30".into()),
        dnd_timezone: Some("Europe/Berlin".into()),
        ..Default::default()
    })
    .await
    .unwrap();
    let settings = core.notification_settings().settings;
    assert!(settings.dnd);
    assert_eq!(settings.dnd_start.as_deref(), Some("22:00"));
    core.update_notification_settings(NotificationSettingsPatch {
        dnd_start: Some(String::new()),
        ..Default::default()
    })
    .await
    .unwrap();
    let settings = core.notification_settings().settings;
    assert_eq!(settings.dnd_start, None, "cleared with a null");
    assert_eq!(settings.dnd_end.as_deref(), Some("07:30"), "the rest kept");

    // Channel ids in the showcase stay readable; the fake accepts a known one as the backend does a UUID.
    let muted = "tr-general".to_owned();
    core.channel_notify_level(muted.clone());
    until("a channel's level", || {
        core.channel_notify_level(muted.clone()).state == LoadState::Ready
    })
    .await;
    assert_eq!(
        core.channel_notify_level(muted.clone()).level,
        Some(NotifyLevel::Muted)
    );
    let general = "cc-general".to_owned();
    core.channel_notify_level(general.clone());
    until("no level of its own", || {
        core.channel_notify_level(general.clone()).state == LoadState::Ready
    })
    .await;
    let view = core.channel_notify_level(general.clone());
    assert_eq!((view.level, view.effective), (None, NotifyLevel::Mentions));
    core.set_channel_notify_level(general.clone(), Some(NotifyLevel::All))
        .await
        .unwrap();
    assert_eq!(
        core.channel_notify_level(general.clone()).effective,
        NotifyLevel::All
    );
    core.set_channel_notify_level(general.clone(), None)
        .await
        .unwrap();
    assert_eq!(core.channel_notify_level(general.clone()).level, None);

    // --- Idle ---
    core.set_idle(true);
    until("presenceOnline idle", || {
        server.requests().iter().any(|record| {
            matches!(record, Record::Socket { event, payload: Some(payload), .. }
                if event == "presenceOnline" && payload["idle"] == true)
        })
    })
    .await;

    // A path id that isn't a UUID is the server's 400, as a failure the UI can show.
    let error = core.leave_dm("not-a-uuid".into()).await.unwrap_err();
    assert!(matches!(error, CoreError::Failed { .. }));

    let seen = answered(&server);
    for operation in [
        "DirectMessagesController_findUserDmGroups",
        "DirectMessagesController_createDmGroup",
        "DirectMessagesController_addMembers",
        "DirectMessagesController_leaveDmGroup",
        "UserController_searchUsers",
        "FriendsController_getFriends",
        "FriendsController_getPendingRequests",
        "FriendsController_getFriendshipStatus",
        "FriendsController_sendFriendRequest",
        "FriendsController_acceptFriendRequest",
        "FriendsController_cancelFriendRequest",
        "FriendsController_removeFriend",
        "NotificationsController_getNotifications",
        "NotificationsController_markAsRead",
        "NotificationsController_markAllAsRead",
        "NotificationsController_dismissNotification",
        "NotificationsController_getSettings",
        "NotificationsController_updateSettings",
        "NotificationsController_getChannelOverride",
        "NotificationsController_setChannelOverride",
        "NotificationsController_deleteChannelOverride",
        "NotificationsController_getUnreadCount",
    ] {
        let statuses = seen
            .get(operation)
            .unwrap_or_else(|| panic!("{operation} was never called: {seen:?}"));
        assert!(
            statuses.iter().any(|status| (200..300).contains(status)),
            "{operation} answered {statuses:?}"
        );
    }
    assert!(
        seen["FriendsController_declineFriendRequest"]
            .iter()
            .all(|status| *status >= 400),
        "the sender's decline is refused"
    );
    drop(events);
}

#[tokio::test]
async fn a_dm_conversation_over_the_wire() {
    let Rig {
        server,
        core,
        events,
    } = rig().await;
    let priya_id = entity_uuid("u-priya");
    let dm = entity_uuid("dm-priya");
    let conversation = Conversation::DirectMessage { id: dm.clone() };
    core.dm_list();
    until("the DM list", || core.dm_list().state == LoadState::Ready).await;
    core.open_conversation(conversation.clone()).await.unwrap();
    until("the DM's rows", || !rows(&events, &conversation).is_empty()).await;

    // Send, edit, react.
    core.send_message(conversation.clone(), draft("over the wire"))
        .await
        .unwrap();
    until("the sent row", || {
        by_text(&events, &conversation, "over the wire").is_some_and(|row| row.id.is_some())
    })
    .await;
    let sent = by_text(&events, &conversation, "over the wire")
        .unwrap()
        .id
        .unwrap();
    assert_eq!(
        core.dm(dm.clone()).unwrap().last_message.unwrap().text,
        "over the wire",
        "the list follows the conversation"
    );
    core.edit_message(sent.clone(), draft("edited in a DM"), None)
        .await
        .unwrap();
    until("the edit", || {
        by_text(&events, &conversation, "edited in a DM").is_some_and(|row| row.edited)
    })
    .await;
    core.add_reaction(sent.clone(), "🔥".into()).await.unwrap();
    until("the reaction", || {
        by_text(&events, &conversation, "edited in a DM")
            .is_some_and(|row| row.reactions.iter().any(|r| r.emoji == "🔥" && r.me))
    })
    .await;

    // A thread in a DM.
    let thread = Conversation::Thread {
        parent_message_id: sent.clone(),
    };
    core.open_conversation(thread.clone()).await.unwrap();
    core.send_message(thread.clone(), draft("a reply in a DM thread"))
        .await
        .unwrap();
    until("the reply", || {
        by_text(&events, &thread, "a reply in a DM thread").is_some_and(|row| row.id.is_some())
    })
    .await;
    until("the reply count", || {
        core.thread_info(sent.clone()).reply_count == 1
    })
    .await;

    // What a DM refuses.
    assert!(core.pin_message(sent.clone(), None).await.is_err());
    let custom = format!("custom:{}", uuid::Uuid::from_u128(7));
    assert!(
        core.add_reaction(sent.clone(), custom.clone())
            .await
            .is_err()
    );
    until("the refused reaction rolled back", || {
        by_text(&events, &conversation, "edited in a DM")
            .is_some_and(|row| row.reactions.iter().all(|r| r.emoji != custom))
    })
    .await;

    // Priya writes while the window is elsewhere: the message, an OS notification once.
    core.set_focused(false);
    let mut priya = Peer::connect(&server.base_url(), &priya_id).await;
    let ack = priya
        .emit(
            "sendDirectMessage",
            json!({
                "directMessageGroupId": dm,
                "spans": [{ "type": "PLAINTEXT", "text": "are you there" }],
                "attachments": [],
                "clientNonce": uuid::Uuid::from_u128(42).to_string(),
            }),
        )
        .await;
    assert_eq!(ack["ok"], true, "{ack}");
    until("priya's message", || {
        by_text(&events, &conversation, "are you there").is_some()
    })
    .await;
    until("the OS notification", || {
        events
            .all()
            .iter()
            .any(|event| matches!(event, CoreEvent::Notify { .. }))
    })
    .await;
    let raised: Vec<_> = events
        .all()
        .into_iter()
        .filter_map(|event| match event {
            CoreEvent::Notify { notification } => Some(notification),
            _ => None,
        })
        .collect();
    assert_eq!(raised.len(), 1);
    assert_eq!(raised[0].tag, format!("dm:{dm}"));
    assert_eq!(raised[0].body, "are you there");
    assert_eq!(raised[0].title, "pri");

    // Reading it: the server sends the receipt twice in a DM (to me, and to the group with my
    // id); core reads the count again once.
    let message_id = by_text(&events, &conversation, "are you there")
        .unwrap()
        .id
        .unwrap();
    let mark = events.all().len();
    core.mark_read(conversation.clone(), message_id)
        .await
        .unwrap();
    // Whatever the server sends this socket after the receipts arrives after them: once they're
    // out, a presence change for someone else orders them.
    until("markAsRead reached the server", || {
        server
            .requests()
            .iter()
            .any(|record| matches!(record, Record::Socket { event, .. } if event == "markAsRead"))
    })
    .await;
    server.idle().await;
    let kwame = entity_uuid("u-kwame");
    let dm_kwame = entity_uuid("dm-kwame");
    let online = core.dm(dm_kwame.clone()).unwrap().online;
    server
        .emit_to_user(
            &entity_uuid("me"),
            if online { "userOffline" } else { "userOnline" },
            json!({ "userId": kwame }),
        )
        .await;
    until("the later presence change", || {
        core.dm(dm_kwame.clone()).unwrap().online != online
    })
    .await;
    let receipts = server
        .requests()
        .iter()
        .filter(|record| matches!(record, Record::Socket { event, .. } if event == "markAsRead"))
        .count();
    assert_eq!(receipts, 1);
    let after: Vec<CoreEvent> = events.all().into_iter().skip(mark).collect();
    let recounts = after
        .iter()
        .filter(|event| {
            matches!(event, CoreEvent::QueriesInvalidated { keys }
                if keys.iter().any(|key| key.op() == "notificationsControllerGetUnreadCount"))
        })
        .count();
    assert_eq!(recounts, 1, "the duplicate receipt read the count again");
    let withdrawals = after
        .iter()
        .filter(|event| matches!(event, CoreEvent::WithdrawNotifications { tag } if *tag == format!("dm:{dm}")))
        .count();
    assert_eq!(withdrawals, 1);
    assert!(events.all().iter().any(|event| matches!(
        event,
        CoreEvent::ViewChanged {
            view: ViewKey::Badge
        }
    )));
}
