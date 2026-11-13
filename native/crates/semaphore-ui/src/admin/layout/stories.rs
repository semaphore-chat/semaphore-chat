//! The admin shell's stories: an owner with every page, a user allowed only Invites, the page
//! loading, and a phone's list before a page is picked and with Users open.
//! `rigs/shot/scripts/ua1-admin-shell-settings.steps` renders them all, on a desktop and a phone.

use super::AdminShell;
use crate::community_settings::common::{empty_line, page, phone};
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{AdminPage, InstanceAdminCaps};

fn caps_owner() -> InstanceAdminCaps {
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

fn caps_invites_only() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        invites_read: true,
        ..InstanceAdminCaps::default()
    }
}

/// What the owner hands the shell for the open page, while that page's own lane draws it.
struct Placeholder {
    label: &'static str,
}

impl Render for Placeholder {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        page(
            "admin-placeholder",
            self.label,
            None,
            Vec::new(),
            empty_line("Not available yet.", cx),
            window,
            cx,
        )
    }
}

fn placeholder(label: &'static str, cx: &mut App) -> AnyView {
    cx.new(|_| Placeholder { label }).into()
}

fn shell(
    caps: InstanceAdminCaps,
    open: Option<AdminPage>,
    content: Option<AnyView>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    cx.new(|cx| {
        let mut shell = AdminShell::new(window, cx);
        shell.set_caps(caps, cx);
        if let Some(open) = open {
            shell.set_page(open, cx);
        }
        shell.set_content(content, cx);
        shell
    })
    .into()
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(crate) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        ("admin-shell-owner", |_, window, cx| {
            shell(
                caps_owner(),
                Some(AdminPage::Dashboard),
                Some(placeholder("Dashboard", cx)),
                window,
                cx,
            )
        }),
        ("admin-shell-limited", |_, window, cx| {
            // On a phone the list is the state worth seeing: `set_page` would open the page.
            let open = (!phone(window)).then_some(AdminPage::Invites);
            shell(
                caps_invites_only(),
                open,
                Some(placeholder("Invites", cx)),
                window,
                cx,
            )
        }),
        ("admin-shell-loading", |_, window, cx| {
            shell(caps_owner(), Some(AdminPage::Dashboard), None, window, cx)
        }),
        ("admin-shell-phone-list", |_, window, cx| {
            // No `set_page`: on a phone the shell shows the list until one is picked.
            shell(
                caps_owner(),
                None,
                Some(placeholder("Dashboard", cx)),
                window,
                cx,
            )
        }),
        ("admin-shell-phone-page", |_, window, cx| {
            shell(
                caps_owner(),
                Some(AdminPage::Users),
                Some(placeholder("Users", cx)),
                window,
                cx,
            )
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
