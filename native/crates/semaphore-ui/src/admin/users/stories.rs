//! The admin users stories: the list in each state it can be in (loading, empty, failed, long,
//! one more page on its way, the filters set), the per-user menu with everything allowed, with each
//! reason core gives, and for the user themselves, the ban and confirm dialogs busy and refused,
//! the reset-password form empty, too short and refused, the instance-role dialog loading, full and
//! with a role on its way, the storage quota, and the phone layout with its menu open.
//! `rigs/shot/scripts/ua3-admin-users.steps` renders them all on a desktop and a phone.

use super::{Panel, UsersPage};
use crate::dms::stories::failed;
use crate::messages::TimeFormat;
use crate::messages::fixture::NOW_MS;
use crate::stories::{Story, StoryEnv};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind as K, AdminActionState, AdminNotAllowed as NA, AdminOp,
    AdminUserActions, AdminUserQuery, AdminUserRolesView, AdminUserRow, AdminUserView,
    AdminUsersView, ErrorView, InstanceAdminCaps, InstanceRoleRef, LoadState, UserView,
};

const DAY: i64 = 24 * 60 * 60 * 1000;
const GIB: u64 = 1 << 30;

// ---- Fixtures. ----

fn caps() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        dashboard: true,
        settings_read: true,
        settings_write: true,
        users_read: true,
        users_update: true,
        users_ban: true,
        users_delete: true,
        storage: true,
        communities_read: true,
        communities_delete: true,
        invites_read: true,
        invites_create: true,
        invites_delete: true,
        roles_read: true,
        roles_write: true,
        is_owner: true,
        full_authority: true,
    }
}

fn user(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

fn actions() -> AdminUserActions {
    AdminUserActions::default()
}

#[allow(clippy::too_many_arguments)]
fn row(
    id: &str,
    username: &str,
    display: Option<&str>,
    is_owner: bool,
    banned: bool,
    used_gb: f64,
    quota_gb: u64,
    actions: AdminUserActions,
) -> AdminUserRow {
    AdminUserRow {
        user: user(id, username, display),
        email: Some(format!("{username}@northwind.example")),
        is_owner,
        banned,
        banned_at_ms: banned.then_some(NOW_MS - 3 * DAY),
        created_at_ms: NOW_MS - 400 * DAY,
        last_seen_ms: Some(NOW_MS - DAY),
        storage_used_bytes: (used_gb * GIB as f64) as u64,
        storage_quota_bytes: quota_gb * GIB,
        actions,
    }
}

fn people() -> Vec<AdminUserRow> {
    let owner = AdminUserActions {
        ban: Some(NA::Owner),
        delete: Some(NA::Owner),
        ..actions()
    };
    vec![
        row(
            "u-river",
            "river_owner",
            Some("River"),
            true,
            false,
            1.2,
            50,
            owner,
        ),
        row(
            "u-maple",
            "maple_admin",
            Some("Maple"),
            false,
            false,
            8.4,
            50,
            actions(),
        ),
        row(
            "u-juniper",
            "juniper",
            Some("Juniper Park"),
            false,
            false,
            2.1,
            10,
            actions(),
        ),
        row("u-quill", "quill", None, false, false, 0.4, 10, actions()),
        row(
            "u-harbor",
            "harbor_mod",
            Some("Harbor"),
            false,
            true,
            5.6,
            10,
            actions(),
        ),
        row(
            "u-sable",
            "sable",
            Some("Sable Ito"),
            false,
            false,
            48.2,
            50,
            actions(),
        ),
        row("u-tamsin", "tamsin", None, false, false, 3.3, 10, actions()),
        row(
            "u-ozzie",
            "ozzie",
            Some("Oz"),
            false,
            false,
            0.9,
            10,
            actions(),
        ),
    ]
}

fn server_error(message: &str) -> ErrorView {
    ErrorView {
        code: "FORBIDDEN".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn state(kind: K, target: Option<&str>) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: target.map(str::to_owned),
        },
        busy: false,
        upload: None,
        error: None,
    }
}

fn op(states: Vec<AdminActionState>) -> AdminOp {
    let last = states.last().cloned();
    AdminOp {
        busy: states.iter().any(|state| state.busy),
        upload: last.as_ref().and_then(|state| state.upload.clone()),
        error: last.as_ref().and_then(|state| state.error.clone()),
        action: last.map(|state| state.action),
        actions: states,
        finished: Vec::new(),
    }
}

fn busy(kind: K, target: Option<&str>) -> AdminOp {
    op(vec![AdminActionState {
        busy: true,
        ..state(kind, target)
    }])
}

fn erred(kind: K, target: Option<&str>, message: &str) -> AdminOp {
    op(vec![AdminActionState {
        error: Some(server_error(message)),
        ..state(kind, target)
    }])
}

fn view(
    state: LoadState,
    query: AdminUserQuery,
    rows: Vec<AdminUserRow>,
    more: bool,
    loading_more: bool,
    op: AdminOp,
) -> AdminUsersView {
    AdminUsersView {
        state,
        query,
        rows,
        more,
        loading_more,
        op,
    }
}

fn ready() -> AdminUsersView {
    view(
        LoadState::Ready,
        AdminUserQuery::default(),
        people(),
        false,
        false,
        AdminOp::default(),
    )
}

fn user_view(row: AdminUserRow, op: AdminOp) -> AdminUserView {
    AdminUserView {
        state: LoadState::Ready,
        user: Some(row),
        op,
    }
}

fn role(id: &str, name: &str) -> InstanceRoleRef {
    InstanceRoleRef {
        id: id.into(),
        name: name.into(),
    }
}

fn roles(state: LoadState, op: AdminOp) -> AdminUserRolesView {
    AdminUserRolesView {
        state,
        user_id: "u-maple".into(),
        held: vec![
            role("r-moderator", "Instance Moderator"),
            role("r-support", "Support"),
        ],
        available: vec![
            role("r-admin", "Instance Admin"),
            role("r-auditor", "Auditor"),
            role("r-community", "Community Manager"),
        ],
        op,
    }
}

/// A 100-character version of `base`, for the long-content story.
fn long(base: &str) -> String {
    let mut out = String::new();
    while out.chars().count() < 100 {
        out.push_str(base);
    }
    out.chars().take(100).collect()
}

fn long_rows() -> Vec<AdminUserRow> {
    (0..60)
        .map(|index| {
            let id = format!("u-long{index:02}");
            let display = long("Long Display Name ");
            let mut person = row(
                &id,
                &format!("long_username_{index:02}"),
                Some(display.as_str()),
                index % 17 == 0,
                index % 13 == 0,
                3.7,
                50,
                actions(),
            );
            person.email = Some(format!("{}@northwind.example", long("email")));
            person
        })
        .collect()
}

/// An instance owner who is banned: what the two filters together find.
fn banned_owner() -> AdminUserRow {
    row(
        "u-olive",
        "olive_owner",
        Some("Olive"),
        true,
        true,
        12.0,
        50,
        AdminUserActions::default(),
    )
}

/// An instance owner who is also banned: every reason except `OnlyOwner` lands on some item.
fn limited_row() -> AdminUserRow {
    row(
        "u-limited",
        "olive_owner",
        Some("Olive"),
        true,
        true,
        22.0,
        50,
        AdminUserActions {
            ban: Some(NA::Owner),
            unban: Some(NA::Owner),
            delete: Some(NA::Myself),
            reset_password: Some(NA::Rank),
            set_owner: Some(NA::LastOwner),
            edit_roles: Some(NA::NoPermission),
            set_quota: Some(NA::NoPermission),
        },
    )
}

/// This user's own row: the two actions that say "That's you", and `OnlyOwner` on the owner role.
fn self_row() -> AdminUserRow {
    row(
        "u-me",
        "river_me",
        Some("River"),
        false,
        false,
        1.2,
        50,
        AdminUserActions {
            ban: Some(NA::Myself),
            delete: Some(NA::Myself),
            set_owner: Some(NA::OnlyOwner),
            reset_password: Some(NA::Rank),
            set_quota: Some(NA::NoPermission),
            ..actions()
        },
    )
}

// ---- Builders. ----

fn build(
    view: AdminUsersView,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut UsersPage, &mut Window, &mut Context<UsersPage>),
) -> AnyView {
    cx.new(|cx| {
        let mut page = UsersPage::new(window, cx);
        page.set_time(TimeFormat::fixed(NOW_MS), cx);
        page.set_caps(caps(), cx);
        page.set_view(view, cx);
        tweak(&mut page, window, cx);
        page
    })
    .into()
}

/// The menu open on one user, with `op` as their view's own changes.
fn menu(row: AdminUserRow, op: AdminOp, window: &mut Window, cx: &mut App) -> AnyView {
    // The menu hangs from its row: the row has to be in the list the page shows.
    let mut rows = ready().rows;
    rows.retain(|known| known.user.id != row.user.id);
    rows.insert(0, row.clone());
    let view = AdminUsersView { rows, ..ready() };
    build(view, window, cx, move |page, _, cx| {
        page.set_user(Some(user_view(row, op)), cx);
    })
}

/// A dialog open on one user that the owner has already read.
fn dialog(
    panel: Panel,
    row: AdminUserRow,
    op: AdminOp,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut UsersPage, &mut Window, &mut Context<UsersPage>),
) -> AnyView {
    build(ready(), window, cx, move |page, window, cx| {
        page.set_user(Some(user_view(row, op)), cx);
        page.open_panel(panel, window, cx);
        tweak(page, window, cx);
    })
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(crate) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        // ---- The list. ----
        ("admin-users-loading", |_, w, cx| {
            build(
                view(
                    LoadState::Loading,
                    AdminUserQuery::default(),
                    Vec::new(),
                    false,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-empty", |_, w, cx| {
            build(
                view(
                    LoadState::Ready,
                    AdminUserQuery {
                        search: "nobody".into(),
                        ..AdminUserQuery::default()
                    },
                    Vec::new(),
                    false,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-failed", |_, w, cx| {
            build(
                view(
                    failed(),
                    AdminUserQuery::default(),
                    Vec::new(),
                    false,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-ready", |_, w, cx| {
            build(ready(), w, cx, |_, _, _| {})
        }),
        ("admin-users-long", |_, w, cx| {
            build(
                view(
                    LoadState::Ready,
                    AdminUserQuery::default(),
                    long_rows(),
                    true,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-loading-more", |_, w, cx| {
            build(
                view(
                    LoadState::Ready,
                    AdminUserQuery::default(),
                    people().into_iter().take(2).collect(),
                    true,
                    true,
                    AdminOp::default(),
                ),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-filtered", |_, w, cx| {
            build(
                view(
                    LoadState::Ready,
                    AdminUserQuery {
                        search: String::new(),
                        banned: Some(true),
                        owners: Some(true),
                    },
                    vec![banned_owner()],
                    false,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-phone", |_, w, cx| {
            // The phone's own story: a banned user's menu over the stacked rows.
            menu(
                people().into_iter().nth(4).expect("a banned user"),
                AdminOp::default(),
                w,
                cx,
            )
        }),
        // ---- The menu. ----
        ("admin-users-menu-owner-actor", |_, w, cx| {
            menu(
                people().into_iter().nth(1).expect("a second user"),
                AdminOp::default(),
                w,
                cx,
            )
        }),
        ("admin-users-menu-limited", |_, w, cx| {
            menu(limited_row(), AdminOp::default(), w, cx)
        }),
        ("admin-users-menu-self", |_, w, cx| {
            menu(self_row(), AdminOp::default(), w, cx)
        }),
        // ---- Banning. ----
        ("admin-users-ban-busy", |_, w, cx| {
            dialog(
                Panel::Ban,
                people().into_iter().next().expect("an owner"),
                busy(K::BanUser, Some("u-river")),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-ban-refused", |_, w, cx| {
            dialog(
                Panel::Ban,
                people().into_iter().next().expect("an owner"),
                erred(K::BanUser, Some("u-river"), "Cannot ban an instance owner"),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-delete-confirm", |_, w, cx| {
            dialog(
                Panel::Delete,
                people().into_iter().nth(2).expect("a third user"),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        // ---- Reset password. ----
        ("admin-users-reset-password", |_, w, cx| {
            dialog(
                Panel::ResetPassword,
                people().into_iter().nth(1).expect("a second user"),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-users-reset-password-invalid", |_, w, cx| {
            dialog(
                Panel::ResetPassword,
                people().into_iter().nth(1).expect("a second user"),
                AdminOp::default(),
                w,
                cx,
                |page, window, cx| {
                    page.password
                        .update(cx, |field, cx| field.set_value("1234567", window, cx));
                },
            )
        }),
        ("admin-users-reset-password-refused", |_, w, cx| {
            dialog(
                Panel::ResetPassword,
                people().into_iter().next().expect("an owner"),
                erred(
                    K::SetUserPassword,
                    Some("u-river"),
                    "Only an instance owner can reset another owner's password",
                ),
                w,
                cx,
                |page, window, cx| {
                    page.password.update(cx, |field, cx| {
                        field.set_value("a-new-password", window, cx)
                    });
                },
            )
        }),
        // ---- Instance roles. ----
        ("admin-users-roles-dialog", |_, w, cx| {
            dialog(
                Panel::Roles,
                people().into_iter().nth(1).expect("a second user"),
                AdminOp::default(),
                w,
                cx,
                |page, _, cx| {
                    page.set_user_roles(Some(roles(LoadState::Ready, AdminOp::default())), cx)
                },
            )
        }),
        ("admin-users-roles-loading", |_, w, cx| {
            dialog(
                Panel::Roles,
                people().into_iter().nth(1).expect("a second user"),
                AdminOp::default(),
                w,
                cx,
                |page, _, cx| {
                    page.set_user_roles(
                        Some(AdminUserRolesView {
                            state: LoadState::Loading,
                            user_id: "u-maple".into(),
                            ..AdminUserRolesView::default()
                        }),
                        cx,
                    )
                },
            )
        }),
        ("admin-users-roles-busy", |_, w, cx| {
            dialog(
                Panel::Roles,
                people().into_iter().nth(1).expect("a second user"),
                AdminOp::default(),
                w,
                cx,
                |page, _, cx| {
                    page.set_user_roles(
                        Some(roles(
                            LoadState::Ready,
                            busy(K::AssignInstanceRole, Some("r-auditor")),
                        )),
                        cx,
                    )
                },
            )
        }),
        // ---- The quota. ----
        ("admin-users-quota", |_, w, cx| {
            dialog(
                Panel::Quota,
                people().into_iter().nth(2).expect("a third user"),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
