//! The admin shell in a window: which pages its caps open, what picking one emits, and the
//! phone's list, page and back arrow.

use super::{AdminShell, AdminShellEvent};
use crate::dms::rig::{Rig, rig};
use gpui_kit::TestAppContext;
use semaphore_core::model::{AdminPage, InstanceAdminCaps};

fn caps_invites() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        invites_read: true,
        ..InstanceAdminCaps::default()
    }
}

fn caps_users() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        users_read: true,
        ..InstanceAdminCaps::default()
    }
}

fn caps_all() -> InstanceAdminCaps {
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

fn shell_rig(
    cx: &mut TestAppContext,
    width: f32,
    caps: InstanceAdminCaps,
    open: Option<AdminPage>,
) -> Rig<AdminShell, AdminShellEvent> {
    rig(cx, width, move |window, cx| {
        let mut shell = AdminShell::new(window, cx);
        shell.set_caps(caps, cx);
        if let Some(open) = open {
            shell.set_page(open, cx);
        }
        shell
    })
}

#[gpui_kit::test]
fn shell_enables_pages_by_caps(cx: &mut TestAppContext) {
    let rig = shell_rig(cx, 1200., caps_invites(), None);
    for id in [
        "admin-page-dashboard",
        "admin-page-users",
        "admin-page-communities",
        "admin-page-roles",
        "admin-page-storage",
        "admin-page-settings",
    ] {
        assert!(rig.has(cx, id), "{id} is shown, disabled");
        rig.click(cx, id);
    }
    assert!(
        rig.events().is_empty(),
        "a page these caps don't open emits nothing"
    );
    rig.click(cx, "admin-page-invites");
    assert_eq!(rig.events(), [AdminShellEvent::Open(AdminPage::Invites)]);
}

#[gpui_kit::test]
fn shell_open_emits_the_page(cx: &mut TestAppContext) {
    let rig = shell_rig(cx, 1200., caps_users(), Some(AdminPage::Dashboard));
    rig.click(cx, "admin-page-users");
    assert_eq!(rig.events(), [AdminShellEvent::Open(AdminPage::Users)]);
}

#[gpui_kit::test]
fn shell_back_on_phone(cx: &mut TestAppContext) {
    let rig = shell_rig(cx, 390., caps_all(), None);
    assert!(rig.has(cx, "admin-nav"), "the list until a page is picked");
    rig.click(cx, "admin-page-users");
    assert!(!rig.has(cx, "admin-nav"), "the page instead of the list");
    rig.click(cx, "admin-back");
    assert!(rig.has(cx, "admin-nav"), "back to the list");
    rig.click(cx, "admin-exit");
    assert_eq!(
        rig.events(),
        [
            AdminShellEvent::Open(AdminPage::Users),
            AdminShellEvent::Back,
            AdminShellEvent::Back,
        ]
    );
}
