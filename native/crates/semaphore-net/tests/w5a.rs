//! W5-A over the real transports: community administration by `Core` on `HttpBackend` and
//! `SocketRealtime` against `semaphore-fake-server`'s showcase. A second client, signed in as the
//! same user on another device, watches what the socket tells it.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    ChannelDraft, ChannelKind, ChannelMove, DraftFile, InviteDraft, LoadState, RemovalCause,
    SessionState, SoundDraft,
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

    fn names(&self, community: &str) -> Vec<String> {
        self.core
            .channels(community.into())
            .into_iter()
            .map(|channel| channel.name)
            .collect()
    }
}

async fn signed_in(server: &FakeServer) -> Client {
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
    Client { core, events }
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

fn png() -> DraftFile {
    DraftFile {
        name: "e.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![0x89, b'P', b'N', b'G', 1, 2, 3],
    }
}

/// Reads a view until it says ready.
async fn loaded(what: &str, mut ready: impl FnMut() -> bool) {
    until(what, &mut ready).await;
}

#[tokio::test]
async fn channels_made_renamed_and_moved_reach_another_device() {
    let server = server().await;
    let (mine, theirs) = (signed_in(&server).await, signed_in(&server).await);
    let couch = id("c-couch");
    for client in [&mine, &theirs] {
        client.core.channels(couch.clone());
    }
    until("both lists", || {
        mine.names(&couch).len() == 6 && theirs.names(&couch).len() == 6
    })
    .await;

    let news = mine
        .core
        .create_channel(
            couch.clone(),
            ChannelDraft {
                name: "news".into(),
                kind: ChannelKind::Text,
                is_private: false,
                slowmode_seconds: 0,
            },
        )
        .await
        .unwrap();
    assert!(mine.names(&couch).contains(&"news".to_owned()), "at once");
    until("their channelCreated", || {
        theirs.names(&couch).contains(&"news".to_owned())
    })
    .await;

    mine.core
        .update_channel(
            news.clone(),
            ChannelDraft {
                name: "headlines".into(),
                kind: ChannelKind::Text,
                is_private: false,
                slowmode_seconds: 10,
            },
        )
        .await
        .unwrap();
    until("their channelUpdated", || {
        theirs.names(&couch).contains(&"headlines".to_owned())
    })
    .await;

    mine.core
        .move_channel(news.clone(), ChannelMove::Up)
        .await
        .unwrap();
    let text_order = |client: &Client| -> Vec<String> {
        client
            .core
            .channels(couch.clone())
            .into_iter()
            .filter(|channel| channel.kind == ChannelKind::Text)
            .map(|channel| channel.name)
            .collect()
    };
    assert_eq!(
        text_order(&mine),
        ["general", "clips", "lfg", "headlines", "memes"]
    );
    until("their channelsReordered", || {
        text_order(&theirs) == ["general", "clips", "lfg", "headlines", "memes"]
    })
    .await;
    let row = theirs
        .core
        .channels(couch.clone())
        .into_iter()
        .find(|channel| channel.id == news)
        .unwrap();
    assert_eq!(row.slowmode_seconds, 10);

    mine.core.delete_channel(news.clone()).await.unwrap();
    until("their channelDeleted", || {
        !theirs.names(&couch).contains(&"headlines".to_owned())
    })
    .await;
    until("the removal", || {
        theirs.events.0.lock().unwrap().iter().any(|event| {
            matches!(event, CoreEvent::ChannelRemoved { channel_id, .. } if *channel_id == news)
        })
    })
    .await;
}

#[tokio::test]
async fn a_private_member_is_added_and_listed_with_their_user() {
    let server = server().await;
    let client = signed_in(&server).await;
    let couch = id("c-couch");
    let staff = client
        .core
        .create_channel(
            couch,
            ChannelDraft {
                name: "staff".into(),
                kind: ChannelKind::Text,
                is_private: true,
                slowmode_seconds: 0,
            },
        )
        .await
        .unwrap();
    loaded("the members", || {
        client.core.private_members(staff.clone()).state == LoadState::Ready
    })
    .await;
    assert_eq!(client.core.private_members(staff.clone()).members.len(), 1);
    client
        .core
        .add_private_member(staff.clone(), id("u-samira"))
        .await
        .unwrap();
    until("the reread with samira", || {
        client
            .core
            .private_members(staff.clone())
            .members
            .iter()
            .any(|member| member.user.username == "samira")
    })
    .await;
    // Someone not in the community is refused, with the server's reason.
    let refused = client
        .core
        .add_private_member(staff.clone(), id("u-mateo"))
        .await;
    assert!(refused.is_err());
    let op = client.core.private_members(staff.clone()).op;
    assert_eq!(
        op.error.unwrap().message,
        "User must be a member of the community before being added to a private channel"
    );
    client
        .core
        .remove_private_member(staff.clone(), id("u-samira"))
        .await
        .unwrap();
    assert_eq!(client.core.private_members(staff).members.len(), 1);
}

#[tokio::test]
async fn a_mention_groups_members_are_set_added_and_removed() {
    let server = server().await;
    let client = signed_in(&server).await;
    let couch = id("c-couch");
    loaded("the groups", || {
        client.core.alias_groups(couch.clone()).state == LoadState::Ready
    })
    .await;
    let group = client
        .core
        .create_alias_group(couch.clone(), "raiders".into(), vec![id("u-samira")])
        .await
        .unwrap();
    assert_eq!(
        client.core.alias_groups(couch.clone()).groups[0].member_count,
        1
    );
    client
        .core
        .add_alias_group_member(group.clone(), id("u-marcus"))
        .await
        .unwrap();
    until("two members", || {
        client.core.alias_group(group.clone()).members.len() == 2
            && client.core.alias_groups(couch.clone()).groups[0].member_count == 2
    })
    .await;
    client
        .core
        .remove_alias_group_member(group.clone(), id("u-samira"))
        .await
        .unwrap();
    client
        .core
        .set_alias_group_members(
            group.clone(),
            vec![id("u-aiko"), id("u-grace"), id("u-marcus")],
        )
        .await
        .unwrap();
    until("three members", || {
        client.core.alias_group(group.clone()).members.len() == 3
    })
    .await;
    client
        .core
        .rename_alias_group(group.clone(), "builders".into())
        .await
        .unwrap();
    assert_eq!(
        client.core.alias_groups(couch.clone()).groups[0].name,
        "builders"
    );
    client.core.delete_alias_group(group).await.unwrap();
    // A reread already on its way when it went lands first, and is read again after.
    until("the group gone", || {
        client.core.alias_groups(couch.clone()).groups.is_empty()
    })
    .await;
}

#[tokio::test]
async fn an_emoji_and_a_sound_upload_then_are_added_and_deleted() {
    let server = server().await;
    let client = signed_in(&server).await;
    let couch = id("c-couch");
    loaded("the emoji", || {
        client.core.custom_emoji(couch.clone()).state == LoadState::Ready
    })
    .await;
    let before = client.core.custom_emoji(couch.clone()).emojis.len();
    client
        .core
        .add_custom_emoji(couch.clone(), "aaa_wave".into(), png())
        .await
        .unwrap();
    let view = client.core.custom_emoji(couch.clone());
    assert_eq!(view.emojis.len(), before + 1);
    let emoji = view
        .emojis
        .iter()
        .find(|emoji| emoji.name == "aaa_wave")
        .unwrap()
        .clone();
    assert!(view.op.error.is_none() && view.op.upload.is_none());
    client
        .core
        .delete_custom_emoji(couch.clone(), emoji.id)
        .await
        .unwrap();
    assert_eq!(client.core.custom_emoji(couch.clone()).emojis.len(), before);

    loaded("the soundboard", || {
        client.core.soundboard(couch.clone()).state == LoadState::Ready
    })
    .await;
    client
        .core
        .add_sound(
            couch.clone(),
            SoundDraft {
                name: "Bell".into(),
                emoji: Some("🔔".into()),
                file: DraftFile {
                    name: "bell.wav".into(),
                    mime_type: "audio/wav".into(),
                    bytes: vec![1, 2, 3],
                },
            },
        )
        .await
        .unwrap();
    let bell = client
        .core
        .soundboard(couch.clone())
        .sounds
        .into_iter()
        .find(|sound| sound.name == "Bell")
        .expect("listed");
    client
        .core
        .delete_sound(couch.clone(), bell.id)
        .await
        .unwrap();
    until("the reread without it", || {
        !client
            .core
            .soundboard(couch.clone())
            .sounds
            .iter()
            .any(|sound| sound.name == "Bell")
    })
    .await;
}

#[tokio::test]
async fn an_invite_is_made_for_this_community_and_deleted() {
    let server = server().await;
    let client = signed_in(&server).await;
    let couch = id("c-couch");
    loaded("the invites", || {
        client.core.community_invites(couch.clone()).state == LoadState::Ready
    })
    .await;
    let code = client
        .core
        .create_invite(
            couch.clone(),
            InviteDraft {
                max_uses: Some(2),
                valid_until_ms: None,
            },
        )
        .await
        .unwrap();
    let view = client.core.community_invites(couch.clone());
    assert_eq!(view.invites.len(), 1);
    assert_eq!(
        (view.invites[0].code.as_str(), view.invites[0].max_uses),
        (code.as_str(), Some(2))
    );
    assert!(
        client
            .core
            .community_invites(id("c-lumen"))
            .invites
            .is_empty()
    );
    client.core.delete_invite(code).await.unwrap();
    assert!(client.core.community_invites(couch).invites.is_empty());
}

#[tokio::test]
async fn deleting_a_community_removes_it_here_quietly_and_announces_it_on_the_other_device() {
    let server = server().await;
    let (mine, theirs) = (signed_in(&server).await, signed_in(&server).await);
    let couch = id("c-couch");
    until("both rails", || {
        mine.core.communities().len() == 4 && theirs.core.communities().len() == 4
    })
    .await;
    mine.core.delete_community(couch.clone()).await.unwrap();
    assert!(!mine.core.communities().iter().any(|c| c.id == couch));
    until("their removal", || !theirs.removals().is_empty()).await;
    assert_eq!(theirs.removals(), [(couch.clone(), RemovalCause::Deleted)]);
    until("their rail", || {
        !theirs.core.communities().iter().any(|c| c.id == couch)
    })
    .await;
    assert!(mine.removals().is_empty(), "the deleter isn't told");
}
