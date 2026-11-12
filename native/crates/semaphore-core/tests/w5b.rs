//! W5-B in core, on `FakeBackend`: the community permission set (a table of who may do what), the
//! rank rules for a member and for roles, unknown actions surviving a save, overrides, and this
//! user being kicked, banned or timed out.

mod common;

use common::w5b::{refusal, role_json, user_roles_json};
use common::*;
use semaphore_core::model::{
    BanDuration, BanRequest, ChannelPreset, CommunityCaps, LoadState, NotAllowed, OverwriteRow,
    OverwriteTarget, OverwritesDraft, RemovalCause, RoleDraft, RolePatch, ViewKey, VoiceStatus,
};
use semaphore_core::platform::CoreEvent;
use serde_json::{Value, json};

const COMMUNITY: &str = "comm";
const VOICE: &str = "00000000-0000-4000-8000-000000000001";
const ROLE_ID: &str = "00000000-0000-4000-8000-0000000000aa";
const BOB: &str = "00000000-0000-4000-8000-0000000000b0";

/// Every action a `CommunityCaps` flag reads.
const ADMIN: &[&str] = &[
    "UPDATE_COMMUNITY",
    "DELETE_COMMUNITY",
    "CREATE_CHANNEL",
    "UPDATE_CHANNEL",
    "DELETE_CHANNEL",
    "CREATE_MEMBER",
    "DELETE_MEMBER",
    "MANAGE_CHANNEL_PERMISSIONS",
    "READ_ROLE",
    "CREATE_ROLE",
    "UPDATE_ROLE",
    "DELETE_ROLE",
    "UPDATE_MEMBER",
    "READ_MEMBER",
    "READ_ALIAS_GROUP",
    "CREATE_ALIAS_GROUP",
    "UPDATE_ALIAS_GROUP",
    "DELETE_ALIAS_GROUP",
    "UPDATE_ALIAS_GROUP_MEMBER",
    "MANAGE_EMOJIS",
    "READ_SOUNDBOARD_SOUND",
    "CREATE_SOUNDBOARD_SOUND",
    "DELETE_SOUNDBOARD_SOUND",
    "MANAGE_WEBHOOKS",
    "CREATE_INVITE",
    "BAN_USER",
    "UNBAN_USER",
    "KICK_USER",
    "TIMEOUT_USER",
    "VIEW_BAN_LIST",
    "VIEW_MODERATION_LOGS",
];
const MODERATOR: &[&str] = &[
    "READ_ROLE",
    "READ_MEMBER",
    "KICK_USER",
    "TIMEOUT_USER",
    "VIEW_BAN_LIST",
    "UPDATE_MEMBER",
    "CREATE_INVITE",
];
const MEMBER: &[&str] = &["READ_MEMBER", "READ_ALIAS_GROUP", "READ_SOUNDBOARD_SOUND"];

fn all_roles() -> Value {
    json!({ "communityId": COMMUNITY, "roles": [
        role_json("admin", 10, ADMIN),
        role_json("moderator", 20, MODERATOR),
        role_json("member", 100, MEMBER),
    ] })
}

/// This user holds these roles; the community's roles are the three above.
fn script_me(rig: &Rig, roles: &[Value]) {
    rig.backend
        .w5b
        .answer("my_roles comm", user_roles_json(ME, COMMUNITY, roles));
    rig.backend.w5b.answer("roles comm", all_roles());
}

fn script_member(rig: &Rig, user: &str, roles: &[Value]) {
    rig.backend.w5b.answer(
        &format!("user_roles comm {user}"),
        user_roles_json(user, COMMUNITY, roles),
    );
    rig.backend.w5b.answer(
        &format!("timeout_status comm {user}"),
        json!({ "isTimedOut": false }),
    );
}

/// Signed in as the instance owner, after `setup` scripted what sign-in already reads.
async fn owner_with(setup: impl FnOnce(&Rig)) -> Rig {
    let rig = Rig::with_media();
    let mut me = user_json(ME);
    me["role"] = json!("OWNER");
    rig.backend.w3.answer("profile", me);
    setup(&rig);
    rig.signed_in().await
}

async fn owner() -> Rig {
    owner_with(|_| {}).await
}

/// Signed in, after `setup` scripted what sign-in already reads (channels, instance roles).
async fn member_with(setup: impl FnOnce(&Rig)) -> Rig {
    let rig = Rig::new();
    setup(&rig);
    rig.signed_in().await
}

/// Reads the view until it has arrived.
async fn caps(rig: &mut Rig) -> (LoadState, CommunityCaps) {
    // Its own roles first, then (for `is_top`) the community's.
    rig.core.community_permissions(COMMUNITY.into());
    rig.settle().await;
    rig.core.community_permissions(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.community_permissions(COMMUNITY.into());
    (view.state, view.caps)
}

fn every(value: bool) -> CommunityCaps {
    CommunityCaps {
        update_community: value,
        delete_community: value,
        create_channel: value,
        update_channel: value,
        delete_channel: value,
        manage_private_members: value,
        manage_channel_permissions: value,
        read_roles: value,
        create_role: value,
        update_role: value,
        delete_role: value,
        assign_roles: value,
        read_members: value,
        add_members: value,
        read_alias_groups: value,
        create_alias_group: value,
        update_alias_group: value,
        delete_alias_group: value,
        manage_alias_members: value,
        manage_emoji: value,
        read_sounds: value,
        create_sound: value,
        delete_sound: value,
        manage_webhooks: value,
        create_invite: value,
        delete_invite: value,
        ban: value,
        unban: value,
        kick: value,
        timeout: value,
        view_bans: value,
        view_moderation_log: value,
    }
}

// --- The permission set ---

#[tokio::test]
async fn the_gating_table_owner_top_holder_mid_rank_member_and_no_roles() {
    // The instance owner: everything, at once, with no role here (RbacGuard's bypass).
    let mut rig = owner().await;
    script_me(&rig, &[]);
    let (state, got) = caps(&mut rig).await;
    assert_eq!(state, LoadState::Ready);
    assert_eq!(got, every(true));

    // The top holder: what the role holds; invites also need the instance's invite action.
    let mut rig = member_with(|rig| {
        rig.backend
            .w3
            .answer("instance_roles", json!({ "userId": ME, "roles": [] }));
    })
    .await;
    script_me(&rig, &[role_json("admin", 10, ADMIN)]);
    let (state, got) = caps(&mut rig).await;
    assert_eq!(state, LoadState::Ready);
    assert_eq!(
        got,
        CommunityCaps {
            create_invite: false,
            delete_invite: false,
            ..every(true)
        }
    );
    assert!(rig.core.community_permissions(COMMUNITY.into()).is_top);

    // A mid rank: only the moderator's flags.
    let mut rig = member_with(|rig| {
        rig.backend
            .w3
            .answer("instance_roles", json!({ "userId": ME, "roles": [] }));
    })
    .await;
    script_me(&rig, &[role_json("moderator", 20, MODERATOR)]);
    let (_, got) = caps(&mut rig).await;
    assert_eq!(
        got,
        CommunityCaps {
            read_roles: true,
            read_members: true,
            kick: true,
            timeout: true,
            view_bans: true,
            assign_roles: true,
            ..every(false)
        }
    );
    let view = rig.core.community_permissions(COMMUNITY.into());
    assert_eq!(view.best_position, Some(20));
    assert!(!view.is_top);

    // Member only.
    let mut rig = Rig::new().signed_in().await;
    script_me(&rig, &[role_json("member", 100, MEMBER)]);
    let (_, got) = caps(&mut rig).await;
    assert_eq!(
        got,
        CommunityCaps {
            read_members: true,
            read_alias_groups: true,
            read_sounds: true,
            ..every(false)
        }
    );
    // A member can't read the community's roles: core doesn't ask.
    assert_eq!(rig.backend.w5b.count("roles"), 0);

    // No roles: nothing, and no rank.
    let mut rig = Rig::new().signed_in().await;
    script_me(&rig, &[]);
    let (state, got) = caps(&mut rig).await;
    assert_eq!(state, LoadState::Ready);
    assert_eq!(got, every(false));
    assert_eq!(
        rig.core
            .community_permissions(COMMUNITY.into())
            .best_position,
        None
    );
}

#[tokio::test]
async fn invites_need_the_instance_action_as_well() {
    let mut rig = member_with(|rig| {
        rig.backend.w3.answer(
            "instance_roles",
            json!({ "userId": ME, "roles": [role_json("inviter", 40, &["CREATE_INSTANCE_INVITE", "DELETE_INSTANCE_INVITE"])] }),
        );
    })
    .await;
    script_me(&rig, &[role_json("admin", 10, ADMIN)]);
    let (_, got) = caps(&mut rig).await;
    assert!(got.create_invite);
    assert!(got.delete_invite);
}

#[tokio::test]
async fn nothing_is_offered_while_the_roles_load_or_after_they_fail() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w5b
        .fail_next("my_roles comm", refusal(500, "boom"));
    let first = rig.core.community_permissions(COMMUNITY.into());
    assert_eq!(first.state, LoadState::Loading);
    assert_eq!(first.caps, every(false));
    rig.settle().await;
    let failed = rig.core.community_permissions(COMMUNITY.into());
    assert!(matches!(failed.state, LoadState::Failed { .. }));
    assert_eq!(failed.caps, every(false));
}

// --- One member ---

async fn target(rig: &mut Rig, user: &str) -> semaphore_core::model::ModerationTargetView {
    rig.core.moderation_target(COMMUNITY.into(), user.into());
    rig.settle().await;
    rig.core.moderation_target(COMMUNITY.into(), user.into())
}

#[tokio::test]
async fn moderating_a_member_needs_a_strictly_higher_role() {
    let mut rig = Rig::new().signed_in().await;
    script_me(&rig, &[role_json("moderator", 20, MODERATOR)]);
    script_member(&rig, "pat", &[role_json("member", 100, MEMBER)]);
    script_member(&rig, "ada", &[role_json("admin", 10, ADMIN)]);
    script_member(&rig, "peer", &[role_json("moderator", 20, MODERATOR)]);
    script_member(&rig, "nobody", &[]);

    let pat = target(&mut rig, "pat").await;
    assert_eq!(pat.state, LoadState::Ready);
    assert!(pat.can_kick && pat.can_timeout);
    assert!(!pat.can_ban, "the moderator role holds no BAN_USER");
    assert!(pat.can_change_roles);
    assert_eq!(pat.not_allowed, None);

    for user in ["ada", "peer"] {
        let view = target(&mut rig, user).await;
        assert!(
            !view.can_kick && !view.can_timeout && !view.can_change_roles,
            "{user}"
        );
        assert_eq!(view.not_allowed, Some(NotAllowed::Rank), "{user}");
    }
    // No role ranks below everyone.
    assert!(target(&mut rig, "nobody").await.can_kick);
    assert_eq!(
        target(&mut rig, ME).await.not_allowed,
        Some(NotAllowed::SelfTarget)
    );
}

#[tokio::test]
async fn a_member_only_has_nothing_to_offer_and_the_owner_meets_the_rank_rule() {
    let mut rig = Rig::new().signed_in().await;
    script_me(&rig, &[role_json("member", 100, MEMBER)]);
    script_member(&rig, "pat", &[role_json("member", 100, MEMBER)]);
    assert_eq!(
        target(&mut rig, "pat").await.not_allowed,
        Some(NotAllowed::Missing)
    );

    // #679: the owner passes the guard, but the server applies the rank rule to them too.
    let mut rig = owner().await;
    script_me(&rig, &[]);
    script_member(&rig, "pat", &[role_json("member", 100, MEMBER)]);
    let pat = target(&mut rig, "pat").await;
    assert_eq!(pat.not_allowed, Some(NotAllowed::Rank));
    assert!(!pat.can_ban && !pat.can_kick && !pat.can_timeout);
    // Roles they may change: the owner stands as the top holder there.
    assert!(pat.can_change_roles);
}

// --- Roles ---

#[tokio::test]
async fn roles_are_flagged_by_rank_and_by_what_this_user_holds() {
    let mut rig = Rig::new().signed_in().await;
    let lead = role_json(
        "lead",
        15,
        &[
            "READ_ROLE",
            "UPDATE_ROLE",
            "DELETE_ROLE",
            "UPDATE_MEMBER",
            "KICK_USER",
            "READ_MEMBER",
            "TIMEOUT_USER",
            "VIEW_BAN_LIST",
            "CREATE_INVITE",
        ],
    );
    rig.backend.w5b.answer(
        "my_roles comm",
        user_roles_json(ME, COMMUNITY, std::slice::from_ref(&lead)),
    );
    rig.backend.w5b.answer(
        "roles comm",
        json!({ "communityId": COMMUNITY, "roles": [
            role_json("admin", 10, ADMIN), lead,
            role_json("moderator", 20, MODERATOR), role_json("member", 100, MEMBER),
        ] }),
    );
    rig.core.roles(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.roles(COMMUNITY.into());
    assert_eq!(view.state, LoadState::Ready);
    let flags: Vec<(&str, bool, bool, bool)> = view
        .roles
        .iter()
        .map(|role| {
            (
                role.id.as_str(),
                role.editable,
                role.deletable,
                role.assignable,
            )
        })
        .collect();
    assert_eq!(
        flags,
        [
            ("admin", false, false, false),
            ("lead", false, false, false),
            // Below, and every action of it held.
            ("moderator", true, true, true),
            // Below, but it holds READ_ALIAS_GROUP and READ_SOUNDBOARD_SOUND, which `lead` lacks:
            // the server refuses the whole list (`assertHolds`); defaults can't be deleted.
            ("member", false, false, false),
        ]
    );
    assert!(view.grantable.contains(&"KICK_USER".to_owned()));
    assert!(!view.grantable.contains(&"BAN_USER".to_owned()));
    assert!(!view.can_create);
    assert!(view.can_reorder);

    let catalog = rig.core.permission_catalog();
    assert_eq!(catalog[0].id, "messages");
    assert!(
        catalog
            .iter()
            .any(|group| group.actions.contains(&"CAPTURE_REPLAY".to_owned()))
    );
}

#[tokio::test]
async fn an_action_this_build_does_not_know_survives_a_save() {
    let mut rig = owner().await;
    let future = role_json("custom", 30, &["KICK_USER", "FUTURE_ACTION"]);
    script_me(&rig, &[]);
    rig.backend.w5b.answer(
        "roles comm",
        json!({ "communityId": COMMUNITY, "roles": [future, role_json("member", 100, MEMBER)] }),
    );
    rig.core.roles(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.roles(COMMUNITY.into());
    let custom = &view.roles[0];
    assert_eq!(custom.actions, ["KICK_USER", "FUTURE_ACTION"]);
    assert!(custom.editable);

    rig.backend
        .w5b
        .answer("update_role", role_json("custom", 30, &["FUTURE_ACTION"]));
    rig.core
        .update_role(
            COMMUNITY.into(),
            "custom".into(),
            RolePatch {
                name: Some("Renamed".into()),
                // A change to the list sends the whole list, the unknown action with it.
                actions: Some(
                    custom
                        .actions
                        .iter()
                        .cloned()
                        .chain(["BAN_USER".to_owned()])
                        .collect(),
                ),
            },
        )
        .await
        .unwrap();
    let sent = rig
        .backend
        .w5b
        .calls()
        .into_iter()
        .find(|call| call.starts_with("update_role"))
        .unwrap();
    assert!(sent.contains("\"FUTURE_ACTION\""), "{sent}");
    assert!(sent.contains("\"Renamed\""), "{sent}");
    // Saved: the view isn't busy and the roles are read again.
    rig.settle().await;
    let after = rig.core.roles(COMMUNITY.into());
    assert!(!after.op.busy);
    assert_eq!(after.op.error, None);
    assert!(rig.backend.w5b.count("roles") >= 2);
}

#[tokio::test]
async fn a_refused_save_keeps_the_servers_message_on_the_view() {
    let rig = owner().await;
    script_me(&rig, &[]);
    rig.backend.w5b.fail_next(
        "create_role",
        refusal(403, "Cannot grant permissions you do not have: BAN_USER"),
    );
    let result = rig
        .core
        .create_role(
            COMMUNITY.into(),
            RoleDraft {
                name: "New".into(),
                actions: vec!["BAN_USER".into()],
            },
        )
        .await;
    assert!(result.is_err());
    let view = rig.core.roles(COMMUNITY.into());
    assert_eq!(
        view.op.error.map(|error| error.message),
        Some("Cannot grant permissions you do not have: BAN_USER".to_owned())
    );
}

#[tokio::test]
async fn assigning_sends_uuids_and_reads_the_member_again() {
    let mut rig = owner().await;
    script_me(&rig, &[]);
    script_member(&rig, BOB, &[]);
    rig.core
        .assign_role(COMMUNITY.into(), BOB.into(), ROLE_ID.into())
        .await
        .unwrap();
    let calls = rig.backend.w5b.calls();
    assert!(
        calls.iter().any(|call| call
            == &format!("assign comm {{\"roleId\":\"{ROLE_ID}\",\"userId\":\"{BOB}\"}}")),
        "{calls:?}"
    );
    // A role id that isn't one is refused before any request.
    assert!(
        rig.core
            .assign_role(COMMUNITY.into(), BOB.into(), "nope".into())
            .await
            .is_err()
    );
    rig.settle().await;
}

// --- Overrides ---

#[tokio::test]
async fn overrides_are_replaced_whole_and_named_from_the_roles() {
    let mut rig = owner_with(|rig| {
        rig.backend.channels.lock().unwrap().push(json!({
            "id": CHANNEL, "name": "general", "communityId": COMMUNITY, "type": "TEXT",
            "position": 0, "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
            "createdAt": "2026-09-22T18:00:00.000Z",
        }));
    })
    .await;
    script_me(&rig, &[]);
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    rig.backend.w5b.answer(
        "overwrites chan",
        json!({ "channelId": CHANNEL, "preset": "READ_ONLY", "overwrites": [
            { "targetType": "EVERYONE", "roleId": null, "allow": [], "deny": ["CREATE_MESSAGE"] },
            { "targetType": "ROLE", "roleId": "moderator", "allow": ["CREATE_MESSAGE"], "deny": [] },
        ] }),
    );
    rig.core.channel_overwrites(CHANNEL.into());
    rig.settle().await;
    let view = rig.core.channel_overwrites(CHANNEL.into());
    assert_eq!(view.state, LoadState::Ready);
    assert!(view.editable);
    assert_eq!(view.preset, ChannelPreset::ReadOnly);
    assert_eq!(
        view.overwrites[1].target,
        OverwriteTarget::Role {
            role_id: "moderator".into(),
            name: "moderator name".into()
        }
    );

    rig.backend.w5b.answer(
        "replace_overwrites",
        json!({ "channelId": CHANNEL, "preset": "CUSTOM", "overwrites": [] }),
    );
    rig.core
        .replace_channel_overwrites(
            CHANNEL.into(),
            OverwritesDraft {
                preset: ChannelPreset::Custom,
                overwrites: vec![OverwriteRow {
                    target: OverwriteTarget::Everyone,
                    allow: vec![],
                    deny: vec!["SPEAK".into()],
                    role_missing: false,
                }],
            },
        )
        .await
        .unwrap();
    let sent = rig
        .backend
        .w5b
        .calls()
        .into_iter()
        .find(|call| call.starts_with("replace_overwrites"))
        .unwrap();
    assert_eq!(
        sent,
        "replace_overwrites chan {\"overwrites\":[{\"allow\":[],\"deny\":[\"SPEAK\"],\"targetType\":\"EVERYONE\"}],\"preset\":\"CUSTOM\"}"
    );
}

// --- Being moderated ---

fn voice_channel() -> Value {
    json!({
        "id": VOICE, "name": "voice", "communityId": COMMUNITY, "type": "VOICE", "position": 1,
        "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

async fn in_call() -> Rig {
    let rig = Rig::with_media();
    rig.backend.channels.lock().unwrap().push(voice_channel());
    let mut rig = rig.signed_in().await;
    rig.core.communities();
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    rig.core.join_voice(VOICE.into()).await.unwrap();
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
    rig
}

fn removed(events: &[CoreEvent]) -> Vec<(String, String, RemovalCause)> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::CommunityRemoved {
                community_id,
                name,
                cause,
            } => Some((community_id.clone(), name.clone(), cause.clone())),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn banned_twice_over_is_announced_once_the_call_left_and_the_community_dropped() {
    let mut rig = in_call().await;
    rig.events.take();
    let payload = json!({
        "communityId": COMMUNITY, "userId": ME, "moderatorId": "ada", "reason": "spam",
        "expiresAt": "2026-12-01T00:00:00.000Z",
    });
    // #673: the user's own room and the community's both carry it.
    rig.core.ingest(event("userBanned", payload.clone()));
    rig.core.ingest(event("userBanned", payload));
    let events = rig.settle().await;
    assert_eq!(
        removed(&events),
        [(
            COMMUNITY.to_owned(),
            "Community".to_owned(),
            RemovalCause::Banned {
                reason: Some("spam".into()),
                until_ms: Some(1_796_083_200_000),
            }
        )]
    );
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
    assert!(
        rig.media
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|call| call == "disconnect"),
        "{:?}",
        rig.media.calls.lock().unwrap()
    );
    assert_eq!(rig.core.voice().room, None);
}

#[tokio::test]
async fn kicked_or_deleted_say_why_and_someone_elses_kick_only_refreshes() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.settle().await;
    rig.core.ingest(event(
        "userKicked",
        json!({ "communityId": COMMUNITY, "userId": "pat", "moderatorId": ME }),
    ));
    assert!(removed(&rig.settle().await).is_empty());

    rig.core.ingest(event(
        "userKicked",
        json!({ "communityId": COMMUNITY, "userId": ME, "moderatorId": "ada" }),
    ));
    assert_eq!(
        removed(&rig.settle().await)[0].2,
        RemovalCause::Kicked { reason: None }
    );

    let mut rig = Rig::new().signed_in().await;
    rig.core.ingest(event(
        "communityDeleted",
        json!({ "communityId": COMMUNITY }),
    ));
    assert_eq!(removed(&rig.settle().await)[0].2, RemovalCause::Deleted);
}

fn capabilities(timed_out_until: Option<&str>) -> Value {
    json!({ "communityId": COMMUNITY, "channels": [{
        "channelId": CHANNEL, "view": true, "post": timed_out_until.is_none(), "attach": true,
        "react": true, "threadReply": true, "connect": true, "speak": true, "video": true,
        "share": true, "managePermissions": false, "postingRoleNames": [],
        "pin": true, "deleteAny": true, "seeRemoved": true,
        "timedOutUntil": timed_out_until,
    }] })
}

#[tokio::test]
async fn when_a_timeout_runs_out_the_capabilities_are_read_again() {
    let rig = Rig::new();
    rig.backend.channels.lock().unwrap().push(json!({
        "id": CHANNEL, "name": "general", "communityId": COMMUNITY, "type": "TEXT", "position": 0,
        "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    }));
    *rig.backend.capabilities.lock().unwrap() =
        Some(capabilities(Some("2026-11-11T12:00:00.000Z")));
    let mut rig = rig.signed_in().await;
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    let locked = rig.core.channels(COMMUNITY.into())[0]
        .permissions
        .clone()
        .unwrap();
    assert!(locked.timed_out_until_ms.is_some());
    assert!(!locked.post);
    // The server says nothing when it runs out; the host's timer does.
    *rig.backend.capabilities.lock().unwrap() = Some(capabilities(None));
    rig.core.timeout_elapsed(COMMUNITY.into());
    rig.settle().await;
    let open = rig.core.channels(COMMUNITY.into())[0]
        .permissions
        .clone()
        .unwrap();
    assert_eq!(open.timed_out_until_ms, None);
    assert!(open.post);
}

#[tokio::test]
async fn banning_sends_the_end_as_a_date_and_refreshes_the_lists() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w5b.answer("bans comm", json!([]));
    rig.core.bans(COMMUNITY.into());
    rig.settle().await;
    rig.core
        .ban_member(
            COMMUNITY.into(),
            "pat".into(),
            BanRequest {
                reason: Some("  ".into()),
                duration: BanDuration::Seconds { seconds: 3600 },
            },
        )
        .await
        .unwrap();
    let sent = rig
        .backend
        .w5b
        .calls()
        .into_iter()
        .find(|call| call.starts_with("ban "))
        .unwrap();
    // The fake clock is at 1,000,000 ms; a blank reason is left out.
    assert_eq!(
        sent,
        "ban comm pat {\"expiresAt\":\"1970-01-01T01:16:40.000Z\"}"
    );
    rig.settle().await;
    assert_eq!(rig.backend.w5b.count("bans"), 2);
    let _ = ViewKey::Bans {
        community_id: COMMUNITY.into(),
    };
}

// --- Role names (failing first: blank names used to be sent) ---

#[tokio::test]
async fn a_role_name_is_one_to_fifty_characters_once_trimmed() {
    let cases: &[(&str, bool)] = &[
        ("", false),
        ("   ", false),
        ("\t\n", false),
        ("a", true),
        ("  a  ", true),
        (&"x".repeat(50), true),
        (&"x".repeat(51), false),
        // Counted in characters, as the wire type counts: 50 two-byte letters fit.
        (&"é".repeat(50), true),
        (&"é".repeat(51), false),
    ];
    for (name, ok) in cases {
        let rig = owner().await;
        script_me(&rig, &[]);
        rig.backend
            .w5b
            .answer("create_role", role_json("new", 50, &["KICK_USER"]));
        let result = rig
            .core
            .create_role(
                COMMUNITY.into(),
                RoleDraft {
                    name: (*name).to_owned(),
                    actions: vec!["KICK_USER".into()],
                },
            )
            .await;
        assert_eq!(result.is_ok(), *ok, "{name:?}");
        assert_eq!(
            rig.backend.w5b.count("create_role"),
            usize::from(*ok),
            "{name:?}: refused before any request"
        );
    }
}
