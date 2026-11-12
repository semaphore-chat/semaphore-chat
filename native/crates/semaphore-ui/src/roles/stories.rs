//! The roles stories: the role list for each kind of member (owner, admin, moderator, member),
//! while it loads or fails, with many roles, moving, deleting and resetting (busy, failed), who
//! holds a role; the editor creating, invalid, a duplicate name, a default role, the top role, a
//! role above mine read-only, permissions I can't grant, an unknown action, busy and failed; the
//! assignment dialog; and a channel's presets in each state. `rigs/shot/scripts/w5-roles.steps`
//! renders them on a desktop and a phone.

use super::{ChannelOverrides, RoleAssignmentDialog, RolesPanel};
use crate::kit::{Variant, spacing, text};
use crate::messages::fixture::NOW_MS;
use crate::stories::{Story, StoryEnv};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionState, AdminOp, ChannelOverwritesView, ChannelPreset,
    DetectedPreset, ErrorView, LoadState, MemberRolesView, NotAllowed, OverwriteRoleOption,
    OverwriteRow, OverwriteTarget, PermissionGroup, PresetAccess, RoleBlock, RoleMembersView,
    RoleRow, RolesView, UserView,
};

const DAY: i64 = 24 * 60 * 60 * 1000;

const COMMUNITY: &str = "community-1";

// ---- Fixtures. ----

/// Core's catalog (`commands/roles.rs` `CATALOG`), as `Core::permission_catalog` returns it.
pub(super) fn catalog() -> Vec<PermissionGroup> {
    let groups: &[(&str, &[&str])] = &[
        (
            "messages",
            &["CREATE_MESSAGE", "DELETE_MESSAGE", "READ_MESSAGE"],
        ),
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
        (
            "voice",
            &["SPEAK", "VIDEO", "SCREEN_SHARE", "CAPTURE_REPLAY"],
        ),
        (
            "community",
            &[
                "UPDATE_COMMUNITY",
                "DELETE_COMMUNITY",
                "READ_COMMUNITY",
                "READ_ALL_COMMUNITIES",
            ],
        ),
        (
            "members",
            &[
                "CREATE_MEMBER",
                "UPDATE_MEMBER",
                "DELETE_MEMBER",
                "READ_MEMBER",
            ],
        ),
        (
            "roles",
            &["CREATE_ROLE", "UPDATE_ROLE", "DELETE_ROLE", "READ_ROLE"],
        ),
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
            &[
                "READ_SOUNDBOARD_SOUND",
                "CREATE_SOUNDBOARD_SOUND",
                "DELETE_SOUNDBOARD_SOUND",
            ],
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
        fixed: is_default && name == "Member",
        created_at_ms: Some(NOW_MS - i64::from(position) * 3 * DAY),
        ..RoleRow::default()
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
            strs(&[
                "CREATE_MESSAGE",
                "READ_MESSAGE",
                "PIN_MESSAGE",
                "MANAGE_CHANNEL_PERMISSIONS",
                "SPEAK",
            ]),
        ),
        role(
            "r-long",
            "Very Long Role Name For Weekend Event Organisers Too",
            40,
            false,
            strs(&["READ_MESSAGE", "CREATE_REACTION"]),
        ),
        role(
            "r-bots",
            "Bots",
            50,
            false,
            strs(&["CREATE_MESSAGE", "MANAGE_WEBHOOKS"]),
        ),
        role("r-member", "Member", 100, true, member_actions()),
    ]
}

fn viewer_rank(viewer: Viewer) -> (Vec<String>, i32, [bool; 4]) {
    // grantable, best position, [create, update, assign, delete]
    match viewer {
        Viewer::Owner => (all_actions(), 0, [true; 4]),
        Viewer::Admin => (admin_actions(), 10, [true; 4]),
        Viewer::Moderator => (moderator_actions(), 20, [false, false, true, false]),
        Viewer::Member => (member_actions(), 100, [false; 4]),
    }
}

/// The roles as `viewer` sees them, with core's flags set as its rank rules would.
fn roles_for(viewer: Viewer, mut roles: Vec<RoleRow>) -> RolesView {
    let (grantable, best, [create, update, assign, delete]) = viewer_rank(viewer);
    let below: Vec<bool> = roles.iter().map(|role| role.position > best).collect();
    let count = roles.len();
    for (index, role) in roles.iter_mut().enumerate() {
        let holds = role.actions.iter().all(|a| grantable.contains(a));
        let reason = |allowed: bool| {
            if !allowed {
                Some(RoleBlock::Missing)
            } else if !below[index] {
                Some(RoleBlock::Rank)
            } else {
                None
            }
        };
        role.edit_blocked = reason(update).or((!holds).then_some(RoleBlock::HoldsUngrantable));
        role.editable = role.edit_blocked.is_none();
        role.delete_blocked = if role.is_default {
            Some(RoleBlock::DefaultRole)
        } else {
            reason(delete)
        };
        role.deletable = role.delete_blocked.is_none();
        role.assign_blocked = reason(assign).or((!holds).then_some(RoleBlock::HoldsUngrantable));
        role.assignable = role.assign_blocked.is_none();
        let movable = |at: usize| at < count && below[at];
        role.can_move_up = update && !role.fixed && below[index] && index > 0 && movable(index - 1);
        role.can_move_down =
            update && !role.fixed && below[index] && index + 2 < count && movable(index + 1);
    }
    RolesView {
        state: LoadState::Ready,
        community_id: COMMUNITY.into(),
        roles,
        grantable,
        can_create: create,
        can_reorder: update,
        can_reset_defaults: update,
        can_read: true,
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
            &format!(
                "Squad {:02} \u{2014} {}",
                index + 1,
                ["Raids", "Art", "Music", "Dev"][index % 4]
            ),
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

fn entry(
    kind: AdminActionKind,
    target: Option<&str>,
    busy: bool,
    error: Option<&str>,
) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: target.map(str::to_owned),
        },
        busy,
        upload: None,
        error: error.map(|message| self::error("FORBIDDEN", message)),
    }
}

fn running(kind: AdminActionKind, target: Option<&str>) -> AdminActionState {
    entry(kind, target, true, None)
}

fn failed(kind: AdminActionKind, target: Option<&str>, message: &str) -> AdminActionState {
    entry(kind, target, false, Some(message))
}

/// An op with these changes running or failed, as core shows it.
fn op(actions: Vec<AdminActionState>) -> AdminOp {
    let last = actions.last().cloned();
    AdminOp {
        busy: actions.iter().any(|a| a.busy),
        upload: None,
        error: last.as_ref().and_then(|a| a.error.clone()),
        action: last.map(|a| a.action),
        actions,
        finished: Vec::new(),
    }
}

fn with_op(mut view: RolesView, actions: Vec<AdminActionState>) -> RolesView {
    view.op = op(actions);
    view
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
            .items_start()
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
    let inner: AnyView = cx
        .new(|cx| {
            let mut panel = RolesPanel::new(window, cx);
            panel.set_catalog(catalog(), cx);
            panel.set_roles(view, cx);
            tweak(&mut panel, window, cx);
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
    panel(
        roles_for(Viewer::Owner, base_roles()),
        window,
        cx,
        move |panel, _, cx| {
            panel.show_members("r-mod", cx);
            panel.set_role_members(members, cx);
        },
    )
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
            dialog.set_member_roles(
                MemberRolesView {
                    op: AdminOp::default(),
                    ..member.clone()
                },
                cx,
            );
            tweak(&mut dialog, cx);
            dialog.set_member_roles(member, cx);
            dialog.set_saving(saving, cx);
            dialog
        })
        .into();
    framed(inner, false, cx)
}

fn member_roles(
    held: &[&str],
    changeable: &[&str],
    not_allowed: Option<NotAllowed>,
    actions: Vec<AdminActionState>,
) -> MemberRolesView {
    MemberRolesView {
        state: LoadState::Ready,
        user_id: "u-2".into(),
        held: strs(held),
        changeable: strs(changeable),
        not_allowed,
        op: op(actions),
    }
}

fn row(target: OverwriteTarget, allow: &[&str], deny: &[&str]) -> OverwriteRow {
    OverwriteRow {
        target,
        allow: strs(allow),
        deny: strs(deny),
        role_missing: false,
    }
}

fn on_role(id: &str, name: &str) -> OverwriteTarget {
    OverwriteTarget::Role {
        role_id: id.into(),
        name: name.into(),
    }
}

fn detected(preset: ChannelPreset, posters: &[&str], attach: bool) -> DetectedPreset {
    DetectedPreset {
        preset,
        post_role_ids: strs(posters),
        members_can_attach: attach,
    }
}

/// A channel's overrides as `viewer` sees them, with core's preset data for them.
fn overwrites(
    viewer: Viewer,
    state: LoadState,
    rows: Vec<OverwriteRow>,
    found: DetectedPreset,
    editable: bool,
    actions: Vec<AdminActionState>,
) -> ChannelOverwritesView {
    let (grantable, best, _) = viewer_rank(viewer);
    let roles = base_roles();
    let preset_access = [
        (ChannelPreset::Normal, vec!["ATTACH_FILES"]),
        (
            ChannelPreset::ReadOnly,
            vec!["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"],
        ),
        (
            ChannelPreset::Announcement,
            vec!["CREATE_MESSAGE", "ATTACH_FILES"],
        ),
    ]
    .into_iter()
    .map(|(preset, denies)| PresetAccess {
        preset,
        missing: denies
            .into_iter()
            .filter(|a| !grantable.iter().any(|g| g == a))
            .map(str::to_owned)
            .collect(),
    })
    .collect();
    ChannelOverwritesView {
        state,
        channel_id: "ch-1".into(),
        preset: found.preset,
        overwrites: rows,
        editable,
        default_post_role_ids: roles
            .iter()
            .filter(|r| {
                r.position > best && r.actions.iter().any(|a| a == "MANAGE_CHANNEL_PERMISSIONS")
            })
            .map(|r| r.id.clone())
            .collect(),
        roles: roles
            .iter()
            .map(|r| OverwriteRoleOption {
                id: r.id.clone(),
                name: r.name.clone(),
                position: r.position,
                below_me: r.position > best,
            })
            .collect(),
        detected: found,
        preset_access,
        op: op(actions),
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
    cx: &mut App,
    tweak: impl FnOnce(&mut ChannelOverrides, &mut Context<ChannelOverrides>),
) -> AnyView {
    let quiet = ChannelOverwritesView {
        op: AdminOp::default(),
        ..view.clone()
    };
    let inner: AnyView = cx
        .new(|cx| {
            let mut editor = ChannelOverrides::new("ch-1".into());
            editor.set_overwrites(quiet, cx);
            tweak(&mut editor, cx);
            editor.set_overwrites(view, cx);
            editor
        })
        .into();
    framed(inner, true, cx)
}

fn ready(viewer: Viewer, rows: Vec<OverwriteRow>, found: DetectedPreset) -> ChannelOverwritesView {
    overwrites(viewer, LoadState::Ready, rows, found, true, Vec::new())
}

use AdminActionKind as K;

pub(super) fn all() -> Vec<Story> {
    let all: Vec<(&'static str, crate::stories::BuildStory)> = vec![
        // ---- The list. ----
        ("roles-loading", |_: &StoryEnv, w, cx| {
            panel(
                RolesView {
                    state: LoadState::Loading,
                    can_read: true,
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
                    can_read: true,
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
                    state: LoadState::Ready,
                    can_read: false,
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
            panel(
                roles_for(Viewer::Moderator, base_roles()),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("roles-member", |_, w, cx| {
            panel(roles_for(Viewer::Member, base_roles()), w, cx, |_, _, _| {})
        }),
        ("roles-reorder-busy", |_, w, cx| {
            let view = with_op(
                roles_for(Viewer::Owner, base_roles()),
                vec![running(K::ReorderRoles, None)],
            );
            panel(view, w, cx, |_, _, _| {})
        }),
        ("roles-reorder-error", |_, w, cx| {
            let view = with_op(
                roles_for(Viewer::Owner, base_roles()),
                vec![failed(
                    K::ReorderRoles,
                    None,
                    "You can't place a role above your own rank.",
                )],
            );
            panel(view, w, cx, |_, _, _| {})
        }),
        ("roles-delete-confirm", |_, w, cx| {
            panel(
                roles_for(Viewer::Owner, base_roles()),
                w,
                cx,
                |panel, _, cx| panel.ask_delete("r-hosts", cx),
            )
        }),
        ("roles-delete-busy", |_, w, cx| {
            let view = with_op(
                roles_for(Viewer::Owner, base_roles()),
                vec![running(K::DeleteRole, Some("r-hosts"))],
            );
            panel(view, w, cx, |_, _, _| {})
        }),
        ("roles-delete-error", |_, w, cx| {
            let view = with_op(
                roles_for(Viewer::Owner, base_roles()),
                vec![failed(
                    K::DeleteRole,
                    Some("r-hosts"),
                    "You can only delete roles below your highest role.",
                )],
            );
            panel(view, w, cx, |_, _, _| {})
        }),
        ("roles-overlapping", |_, w, cx| {
            // Two deletes at once, one running and one failed, while the defaults reset.
            let view = with_op(
                roles_for(Viewer::Owner, base_roles()),
                vec![
                    failed(
                        K::DeleteRole,
                        Some("r-hosts"),
                        "Role is in use by a channel override.",
                    ),
                    running(K::DeleteRole, Some("r-bots")),
                    running(K::ResetDefaults, None),
                ],
            );
            panel(view, w, cx, |_, _, _| {})
        }),
        ("roles-reset-confirm", |_, w, cx| {
            panel(
                roles_for(Viewer::Owner, base_roles()),
                w,
                cx,
                |panel, _, cx| panel.ask_reset(cx),
            )
        }),
        ("role-members", |_, w, cx| {
            members_dialog(
                Some(RoleMembersView {
                    state: LoadState::Ready,
                    role_id: "r-mod".into(),
                    users: vec![
                        user("u-5", "harbor_mod", Some("Harbor")),
                        user("u-6", "sable", Some("Sable Ito")),
                        user(
                            "u-9",
                            "an_extraordinarily_long_username_x",
                            Some("Somebody With A Display Name Far Too Long"),
                        ),
                        user("u-7", "tamsin", None),
                    ],
                }),
                w,
                cx,
            )
        }),
        ("role-members-loading", |_, w, cx| {
            members_dialog(None, w, cx)
        }),
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
            editing(
                roles_for(Viewer::Owner, base_roles()),
                None,
                w,
                cx,
                |panel, window, cx| {
                    panel.type_name("Stream Team", window, cx);
                    for action in ["CREATE_MESSAGE", "READ_MESSAGE", "SPEAK", "VIDEO"] {
                        panel.toggle_action(action, cx);
                    }
                },
            )
        }),
        ("role-editor-create-invalid", |_, w, cx| {
            editing(
                roles_for(Viewer::Owner, base_roles()),
                None,
                w,
                cx,
                |panel, _, cx| panel.save(cx),
            )
        }),
        ("role-editor-duplicate", |_, w, cx| {
            editing(
                roles_for(Viewer::Owner, base_roles()),
                None,
                w,
                cx,
                |panel, window, cx| {
                    panel.type_name("  Event Hosts ", window, cx);
                    panel.toggle_action("READ_MESSAGE", cx);
                },
            )
        }),
        ("role-editor-too-long", |_, w, cx| {
            editing(
                roles_for(Viewer::Owner, base_roles()),
                None,
                w,
                cx,
                |panel, window, cx| {
                    panel.type_name(&"x".repeat(51), window, cx);
                    panel.toggle_action("READ_MESSAGE", cx);
                },
            )
        }),
        ("role-editor-default", |_, w, cx| {
            editing(
                roles_for(Viewer::Owner, base_roles()),
                Some("r-mod"),
                w,
                cx,
                |panel, _, cx| panel.toggle_action("BAN_USER", cx),
            )
        }),
        ("role-editor-top", |_, w, cx| {
            editing(
                roles_for(Viewer::Owner, base_roles()),
                Some("r-admin"),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("role-editor-readonly", |_, w, cx| {
            editing(
                roles_for(Viewer::Admin, base_roles()),
                Some("r-admin"),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("role-editor-ungrantable", |_, w, cx| {
            let mut view = roles_for(Viewer::Admin, base_roles());
            // An admin holding nothing of moderation: those can't be granted.
            view.grantable.retain(|a| {
                !a.ends_with("_USER") && !a.contains("MODERATION") && a != "VIEW_BAN_LIST"
            });
            editing(view, Some("r-hosts"), w, cx, |panel, _, cx| {
                // Moderation first, so the shot shows it.
                let mut groups = catalog();
                groups.sort_by_key(|g| g.id != "moderation");
                panel.set_catalog(groups, cx);
                panel.collapse_all_but(&["moderation"], cx)
            })
        }),
        ("role-editor-unknown", |_, w, cx| {
            let mut roles = base_roles();
            // Only message actions this build knows, and two it doesn't.
            roles[2].actions = strs(&[
                "CREATE_MESSAGE",
                "READ_MESSAGE",
                "MANAGE_STAGE_EVENTS",
                "USE_APPLICATION_COMMANDS",
            ]);
            let mut view = roles_for(Viewer::Owner, roles);
            if let Some(role) = view.roles.iter_mut().find(|r| r.id == "r-hosts") {
                role.editable = true;
                role.edit_blocked = None;
            }
            editing(view, Some("r-hosts"), w, cx, |panel, _, cx| {
                // A short catalog, so the shot reaches "Other".
                let groups = catalog().into_iter().take(1).collect();
                panel.set_catalog(groups, cx);
                panel.collapse_all_but(&["messages", super::rules::OTHER_GROUP], cx)
            })
        }),
        ("role-editor-busy", |_, w, cx| {
            let view = with_op(
                roles_for(Viewer::Owner, base_roles()),
                vec![running(K::UpdateRole, Some("r-hosts"))],
            );
            editing(view, Some("r-hosts"), w, cx, |_, _, _| {})
        }),
        ("role-editor-error", |_, w, cx| {
            let view = with_op(
                roles_for(Viewer::Owner, base_roles()),
                vec![failed(
                    K::UpdateRole,
                    Some("r-hosts"),
                    "Role with name \"Bots\" already exists in this community",
                )],
            );
            editing(view, Some("r-hosts"), w, cx, |panel, window, cx| {
                panel.type_name("Bots ", window, cx);
            })
        }),
        // ---- The assignment dialog. ----
        ("role-assign", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Admin, base_roles()),
                member_roles(
                    &["r-member", "r-hosts"],
                    &["r-mod", "r-hosts", "r-long", "r-bots", "r-member"],
                    None,
                    Vec::new(),
                ),
                false,
                cx,
                |dialog, cx| dialog.toggle("r-mod", cx),
            )
        }),
        ("role-assign-rank", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Moderator, base_roles()),
                member_roles(
                    &["r-member", "r-admin"],
                    &[],
                    Some(NotAllowed::Rank),
                    Vec::new(),
                ),
                false,
                cx,
                |_, _| {},
            )
        }),
        ("role-assign-some-locked", |_, _, cx| {
            assign_dialog(
                roles_for(Viewer::Moderator, base_roles()),
                member_roles(&["r-member"], &["r-long", "r-bots"], None, Vec::new()),
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
                member_roles(
                    &["r-member"],
                    &["r-mod", "r-hosts", "r-long", "r-bots", "r-member"],
                    None,
                    vec![running(K::AssignRole, Some("r-mod"))],
                ),
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
                    None,
                    vec![failed(
                        K::AssignRole,
                        Some("r-hosts"),
                        "You can only change roles of members ranked below you.",
                    )],
                ),
                false,
                cx,
                |dialog, cx| dialog.toggle("r-hosts", cx),
            )
        }),
        // ---- Channel presets. ----
        ("overrides-loading", |_, _, cx| {
            overrides(
                overwrites(
                    Viewer::Owner,
                    LoadState::Loading,
                    Vec::new(),
                    detected(ChannelPreset::Normal, &[], true),
                    true,
                    Vec::new(),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-failed", |_, _, cx| {
            overrides(
                overwrites(
                    Viewer::Owner,
                    LoadState::Failed {
                        error: error("NETWORK", "The server couldn't be reached."),
                    },
                    Vec::new(),
                    detected(ChannelPreset::Normal, &[], true),
                    true,
                    Vec::new(),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-normal", |_, _, cx| {
            overrides(
                ready(
                    Viewer::Owner,
                    Vec::new(),
                    detected(ChannelPreset::Normal, &[], true),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-no-attach", |_, _, cx| {
            overrides(
                ready(
                    Viewer::Owner,
                    vec![row(OverwriteTarget::Everyone, &[], &["ATTACH_FILES"])],
                    detected(ChannelPreset::Normal, &[], false),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-read-only", |_, _, cx| {
            overrides(
                ready(
                    Viewer::Owner,
                    read_only_rows(),
                    detected(ChannelPreset::ReadOnly, &["r-admin", "r-hosts"], false),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-announcement-kept", |_, _, cx| {
            overrides(
                ready(
                    Viewer::Admin,
                    vec![
                        row(
                            OverwriteTarget::Everyone,
                            &[],
                            &["CREATE_MESSAGE", "ATTACH_FILES"],
                        ),
                        row(
                            on_role("r-admin", "Community Admin"),
                            &["CREATE_MESSAGE", "ATTACH_FILES"],
                            &[],
                        ),
                        row(
                            on_role("r-hosts", "Event Hosts"),
                            &["CREATE_MESSAGE", "ATTACH_FILES"],
                            &[],
                        ),
                    ],
                    detected(ChannelPreset::Announcement, &["r-admin", "r-hosts"], false),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-dirty", |_, _, cx| {
            overrides(
                ready(
                    Viewer::Admin,
                    Vec::new(),
                    detected(ChannelPreset::Normal, &[], true),
                ),
                cx,
                |editor, cx| {
                    editor.choose(super::Card::Announcement, cx);
                    editor.toggle_poster("r-bots", cx);
                    editor.set_kept(Some(vec!["r-admin".into()]), cx);
                },
            )
        }),
        ("overrides-missing", |_, _, cx| {
            overrides(
                ready(
                    Viewer::Moderator,
                    Vec::new(),
                    detected(ChannelPreset::Normal, &[], true),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-custom", |_, _, cx| {
            overrides(
                ready(
                    Viewer::Owner,
                    vec![
                        row(OverwriteTarget::Everyone, &[], &["SPEAK", "SCREEN_SHARE"]),
                        row(
                            on_role("r-mod", "Moderator"),
                            &["SPEAK", "MUTE_PARTICIPANT"],
                            &[],
                        ),
                        row(
                            on_role("r-hosts", "Event Hosts"),
                            &["SCREEN_SHARE"],
                            &["PIN_MESSAGE"],
                        ),
                    ],
                    detected(ChannelPreset::Custom, &[], true),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-deleted-role", |_, _, cx| {
            let mut gone = row(
                on_role("r-gone", "r-gone"),
                &["CREATE_MESSAGE", "MANAGE_STAGE_EVENTS"],
                &[],
            );
            gone.role_missing = true;
            overrides(
                ready(
                    Viewer::Owner,
                    vec![
                        row(OverwriteTarget::Everyone, &[], &["CREATE_MESSAGE"]),
                        gone,
                    ],
                    detected(ChannelPreset::Custom, &[], true),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-not-editable", |_, _, cx| {
            overrides(
                overwrites(
                    Viewer::Member,
                    LoadState::Ready,
                    read_only_rows(),
                    detected(ChannelPreset::ReadOnly, &["r-admin", "r-hosts"], false),
                    false,
                    Vec::new(),
                ),
                cx,
                |_, _| {},
            )
        }),
        ("overrides-busy", |_, _, cx| {
            overrides(
                overwrites(
                    Viewer::Owner,
                    LoadState::Ready,
                    Vec::new(),
                    detected(ChannelPreset::Normal, &[], true),
                    true,
                    vec![running(K::ReplaceOverwrites, Some("ch-1"))],
                ),
                cx,
                |editor, cx| editor.choose(super::Card::ReadOnly, cx),
            )
        }),
        ("overrides-error", |_, _, cx| {
            overrides(
                overwrites(
                    Viewer::Owner,
                    LoadState::Ready,
                    Vec::new(),
                    detected(ChannelPreset::Normal, &[], true),
                    true,
                    vec![failed(
                        K::ReplaceOverwrites,
                        Some("ch-1"),
                        "This would remove SPEAK from roles above yours; add allows for them or ask an admin",
                    )],
                ),
                cx,
                |editor, cx| editor.choose(super::Card::ReadOnly, cx),
            )
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
