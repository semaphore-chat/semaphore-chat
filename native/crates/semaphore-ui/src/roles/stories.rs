//! The roles stories: the role list for each kind of member (owner, admin, moderator, member),
//! while it loads or fails, with many roles, moving, deleting and resetting (busy, failed), who
//! holds a role; the editor creating, invalid, a duplicate name, a default role, the top role, a
//! role above mine read-only, permissions I can't grant, an unknown action, busy and failed; the
//! assignment dialog; and a channel's presets in each state. `rigs/shot/scripts/w5-roles.steps`
//! renders them on a desktop and a phone.

use super::rules::RoleOp;
use super::{ChannelOverrides, RoleAssignmentDialog, RolesPanel};
use crate::kit::{Variant, spacing, text};
use crate::stories::{Story, StoryEnv};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminOp, ChannelOverwritesView, ChannelPreset, ErrorView, LoadState, MemberRolesView,
    OverwriteRow, OverwriteTarget, PermissionGroup, RoleMembersView, RoleRow, RolesView, UserView,
};

const COMMUNITY: &str = "community-1";

// ---- Fixtures. ----

/// Core's catalog (`commands/roles.rs` `CATALOG`), as `Core::permission_catalog` returns it.
pub(super) fn catalog() -> Vec<PermissionGroup> {
    let groups: &[(&str, &[&str])] = &[
        ("messages", &["CREATE_MESSAGE", "DELETE_MESSAGE", "READ_MESSAGE"]),
        (
            "channels",
            &[
                "CREATE_CHANNEL",
                "UPDATE_CHANNEL",
                "DELETE_CHANNEL",
                "READ_CHANNEL",
                "JOIN_CHANNEL",
                "MANAGE_CHANNEL_PERMISSIONS",
                "MANAGE_WEBHOOKS",
            ],
        ),
        ("voice", &["SPEAK", "VIDEO", "SCREEN_SHARE", "CAPTURE_REPLAY"]),
        (
            "community",
            &["UPDATE_COMMUNITY", "DELETE_COMMUNITY", "READ_COMMUNITY", "READ_ALL_COMMUNITIES"],
        ),
        ("members", &["CREATE_MEMBER", "UPDATE_MEMBER", "DELETE_MEMBER", "READ_MEMBER"]),
        ("roles", &["CREATE_ROLE", "UPDATE_ROLE", "DELETE_ROLE", "READ_ROLE"]),
        ("users", &["UPDATE_USER", "DELETE_USER", "READ_USER"]),
        (
            "invites",
            &[
                "CREATE_INVITE",
                "DELETE_INVITE",
                "CREATE_INSTANCE_INVITE",
                "DELETE_INSTANCE_INVITE",
                "READ_INSTANCE_INVITE",
                "UPDATE_INSTANCE_INVITE",
            ],
        ),
        (
            "content",
            &[
                "CREATE_REACTION",
                "DELETE_REACTION",
                "ATTACH_FILES",
                "CREATE_ATTACHMENT",
                "DELETE_ATTACHMENT",
                "MANAGE_EMOJIS",
            ],
        ),
        (
            "alias_groups",
            &[
                "CREATE_ALIAS_GROUP",
                "UPDATE_ALIAS_GROUP",
                "DELETE_ALIAS_GROUP",
                "READ_ALIAS_GROUP",
                "CREATE_ALIAS_GROUP_MEMBER",
                "DELETE_ALIAS_GROUP_MEMBER",
                "READ_ALIAS_GROUP_MEMBER",
                "UPDATE_ALIAS_GROUP_MEMBER",
            ],
        ),
        (
            "moderation",
            &[
                "BAN_USER",
                "UNBAN_USER",
                "KICK_USER",
                "TIMEOUT_USER",
                "PIN_MESSAGE",
                "UNPIN_MESSAGE",
                "DELETE_ANY_MESSAGE",
                "VIEW_BAN_LIST",
                "VIEW_MODERATION_LOGS",
                "MUTE_PARTICIPANT",
            ],
        ),
        (
            "soundboard",
            &["READ_SOUNDBOARD_SOUND", "CREATE_SOUNDBOARD_SOUND", "DELETE_SOUNDBOARD_SOUND"],
        ),
    ];
    groups
        .iter()
        .map(|(id, actions)| PermissionGroup {
            id: (*id).into(),
            actions: actions.iter().map(|a| (*a).into()).collect(),
        })
        .collect()
}

fn all_actions() -> Vec<String> {
    catalog().into_iter().flat_map(|g| g.actions).collect()
}

fn strs(actions: &[&str]) -> Vec<String> {
    actions.iter().map(|a| (*a).into()).collect()
}

fn member_actions() -> Vec<String> {
    strs(&[
        "CREATE_MESSAGE",
        "READ_MESSAGE",
        "READ_CHANNEL",
        "JOIN_CHANNEL",
        "SPEAK",
        "VIDEO",
        "SCREEN_SHARE",
        "CREATE_REACTION",
        "ATTACH_FILES",
        "READ_MEMBER",
        "READ_ROLE",
        "READ_COMMUNITY",
        "READ_SOUNDBOARD_SOUND",
    ])
}

fn moderator_actions() -> Vec<String> {
    let mut actions = member_actions();
    actions.retain(|a| !["ATTACH_FILES", "SPEAK", "VIDEO", "SCREEN_SHARE"].contains(&a.as_str()));
    actions.extend(strs(&[
        "KICK_USER",
        "TIMEOUT_USER",
        "PIN_MESSAGE",
        "UNPIN_MESSAGE",
        "DELETE_ANY_MESSAGE",
        "VIEW_BAN_LIST",
        "VIEW_MODERATION_LOGS",
        "MUTE_PARTICIPANT",
        "MANAGE_CHANNEL_PERMISSIONS",
    ]));
    actions
}

fn admin_actions() -> Vec<String> {
    all_actions()
        .into_iter()
        .filter(|a| !["DELETE_COMMUNITY", "BAN_USER", "READ_ALL_COMMUNITIES"].contains(&a.as_str()))
        .collect()
}

#[derive(Clone, Copy)]
enum Viewer {
    Owner,
    Admin,
    Moderator,
    Member,
}

fn role(id: &str, name: &str, position: i32, is_default: bool, actions: Vec<String>) -> RoleRow {
    RoleRow {
        id: id.into(),
        name: name.into(),
        position,
        is_default,
        actions,
        editable: false,
        deletable: false,
        assignable: false,
    }
}

fn base_roles() -> Vec<RoleRow> {
    vec![
        role("r-admin", "Community Admin", 10, true, admin_actions()),
        role("r-mod", "Moderator", 20, true, moderator_actions()),
        role(
            "r-hosts",
            "Event Hosts",
            30,
            false,
            strs(&["CREATE_MESSAGE", "READ_MESSAGE", "PIN_MESSAGE", "MANAGE_CHANNEL_PERMISSIONS", "SPEAK"]),
        ),
        role(
            "r-long",
            "Very Long Role Name For Weekend Event Organisers Too",
            40,
            false,
            strs(&["READ_MESSAGE", "CREATE_REACTION"]),
        ),
        role("r-bots", "Bots", 50, false, strs(&["CREATE_MESSAGE", "MANAGE_WEBHOOKS"])),
        role("r-member", "Member", 100, true, member_actions()),
    ]
}

/// The roles as `viewer` sees them, with core's flags set as its rank rules would.
fn roles_for(viewer: Viewer, mut roles: Vec<RoleRow>) -> RolesView {
    let (grantable, best, create, update, assign, delete) = match viewer {
        Viewer::Owner => (all_actions(), 0, true, true, true, true),
        Viewer::Admin => (admin_actions(), 10, true, true, true, true),
        Viewer::Moderator => (moderator_actions(), 20, false, false, true, false),
        Viewer::Member => (member_actions(), 100, false, false, false, false),
    };
    for role in &mut roles {
        let below = role.position > best;
        let holds = role.actions.iter().all(|a| grantable.contains(a));
        role.editable = update && below && holds;
        role.deletable = delete && below && !role.is_default;
        role.assignable = assign && below && holds;
    }
    RolesView {
        state: LoadState::Ready,
        community_id: COMMUNITY.into(),
        roles,
        grantable,
        can_create: create,
        can_reorder: update,
        can_reset_defaults: update,
        op: AdminOp::default(),
    }
}

fn many_roles() -> Vec<RoleRow> {
    let mut roles = base_roles();
    let member = roles.pop().expect("member");
    for index in 0..18 {
        let picks: Vec<String> = all_actions()
            .into_iter()
            .skip(index * 3)
            .take(2 + index % 5)
            .collect();
        roles.push(role(
            &format!("r-x{index}"),
            &format!("Squad {:02} \u{2014} {}", index + 1, ["Raids", "Art", "Music", "Dev"][index % 4]),
            60 + index as i32,
            false,
            picks,
        ));
    }
    roles.push(member);
    roles
}

fn error(code: &str, message: &str) -> ErrorView {
    ErrorView {
        code: code.into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn busy() -> AdminOp {
    AdminOp {
        busy: true,
        ..AdminOp::default()
    }
}

fn erred(message: &str) -> AdminOp {
    AdminOp {
        error: Some(error("FORBIDDEN", message)),
        ..AdminOp::default()
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

// ---- Views. ----

/// A story's background, so overlays sit on the app's colour.
struct Frame {
    view: AnyView,
    /// Draw it as the Edit Channel dialog's Permissions tab would.
    channel_dialog: bool,
}

impl Render for Frame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        if !self.channel_dialog {
            return div()
                .size_full()
                .bg(sem.background_default)
                .child(self.view.clone())
                .into_any_element();
        }
        div()
            .id("overrides-frame")
            .size_full()
            .bg(sem.background_default)
            .overflow_y_scroll()
            .flex()
            .justify_center()
            .p(spacing(2.))
            .child(
                div()
                    .w(px(600.))
                    .max_w_full()
                    .h_auto()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .rounded(px(12.))
                    .bg(sem.paper)
                    .p(spacing(3.))
                    .child(
                        text(Variant::H6, "Edit Channel: announcements")
                            .text_color(sem.text_primary),
                    )
                    .child(self.view.clone()),
            )
            .into_any_element()
    }
}

fn framed(view: AnyView, channel_dialog: bool, cx: &mut App) -> AnyView {
    cx.new(|_| Frame {
        view,
        channel_dialog,
    })
    .into()
}

fn panel(
    view: RolesView,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut RolesPanel, &mut Window, &mut Context<RolesPanel>),
) -> AnyView {
    let op = view.op.clone();
    let view_ready = RolesView {
        op: AdminOp::default(),
        ..view
    };
    let inner: AnyView = cx
        .new(|cx| {
            let mut panel = RolesPanel::new(window, cx);
            panel.set_catalog(catalog(), cx);
            panel.set_roles(view_ready.clone(), cx);
            tweak(&mut panel, window, cx);
            panel.set_roles(RolesView { op, ..view_ready }, cx);
            panel
        })
        .into();
    framed(inner, false, cx)
}

fn editing(
    view: RolesView,
    role_id: Option<&'static str>,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut RolesPanel, &mut Window, &mut Context<RolesPanel>) + 'static,
) -> AnyView {
    panel(view, window, cx, move |panel, window, cx| {
        match role_id {
            Some(id) => panel.open_edit(id, window, cx),
            None => panel.open_create(window, cx),
        }
        tweak(panel, window, cx);
    })
}

fn members_dialog(members: Option<RoleMembersView>, window: &mut Window, cx: &mut App) -> AnyView {
    panel(roles_for(Viewer::Owner, base_roles()), window, cx, move |panel, _, cx| {
        panel.show_members("r-mod", cx);
        panel.set_role_members(members, cx);
    })
}

fn assign_dialog(
    roles: RolesView,
    member: MemberRolesView,
    saving: bool,
    cx: &mut App,
    tweak: impl FnOnce(&mut RoleAssignmentDialog, &mut Context<RoleAssignmentDialog>),
) -> AnyView {
    let inner: AnyView = cx
        .new(|cx| {
            let mut dialog = RoleAssignmentDialog::new("u-2".into(), "juniper".into());
            dialog.set_roles(roles, cx);
            dialog.set_member_roles(member, cx);
            tweak(&mut dialog, cx);
            dialog.set_saving(saving, cx);
            dialog
        })
        .into();
    framed(inner, false, cx)
}

fn member_roles(held: &[&str], changeable: &[&str], op: AdminOp) -> MemberRolesView {
    MemberRolesView {
        state: LoadState::Ready,
        user_id: "u-2".into(),
        held: strs(held),
        changeable: strs(changeable),
        op,
    }
}

fn row(target: OverwriteTarget, allow: &[&str], deny: &[&str]) -> OverwriteRow {
    OverwriteRow {
        target,
        allow: strs(allow),
        deny: strs(deny),
    }
}

fn on_role(id: &str, name: &str) -> OverwriteTarget {
    OverwriteTarget::Role {
        role_id: id.into(),
        name: name.into(),
    }
}

fn overwrites(
    state: LoadState,
    rows: Vec<OverwriteRow>,
    editable: bool,
    op: AdminOp,
) -> ChannelOverwritesView {
    ChannelOverwritesView {
        state,
        channel_id: "ch-1".into(),
        preset: ChannelPreset::Normal,
        overwrites: rows,
        editable,
        op,
    }
}

fn read_only_rows() -> Vec<OverwriteRow> {
    vec![
        row(
            OverwriteTarget::Everyone,
            &[],
            &["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"],
        ),
        row(
            on_role("r-admin", "Community Admin"),
            &["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"],
            &[],
        ),
        row(
            on_role("r-hosts", "Event Hosts"),
            &["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"],
            &[],
        ),
    ]
}

fn overrides(
    view: ChannelOverwritesView,
    roles: RolesView,
    cx: &mut App,
    tweak: impl FnOnce(&mut ChannelOverrides, &mut Context<ChannelOverrides>),
) -> AnyView {
    let op = view.op.clone();
    let quiet = ChannelOverwritesView {
        op: AdminOp::default(),
        ..view
    };
    let inner: AnyView = cx
        .new(|cx| {
            let mut editor = ChannelOverrides::new("ch-1".into());
            editor.set_roles(roles, cx);
            editor.set_overwrites(quiet.clone(), cx);
            tweak(&mut editor, cx);
            editor.set_overwrites(ChannelOverwritesView { op, ..quiet }, cx);
            editor
        })
        .into();
    framed(inner, true, cx)
}

fn ready(rows: Vec<OverwriteRow>) -> ChannelOverwritesView {
    overwrites(LoadState::Ready, rows, true, AdminOp::default())
}

pub(super) fn all() -> Vec<Story> {
    let all: Vec<(&'static str, crate::stories::BuildStory)> = vec![
        // ---- The list. ----
        ("roles-loading", |_: &StoryEnv, w, cx| {
            panel(
                RolesView {
                    state: LoadState::Loading,
                    ..RolesView::default()
                },
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("roles-failed", |_, w, cx| {
            panel(
                RolesView {
                    state: LoadState::Failed {
                        error: error("NETWORK", "The server couldn't be reached."),
                    },
                    ..RolesView::default()
                },
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("roles-no-read", |_, w, cx| {
            panel(
                RolesView {
                    state: LoadState::Failed {
                        error: error("FORBIDDEN", "Missing READ_ROLE"),
                    },
                    ..RolesView::default()
                },
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("roles-empty", |_, w, cx| {
            panel(roles_for(Viewer::Owner, Vec::new()), w, cx, |_, _, _| {})
        }),
        ("roles-owner", |_, w, cx| {
            panel(roles_for(Viewer::Owner, base_roles()), w, cx, |_, _, _| {})
        }),
        ("roles-many", |_, w, cx| {
            panel(roles_for(Viewer::Owner, many_roles()), w, cx, |_, _, _| {})
        }),
        ("roles-admin", |_, w, cx| {
            panel(roles_for(Viewer::Admin, base_roles()), w, cx, |_, _, _| {})
        }),
        ("roles-moderator", |_, w, cx| {
            panel(roles_for(Viewer::Moderator, base_roles()), w, cx, |_, _, _| {})
        }),
        ("roles-member", |_, w, cx| {
            panel(roles_for(Viewer::Member, base_roles()), w, cx, |_, _, _| {})
        }),
        ("roles-reorder-busy", |_, w, cx| {
            let mut view = roles_for(Viewer::Owner, base_roles());
            view.op = busy();
            panel(view, w, cx, |panel, _, _| panel.mark_sent(RoleOp::Reorder))
        }),
        ("roles-reorder-error", |_, w, cx| {
            let mut view = roles_for(Viewer::Owner, base_roles());
            view.op = erred("You can't place a role above your own rank.");
            panel(view, w, cx, |panel, _, _| panel.mark_sent(RoleOp::Reorder))
        }),
        ("roles-delete-confirm", |_, w, cx| {
            panel(roles_for(Viewer::Owner, base_roles()), w, cx, |panel, _, cx| {
                panel.ask_delete("r-hosts", cx)
            })
        }),
        ("roles-delete-busy", |_, w, cx| {
            let mut view = roles_for(Viewer::Owner, base_roles());
            view.op = busy();
            panel(view, w, cx, |panel, _, cx| {
                panel.ask_delete("r-hosts", cx);
                panel.mark_sent(RoleOp::Delete {
                    role_id: "r-hosts".into(),
                });
            })
        }),
        ("roles-delete-error", |_, w, cx| {
            let mut view = roles_for(Viewer::Owner, base_roles());
            view.op = erred("You can only delete roles below your highest role.");
            panel(view, w, cx, |panel, _, cx| {
                panel.ask_delete("r-hosts", cx);
                panel.mark_sent(RoleOp::Delete {
                    role_id: "r-hosts".into(),
                });
            })
        }),
        ("roles-reset-confirm", |_, w, cx| {
            panel(roles_for(Viewer::Owner, base_roles()), w, cx, |panel, _, cx| {
                panel.ask_reset(cx)
            })
        }),
        ("role-members", |_, w, cx| {
            members_dialog(
                Some(RoleMembersView {
                    state: LoadState::Ready,
                    role_id: "r-mod".into(),
                    users: vec![
                        user("u-5", "harbor_mod", Some("Harbor")),
                        user("u-6", "sable", Some("Sable Ito")),
                        user("u-9", "an_extraordinarily_long_username_x", Some("Somebody With A Display Name Far Too Long")),
                        user("u-7", "tamsin", None),
                    ],
                }),
                w,
                cx,
            )
        }),
        ("role-members-loading", |_, w, cx| members_dialog(None, w, cx)),
        ("role-members-empty", |_, w, cx| {
            members_dialog(
                Some(RoleMembersView {
                    state: LoadState::Ready,
                    role_id: "r-mod".into(),
                    users: Vec::new(),
                }),
                w,
                cx,
            )
        }),
        ("role-members-failed", |_, w, cx| {
            members_dialog(
                Some(RoleMembersView {
                    state: LoadState::Failed {
                        error: error("NETWORK", "The server couldn't be reached."),
                    },
                    role_id: "r-mod".into(),
                    users: Vec::new(),
                }),
                w,
                cx,
            )
        }),
        // ---- The editor. ----
        ("role-editor-create", |_, w, cx| {
            editing(roles_for(Viewer::Owner, base_roles()), None, w, cx, |panel, window, cx| {
                panel.type_name("Stream Team", window, cx);
                for action in ["CREATE_MESSAGE", "READ_MESSAGE", "SPEAK", "VIDEO"] {
                    panel.toggle_action(action, cx);
                }
            })
        }),
        ("role-editor-create-invalid", |_, w, cx| {
            editing(roles_for(Viewer::Owner, base_roles()), None, w, cx, |panel, _, cx| {
                panel.save(cx)
            })
        }),
        ("role-editor-duplicate", |_, w, cx| {
            editing(roles_for(Viewer::Owner, base_roles()), None, w, cx, |panel, window, cx| {
                panel.type_name("  Event Hosts ", window, cx);
                panel.toggle_action("READ_MESSAGE", cx);
            })
        }),
        ("role-editor-too-long", |_, w, cx| {
            editing(roles_for(Viewer::Owner, base_roles()), None, w, cx, |panel, window, cx| {
                panel.type_name(&"x".repeat(51), window, cx);
                panel.toggle_action("READ_MESSAGE", cx);
            })
        }),
        ("role-editor-default", |_, w, cx| {
            editing(roles_for(Viewer::Owner, base_roles()), Some("r-mod"), w, cx, |panel, _, cx| {
                panel.toggle_action("BAN_USER", cx)
            })
        }),
        ("role-editor-top", |_, w, cx| {
            editing(roles_for(Viewer::Owner, base_roles()), Some("r-admin"), w, cx, |_, _, _| {})
        }),
        ("role-editor-readonly", |_, w, cx| {
            editing(roles_for(Viewer::Admin, base_roles()), Some("r-admin"), w, cx, |_, _, _| {})
        }),
        ("role-editor-ungrantable", |_, w, cx| {
            let mut view = roles_for(Viewer::Admin, base_roles());
            // An admin holding nothing of moderation: those can't be granted.
            view.grantable
                .retain(|a| !a.ends_with("_USER") && !a.contains("MODERATION") && a != "VIEW_BAN_LIST");
            if let Some(role) = view.roles.iter_mut().find(|r| r.id == "r-hosts") {
                role.editable = true;
            }
            editing(view, Some("r-hosts"), w, cx, |_, _, _| {})
        }),
        ("role-editor-unknown", |_, w, cx| {
            let mut roles = base_roles();
            roles[2].actions.extend(strs(&["MANAGE_STAGE_EVENTS", "USE_APPLICATION_COMMANDS"]));
            let mut view = roles_for(Viewer::Owner, roles);
            if let Some(role) = view.roles.iter_mut().find(|r| r.id == "r-hosts") {
                role.editable = true;
            }
            editing(view, Some("r-hosts"), w, cx, |_, _, _| {})
        }),
        ("role-editor-busy", |_, w, cx| {
            let mut view = roles_for(Viewer::Owner, base_roles());
            view.op = busy();
            editing(view, Some("r-hosts"), w, cx, |panel, _, cx| {
                panel.toggle_action("SPEAK", cx);
                panel.mark_sent(RoleOp::Update {
                    role_id: "r-hosts".into(),
                });
            })
        }),
        ("role-editor-error", |_, w, cx| {
            let mut view = roles_for(Viewer::Owner, base_roles());
            view.op = erred("Role with name \"Bots\" already exists in this community");
            editing(view, Some("r-hosts"), w, cx, |panel, window, cx| {
                panel.type_name("Bots ", window, cx);
                panel.mark_sent(RoleOp::Update {
                    role_id: "r-hosts".into(),
                });
            })
        }),
        // ---- The assignment dialog. ----
        ("role-assign", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Admin, base_roles()),
                member_roles(&["r-member", "r-hosts"], &["r-mod", "r-hosts", "r-long", "r-bots", "r-member"], AdminOp::default()),
                false,
                cx,
                |dialog, cx| dialog.toggle("r-mod", cx),
            )
        }),
        ("role-assign-rank", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Moderator, base_roles()),
                member_roles(&["r-member", "r-admin"], &[], AdminOp::default()),
                false,
                cx,
                |_, _| {},
            )
        }),
        ("role-assign-some-locked", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Moderator, base_roles()),
                member_roles(&["r-member"], &["r-long", "r-bots"], AdminOp::default()),
                false,
                cx,
                |dialog, cx| dialog.toggle("r-bots", cx),
            )
        }),
        ("role-assign-loading", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Admin, base_roles()),
                MemberRolesView {
                    state: LoadState::Loading,
                    ..MemberRolesView::default()
                },
                false,
                cx,
                |_, _| {},
            )
        }),
        ("role-assign-failed", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Admin, base_roles()),
                MemberRolesView {
                    state: LoadState::Failed {
                        error: error("NETWORK", "The server couldn't be reached."),
                    },
                    ..MemberRolesView::default()
                },
                false,
                cx,
                |_, _| {},
            )
        }),
        ("role-assign-busy", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Admin, base_roles()),
                member_roles(&["r-member"], &["r-mod", "r-hosts", "r-long", "r-bots", "r-member"], busy()),
                true,
                cx,
                |dialog, cx| dialog.toggle("r-mod", cx),
            )
        }),
        ("role-assign-error", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Admin, base_roles()),
                member_roles(
                    &["r-member", "r-mod"],
                    &["r-mod", "r-hosts", "r-long", "r-bots", "r-member"],
                    erred("You can only change roles of members ranked below you."),
                ),
                false,
                cx,
                |dialog, cx| dialog.toggle("r-hosts", cx),
            )
        }),
        // ---- Channel presets. ----
        ("overrides-loading", |_, _, cx| {
            overrides(
                overwrites(LoadState::Loading, Vec::new(), true, AdminOp::default()),
                roles_for(Viewer::Owner, base_roles()),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-failed", |_, _, cx| {
            overrides(
                overwrites(
                    LoadState::Failed {
                        error: error("NETWORK", "The server couldn't be reached."),
                    },
                    Vec::new(),
                    true,
                    AdminOp::default(),
                ),
                roles_for(Viewer::Owner, base_roles()),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-normal", |_, _, cx| {
            overrides(ready(Vec::new()), roles_for(Viewer::Owner, base_roles()), cx, |_, _| {})
        }),
        ("overrides-no-attach", |_, _, cx| {
            overrides(
                ready(vec![row(OverwriteTarget::Everyone, &[], &["ATTACH_FILES"])]),
                roles_for(Viewer::Owner, base_roles()),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-read-only", |_, _, cx| {
            overrides(ready(read_only_rows()), roles_for(Viewer::Owner, base_roles()), cx, |_, _| {})
        }),
        ("overrides-announcement-kept", |_, _, cx| {
            overrides(
                ready(vec![
                    row(OverwriteTarget::Everyone, &[], &["CREATE_MESSAGE", "ATTACH_FILES"]),
                    row(on_role("r-admin", "Community Admin"), &["CREATE_MESSAGE", "ATTACH_FILES"], &[]),
                    row(on_role("r-hosts", "Event Hosts"), &["CREATE_MESSAGE", "ATTACH_FILES"], &[]),
                ]),
                roles_for(Viewer::Admin, base_roles()),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-dirty", |_, _, cx| {
            overrides(ready(Vec::new()), roles_for(Viewer::Admin, base_roles()), cx, |editor, cx| {
                editor.choose(super::Card::Announcement, cx);
                editor.toggle_poster("r-bots", cx);
            })
        }),
        ("overrides-missing", |_, _, cx| {
            let mut roles = roles_for(Viewer::Moderator, base_roles());
            roles.grantable.retain(|a| a != "ATTACH_FILES" && a != "CREATE_REACTION");
            overrides(ready(Vec::new()), roles, cx, |_, _| {})
        }),
        ("overrides-custom", |_, _, cx| {
            overrides(
                ready(vec![
                    row(OverwriteTarget::Everyone, &[], &["SPEAK", "SCREEN_SHARE"]),
                    row(on_role("r-mod", "Moderator"), &["SPEAK", "MUTE_PARTICIPANT"], &[]),
                    row(on_role("r-hosts", "Event Hosts"), &["SCREEN_SHARE"], &["PIN_MESSAGE"]),
                ]),
                roles_for(Viewer::Owner, base_roles()),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-deleted-role", |_, _, cx| {
            overrides(
                ready(vec![
                    row(OverwriteTarget::Everyone, &[], &["CREATE_MESSAGE"]),
                    row(on_role("r-gone", "r-gone"), &["CREATE_MESSAGE", "MANAGE_STAGE_EVENTS"], &[]),
                ]),
                roles_for(Viewer::Owner, base_roles()),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-not-editable", |_, _, cx| {
            overrides(
                overwrites(LoadState::Ready, read_only_rows(), false, AdminOp::default()),
                roles_for(Viewer::Member, base_roles()),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-busy", |_, _, cx| {
            overrides(
                overwrites(LoadState::Ready, Vec::new(), true, busy()),
                roles_for(Viewer::Owner, base_roles()),
                cx,
                |editor, cx| {
                    editor.choose(super::Card::ReadOnly, cx);
                    editor.mark_sent();
                },
            )
        }),
        ("overrides-error", |_, _, cx| {
            overrides(
                overwrites(
                    LoadState::Ready,
                    Vec::new(),
                    true,
                    erred("This would remove SPEAK from roles above yours; add allows for them or ask an admin"),
                ),
                roles_for(Viewer::Owner, base_roles()),
                cx,
                |editor, cx| {
                    editor.choose(super::Card::ReadOnly, cx);
                    editor.mark_sent();
                },
            )
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
