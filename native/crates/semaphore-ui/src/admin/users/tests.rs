//! The admin users page in a window: the filters and their debounce, the page's foot, the menu's
//! allowed and off items, every dialog's event, and how a dialog waits on its change.

use super::{SEARCH_DEBOUNCE, UsersEvent, UsersPage};
use crate::dms::rig::{Rig, rig};
use crate::messages::TimeFormat;
use crate::messages::fixture::NOW_MS;
use core::prelude::v1::test;
use gpui_kit::component::select::SelectEvent;
use gpui_kit::test::TestQueryExt as _;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind as K, AdminActionOutcome, AdminActionState, AdminNotAllowed as NA,
    AdminOp, AdminUserActions, AdminUserQuery, AdminUserRolesView, AdminUserRow, AdminUserView,
    AdminUsersView, ErrorView, InstanceAdminCaps, InstanceRoleRef, LoadState, UserView,
};
use std::time::Duration;

const DAY: i64 = 24 * 60 * 60 * 1000;
const GIB: u64 = 1 << 30;

// ---- Fixtures. ----

fn caps() -> InstanceAdminCaps {
    InstanceAdminCaps {
        users_read: true,
        users_update: true,
        users_ban: true,
        users_delete: true,
        storage: true,
        is_owner: true,
        full_authority: true,
        ..InstanceAdminCaps::default()
    }
}

fn user_row(
    id: &str,
    username: &str,
    is_owner: bool,
    banned: bool,
    actions: AdminUserActions,
) -> AdminUserRow {
    AdminUserRow {
        user: UserView {
            id: id.into(),
            username: username.into(),
            display_name: Some(username.replace('_', " ")),
            avatar_file_id: None,
        },
        email: Some(format!("{username}@example.com")),
        is_owner,
        banned,
        banned_at_ms: banned.then_some(NOW_MS - DAY),
        created_at_ms: NOW_MS - 400 * DAY,
        last_seen_ms: Some(NOW_MS - DAY),
        storage_used_bytes: 2 * GIB,
        storage_quota_bytes: 50 * GIB,
        actions,
    }
}

fn maple() -> AdminUserRow {
    user_row(
        "u-maple",
        "maple",
        false,
        false,
        AdminUserActions::default(),
    )
}

fn juniper() -> AdminUserRow {
    user_row(
        "u-juniper",
        "juniper",
        false,
        true,
        AdminUserActions::default(),
    )
}

fn ready() -> AdminUsersView {
    AdminUsersView {
        state: LoadState::Ready,
        query: AdminUserQuery::default(),
        rows: vec![maple(), juniper()],
        more: false,
        loading_more: false,
        op: AdminOp::default(),
    }
}

fn view(more: bool, loading_more: bool) -> AdminUsersView {
    AdminUsersView {
        more,
        loading_more,
        ..ready()
    }
}

fn user_view(row: AdminUserRow, op: AdminOp) -> AdminUserView {
    AdminUserView {
        state: LoadState::Ready,
        user: Some(row),
        op,
    }
}

fn users_rig(cx: &mut TestAppContext, view: AdminUsersView) -> Rig<UsersPage, UsersEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut page = UsersPage::new(window, cx);
        page.set_caps(caps(), cx);
        page.set_time(TimeFormat::fixed(NOW_MS), cx);
        page.set_view(view, cx);
        page
    })
}

fn users_rig_rows(cx: &mut TestAppContext, rows: Vec<AdminUserRow>) -> Rig<UsersPage, UsersEvent> {
    users_rig(cx, AdminUsersView { rows, ..ready() })
}

fn open_menu(rig: &Rig<UsersPage, UsersEvent>, cx: &mut TestAppContext, row: AdminUserRow) {
    rig.with(cx, |page, _, cx| {
        page.update(cx, |page, cx| {
            page.set_user(Some(user_view(row, AdminOp::default())), cx)
        })
    });
}

fn server_error(message: &str) -> ErrorView {
    ErrorView {
        code: "FORBIDDEN".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn state(kind: K, target: &str) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: Some(target.into()),
        },
        busy: false,
        upload: None,
        error: None,
    }
}

fn busy(kind: K, target: &str) -> AdminOp {
    AdminOp {
        busy: true,
        action: Some(state(kind, target).action),
        actions: vec![AdminActionState {
            busy: true,
            ..state(kind, target)
        }],
        ..AdminOp::default()
    }
}

fn ended(kind: K, target: &str, seq: u64, message: Option<&str>) -> AdminOp {
    AdminOp {
        error: message.map(server_error),
        action: Some(state(kind, target).action),
        actions: vec![AdminActionState {
            error: message.map(server_error),
            ..state(kind, target)
        }],
        finished: vec![AdminActionOutcome {
            action: state(kind, target).action,
            seq,
            error: message.map(server_error),
        }],
        ..AdminOp::default()
    }
}

fn type_search(rig: &Rig<UsersPage, UsersEvent>, cx: &mut TestAppContext, text: &str) {
    let text = text.to_owned();
    rig.with(cx, |page, window, cx| {
        page.update(cx, |page, cx| {
            page.search
                .update(cx, |field, cx| field.set_value(text.clone(), window, cx));
            page.search_changed(&text, cx);
        })
    });
}

fn type_password(rig: &Rig<UsersPage, UsersEvent>, cx: &mut TestAppContext, text: &str) {
    let text = text.to_owned();
    rig.with(cx, |page, window, cx| {
        page.update(cx, |page, cx| {
            page.password
                .update(cx, |field, cx| field.set_value(text.clone(), window, cx))
        })
    });
}

fn type_quota(rig: &Rig<UsersPage, UsersEvent>, cx: &mut TestAppContext, text: &str) {
    let text = text.to_owned();
    rig.with(cx, |page, window, cx| {
        page.update(cx, |page, cx| {
            page.quota
                .update(cx, |field, cx| field.set_value(text.clone(), window, cx))
        })
    });
}

fn feed_user(rig: &Rig<UsersPage, UsersEvent>, cx: &mut TestAppContext, view: AdminUserView) {
    rig.with(cx, |page, _, cx| {
        page.update(cx, |page, cx| page.set_user(Some(view.clone()), cx))
    });
}

// ---- The filters and the list. ----

#[gpui_kit::test]
fn filters_emit_the_query(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    rig.with(cx, |page, _, cx| {
        let status = page.read(cx).status.clone();
        status.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Banned".into())))
        });
    });
    assert_eq!(
        rig.events(),
        [UsersEvent::Query(AdminUserQuery {
            banned: Some(true),
            ..AdminUserQuery::default()
        })]
    );
    rig.with(cx, |page, _, cx| {
        let role = page.read(cx).role.clone();
        role.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Owner".into())))
        });
    });
    assert_eq!(
        rig.events().last(),
        Some(&UsersEvent::Query(AdminUserQuery {
            banned: Some(true),
            owners: Some(true),
            ..AdminUserQuery::default()
        }))
    );
}

#[gpui_kit::test]
fn search_is_debounced(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    type_search(&rig, cx, "ri");
    cx.executor().advance_clock(Duration::from_millis(200));
    type_search(&rig, cx, "riv");
    cx.executor()
        .advance_clock(SEARCH_DEBOUNCE - Duration::from_millis(1));
    cx.run_until_parked();
    assert!(rig.events().is_empty(), "still inside the debounce");
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    assert_eq!(
        rig.events(),
        [UsersEvent::Query(AdminUserQuery {
            search: "riv".into(),
            ..AdminUserQuery::default()
        })]
    );
    cx.executor().advance_clock(Duration::from_secs(2));
    cx.run_until_parked();
    assert_eq!(
        rig.events().len(),
        1,
        "the first keystroke's timer was cancelled"
    );
}

#[gpui_kit::test]
fn load_more_only_when_more(cx: &mut TestAppContext) {
    let rig = users_rig(cx, view(false, false));
    assert!(!rig.has(cx, "admin-users-more"), "nothing left to load");
    assert!(rig.events().is_empty());

    let rig = users_rig(cx, view(true, false));
    rig.click(cx, "admin-users-more");
    assert_eq!(rig.events(), [UsersEvent::LoadMore]);

    let rig = users_rig(cx, view(true, true));
    rig.click(cx, "admin-users-more");
    assert!(rig.events().is_empty(), "the next page is already coming");
}

// ---- The menu. ----

#[gpui_kit::test]
fn a_disabled_action_shows_its_reason_and_sends_nothing(cx: &mut TestAppContext) {
    let me = user_row(
        "u-me",
        "me",
        false,
        false,
        AdminUserActions {
            ban: Some(NA::Myself),
            delete: Some(NA::Myself),
            set_owner: Some(NA::OnlyOwner),
            ..AdminUserActions::default()
        },
    );
    let rig = users_rig_rows(cx, vec![me.clone()]);
    open_menu(&rig, cx, me);
    rig.with(cx, |_, window, _| {
        assert!(
            window.try_find_by_label("Ban User, That's you").is_some(),
            "the reason is on the item"
        );
        assert!(
            window
                .try_find_by_label(
                    "Promote to Owner, Only an instance owner can grant or remove the owner role"
                )
                .is_some()
        );
    });
    rig.click(cx, "admin-user-ban");
    rig.click(cx, "admin-user-delete");
    assert!(rig.events().is_empty(), "an off action sends nothing");
    assert!(!rig.has(cx, "admin-ban-confirm"), "and opens no dialog");
}

#[gpui_kit::test]
fn ban_confirm_sends_ban(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-ban");
    assert!(rig.has(cx, "admin-ban-confirm"));
    rig.click(cx, "admin-ban-confirm");
    assert_eq!(
        rig.events(),
        [UsersEvent::Ban {
            user_id: "u-maple".into()
        }]
    );
}

#[gpui_kit::test]
fn unban_sends_unban(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, juniper());
    assert!(!rig.has(cx, "admin-user-ban"), "a banned user has no ban");
    rig.click(cx, "admin-user-unban");
    assert_eq!(
        rig.events(),
        [
            UsersEvent::Unban {
                user_id: "u-juniper".into()
            },
            UsersEvent::CloseUser
        ]
    );
}

#[gpui_kit::test]
fn delete_confirm_sends_delete(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-delete");
    rig.click(cx, "admin-delete-confirm");
    assert_eq!(
        rig.events(),
        [UsersEvent::Delete {
            user_id: "u-maple".into()
        }]
    );
}

#[gpui_kit::test]
fn owner_toggle_sends_set_owner(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-make-owner");
    rig.click(cx, "admin-owner-confirm");
    assert_eq!(
        rig.events(),
        [UsersEvent::SetOwner {
            user_id: "u-maple".into(),
            owner: true
        }]
    );

    let owner = user_row("u-river", "river", true, false, AdminUserActions::default());
    let rig = users_rig_rows(cx, vec![owner.clone()]);
    open_menu(&rig, cx, owner);
    rig.click(cx, "admin-user-remove-owner");
    rig.click(cx, "admin-owner-confirm");
    assert_eq!(
        rig.events(),
        [UsersEvent::SetOwner {
            user_id: "u-river".into(),
            owner: false
        }]
    );
}

// ---- The dialogs. ----

#[gpui_kit::test]
fn reset_password_checks_length(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-reset-password");
    assert!(rig.has(cx, "admin-reset-password-field"));
    rig.click(cx, "admin-reset-password-save");
    assert!(rig.events().is_empty(), "nothing typed");
    type_password(&rig, cx, "1234567");
    rig.with(cx, |_, window, _| {
        assert!(
            window
                .try_find_by_label("Password must be at least 8 characters")
                .is_some(),
            "seven characters says why"
        );
    });
    rig.click(cx, "admin-reset-password-save");
    assert!(rig.events().is_empty(), "seven characters is too short");
    type_password(&rig, cx, &"x".repeat(129));
    rig.click(cx, "admin-reset-password-save");
    assert!(rig.events().is_empty(), "129 characters is too long");
}

#[gpui_kit::test]
fn reset_password_sends_it(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-reset-password");
    type_password(&rig, cx, "correct horse");
    rig.click(cx, "admin-reset-password-save");
    assert_eq!(
        rig.events(),
        [UsersEvent::ResetPassword {
            user_id: "u-maple".into(),
            password: "correct horse".into()
        }]
    );
}

#[gpui_kit::test]
fn roles_dialog_assigns_and_unassigns(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.with(cx, |page, _, cx| {
        page.update(cx, |page, cx| {
            page.set_user_roles(
                Some(AdminUserRolesView {
                    state: LoadState::Ready,
                    user_id: "u-maple".into(),
                    held: vec![InstanceRoleRef {
                        id: "r-support".into(),
                        name: "Support".into(),
                    }],
                    available: vec![InstanceRoleRef {
                        id: "r-auditor".into(),
                        name: "Auditor".into(),
                    }],
                    op: AdminOp::default(),
                }),
                cx,
            )
        })
    });
    rig.click(cx, "admin-user-roles");
    assert!(rig.has(cx, "admin-user-roles-dialog"));
    rig.click(cx, "admin-role-assign-r-auditor");
    rig.click(cx, "admin-role-remove-r-support");
    assert_eq!(
        rig.events(),
        [
            UsersEvent::AssignRole {
                user_id: "u-maple".into(),
                role_id: "r-auditor".into()
            },
            UsersEvent::UnassignRole {
                user_id: "u-maple".into(),
                role_id: "r-support".into()
            }
        ]
    );
}

#[gpui_kit::test]
fn quota_converts_gb_to_bytes(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-quota");
    assert!(rig.has(cx, "admin-quota-field"));
    type_quota(&rig, cx, "5");
    rig.click(cx, "admin-quota-save");
    assert_eq!(
        rig.events(),
        [
            UsersEvent::SetQuota {
                user_id: "u-maple".into(),
                quota_bytes: 5 * GIB
            },
            UsersEvent::CloseUser
        ]
    );
}

// ---- Waiting on a change. ----

#[gpui_kit::test]
fn a_dialog_closes_when_its_change_finishes(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-ban");
    rig.click(cx, "admin-ban-confirm");
    feed_user(
        &rig,
        cx,
        user_view(maple(), ended(K::BanUser, "u-maple", 1, None)),
    );
    assert!(
        !rig.has(cx, "admin-ban-confirm"),
        "the ban worked, so the dialog is gone"
    );
    assert_eq!(
        rig.events(),
        [
            UsersEvent::Ban {
                user_id: "u-maple".into()
            },
            UsersEvent::CloseUser
        ]
    );
}

#[gpui_kit::test]
fn a_refused_change_stays_in_its_dialog(cx: &mut TestAppContext) {
    let rig = users_rig(cx, ready());
    open_menu(&rig, cx, maple());
    rig.click(cx, "admin-user-ban");
    rig.click(cx, "admin-ban-confirm");
    feed_user(
        &rig,
        cx,
        user_view(
            maple(),
            ended(
                K::BanUser,
                "u-maple",
                1,
                Some("Cannot ban an instance owner"),
            ),
        ),
    );
    assert!(
        rig.has(cx, "admin-ban-confirm"),
        "the dialog stays with its action"
    );
    rig.with(cx, |_, window, _| {
        assert!(
            window
                .try_find_by_label("Cannot ban an instance owner")
                .is_some(),
            "the server's words sit in the dialog"
        );
    });
    assert_eq!(
        rig.events(),
        [UsersEvent::Ban {
            user_id: "u-maple".into()
        }],
        "no page error, no close"
    );
}
