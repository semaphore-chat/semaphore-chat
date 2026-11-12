//! W6-B: the users list and one user, against `FakeBackend` (`common/w6_users.rs`). The row's
//! actions, paging, the filters reaching the request, a change that shows at once and goes back,
//! a refusal before sending, and an answer for an ended session.

mod common;

use common::w6_users::*;
use common::*;
use semaphore_core::QueryKey;
use semaphore_core::backend::BackendError;
use semaphore_core::commands::instance_admin::users::{Actor, Target, keys, user_actions};
use semaphore_core::commands::instance_admin::{Authority, caps_from};
use semaphore_core::model::{
    AdminActionKind, AdminNotAllowed, AdminUserActions, AdminUserQuery, AdminUsersView,
    INSTANCE_ADMIN_ACTIONS, LoadState,
};
use semaphore_core::platform::CoreError;
use semaphore_wire::enums::ErrorCode;
use serde_json::json;

const ZARA: &str = "00000000-0000-4000-8000-0000000000b3";
const KAI: &str = "00000000-0000-4000-8000-0000000000b4";

fn error(status: u16, code: &str) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown(code.into()),
        message: format!("{code} from the server"),
        retryable: false,
        retry_after_ms: None,
    }
}

/// Signed in as the instance owner.
async fn owner() -> Rig {
    let rig = Rig::new();
    let mut me = user_json(ME);
    me["role"] = json!("OWNER");
    rig.backend.w3.answer("profile", me);
    rig.signed_in().await
}

/// Signed in as a plain user holding these instance actions.
async fn with_actions(actions: &[&str]) -> Rig {
    let rig = Rig::new();
    rig.backend.w3.answer("profile", user_json(ME));
    rig.backend
        .w3
        .answer("instance_roles", instance_roles_json(actions));
    let mut rig = rig.signed_in().await;
    rig.core.instance_permissions();
    rig.settle().await;
    rig
}

fn ids(view: &AdminUsersView) -> Vec<&str> {
    view.rows.iter().map(|row| row.user.id.as_str()).collect()
}

fn listed_users(rig: &Rig, query: &AdminUserQuery) -> AdminUsersView {
    rig.core.admin_users(query.clone())
}

fn message(result: Result<(), CoreError>) -> String {
    match result {
        Err(CoreError::Failed { message }) => message,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

fn actor(owner: bool, held: &[&str]) -> Actor {
    let mut held_actions: Vec<String> = held.iter().map(|action| (*action).to_owned()).collect();
    held_actions.sort();
    let full = INSTANCE_ADMIN_ACTIONS
        .iter()
        .all(|action| held_actions.iter().any(|held| held == action));
    let authority = Authority {
        owner,
        full,
        held: held_actions.clone(),
    };
    Actor {
        id: ME.into(),
        caps: caps_from(&authority),
        held: held_actions,
    }
}

fn target(id: &str, is_owner: bool, actions: Option<&[&str]>) -> Target {
    Target {
        id: id.into(),
        is_owner,
        banned: false,
        actions: actions.map(|actions| actions.iter().map(|a| (*a).to_owned()).collect()),
    }
}

fn allowed() -> AdminUserActions {
    AdminUserActions::default()
}

#[test]
fn user_actions_table() {
    // The owner everything on someone else.
    let owner_actor = actor(true, &[]);
    let other = target(PRIYA, false, None);
    assert_eq!(user_actions(&owner_actor, &other), allowed());
    // The owner never acts on themselves by ban or delete; both actions on their own role stay.
    assert_eq!(
        user_actions(&owner_actor, &target(ME, true, None)),
        AdminUserActions {
            ban: Some(AdminNotAllowed::Myself),
            unban: Some(AdminNotAllowed::Myself),
            delete: Some(AdminNotAllowed::Myself),
            ..allowed()
        }
    );
    // Full authority stops at an instance owner, and only an owner grants the role.
    let full_actor = actor(false, &INSTANCE_ADMIN_ACTIONS);
    assert_eq!(
        user_actions(&full_actor, &target(PRIYA, true, None)),
        AdminUserActions {
            ban: Some(AdminNotAllowed::Owner),
            unban: Some(AdminNotAllowed::Owner),
            delete: Some(AdminNotAllowed::Owner),
            reset_password: Some(AdminNotAllowed::Owner),
            set_owner: Some(AdminNotAllowed::OnlyOwner),
            ..allowed()
        }
    );
    // Below full authority: only actions I hold, on users holding only what I hold.
    let partial = actor(false, &["READ_USER", "UPDATE_USER", "BAN_USER"]);
    assert_eq!(
        user_actions(&partial, &target(PRIYA, false, Some(&["READ_USER"]))),
        AdminUserActions {
            delete: Some(AdminNotAllowed::NoPermission),
            set_owner: Some(AdminNotAllowed::OnlyOwner),
            set_quota: Some(AdminNotAllowed::NoPermission),
            ..allowed()
        }
    );
    assert_eq!(
        user_actions(
            &partial,
            &target(PRIYA, false, Some(&["READ_USER", "DELETE_USER"]))
        ),
        AdminUserActions {
            ban: Some(AdminNotAllowed::Rank),
            unban: Some(AdminNotAllowed::Rank),
            delete: Some(AdminNotAllowed::NoPermission),
            reset_password: Some(AdminNotAllowed::Rank),
            set_owner: Some(AdminNotAllowed::OnlyOwner),
            set_quota: Some(AdminNotAllowed::NoPermission),
            ..allowed()
        }
    );
    // Unknown target actions never block.
    assert_eq!(
        user_actions(&partial, &target(PRIYA, false, None)),
        AdminUserActions {
            delete: Some(AdminNotAllowed::NoPermission),
            set_owner: Some(AdminNotAllowed::OnlyOwner),
            set_quota: Some(AdminNotAllowed::NoPermission),
            ..allowed()
        }
    );
    // No permission at all.
    let nobody = actor(false, &[]);
    assert_eq!(
        user_actions(&nobody, &other),
        AdminUserActions {
            ban: Some(AdminNotAllowed::NoPermission),
            unban: Some(AdminNotAllowed::NoPermission),
            delete: Some(AdminNotAllowed::NoPermission),
            reset_password: Some(AdminNotAllowed::NoPermission),
            set_owner: Some(AdminNotAllowed::NoPermission),
            edit_roles: Some(AdminNotAllowed::NoPermission),
            set_quota: Some(AdminNotAllowed::NoPermission),
        }
    );
    // Full authority never ranks, even against actions it could not hold.
    assert_eq!(
        user_actions(
            &full_actor,
            &target(PRIYA, false, Some(&["SOME_NEW_ACTION"]))
        ),
        AdminUserActions {
            set_owner: Some(AdminNotAllowed::OnlyOwner),
            ..allowed()
        }
    );
    // The last owner is the server's to refuse: nothing here says it.
    for actions in [
        user_actions(&owner_actor, &target(ME, true, None)),
        user_actions(&full_actor, &target(PRIYA, true, None)),
        user_actions(&partial, &other),
        user_actions(&nobody, &other),
    ] {
        for action in [
            actions.ban,
            actions.unban,
            actions.delete,
            actions.reset_password,
            actions.set_owner,
            actions.edit_roles,
            actions.set_quota,
        ] {
            assert_ne!(action, Some(AdminNotAllowed::LastOwner));
        }
    }
}

#[tokio::test]
async fn paging_table() {
    let mut rig = owner().await;
    let calls = |rig: &Rig| rig.backend.w4.count("w6b_users");

    // A first page with no token has nothing more, and asks for nothing more.
    let plain = AdminUserQuery::default();
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![
                admin_user_json(PRIYA, "pri", "USER", false),
                admin_user_json(MARCUS, "marcus", "USER", false),
            ],
            None,
        ),
    );
    assert_eq!(
        listed_users(&rig, &plain).state,
        LoadState::Loading,
        "the first read asks"
    );
    rig.settle().await;
    let view = listed_users(&rig, &plain);
    assert_eq!(ids(&view), [PRIYA, MARCUS]);
    assert!(!view.more && !view.loading_more);
    assert_eq!(calls(&rig), 1);
    rig.core.load_more_admin_users(plain.clone()).await.unwrap();
    assert_eq!(calls(&rig), 1, "nothing more to read");

    // Two pages, appended in order.
    let banned = AdminUserQuery {
        banned: Some(true),
        ..AdminUserQuery::default()
    };
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![admin_user_json(ZARA, "zara", "USER", true)],
            Some(ZARA),
        ),
    );
    listed_users(&rig, &banned);
    rig.settle().await;
    assert!(listed_users(&rig, &banned).more);
    assert_eq!(calls(&rig), 2, "a different query is its own list");
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![
                admin_user_json(KAI, "kai", "USER", true),
                admin_user_json(MARCUS, "marcus", "USER", true),
            ],
            None,
        ),
    );
    rig.core
        .load_more_admin_users(banned.clone())
        .await
        .unwrap();
    let view = listed_users(&rig, &banned);
    assert_eq!(ids(&view), [ZARA, KAI, MARCUS]);
    assert!(!view.more && !view.loading_more);
    // The first list keeps its own rows.
    assert_eq!(ids(&listed_users(&rig, &plain)), [PRIYA, MARCUS]);

    // A page that repeats an id keeps it once.
    let owners = AdminUserQuery {
        owners: Some(true),
        ..AdminUserQuery::default()
    };
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![admin_user_json(ZARA, "zara", "USER", false)],
            Some(ZARA),
        ),
    );
    listed_users(&rig, &owners);
    rig.settle().await;
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![
                admin_user_json(ZARA, "zara", "USER", false),
                admin_user_json(KAI, "kai", "USER", false),
            ],
            None,
        ),
    );
    rig.core
        .load_more_admin_users(owners.clone())
        .await
        .unwrap();
    assert_eq!(
        ids(&listed_users(&rig, &owners)),
        [ZARA, KAI],
        "the repeat is kept once"
    );

    // A second request while one is on its way asks for nothing.
    let held = AdminUserQuery {
        search: "held".into(),
        ..AdminUserQuery::default()
    };
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![admin_user_json(ZARA, "zara", "USER", false)],
            Some(ZARA),
        ),
    );
    listed_users(&rig, &held);
    rig.settle().await;
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![
                admin_user_json(ZARA, "zara", "USER", false),
                admin_user_json(KAI, "kai", "USER", false),
            ],
            None,
        ),
    );
    let before = calls(&rig);
    let hold = rig.backend.w4.hold("w6b_users");
    let (first, second, ()) = tokio::join!(
        rig.core.load_more_admin_users(held.clone()),
        rig.core.load_more_admin_users(held.clone()),
        async {
            tokio::task::yield_now().await;
            assert!(
                listed_users(&rig, &held).loading_more,
                "a page is on its way"
            );
            hold.send(()).unwrap();
        }
    );
    first.unwrap();
    second.unwrap();
    assert_eq!(calls(&rig) - before, 1, "one page for two requests");
    assert_eq!(ids(&listed_users(&rig, &held)), [ZARA, KAI]);

    // A page that fails leaves the rows and `more` as they were.
    let failing = AdminUserQuery {
        search: "failing".into(),
        ..AdminUserQuery::default()
    };
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![admin_user_json(ZARA, "zara", "USER", false)],
            Some(ZARA),
        ),
    );
    listed_users(&rig, &failing);
    rig.settle().await;
    rig.backend
        .w4
        .fail_next("w6b_users", error(500, "INTERNAL"));
    assert!(
        rig.core
            .load_more_admin_users(failing.clone())
            .await
            .is_err()
    );
    let view = listed_users(&rig, &failing);
    assert_eq!(ids(&view), [ZARA]);
    assert!(view.more, "the token still says more follow");
    assert!(!view.loading_more, "the failure clears the flag");
}

#[tokio::test]
async fn the_list_maps_every_field() {
    let mut rig = owner().await;
    let mut user = admin_user_json(PRIYA, "pri", "USER", true);
    user["bannedAt"] = json!("2026-09-24T10:00:00Z");
    user["createdAt"] = json!("2026-08-01T09:30:00Z");
    user["lastSeen"] = json!("2026-09-23T01:04:00Z");
    user["storageUsedBytes"] = json!(-5);
    user["storageQuotaBytes"] = json!(-7);
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![user, admin_user_json(MARCUS, "marcus", "OWNER", false)],
            None,
        ),
    );
    rig.core.admin_users(AdminUserQuery::default());
    rig.settle().await;
    let view = rig.core.admin_users(AdminUserQuery::default());
    let row = &view.rows[0];
    assert_eq!(row.user.id, PRIYA);
    assert_eq!(row.user.username, "pri");
    assert_eq!(row.user.display_name.as_deref(), Some("pri display"));
    assert_eq!(
        row.user.avatar_file_id.as_deref(),
        Some(format!("avatar-{PRIYA}").as_str())
    );
    assert_eq!(row.email.as_deref(), Some("pri@example.invalid"));
    assert!(!row.is_owner);
    assert!(row.banned);
    let at = |text: &str| {
        chrono::DateTime::parse_from_rfc3339(text)
            .unwrap()
            .timestamp_millis()
    };
    assert_eq!(row.banned_at_ms, Some(at("2026-09-24T10:00:00Z")));
    assert_eq!(row.created_at_ms, at("2026-08-01T09:30:00Z"));
    assert_eq!(row.last_seen_ms, Some(at("2026-09-23T01:04:00Z")));
    assert_eq!(row.storage_used_bytes, 0, "negative reads as nothing used");
    assert_eq!(row.storage_quota_bytes, 0);
    // The owner may do everything to them.
    assert_eq!(row.actions, allowed());
    let owner_row = &view.rows[1];
    assert!(owner_row.is_owner);
    assert_eq!(
        owner_row.actions,
        AdminUserActions {
            ban: Some(AdminNotAllowed::Owner),
            unban: Some(AdminNotAllowed::Owner),
            delete: Some(AdminNotAllowed::Owner),
            ..allowed()
        }
    );
}

#[tokio::test]
async fn the_filters_reach_the_request() {
    let mut rig = owner().await;
    rig.backend
        .w4
        .answer("w6b_users", list_json(Vec::new(), None));
    for query in [
        AdminUserQuery {
            search: "pri".into(),
            banned: Some(true),
            owners: Some(true),
        },
        AdminUserQuery {
            owners: Some(false),
            ..AdminUserQuery::default()
        },
        AdminUserQuery::default(),
    ] {
        rig.core.admin_users(query);
        rig.settle().await;
    }
    let calls = rig.backend.w4.calls();
    assert!(
        calls.contains(&"w6b_users true OWNER pri 50 ".to_owned()),
        "{calls:?}"
    );
    assert!(
        calls.contains(&"w6b_users - USER  50 ".to_owned()),
        "{calls:?}"
    );
    assert!(
        calls.contains(&"w6b_users - -  50 ".to_owned()),
        "{calls:?}"
    );
}

fn banned_row(rig: &Rig, query: &AdminUserQuery, user_id: &str) -> bool {
    listed_users(rig, query)
        .rows
        .iter()
        .find(|row| row.user.id == user_id)
        .expect("the row is listed")
        .banned
}

#[tokio::test]
async fn ban_shows_at_once_and_goes_back_when_refused() {
    let mut rig = owner().await;
    let query = AdminUserQuery::default();
    rig.backend.w4.answer(
        "w6b_users",
        list_json(vec![admin_user_json(PRIYA, "pri", "USER", false)], None),
    );
    rig.core.admin_users(query.clone());
    rig.settle().await;

    // The server refuses after a while: the row says banned meanwhile, then goes back.
    rig.backend.w4.fail_next("w6b_ban", error(403, "FORBIDDEN"));
    let hold = rig.backend.w4.hold("w6b_ban");
    let ban = rig.core.ban_user(PRIYA.into());
    let (result, ()) = tokio::join!(ban, async {
        tokio::task::yield_now().await;
        assert!(banned_row(&rig, &query, PRIYA), "it shows at once");
        hold.send(()).unwrap();
    });
    assert!(result.is_err());
    assert!(!banned_row(&rig, &query, PRIYA), "a refusal puts it back");
    let view = rig.core.admin_user(PRIYA.into());
    let error = view.op.error.expect("the change's failure is on its view");
    assert_eq!(error.message, "FORBIDDEN from the server");
    assert!(
        view.op
            .actions
            .iter()
            .any(|state| state.action.kind == AdminActionKind::BanUser && state.error.is_some()),
        "{:?}",
        view.op.actions
    );

    // The server agrees: the answer replaces the row.
    rig.backend
        .w4
        .answer("w6b_ban", admin_user_json(PRIYA, "pri", "USER", true));
    rig.core.ban_user(PRIYA.into()).await.unwrap();
    assert!(banned_row(&rig, &query, PRIYA));
    assert_eq!(rig.backend.w4.count("w6b_ban"), 2);
}

#[tokio::test]
async fn a_refusal_before_sending_records_no_call() {
    // No permission.
    let rig = Rig::new().signed_in().await;
    let mut rig = rig;
    rig.core.instance_permissions();
    rig.settle().await;
    assert_eq!(
        message(rig.core.ban_user(PRIYA.into()).await),
        "You don't have permission to do that"
    );
    assert_eq!(
        message(rig.core.delete_user(PRIYA.into()).await),
        "You don't have permission to do that"
    );
    assert_eq!(rig.backend.w4.count("w6b_ban"), 0);
    assert_eq!(rig.backend.w4.count("w6b_delete"), 0);

    // That's me.
    let rig = owner().await;
    assert_eq!(message(rig.core.ban_user(ME.into()).await), "That's you");
    assert_eq!(message(rig.core.delete_user(ME.into()).await), "That's you");
    assert_eq!(rig.backend.w4.count("w6b_ban"), 0);

    // That's an instance owner.
    let mut rig = owner().await;
    rig.backend.w4.answer(
        "w6b_users",
        list_json(vec![admin_user_json(PRIYA, "pri", "OWNER", false)], None),
    );
    rig.core.admin_users(AdminUserQuery::default());
    rig.settle().await;
    assert_eq!(
        message(rig.core.unban_user(PRIYA.into()).await),
        "That's an instance owner"
    );
    assert_eq!(rig.backend.w4.count("w6b_ban"), 0);

    // Full authority still stops at another owner's password.
    let mut rig = with_actions(&INSTANCE_ADMIN_ACTIONS).await;
    rig.backend.w4.answer(
        "w6b_users",
        list_json(vec![admin_user_json(PRIYA, "pri", "OWNER", false)], None),
    );
    rig.core.admin_users(AdminUserQuery::default());
    rig.settle().await;
    assert_eq!(
        message(
            rig.core
                .reset_user_password(PRIYA.into(), "long enough".into())
                .await
        ),
        "That's an instance owner"
    );
    assert_eq!(rig.backend.w4.count("w6b_password"), 0);

    // Only an instance owner may grant the role.
    let rig = with_actions(&INSTANCE_ADMIN_ACTIONS).await;
    assert_eq!(
        message(rig.core.set_user_owner(PRIYA.into(), true).await),
        "Only an instance owner can grant or remove the owner role"
    );
    assert_eq!(rig.backend.w4.count("w6b_set_role"), 0);

    // Their permissions are more than mine.
    let mut rig = with_actions(&["READ_USER", "UPDATE_USER", "BAN_USER"]).await;
    rig.backend.w4.answer(
        "w6b_user_roles",
        user_roles_json(
            PRIYA,
            vec![role_json(
                ROLE_ADMIN,
                "Admin",
                &["READ_USER", "DELETE_USER"],
            )],
        ),
    );
    rig.core.admin_user_roles(PRIYA.into());
    rig.settle().await;
    assert_eq!(
        message(rig.core.ban_user(PRIYA.into()).await),
        "They hold permissions you don't have"
    );
    assert_eq!(rig.backend.w4.count("w6b_ban"), 0);
    let view = rig.core.admin_user(PRIYA.into());
    assert_eq!(
        view.op.error.map(|error| error.message),
        Some("They hold permissions you don't have".to_owned())
    );
}

#[tokio::test]
async fn set_owner_on_myself_rereads_my_permissions() {
    // A user who was not an owner has their instance roles cached; becoming one and then giving
    // it up reads them, and the profile, again.
    let rig = Rig::new();
    rig.backend.w3.answer("profile", user_json(ME));
    rig.backend
        .w3
        .answer("instance_roles", instance_roles_json(&["READ_USER"]));
    let mut rig = rig.signed_in().await;
    rig.core.instance_permissions();
    rig.settle().await;
    assert_eq!(rig.backend.w3.count("instance_roles"), 1);
    rig.backend.w3.answer("profile", {
        let mut me = user_json(ME);
        me["role"] = json!("OWNER");
        me
    });
    rig.core
        .invalidate(&QueryKey::new(&[semaphore_core::cache::keys::PROFILE]));
    rig.settle().await;
    assert!(rig.core.instance_permissions().admin.is_owner);

    rig.backend.w4.answer("w6b_set_role", {
        let mut me = admin_user_json(ME, "me", "USER", false);
        me["role"] = json!("USER");
        me
    });
    rig.core.set_user_owner(ME.into(), false).await.unwrap();
    rig.settle().await;
    assert_eq!(
        rig.backend.w4.count("w6b_set_role"),
        1,
        "the change reached the server"
    );
    assert_eq!(
        rig.backend.w3.count("profile"),
        3,
        "my profile is read again"
    );
    assert_eq!(
        rig.backend.w3.count("instance_roles"),
        2,
        "my instance roles are read again"
    );
}

#[tokio::test]
async fn delete_removes_the_user_from_every_list() {
    let mut rig = owner().await;
    rig.backend.w4.answer(
        "w6b_users",
        list_json(
            vec![
                admin_user_json(PRIYA, "pri", "USER", false),
                admin_user_json(MARCUS, "marcus", "USER", false),
            ],
            None,
        ),
    );
    rig.core.admin_users(AdminUserQuery::default());
    rig.settle().await;
    let banned = AdminUserQuery {
        banned: Some(true),
        ..AdminUserQuery::default()
    };
    rig.backend.w4.answer(
        "w6b_users",
        list_json(vec![admin_user_json(PRIYA, "pri", "USER", true)], None),
    );
    rig.core.admin_users(banned.clone());
    rig.settle().await;
    rig.backend
        .w4
        .answer("w6b_user", admin_user_json(PRIYA, "pri", "USER", false));
    rig.core.admin_user(PRIYA.into());
    rig.settle().await;
    assert!(rig.core.admin_user(PRIYA.into()).user.is_some());
    let more_before = listed_users(&rig, &banned).more;

    rig.backend
        .w4
        .answer("w6b_delete", json!({ "success": true }));
    rig.core.delete_user(PRIYA.into()).await.unwrap();

    assert_eq!(
        ids(&listed_users(&rig, &AdminUserQuery::default())),
        [MARCUS]
    );
    assert!(listed_users(&rig, &banned).rows.is_empty());
    assert_eq!(
        listed_users(&rig, &banned).more,
        more_before,
        "a removal leaves `more` as it was"
    );
    assert!(
        rig.core.admin_user(PRIYA.into()).user.is_none(),
        "its own read is gone"
    );
}

#[tokio::test]
async fn a_short_password_is_refused_before_sending() {
    let rig = owner().await;
    assert_eq!(
        message(
            rig.core
                .reset_user_password(PRIYA.into(), "short".into())
                .await
        ),
        "Password must be at least 8 characters"
    );
    assert_eq!(
        message(
            rig.core
                .reset_user_password(PRIYA.into(), "x".repeat(129))
                .await
        ),
        "Password must be at most 128 characters"
    );
    assert_eq!(rig.backend.w4.count("w6b_password"), 0);
    let view = rig.core.admin_user(PRIYA.into());
    assert_eq!(
        view.op.error.map(|error| error.message),
        Some("Password must be at most 128 characters".to_owned())
    );

    rig.backend
        .w4
        .answer("w6b_password", admin_user_json(PRIYA, "pri", "USER", false));
    rig.core
        .reset_user_password(PRIYA.into(), "x".repeat(8))
        .await
        .unwrap();
    assert_eq!(rig.backend.w4.count("w6b_password"), 1);
}

#[tokio::test]
async fn assign_and_unassign_reread_the_users_roles() {
    let mut rig = owner().await;
    rig.backend.w4.answer(
        "w6b_user_roles",
        user_roles_json(PRIYA, vec![role_json(ROLE_ADMIN, "Admin", &["READ_USER"])]),
    );
    rig.core.admin_user_roles(PRIYA.into());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6b_user_roles"), 1);

    rig.core
        .assign_instance_role(PRIYA.into(), ROLE_ADMIN.into())
        .await
        .unwrap();
    rig.settle().await;
    assert_eq!(
        rig.backend.w4.calls().last().map(String::as_str),
        Some(format!("w6b_user_roles {PRIYA}").as_str()),
        "the roles are read again after the grant"
    );
    assert_eq!(rig.backend.w4.count("w6b_user_roles"), 2);
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&format!("w6b_assign {ROLE_ADMIN} {PRIYA}"))
    );
    let view = rig.core.admin_user_roles(PRIYA.into());
    assert_eq!(view.held.len(), 1);
    assert_eq!(view.held[0].id, ROLE_ADMIN);

    rig.core
        .unassign_instance_role(PRIYA.into(), ROLE_ADMIN.into())
        .await
        .unwrap();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6b_user_roles"), 3);
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&format!("w6b_unassign {ROLE_ADMIN} {PRIYA}"))
    );
}

#[tokio::test]
async fn an_answer_after_sign_out_changes_nothing() {
    let mut rig = owner().await;
    let query = AdminUserQuery::default();
    rig.backend.w4.answer(
        "w6b_users",
        list_json(vec![admin_user_json(PRIYA, "pri", "USER", false)], None),
    );
    rig.core.admin_users(query.clone());
    rig.settle().await;

    rig.backend
        .w4
        .answer("w6b_ban", admin_user_json(PRIYA, "pri", "USER", true));
    let hold = rig.backend.w4.hold("w6b_ban");
    let ban = rig.core.ban_user(PRIYA.into());
    let (result, ()) = tokio::join!(ban, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        rig.core
            .sign_in("http://server".into(), "me".into(), "pw".into())
            .await
            .unwrap();
        rig.core.run_until_idle().await;
        hold.send(()).unwrap();
    });
    assert_eq!(message(result), "signed out");
    let key = QueryKey::new(&[keys::USERS, "", "-", "-"]);
    assert!(
        rig.core.query_state(&key).is_none(),
        "the ended session's list is gone, and the answer wrote nothing"
    );
}

#[tokio::test]
async fn a_new_connection_reads_the_list_again() {
    let mut rig = owner().await;
    rig.backend.w4.answer(
        "w6b_users",
        list_json(vec![admin_user_json(PRIYA, "pri", "USER", false)], None),
    );
    rig.core.admin_users(AdminUserQuery::default());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6b_users"), 1);
    rig.core.ingest(connected());
    rig.settle().await;
    assert_eq!(
        rig.backend.w4.count("w6b_users"),
        2,
        "a new connection reads the list again"
    );
}
