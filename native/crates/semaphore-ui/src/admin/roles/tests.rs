//! The instance roles page in a window: what its controls send (a new and an edited role, the
//! disabled edit and delete, the users dialog) and how the caps gate it.

use super::rules::action_order;
use super::{InstanceRolesEvent, InstanceRolesPage};
use crate::admin::storage::{StorageEvent, StoragePage};
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::*;
use semaphore_core::model::{
    InstanceAdminCaps, InstanceRoleDraft, InstanceRoleRow, InstanceRoleUsersView,
    InstanceRolesView, LoadState, UserView,
};

// ---- Fixtures. ----

fn caps() -> InstanceAdminCaps {
    InstanceAdminCaps {
        roles_read: true,
        roles_write: true,
        is_owner: true,
        full_authority: true,
        ..InstanceAdminCaps::default()
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
    editable: bool,
    deletable: bool,
) -> InstanceRoleRow {
    InstanceRoleRow {
        id: id.into(),
        actions: strings(actions),
        name: name.into(),
        is_default,
        position: 0,
        editable,
        deletable,
    }
}

fn ready() -> InstanceRolesView {
    InstanceRolesView {
        state: LoadState::Ready,
        roles: vec![
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
                true,
                false,
            ),
            role(
                "r-support",
                "Support",
                &["READ_USER", "UPDATE_USER"],
                false,
                true,
                true,
            ),
            role(
                "r-senior",
                "Senior Staff",
                &["READ_USER", "UPDATE_USER", "DELETE_USER"],
                false,
                false,
                false,
            ),
        ],
        grantable: action_order(),
        ..InstanceRolesView::default()
    }
}

fn roles_rig(
    cx: &mut TestAppContext,
    view: InstanceRolesView,
    caps: InstanceAdminCaps,
) -> Rig<InstanceRolesPage, InstanceRolesEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut page = InstanceRolesPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        page
    })
}

fn ready_rig(cx: &mut TestAppContext) -> Rig<InstanceRolesPage, InstanceRolesEvent> {
    roles_rig(cx, ready(), caps())
}

fn type_name(
    rig: &Rig<InstanceRolesPage, InstanceRolesEvent>,
    cx: &mut TestAppContext,
    text: &str,
) {
    let text = text.to_owned();
    rig.with(cx, |page, window, cx| {
        page.update(cx, |page, cx| page.type_name(&text, window, cx))
    });
}

fn feed_users(rig: &Rig<InstanceRolesPage, InstanceRolesEvent>, cx: &mut TestAppContext) {
    rig.with(cx, |page, _, cx| {
        page.update(cx, |page, cx| {
            page.set_role_users(
                Some(InstanceRoleUsersView {
                    state: LoadState::Ready,
                    role_id: "r-support".into(),
                    users: vec![UserView {
                        id: "u-maple".into(),
                        username: "maple".into(),
                        display_name: Some("Maple".into()),
                        avatar_file_id: None,
                    }],
                    ..InstanceRoleUsersView::default()
                }),
                cx,
            )
        })
    });
}

// ---- Tests. ----

#[gpui_kit::test]
fn roles_editor_sends_the_draft(cx: &mut TestAppContext) {
    let rig = ready_rig(cx);
    rig.click(cx, "admin-roles-new");
    type_name(&rig, cx, "  Support Team  ");
    rig.click(cx, "admin-role-action-READ_USER");
    rig.click(cx, "admin-role-editor-save");
    assert_eq!(
        rig.events(),
        [InstanceRolesEvent::Create(InstanceRoleDraft {
            name: "Support Team".into(),
            actions: strings(&["READ_USER"]),
        })]
    );
}

#[gpui_kit::test]
fn roles_editor_checks_name_and_actions(cx: &mut TestAppContext) {
    let rig = ready_rig(cx);
    rig.click(cx, "admin-roles-new");
    rig.click(cx, "admin-role-editor-save");
    assert!(rig.events().is_empty(), "no name");

    type_name(&rig, cx, "Bots");
    rig.click(cx, "admin-role-editor-save");
    assert!(rig.events().is_empty(), "no permission");
    assert!(rig.has(cx, "admin-role-editor-actions-error"));

    type_name(&rig, cx, &"x".repeat(51));
    rig.click(cx, "admin-role-action-READ_USER");
    rig.click(cx, "admin-role-editor-save");
    assert!(rig.events().is_empty(), "a name past 50 characters");

    type_name(&rig, cx, "Bots");
    rig.click(cx, "admin-role-editor-save");
    assert_eq!(
        rig.events(),
        [InstanceRolesEvent::Create(InstanceRoleDraft {
            name: "Bots".into(),
            actions: strings(&["READ_USER"]),
        })]
    );
}

#[gpui_kit::test]
fn a_default_role_keeps_its_name(cx: &mut TestAppContext) {
    let rig = ready_rig(cx);
    rig.click(cx, "admin-role-edit-r-admin");
    // The field is locked, but even a value put into it must not reach the server.
    type_name(&rig, cx, "Renamed");
    rig.click(cx, "admin-role-action-BAN_USER");
    rig.click(cx, "admin-role-editor-save");
    let mut expected = action_order();
    expected.retain(|action| action != "BAN_USER");
    assert_eq!(
        rig.events(),
        [InstanceRolesEvent::Update {
            role_id: "r-admin".into(),
            draft: InstanceRoleDraft {
                name: "Instance Admin".into(),
                actions: expected,
            },
        }]
    );
}

#[gpui_kit::test]
fn ungrantable_actions_stay_off(cx: &mut TestAppContext) {
    let view = InstanceRolesView {
        grantable: strings(&["READ_USER"]),
        ..ready()
    };
    let rig = roles_rig(cx, view, caps());
    rig.click(cx, "admin-roles-new");
    type_name(&rig, cx, "Bots");
    // The ungrantable box is off with its reason; nothing can turn it on.
    assert!(rig.has(cx, "admin-role-action-BAN_USER-locked"));
    rig.with(cx, |page, _, cx| {
        page.update(cx, |page, cx| page.toggle_action("BAN_USER", cx))
    });
    rig.click(cx, "admin-role-action-READ_USER");
    rig.click(cx, "admin-role-editor-save");
    assert_eq!(
        rig.events(),
        [InstanceRolesEvent::Create(InstanceRoleDraft {
            name: "Bots".into(),
            actions: strings(&["READ_USER"]),
        })]
    );
}

#[gpui_kit::test]
fn delete_confirm_sends_delete(cx: &mut TestAppContext) {
    let rig = ready_rig(cx);
    rig.click(cx, "admin-role-delete-r-support");
    assert!(rig.has(cx, "admin-role-delete-confirm"));
    rig.click(cx, "admin-role-delete-confirm");
    assert_eq!(
        rig.events(),
        [InstanceRolesEvent::Delete {
            role_id: "r-support".into(),
        }]
    );
}

#[gpui_kit::test]
fn edit_disabled_when_not_editable(cx: &mut TestAppContext) {
    let rig = ready_rig(cx);
    rig.click(cx, "admin-role-edit-r-senior");
    assert!(rig.events().is_empty());
    assert!(!rig.has(cx, "admin-roles-editor"));
    assert!(rig.has(cx, "admin-role-edit-r-senior-locked"));
    rig.click(cx, "admin-role-delete-r-senior");
    assert!(!rig.has(cx, "admin-role-delete-confirm"));
}

#[gpui_kit::test]
fn users_opens_the_role(cx: &mut TestAppContext) {
    let rig = ready_rig(cx);
    rig.click(cx, "admin-role-users-r-support");
    assert_eq!(
        rig.events(),
        [InstanceRolesEvent::OpenUsers {
            role_id: "r-support".into(),
        }]
    );
    feed_users(&rig, cx);
    assert!(rig.has(cx, "admin-roles-users-list"));
    assert!(rig.has(cx, "admin-role-user-u-maple"));
}

#[gpui_kit::test]
fn controls_follow_the_caps(cx: &mut TestAppContext) {
    let read_only = InstanceAdminCaps::default();
    let locked = roles_rig(cx, InstanceRolesView::default(), read_only);
    assert!(locked.has(cx, "admin-roles-locked"));
    assert!(!locked.has(cx, "admin-roles-list"));

    let no_write = InstanceAdminCaps {
        roles_read: true,
        ..InstanceAdminCaps::default()
    };
    let page = roles_rig(cx, ready(), no_write);
    assert!(page.has(cx, "admin-roles-new-locked"));
    page.click(cx, "admin-roles-new");
    assert!(!page.has(cx, "admin-roles-editor"));
    page.click(cx, "admin-role-edit-r-support");
    assert!(!page.has(cx, "admin-roles-editor"));
    page.click(cx, "admin-role-delete-r-support");
    assert!(!page.has(cx, "admin-role-delete-confirm"));
    assert!(page.events().is_empty());

    let storage: Rig<StoragePage, StorageEvent> = rig(cx, 1200., |window, cx| {
        let mut page = StoragePage::new(window, cx);
        page.set_caps(InstanceAdminCaps::default(), cx);
        page
    });
    assert!(storage.has(cx, "admin-storage-locked"));
    let allowed: Rig<StoragePage, StorageEvent> = rig(cx, 1200., |window, cx| {
        let mut page = StoragePage::new(window, cx);
        page.set_caps(
            InstanceAdminCaps {
                storage: true,
                ..InstanceAdminCaps::default()
            },
            cx,
        );
        page
    });
    assert!(!allowed.has(cx, "admin-storage-locked"));
}
