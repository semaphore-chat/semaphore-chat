//! W5-B's follow-up rules, table by table: role rows' blocks and moves, `RolePatch`, the member
//! dialog's and the moderation menu's reasons, per-action op state, the overrides editor's
//! extras, and the channel preset port (`shared/src/permissions/channel-presets.ts`).

mod common;

use common::w5b::{refusal, role_json, user_roles_json};
use common::*;
use semaphore_core::commands::presets::{self, Role};
use semaphore_core::model::{
    AdminActionKind, BanDuration, BanRequest, ChannelPreset, LoadState, NotAllowed, OverwriteRow,
    OverwriteTarget, RoleBlock, RoleDraft, RolePatch, RoleRow, TimeoutRequest,
};
use serde_json::{Value, json};

const COMMUNITY: &str = "comm";
const BOB: &str = "00000000-0000-4000-8000-0000000000b0";
const PAT: &str = "00000000-0000-4000-8000-0000000000c0";

const ALL: &[&str] = &[
    "READ_ROLE",
    "CREATE_ROLE",
    "UPDATE_ROLE",
    "DELETE_ROLE",
    "UPDATE_MEMBER",
    "READ_MEMBER",
    "KICK_USER",
    "BAN_USER",
    "TIMEOUT_USER",
    "MANAGE_CHANNEL_PERMISSIONS",
    "CREATE_MESSAGE",
    "ATTACH_FILES",
    "CREATE_REACTION",
];
const LEAD: &[&str] = &[
    "READ_ROLE",
    "UPDATE_ROLE",
    "DELETE_ROLE",
    "UPDATE_MEMBER",
    "READ_MEMBER",
    "KICK_USER",
    "TIMEOUT_USER",
    "MANAGE_CHANNEL_PERMISSIONS",
    "CREATE_MESSAGE",
    "ATTACH_FILES",
];
/// Holds BAN_USER, which `lead` lacks.
const MODERATOR: &[&str] = &["READ_MEMBER", "KICK_USER", "BAN_USER"];
const HELPER: &[&str] = &["READ_MEMBER", "KICK_USER", "MANAGE_CHANNEL_PERMISSIONS"];
const MEMBER: &[&str] = &["READ_MEMBER", "CREATE_MESSAGE"];

fn member_role() -> Value {
    let mut role = role_json("member", 100, MEMBER);
    role["name"] = json!("Member");
    role
}

fn roles() -> Vec<Value> {
    vec![
        role_json("admin", 10, ALL),
        role_json("lead", 15, LEAD),
        role_json("moderator", 20, MODERATOR),
        role_json("helper", 30, HELPER),
        member_role(),
    ]
}

fn script(rig: &Rig, mine: &[Value]) {
    rig.backend
        .w5b
        .answer("my_roles comm", user_roles_json(ME, COMMUNITY, mine));
    rig.backend.w5b.answer(
        "roles comm",
        json!({ "communityId": COMMUNITY, "roles": roles() }),
    );
}

fn script_member(rig: &Rig, user: &str, held: &[Value]) {
    rig.backend.w5b.answer(
        &format!("user_roles comm {user}"),
        user_roles_json(user, COMMUNITY, held),
    );
    rig.backend.w5b.answer(
        &format!("timeout_status comm {user}"),
        json!({ "isTimedOut": false }),
    );
}

async fn owner_with(setup: impl FnOnce(&Rig)) -> Rig {
    let rig = Rig::with_media();
    let mut me = user_json(ME);
    me["role"] = json!("OWNER");
    rig.backend.w3.answer("profile", me);
    setup(&rig);
    rig.signed_in().await
}

async fn settled<T>(rig: &mut Rig, mut read: impl FnMut(&Rig) -> T) -> T {
    for _ in 0..3 {
        read(rig);
        rig.settle().await;
    }
    read(rig)
}

async fn rows_as(mine: Option<&[Value]>) -> Vec<RoleRow> {
    let mut rig = match mine {
        None => owner_with(|_| {}).await,
        Some(_) => Rig::new().signed_in().await,
    };
    script(&rig, mine.unwrap_or(&[]));
    settled(&mut rig, |rig| rig.core.roles(COMMUNITY.into()))
        .await
        .roles
}

type Flags = (
    &'static str,
    Option<RoleBlock>,
    Option<RoleBlock>,
    Option<RoleBlock>,
    bool,
    bool,
);

fn flags(rows: &[RoleRow]) -> Vec<Flags> {
    rows.iter()
        .map(|row| {
            (
                match row.id.as_str() {
                    "admin" => "admin",
                    "lead" => "lead",
                    "moderator" => "moderator",
                    "helper" => "helper",
                    _ => "member",
                },
                row.edit_blocked,
                row.delete_blocked,
                row.assign_blocked,
                row.can_move_up,
                row.can_move_down,
            )
        })
        .collect()
}

use RoleBlock::{DefaultRole, HoldsUngrantable, Missing, Rank};

#[tokio::test]
async fn role_rows_say_why_and_where_each_may_move_for_each_standing() {
    // The instance owner: everything, every move but off the ends; Member never moves.
    let rows = rows_as(None).await;
    assert_eq!(
        flags(&rows),
        [
            ("admin", None, None, None, false, true),
            ("lead", None, None, None, true, true),
            ("moderator", None, None, None, true, true),
            ("helper", None, None, None, true, false),
            ("member", None, Some(DefaultRole), None, false, false),
        ]
    );
    assert!(rows[4].fixed && !rows[0].fixed);
    assert_eq!(rows[0].created_at_ms, Some(1_790_100_000_000));

    // The top holder: any role, but nothing they don't hold may take the top.
    let rows = rows_as(Some(&[role_json("admin", 10, ALL)])).await;
    assert_eq!(
        flags(&rows),
        [
            ("admin", None, None, None, false, false),
            ("lead", None, None, None, false, true),
            ("moderator", None, None, None, true, true),
            ("helper", None, None, None, true, false),
            ("member", None, Some(DefaultRole), None, false, false),
        ]
    );

    // A mid rank (lead, 15): what is at or above it stays; below it, only what it can grant.
    let rows = rows_as(Some(&[role_json("lead", 15, LEAD)])).await;
    assert_eq!(
        flags(&rows),
        [
            ("admin", Some(Rank), Some(Rank), Some(Rank), false, false),
            ("lead", Some(Rank), Some(Rank), Some(Rank), false, false),
            // BAN_USER, which lead lacks (#690).
            (
                "moderator",
                Some(HoldsUngrantable),
                None,
                Some(HoldsUngrantable),
                false,
                true
            ),
            ("helper", None, None, None, true, false),
            ("member", None, Some(DefaultRole), None, false, false),
        ]
    );

    // Without UPDATE_ROLE, DELETE_ROLE or UPDATE_MEMBER: missing, and nothing moves.
    let rows = rows_as(Some(&[role_json("helper", 30, &["READ_ROLE"])])).await;
    assert!(rows.iter().all(|row| row.edit_blocked == Some(Missing)
        && row.delete_blocked == Some(Missing)
        && row.assign_blocked == Some(Missing)
        && !row.can_move_up
        && !row.can_move_down));
}

#[tokio::test]
async fn the_roles_list_says_not_allowed_apart_from_failed() {
    for (mine, can_read) in [
        (vec![role_json("lead", 15, LEAD)], true),
        (vec![member_role()], false),
        (vec![], false),
    ] {
        let mut rig = Rig::new().signed_in().await;
        script(&rig, &mine);
        let view = settled(&mut rig, |rig| rig.core.roles(COMMUNITY.into())).await;
        assert_eq!(view.can_read, can_read, "{mine:?}");
    }
    let mut rig = owner_with(|_| {}).await;
    script(&rig, &[]);
    assert!(
        settled(&mut rig, |rig| rig.core.roles(COMMUNITY.into()))
            .await
            .can_read
    );
}

// --- Saving a role ---

async fn patched(patch: RolePatch) -> (Result<(), String>, Vec<String>) {
    let mut rig = owner_with(|_| {}).await;
    script(&rig, &[]);
    settled(&mut rig, |rig| rig.core.roles(COMMUNITY.into())).await;
    rig.backend
        .w5b
        .answer("update_role", role_json("helper", 30, HELPER));
    let role = if patch.name.as_deref() == Some("Folks") {
        "member"
    } else {
        "helper"
    };
    let result = rig
        .core
        .update_role(COMMUNITY.into(), role.into(), patch)
        .await
        .map_err(|error| error.to_string());
    let sent = rig
        .backend
        .w5b
        .calls()
        .into_iter()
        .filter(|call| call.starts_with("update_role"))
        .collect();
    (result, sent)
}

#[tokio::test]
async fn a_patch_sends_only_what_changed() {
    let helper: Vec<String> = HELPER.iter().map(|a| (*a).to_owned()).collect();
    let cases: Vec<(RolePatch, Result<(), ()>, Vec<&str>)> = vec![
        (
            RolePatch::default(),
            Ok(()),
            vec!["update_role comm helper {}"],
        ),
        (
            RolePatch {
                name: Some("helper name".into()),
                actions: Some(helper.clone()),
            },
            Ok(()),
            vec!["update_role comm helper {}"],
        ),
        (
            RolePatch {
                name: Some("  Helpers  ".into()),
                actions: None,
            },
            Ok(()),
            vec!["update_role comm helper {\"name\":\"Helpers\"}"],
        ),
        (
            RolePatch {
                name: None,
                actions: Some(vec!["KICK_USER".into(), "LATER_ACTION".into()]),
            },
            Ok(()),
            vec!["update_role comm helper {\"actions\":[\"KICK_USER\",\"LATER_ACTION\"]}"],
        ),
        // A default role's name never goes.
        (
            RolePatch {
                name: Some("Folks".into()),
                actions: None,
            },
            Ok(()),
            vec!["update_role comm member {}"],
        ),
        // Refused before any request.
        (
            RolePatch {
                name: None,
                actions: Some(vec![]),
            },
            Err(()),
            vec![],
        ),
        (
            RolePatch {
                name: Some(" ".into()),
                actions: None,
            },
            Err(()),
            vec![],
        ),
        (
            RolePatch {
                name: Some("x".repeat(51)),
                actions: None,
            },
            Err(()),
            vec![],
        ),
    ];
    for (patch, ok, sent) in cases {
        let what = format!("{patch:?}");
        let (result, calls) = patched(patch).await;
        assert_eq!(result.is_ok(), ok.is_ok(), "{what}: {result:?}");
        assert_eq!(calls, sent, "{what}");
    }
}

#[tokio::test]
async fn a_new_role_needs_an_action() {
    let rig = owner_with(|_| {}).await;
    script(&rig, &[]);
    let result = rig
        .core
        .create_role(
            COMMUNITY.into(),
            RoleDraft {
                name: "Empty".into(),
                actions: vec![],
            },
        )
        .await;
    assert!(result.is_err());
    assert_eq!(rig.backend.w5b.count("create_role"), 0);
    // The refusal shows on the view, on that action.
    let op = rig.core.roles(COMMUNITY.into()).op;
    assert_eq!(op.actions.len(), 1);
    assert_eq!(op.actions[0].action.kind, AdminActionKind::CreateRole);
    assert!(op.actions[0].error.is_some());
}

// --- Reasons ---

#[tokio::test]
async fn the_member_dialog_says_why_it_is_closed() {
    type Case<'a> = (Vec<Value>, &'a str, Vec<Value>, Option<NotAllowed>);
    let cases: Vec<Case> = vec![
        (
            vec![role_json("lead", 15, LEAD)],
            BOB,
            vec![member_role()],
            None,
        ),
        (
            vec![role_json("lead", 15, LEAD)],
            BOB,
            vec![role_json("admin", 10, ALL)],
            Some(NotAllowed::Rank),
        ),
        (
            vec![role_json("lead", 15, LEAD)],
            BOB,
            vec![role_json("lead", 15, LEAD)],
            Some(NotAllowed::Rank),
        ),
        (vec![member_role()], BOB, vec![], Some(NotAllowed::Missing)),
        // Their own roles: allowed whatever the rank.
        (vec![role_json("lead", 15, LEAD)], ME, vec![], None),
        // The top holder may change a peer's.
        (
            vec![role_json("admin", 10, ALL)],
            BOB,
            vec![role_json("admin", 10, ALL)],
            None,
        ),
    ];
    for (mine, user, theirs, expected) in cases {
        let mut rig = Rig::new().signed_in().await;
        script(&rig, &mine);
        script_member(&rig, user, &theirs);
        let view = settled(&mut rig, |rig| {
            rig.core.member_roles(COMMUNITY.into(), user.into())
        })
        .await;
        assert_eq!(view.not_allowed, expected, "{mine:?} -> {user} {theirs:?}");
        assert_eq!(view.changeable.is_empty(), expected.is_some(), "{user}");
    }
}

#[tokio::test]
async fn each_moderation_action_says_why_on_its_own() {
    type Row = (
        Option<NotAllowed>,
        Option<NotAllowed>,
        Option<NotAllowed>,
        Option<NotAllowed>,
    );
    let cases: Vec<(Vec<Value>, Vec<Value>, Row)> = vec![
        // Lead (15: kick, timeout, roles; no ban) over a member.
        (
            vec![role_json("lead", 15, LEAD)],
            vec![member_role()],
            (Some(NotAllowed::Missing), None, None, None),
        ),
        // Over the top: rank for what they hold, missing for what they don't.
        (
            vec![role_json("lead", 15, LEAD)],
            vec![role_json("admin", 10, ALL)],
            (
                Some(NotAllowed::Missing),
                Some(NotAllowed::Rank),
                Some(NotAllowed::Rank),
                Some(NotAllowed::Rank),
            ),
        ),
        // A peer.
        (
            vec![role_json("lead", 15, LEAD)],
            vec![role_json("lead", 15, LEAD)],
            (
                Some(NotAllowed::Missing),
                Some(NotAllowed::Rank),
                Some(NotAllowed::Rank),
                Some(NotAllowed::Rank),
            ),
        ),
        // Someone with no role ranks below everyone.
        (
            vec![role_json("moderator", 20, MODERATOR)],
            vec![],
            (
                None,
                None,
                Some(NotAllowed::Missing),
                Some(NotAllowed::Missing),
            ),
        ),
    ];
    for (mine, theirs, (ban, kick, timeout, roles)) in cases {
        let mut rig = Rig::new().signed_in().await;
        script(&rig, &mine);
        script_member(&rig, BOB, &theirs);
        let view = settled(&mut rig, |rig| {
            rig.core.moderation_target(COMMUNITY.into(), BOB.into())
        })
        .await;
        assert_eq!(view.state, LoadState::Ready);
        assert_eq!(
            (
                view.ban_not_allowed,
                view.kick_not_allowed,
                view.timeout_not_allowed,
                view.roles_not_allowed
            ),
            (ban, kick, timeout, roles),
            "{mine:?} over {theirs:?}"
        );
        assert_eq!(view.can_ban, ban.is_none());
        assert_eq!(view.can_kick, kick.is_none());
        assert_eq!(view.can_timeout, timeout.is_none());
        assert_eq!(view.can_change_roles, roles.is_none());
    }
    // Yourself: every one says so.
    let mut rig = Rig::new().signed_in().await;
    script(&rig, &[role_json("admin", 10, ALL)]);
    let me = settled(&mut rig, |rig| {
        rig.core.moderation_target(COMMUNITY.into(), ME.into())
    })
    .await;
    assert_eq!(me.ban_not_allowed, Some(NotAllowed::SelfTarget));
    assert_eq!(me.roles_not_allowed, Some(NotAllowed::SelfTarget));
}

// --- Per-action state ---

#[tokio::test]
async fn overlapping_moderation_actions_keep_their_own_state() {
    let mut rig = owner_with(|_| {}).await;
    script(&rig, &[]);
    script_member(&rig, BOB, &[]);
    script_member(&rig, PAT, &[]);
    let held = rig
        .backend
        .w5b
        .hold("ban comm 00000000-0000-4000-8000-0000000000b0");
    rig.backend.w5b.fail_next(
        &format!("timeout comm {BOB}"),
        refusal(403, "Cannot timeout a user with equal or higher role"),
    );
    let core = rig.core.clone();
    let ban = tokio::spawn(async move {
        core.ban_member(
            COMMUNITY.into(),
            BOB.into(),
            BanRequest {
                reason: None,
                duration: BanDuration::Permanent,
            },
        )
        .await
    });
    for _ in 0..1000 {
        if rig.backend.w5b.count("ban") == 1 {
            break;
        }
        tokio::task::yield_now().await;
    }
    // While the ban is out, a timeout of the same member fails.
    let refused = rig
        .core
        .timeout_member(
            COMMUNITY.into(),
            BOB.into(),
            TimeoutRequest {
                seconds: 60,
                reason: None,
            },
        )
        .await;
    assert!(refused.is_err());
    let op = rig.core.moderation_target(COMMUNITY.into(), BOB.into()).op;
    let states: Vec<(AdminActionKind, bool, bool)> = op
        .actions
        .iter()
        .map(|state| (state.action.kind, state.busy, state.error.is_some()))
        .collect();
    assert_eq!(
        states,
        [
            (AdminActionKind::Ban, true, false),
            (AdminActionKind::Timeout, false, true),
        ]
    );
    assert!(op.busy);
    assert_eq!(
        op.actions[1].error.as_ref().unwrap().message,
        "Cannot timeout a user with equal or higher role"
    );
    // Another member's menu shows none of it.
    assert!(
        rig.core
            .moderation_target(COMMUNITY.into(), PAT.into())
            .op
            .actions
            .is_empty()
    );
    held.send(()).unwrap();
    ban.await.unwrap().unwrap();
    let op = rig.core.moderation_target(COMMUNITY.into(), BOB.into()).op;
    assert_eq!(
        op.actions.len(),
        1,
        "the ban that landed leaves; the failure stays"
    );
    assert_eq!(op.actions[0].action.kind, AdminActionKind::Timeout);
    assert!(!op.busy);

    // Lifting a timeout shows on the list's row and on the menu.
    rig.backend.w5b.fail_next(
        "remove_timeout",
        refusal(403, "Cannot lift a timeout set by a higher role"),
    );
    assert!(
        rig.core
            .remove_timeout(COMMUNITY.into(), PAT.into(), None)
            .await
            .is_err()
    );
    let list = rig.core.timeouts(COMMUNITY.into()).op;
    assert_eq!(list.actions[0].action.kind, AdminActionKind::RemoveTimeout);
    assert_eq!(list.actions[0].action.target_id.as_deref(), Some(PAT));
    let menu = rig.core.moderation_target(COMMUNITY.into(), PAT.into()).op;
    assert_eq!(menu.actions[0].action.kind, AdminActionKind::RemoveTimeout);
    rig.settle().await;

    // Kick and unban have theirs too.
    rig.backend
        .w5b
        .fail_next("unban", refusal(404, "User is not banned"));
    assert!(
        rig.core
            .unban_member(COMMUNITY.into(), PAT.into(), None)
            .await
            .is_err()
    );
    assert_eq!(
        rig.core.bans(COMMUNITY.into()).op.actions[0].action.kind,
        AdminActionKind::Unban
    );
}

#[tokio::test]
async fn role_changes_keep_their_own_state_per_role() {
    let mut rig = owner_with(|_| {}).await;
    script(&rig, &[]);
    settled(&mut rig, |rig| rig.core.roles(COMMUNITY.into())).await;
    rig.backend
        .w5b
        .fail_next("delete_role comm helper", refusal(403, "nope"));
    assert!(
        rig.core
            .delete_role(COMMUNITY.into(), "helper".into())
            .await
            .is_err()
    );
    rig.backend
        .w5b
        .answer("update_role", role_json("lead", 15, LEAD));
    rig.core
        .update_role(
            COMMUNITY.into(),
            "lead".into(),
            RolePatch {
                name: Some("Leads".into()),
                actions: None,
            },
        )
        .await
        .unwrap();
    let op = rig.core.roles(COMMUNITY.into()).op;
    let states: Vec<(AdminActionKind, Option<&str>)> = op
        .actions
        .iter()
        .map(|state| (state.action.kind, state.action.target_id.as_deref()))
        .collect();
    assert_eq!(states, [(AdminActionKind::DeleteRole, Some("helper"))]);
    // Assignment is on the member's dialog, by role.
    script_member(&rig, BOB, &[]);
    rig.backend.w5b.fail_next("assign", refusal(403, "nope"));
    assert!(
        rig.core
            .assign_role(
                COMMUNITY.into(),
                BOB.into(),
                "00000000-0000-4000-8000-0000000000aa".into()
            )
            .await
            .is_err()
    );
    let op = rig.core.member_roles(COMMUNITY.into(), BOB.into()).op;
    assert_eq!(op.actions[0].action.kind, AdminActionKind::AssignRole);
    assert_eq!(
        op.actions[0].action.target_id.as_deref(),
        Some("00000000-0000-4000-8000-0000000000aa")
    );
}

// --- The overrides editor ---

fn channel_rig_setup(rig: &Rig) {
    rig.backend.channels.lock().unwrap().push(json!({
        "id": CHANNEL, "name": "general", "communityId": COMMUNITY, "type": "TEXT", "position": 0,
        "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    }));
}

#[tokio::test]
async fn the_overrides_editor_knows_the_roles_the_preset_and_what_is_missing() {
    let rig = Rig::new();
    channel_rig_setup(&rig);
    let mut rig = rig.signed_in().await;
    script(&rig, &[role_json("lead", 15, LEAD)]);
    rig.backend.w5b.answer(
        "overwrites chan",
        json!({ "channelId": CHANNEL, "preset": "ANNOUNCEMENT", "overwrites": [
            { "targetType": "EVERYONE", "roleId": null, "allow": [], "deny": ["CREATE_MESSAGE", "ATTACH_FILES"] },
            { "targetType": "ROLE", "roleId": "helper", "allow": ["CREATE_MESSAGE", "ATTACH_FILES"], "deny": [] },
            { "targetType": "ROLE", "roleId": "gone", "allow": ["CREATE_MESSAGE"], "deny": [] },
        ] }),
    );
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    let view = settled(&mut rig, |rig| rig.core.channel_overwrites(CHANNEL.into())).await;
    let below: Vec<(&str, bool)> = view
        .roles
        .iter()
        .map(|role| (role.id.as_str(), role.below_me))
        .collect();
    assert_eq!(
        below,
        [
            ("admin", false),
            ("lead", false),
            ("moderator", true),
            ("helper", true),
            ("member", true)
        ]
    );
    assert_eq!(
        view.overwrites
            .iter()
            .map(|row| row.role_missing)
            .collect::<Vec<_>>(),
        [false, false, true]
    );
    assert_eq!(view.detected.preset, ChannelPreset::Announcement);
    assert_eq!(view.detected.post_role_ids, ["helper"]);
    let missing: Vec<(ChannelPreset, Vec<String>)> = view
        .preset_access
        .iter()
        .map(|access| (access.preset, access.missing.clone()))
        .collect();
    assert_eq!(
        missing,
        [
            (ChannelPreset::Normal, vec![]),
            (ChannelPreset::ReadOnly, vec!["CREATE_REACTION".to_owned()]),
            (ChannelPreset::Announcement, vec![]),
        ]
    );
    // Below lead and holding MANAGE_CHANNEL_PERMISSIONS: helper only.
    assert_eq!(view.default_post_role_ids, ["helper"]);

    // A per-member row makes the set custom.
    let mut rig = owner_with(channel_rig_setup).await;
    script(&rig, &[]);
    rig.backend.w5b.answer(
        "overwrites chan",
        json!({ "channelId": CHANNEL, "preset": "CUSTOM", "overwrites": [
            { "targetType": "MEMBER", "roleId": null, "allow": [], "deny": ["VIDEO"] },
        ] }),
    );
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    let view = settled(&mut rig, |rig| rig.core.channel_overwrites(CHANNEL.into())).await;
    assert_eq!(view.detected.preset, ChannelPreset::Custom);
    assert!(view.overwrites.is_empty());
    assert!(
        view.preset_access
            .iter()
            .all(|access| access.missing.is_empty())
    );
}

#[tokio::test]
async fn build_preset_uses_the_communitys_roles_and_my_rank() {
    let rig = Rig::new();
    channel_rig_setup(&rig);
    let mut rig = rig.signed_in().await;
    script(&rig, &[role_json("lead", 15, LEAD)]);
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    settled(&mut rig, |rig| rig.core.roles(COMMUNITY.into())).await;
    let built = rig.core.build_preset(
        CHANNEL.into(),
        ChannelPreset::Announcement,
        vec!["helper".into()],
        true,
    );
    // Admin (above) and lead (my own) keep posting automatically; helper is the chosen poster.
    assert_eq!(built.auto_allowed_role_ids, ["admin", "lead"]);
    let ids: Vec<Option<&str>> = built
        .overwrites
        .iter()
        .map(|row| match &row.target {
            OverwriteTarget::Everyone => None,
            OverwriteTarget::Role { role_id, .. } => Some(role_id.as_str()),
        })
        .collect();
    assert_eq!(ids, [None, Some("admin"), Some("lead"), Some("helper")]);
}

// --- The preset port: the shared package's own cases ---

fn strs(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

fn role(id: &str, name: &str, position: i64, actions: &[&str]) -> Role {
    Role {
        id: id.into(),
        name: name.into(),
        position,
        actions: strs(actions),
    }
}

fn shared_roles() -> Vec<Role> {
    vec![
        role(
            "admin",
            "Community Admin",
            10,
            &[
                "CREATE_MESSAGE",
                "ATTACH_FILES",
                "CREATE_REACTION",
                "MANAGE_CHANNEL_PERMISSIONS",
            ],
        ),
        role(
            "mod",
            "Moderator",
            20,
            &[
                "CREATE_MESSAGE",
                "ATTACH_FILES",
                "CREATE_REACTION",
                "MANAGE_CHANNEL_PERMISSIONS",
            ],
        ),
        role("poster", "Poster", 40, &["CREATE_MESSAGE"]),
        role(
            "member",
            "Member",
            100,
            &["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"],
        ),
    ]
}

fn everyone(deny: &[&str]) -> OverwriteRow {
    OverwriteRow {
        target: OverwriteTarget::Everyone,
        allow: vec![],
        deny: strs(deny),
        role_missing: false,
    }
}

fn role_row(id: &str, name: &str, allow: &[&str]) -> OverwriteRow {
    OverwriteRow {
        target: OverwriteTarget::Role {
            role_id: id.into(),
            name: name.into(),
        },
        allow: strs(allow),
        deny: vec![],
        role_missing: false,
    }
}

#[test]
fn normal_writes_nothing_or_a_files_deny() {
    let roles = shared_roles();
    assert!(
        presets::build(ChannelPreset::Normal, &[], true, &roles, None)
            .overwrites
            .is_empty()
    );
    assert_eq!(
        presets::build(ChannelPreset::Normal, &[], false, &roles, None).overwrites,
        [everyone(&["ATTACH_FILES"])]
    );
}

#[test]
fn read_only_denies_posting_files_and_reactions_and_post_roles_get_them_back() {
    let built = presets::build(
        ChannelPreset::ReadOnly,
        &strs(&["poster"]),
        true,
        &shared_roles(),
        None,
    );
    assert_eq!(
        built.overwrites,
        [
            everyone(&["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"]),
            role_row(
                "poster",
                "Poster",
                &["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"]
            ),
        ]
    );
    assert!(built.auto_allowed_role_ids.is_empty());
}

#[test]
fn announcement_keeps_reactions() {
    let built = presets::build(
        ChannelPreset::Announcement,
        &[],
        true,
        &shared_roles(),
        None,
    );
    assert_eq!(built.overwrites[0].deny, ["CREATE_MESSAGE", "ATTACH_FILES"]);
}

#[test]
fn a_moderator_keeps_the_roles_above_them() {
    let built = presets::build(
        ChannelPreset::Announcement,
        &strs(&["mod"]),
        true,
        &shared_roles(),
        Some(20),
    );
    assert_eq!(built.auto_allowed_role_ids, ["admin"]);
    assert_eq!(
        built.overwrites,
        [
            everyone(&["CREATE_MESSAGE", "ATTACH_FILES"]),
            role_row(
                "admin",
                "Community Admin",
                &["CREATE_MESSAGE", "ATTACH_FILES"]
            ),
            role_row("mod", "Moderator", &["CREATE_MESSAGE", "ATTACH_FILES"]),
        ]
    );
}

#[test]
fn automatic_allows_cover_only_what_the_higher_role_holds() {
    let built = presets::build(
        ChannelPreset::ReadOnly,
        &[],
        true,
        &shared_roles(),
        Some(60),
    );
    let poster = built
        .overwrites
        .iter()
        .find(|row| matches!(&row.target, OverwriteTarget::Role { role_id, .. } if role_id == "poster"))
        .unwrap();
    assert_eq!(poster.allow, ["CREATE_MESSAGE"]);
    assert!(!built.overwrites.iter().any(
        |row| matches!(&row.target, OverwriteTarget::Role { role_id, .. } if role_id == "member")
    ));
}

#[test]
fn a_chosen_post_role_is_not_automatic_but_my_own_rank_is() {
    let built = presets::build(
        ChannelPreset::Announcement,
        &strs(&["admin"]),
        true,
        &shared_roles(),
        Some(20),
    );
    assert_eq!(built.auto_allowed_role_ids, ["mod"]);
}

#[test]
fn anything_else_is_custom() {
    let cases: Vec<(&str, Vec<OverwriteRow>)> = vec![
        (
            "a role deny",
            vec![OverwriteRow {
                deny: strs(&["CREATE_MESSAGE"]),
                ..role_row("x", "x", &[])
            }],
        ),
        (
            "an @everyone allow",
            vec![OverwriteRow {
                allow: strs(&["CREATE_MESSAGE"]),
                ..everyone(&[])
            }],
        ),
        ("an unknown deny set", vec![everyone(&["VIDEO"])]),
        (
            "a role allow outside the preset",
            vec![
                everyone(&["CREATE_MESSAGE", "ATTACH_FILES"]),
                role_row("x", "x", &["VIDEO"]),
            ],
        ),
        (
            "two @everyone rows",
            vec![everyone(&["ATTACH_FILES"]), everyone(&["ATTACH_FILES"])],
        ),
        (
            "an empty role allow in a read-only set",
            vec![
                everyone(&["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"]),
                role_row("x", "x", &[]),
            ],
        ),
        (
            "a normal files deny with a posting allow",
            vec![
                everyone(&["ATTACH_FILES"]),
                role_row("x", "x", &["CREATE_MESSAGE"]),
            ],
        ),
    ];
    for (name, rows) in cases {
        assert_eq!(
            presets::detect(&rows).preset,
            ChannelPreset::Custom,
            "{name}"
        );
    }
    // None at all is Normal, with files.
    let none = presets::detect(&[]);
    assert_eq!(
        (none.preset, none.members_can_attach),
        (ChannelPreset::Normal, true)
    );
}

/// detect(build(p)) == p, for every preset, every set of posters, files on and off, and every
/// actor rank (the owner, each role's, below all). Automatic allows of the full set read back as
/// posters, as the shared package's own round-trip test has it.
#[test]
fn every_built_preset_is_detected_as_itself() {
    let roles = shared_roles();
    let ids: Vec<String> = roles.iter().map(|role| role.id.clone()).collect();
    let mut checked = 0;
    for preset in [
        ChannelPreset::Normal,
        ChannelPreset::ReadOnly,
        ChannelPreset::Announcement,
    ] {
        for mask in 0..(1u32 << ids.len()) {
            let posters: Vec<String> = ids
                .iter()
                .enumerate()
                .filter(|(i, _)| mask & (1 << i) != 0)
                .map(|(_, id)| id.clone())
                .collect();
            for attach in [true, false] {
                for actor in [
                    None,
                    Some(10),
                    Some(20),
                    Some(40),
                    Some(100),
                    Some(i64::MAX),
                ] {
                    let built = presets::build(preset, &posters, attach, &roles, actor);
                    let detected = presets::detect(&built.overwrites);
                    assert_eq!(
                        detected.preset, preset,
                        "{preset:?} {posters:?} {attach} {actor:?}"
                    );
                    let full = built.overwrites.first().map_or(0, |row| row.deny.len());
                    let mut expected: Vec<String> = if preset == ChannelPreset::Normal {
                        vec![]
                    } else {
                        posters
                            .iter()
                            .cloned()
                            .chain(built.auto_allowed_role_ids.iter().filter(|id| {
                                built.overwrites.iter().any(|row| {
                                    matches!(&row.target, OverwriteTarget::Role { role_id, .. } if role_id == *id)
                                        && row.allow.len() == full
                                })
                            }).cloned())
                            .collect()
                    };
                    expected.sort();
                    expected.dedup();
                    let mut got = detected.post_role_ids.clone();
                    got.sort();
                    assert_eq!(got, expected, "{preset:?} {posters:?} {attach} {actor:?}");
                    if preset == ChannelPreset::Normal {
                        assert_eq!(detected.members_can_attach, attach);
                    }
                    checked += 1;
                }
            }
        }
    }
    assert_eq!(checked, 3 * 16 * 2 * 6);
}

#[test]
fn presets_that_dont_build_give_nothing() {
    for preset in [
        ChannelPreset::ModsOnly,
        ChannelPreset::Custom,
        ChannelPreset::Unknown,
    ] {
        let built = presets::build(preset, &strs(&["mod"]), false, &shared_roles(), Some(20));
        assert!(built.overwrites.is_empty(), "{preset:?}");
    }
}

// --- The log ---

#[tokio::test]
async fn a_log_entry_names_its_message_when_the_server_does() {
    let mut rig = owner_with(|_| {}).await;
    script(&rig, &[]);
    rig.backend.w5b.answer(
        "logs",
        json!({ "total": 2, "logs": [
            { "id": "l1", "communityId": COMMUNITY, "moderatorId": ME, "targetUserId": null,
              "action": "DELETE_MESSAGE", "reason": null, "metadata": { "messageId": "m1" },
              "createdAt": "2026-09-22T18:00:00Z", "moderator": null, "targetUser": null },
            { "id": "l2", "communityId": COMMUNITY, "moderatorId": ME, "targetUserId": BOB,
              "action": "KICK_USER", "reason": null, "metadata": null,
              "createdAt": "2026-09-22T17:00:00Z", "moderator": null, "targetUser": null },
        ] }),
    );
    let log = settled(&mut rig, |rig| rig.core.moderation_log(COMMUNITY.into())).await;
    let ids: Vec<Option<&str>> = log
        .rows
        .iter()
        .map(|row| row.target_message_id.as_deref())
        .collect();
    assert_eq!(ids, [Some("m1"), None]);
}
