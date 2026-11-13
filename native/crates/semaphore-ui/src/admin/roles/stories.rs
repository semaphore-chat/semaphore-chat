//! The instance roles stories: the list loading, empty, failed, ready, with many long names, with
//! roles and actions the user can't change, and without the read permission; the editor creating,
//! invalid, for the default role, busy and refused, and with permissions the user can't grant; a
//! role's users ready and loading; a refused delete; and the editor on a phone.
//! `rigs/shot/scripts/ua5-admin-roles-storage.steps` renders them all on a desktop and a phone.

use super::InstanceRolesPage;
use super::rules::action_order;
use crate::stories::{Story, StoryEnv};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind as K, AdminActionState, AdminOp, ErrorView, InstanceAdminCaps,
    InstanceRoleRow, InstanceRoleUsersView, InstanceRolesView, LoadState, UserView,
};

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

fn strings(actions: &[&str]) -> Vec<String> {
    actions.iter().map(|action| (*action).to_owned()).collect()
}

fn role(
    id: &str,
    name: &str,
    actions: &[&str],
    is_default: bool,
    position: i64,
    editable: bool,
    deletable: bool,
) -> InstanceRoleRow {
    InstanceRoleRow {
        id: id.into(),
        actions: strings(actions),
        name: name.into(),
        is_default,
        position,
        editable,
        deletable,
    }
}

fn admin_role() -> InstanceRoleRow {
    role(
        "r-admin",
        "Instance Admin",
        &[
            "READ_INSTANCE_SETTINGS",
            "UPDATE_INSTANCE_SETTINGS",
            "READ_INSTANCE_STATS",
            "MANAGE_USER_STORAGE",
            "READ_USER",
            "UPDATE_USER",
            "BAN_USER",
            "DELETE_USER",
            "READ_INSTANCE_INVITE",
            "CREATE_INSTANCE_INVITE",
            "DELETE_INSTANCE_INVITE",
            "UPDATE_INSTANCE_INVITE",
        ],
        true,
        0,
        true,
        false,
    )
}

fn ready_roles() -> Vec<InstanceRoleRow> {
    vec![
        admin_role(),
        role(
            "r-creator",
            "Community Creator",
            &[
                "READ_INSTANCE_SETTINGS",
                "READ_USER",
                "CREATE_INSTANCE_INVITE",
                "READ_INSTANCE_INVITE",
            ],
            false,
            1,
            true,
            true,
        ),
        role(
            "r-support",
            "Support",
            &["READ_USER", "UPDATE_USER", "BAN_USER"],
            false,
            2,
            true,
            true,
        ),
        role(
            "r-auditor",
            "Auditor",
            &[
                "READ_INSTANCE_SETTINGS",
                "READ_INSTANCE_STATS",
                "READ_USER",
                "READ_INSTANCE_INVITE",
            ],
            false,
            3,
            true,
            true,
        ),
    ]
}

fn view(
    state: LoadState,
    roles: Vec<InstanceRoleRow>,
    grantable: Vec<String>,
) -> InstanceRolesView {
    InstanceRolesView {
        state,
        roles,
        grantable,
        op: AdminOp::default(),
    }
}

fn ready() -> InstanceRolesView {
    view(LoadState::Ready, ready_roles(), action_order())
}

fn server_error(message: &str) -> ErrorView {
    ErrorView {
        code: "CONFLICT".into(),
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

/// A 100-character version of `base`.
fn long(base: &str) -> String {
    let mut out = String::new();
    while out.chars().count() < 100 {
        out.push_str(base);
    }
    out.chars().take(100).collect()
}

fn long_roles() -> Vec<InstanceRoleRow> {
    (0..30)
        .map(|index| {
            let id = format!("r-long{index:02}");
            let name = long("Instance Role With An Extremely Long Name ");
            let actions = match index % 3 {
                0 => strings(&[
                    "READ_USER",
                    "UPDATE_USER",
                    "BAN_USER",
                    "DELETE_USER",
                    "READ_INSTANCE_INVITE",
                ]),
                1 => strings(&["READ_INSTANCE_SETTINGS", "READ_INSTANCE_STATS"]),
                _ => strings(&["MANAGE_USER_STORAGE"]),
            };
            InstanceRoleRow {
                actions,
                ..role(&id, &name, &[], false, index, true, index != 0)
            }
        })
        .collect()
}

fn user(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

fn users() -> InstanceRoleUsersView {
    InstanceRoleUsersView {
        state: LoadState::Ready,
        role_id: "r-support".into(),
        users: vec![
            user("u-maple", "maple", Some("Maple")),
            user("u-juniper", "juniper", Some("Juniper Park")),
            user("u-quill", "quill", None),
        ],
        op: AdminOp::default(),
    }
}

// ---- Builders. ----

fn build(
    view: InstanceRolesView,
    caps: InstanceAdminCaps,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut InstanceRolesPage, &mut Window, &mut Context<InstanceRolesPage>),
) -> AnyView {
    cx.new(|cx| {
        let mut page = InstanceRolesPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        tweak(&mut page, window, cx);
        page
    })
    .into()
}

/// The page with the editor open on `role_id` (or a new one).
fn editing(
    view: InstanceRolesView,
    caps: InstanceAdminCaps,
    role_id: Option<&'static str>,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut InstanceRolesPage, &mut Window, &mut Context<InstanceRolesPage>),
) -> AnyView {
    build(view, caps, window, cx, move |page, window, cx| {
        match role_id {
            Some(id) => page.open_edit(id, window, cx),
            None => page.open_create(window, cx),
        }
        tweak(page, window, cx);
    })
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(super) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        // ---- The list. ----
        ("admin-roles-loading", |_, w, cx| {
            build(
                view(LoadState::Loading, Vec::new(), action_order()),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-roles-empty", |_, w, cx| {
            build(
                view(LoadState::Ready, Vec::new(), action_order()),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-roles-failed", |_, w, cx| {
            build(
                view(
                    LoadState::Failed {
                        error: ErrorView {
                            code: "NETWORK".into(),
                            message: "network unreachable".into(),
                            retryable: true,
                            retry_after_ms: None,
                        },
                    },
                    Vec::new(),
                    action_order(),
                ),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-roles-ready", |_, w, cx| {
            build(ready(), caps(), w, cx, |_, _, _| {})
        }),
        ("admin-roles-long", |_, w, cx| {
            build(
                view(LoadState::Ready, long_roles(), action_order()),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-roles-limited", |_, w, cx| {
            // A role holding actions I don't, and the default role: Edit and Delete say why.
            let roles = vec![
                admin_role(),
                role(
                    "r-senior",
                    "Senior Staff",
                    &["READ_USER", "UPDATE_USER", "DELETE_USER"],
                    false,
                    1,
                    false,
                    false,
                ),
                role(
                    "r-support",
                    "Support",
                    &["READ_USER", "UPDATE_USER"],
                    false,
                    2,
                    true,
                    true,
                ),
            ];
            build(
                view(
                    LoadState::Ready,
                    roles,
                    strings(&["READ_USER", "UPDATE_USER", "READ_INSTANCE_SETTINGS"]),
                ),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-roles-locked", |_, w, cx| {
            build(
                InstanceRolesView::default(),
                InstanceAdminCaps::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        // ---- The editor. ----
        ("admin-roles-editor-new", |_, w, cx| {
            // Some permissions aren't mine to grant: they are off with the reason.
            let grantable = strings(&[
                "READ_INSTANCE_SETTINGS",
                "UPDATE_INSTANCE_SETTINGS",
                "READ_USER",
                "UPDATE_USER",
            ]);
            editing(
                view(LoadState::Ready, ready_roles(), grantable),
                caps(),
                None,
                w,
                cx,
                |page, window, cx| {
                    page.type_name("Support Team", window, cx);
                    page.toggle_action("READ_USER", cx);
                    page.toggle_action("UPDATE_USER", cx);
                },
            )
        }),
        ("admin-roles-editor-default", |_, w, cx| {
            editing(ready(), caps(), Some("r-admin"), w, cx, |_, _, _| {})
        }),
        ("admin-roles-editor-invalid", |_, w, cx| {
            editing(ready(), caps(), None, w, cx, |page, window, cx| {
                page.type_name("", window, cx);
            })
        }),
        ("admin-roles-editor-busy", |_, w, cx| {
            editing(ready(), caps(), None, w, cx, |page, window, cx| {
                page.type_name("Mods", window, cx);
                page.toggle_action("READ_USER", cx);
                page.set_view(
                    InstanceRolesView {
                        op: busy(K::CreateInstanceRole, None),
                        ..ready()
                    },
                    cx,
                );
            })
        }),
        ("admin-roles-editor-refused", |_, w, cx| {
            editing(ready(), caps(), None, w, cx, |page, window, cx| {
                page.type_name("Mods", window, cx);
                page.toggle_action("READ_USER", cx);
                page.set_view(
                    InstanceRolesView {
                        op: erred(
                            K::CreateInstanceRole,
                            None,
                            "Role with name \"Mods\" already exists",
                        ),
                        ..ready()
                    },
                    cx,
                );
            })
        }),
        // ---- A role's users. ----
        ("admin-roles-users", |_, w, cx| {
            build(ready(), caps(), w, cx, |page, _, cx| {
                page.open_users("r-support", cx);
                page.set_role_users(Some(users()), cx);
            })
        }),
        ("admin-roles-users-loading", |_, w, cx| {
            build(ready(), caps(), w, cx, |page, _, cx| {
                page.open_users("r-support", cx);
            })
        }),
        // ---- Refusals. ----
        ("admin-roles-delete-refused", |_, w, cx| {
            build(
                InstanceRolesView {
                    op: erred(
                        K::DeleteInstanceRole,
                        Some("r-support"),
                        "Cannot delete role with 2 assigned user(s). Remove all role assignments first.",
                    ),
                    ..ready()
                },
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        // ---- A phone. ----
        ("admin-roles-phone", |_, w, cx| {
            editing(ready(), caps(), Some("r-support"), w, cx, |page, _, cx| {
                page.toggle_action("BAN_USER", cx);
            })
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
