//! W5-B over the real transports: the permission set, roles, overrides and moderation, by `Core`
//! on `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`'s showcase, with a second
//! session signed in as another member (`FakeServer::sign_in_as`).

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    BanDuration, BanRequest, ChannelPreset, LoadState, NotAllowed, OverwriteRow, OverwriteTarget,
    OverwritesDraft, RemovalCause, RoleDraft, SessionState, TimeoutRequest,
};
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

impl Recorder {
    fn removals(&self) -> Vec<(String, RemovalCause)> {
        self.0
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

struct Client {
    core: Core,
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

/// A role for `me` (the instance owner, who may make any) between Admin (10) and Moderator (20),
/// holding these actions, handed to `me`. Its id.
async fn give_me_a_role(server: &FakeServer, me: &Client, actions: &[&str]) -> String {
    let couch = id("c-couch");
    let role_id = me
        .core
        .create_role(
            couch.clone(),
            RoleDraft {
                name: "Bouncer".into(),
                actions: actions.iter().map(|a| (*a).to_owned()).collect(),
            },
        )
        .await
        .unwrap();
    server.act_as(&couch, None, &[&role_id]);
    role_id
}

#[tokio::test]
async fn the_owner_passes_every_gate_but_not_the_moderation_rank_rule() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    let couch = id("c-couch");
    until("permissions", || {
        me.core.community_permissions(couch.clone()).state == LoadState::Ready
    })
    .await;
    let caps = me.core.community_permissions(couch.clone()).caps;
    assert!(caps.ban && caps.update_role && caps.manage_webhooks && caps.create_invite);
    // `me` is only a Member there, and the server lets no owner past the rank rule (#679).
    until("the target", || {
        me.core
            .moderation_target(couch.clone(), id("u-priya"))
            .state
            == LoadState::Ready
    })
    .await;
    let priya = me.core.moderation_target(couch.clone(), id("u-priya"));
    assert_eq!(priya.not_allowed, Some(NotAllowed::Rank));
    assert!(!priya.can_ban);
    let refused = me
        .core
        .ban_member(
            couch.clone(),
            id("u-priya"),
            BanRequest {
                reason: None,
                duration: BanDuration::Permanent,
            },
        )
        .await;
    assert!(refused.is_err(), "the server agrees");

    // The roles, highest first, as the owner may manage them all.
    until("roles", || {
        me.core.roles(couch.clone()).state == LoadState::Ready
    })
    .await;
    let roles = me.core.roles(couch.clone());
    let names: Vec<&str> = roles.roles.iter().map(|role| role.name.as_str()).collect();
    assert_eq!(names, ["Community Admin", "Moderator", "mods", "Member"]);
    assert!(roles.roles.iter().all(|role| role.editable));
    assert!(!roles.roles.last().unwrap().deletable, "a default role");
}

#[tokio::test]
async fn a_banned_member_hears_it_once_and_the_ban_is_listed_and_logged() {
    let server = server().await;
    server.sign_in_as("pri", &id("u-priya"));
    let me = signed_in(&server, "me").await;
    let priya = signed_in(&server, "pri").await;
    let couch = id("c-couch");
    give_me_a_role(
        &server,
        &me,
        &[
            "BAN_USER",
            "UNBAN_USER",
            "VIEW_BAN_LIST",
            "VIEW_MODERATION_LOGS",
            "READ_MEMBER",
        ],
    )
    .await;
    until("my new rank", || {
        me.core.roles(couch.clone()).state == LoadState::Ready
    })
    .await;
    me.core
        .ban_member(
            couch.clone(),
            id("u-priya"),
            BanRequest {
                reason: Some("spam".into()),
                duration: BanDuration::Seconds { seconds: 3600 },
            },
        )
        .await
        .unwrap();
    until("priya hears of it", || !priya.events.removals().is_empty()).await;
    let removals = priya.events.removals();
    assert_eq!(removals.len(), 1);
    assert_eq!(removals[0].0, couch);
    assert!(matches!(
        &removals[0].1,
        RemovalCause::Banned { reason: Some(reason), until_ms: Some(_) } if reason == "spam"
    ));
    assert!(me.events.removals().is_empty());

    until("the ban list", || {
        me.core
            .bans(couch.clone())
            .bans
            .iter()
            .any(|ban| ban.user.id == id("u-priya"))
    })
    .await;
    let ban = me.core.bans(couch.clone()).bans[0].clone();
    assert_eq!(ban.reason.as_deref(), Some("spam"));
    until("the log", || {
        me.core.moderation_log(couch.clone()).total == 1
    })
    .await;
    let log = me.core.moderation_log(couch.clone());
    assert_eq!(log.rows[0].target.as_ref().unwrap().id, id("u-priya"));

    me.core
        .unban_member(couch.clone(), id("u-priya"), None)
        .await
        .unwrap();
    until("the ban gone", || {
        me.core.bans(couch.clone()).bans.is_empty()
    })
    .await;
}

#[tokio::test]
async fn a_moderator_in_another_session_times_out_a_member_below_them() {
    let server = server().await;
    let couch = id("c-couch");
    server.act_as(
        &couch,
        Some(&id("u-marcus")),
        &["role-moderator-c-couch", "role-member-c-couch"],
    );
    server.sign_in_as("dropbear", &id("u-marcus"));
    let marcus = signed_in(&server, "dropbear").await;
    until("marcus's permissions", || {
        marcus.core.community_permissions(couch.clone()).state == LoadState::Ready
    })
    .await;
    let caps = marcus.core.community_permissions(couch.clone()).caps;
    assert!(caps.timeout && caps.kick && !caps.ban && !caps.update_role);
    until("the target", || {
        marcus
            .core
            .moderation_target(couch.clone(), id("u-kwame"))
            .state
            == LoadState::Ready
    })
    .await;
    assert!(
        marcus
            .core
            .moderation_target(couch.clone(), id("u-kwame"))
            .can_timeout
    );
    // Samira holds the top role: out of his reach.
    until("samira", || {
        marcus
            .core
            .moderation_target(couch.clone(), id("u-samira"))
            .state
            == LoadState::Ready
    })
    .await;
    assert_eq!(
        marcus
            .core
            .moderation_target(couch.clone(), id("u-samira"))
            .not_allowed,
        Some(NotAllowed::Rank)
    );
    marcus
        .core
        .timeout_member(
            couch.clone(),
            id("u-kwame"),
            TimeoutRequest {
                seconds: 600,
                reason: None,
            },
        )
        .await
        .unwrap();
    until("the timeout listed", || {
        marcus
            .core
            .timeouts(couch.clone())
            .timeouts
            .iter()
            .any(|timeout| timeout.user.id == id("u-kwame") && timeout.can_lift)
    })
    .await;
    until("the target's timeout", || {
        marcus
            .core
            .moderation_target(couch.clone(), id("u-kwame"))
            .timed_out_until_ms
            .is_some()
    })
    .await;
}

#[tokio::test]
async fn a_role_save_and_an_override_replace_round_trip() {
    let server = server().await;
    let me = signed_in(&server, "me").await;
    let couch = id("c-couch");
    let general = id("cc-general");
    me.core.channels(couch.clone());
    until("channels", || !me.core.channels(couch.clone()).is_empty()).await;
    let moderator = me
        .core
        .roles(couch.clone())
        .roles
        .into_iter()
        .find(|role| role.name == "Moderator");
    let moderator = match moderator {
        Some(role) => role,
        None => {
            until("roles", || {
                me.core.roles(couch.clone()).state == LoadState::Ready
            })
            .await;
            me.core
                .roles(couch.clone())
                .roles
                .into_iter()
                .find(|role| role.name == "Moderator")
                .unwrap()
        }
    };
    let mut actions = moderator.actions.clone();
    actions.push("BAN_USER".into());
    me.core
        .update_role(
            couch.clone(),
            moderator.id.clone(),
            RoleDraft {
                name: "Moderator".into(),
                actions,
            },
        )
        .await
        .unwrap();
    until("the role saved", || {
        me.core
            .roles(couch.clone())
            .roles
            .iter()
            .any(|role| role.id == moderator.id && role.actions.contains(&"BAN_USER".to_owned()))
    })
    .await;

    me.core
        .replace_channel_overwrites(
            general.clone(),
            OverwritesDraft {
                preset: ChannelPreset::ReadOnly,
                overwrites: vec![
                    OverwriteRow {
                        target: OverwriteTarget::Everyone,
                        allow: vec![],
                        deny: vec!["CREATE_MESSAGE".into()],
                    },
                    OverwriteRow {
                        target: OverwriteTarget::Role {
                            role_id: moderator.id.clone(),
                            name: String::new(),
                        },
                        allow: vec!["CREATE_MESSAGE".into()],
                        deny: vec![],
                    },
                ],
            },
        )
        .await
        .unwrap();
    until("the overrides", || {
        me.core.channel_overwrites(general.clone()).overwrites.len() == 2
    })
    .await;
    let view = me.core.channel_overwrites(general.clone());
    assert_eq!(view.preset, ChannelPreset::ReadOnly);
    assert!(view.editable);
    assert_eq!(
        view.overwrites[1].target,
        OverwriteTarget::Role {
            role_id: moderator.id.clone(),
            name: "Moderator".into()
        }
    );
    // A refusal keeps the server's message on the view.
    let refused = me
        .core
        .replace_channel_overwrites(
            general.clone(),
            OverwritesDraft {
                preset: ChannelPreset::Custom,
                overwrites: vec![OverwriteRow {
                    target: OverwriteTarget::Everyone,
                    allow: vec!["READ_CHANNEL".into()],
                    deny: vec![],
                }],
            },
        )
        .await;
    assert!(refused.is_err());
    assert_eq!(
        me.core
            .channel_overwrites(general.clone())
            .op
            .error
            .map(|error| error.message),
        Some("READ_CHANNEL can't be overwritten per channel".to_owned())
    );
}
