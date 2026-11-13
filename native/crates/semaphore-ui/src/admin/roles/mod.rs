//! UA5: instance roles: the list, the editor (name and the grouped actions of
//! `instance_action_groups()`, only `grantable` ones on), a role's users, delete, after
//! `pages/admin/AdminRolesPage.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `InstanceRolesEvent`) is what the app
//! wiring lane builds against while UA5 draws the screen; change it only with the coordinator.
//! Until UA5 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    InstanceAdminCaps, InstanceRoleDraft, InstanceRoleUsersView, InstanceRolesView,
};

#[derive(Debug, Clone, PartialEq)]
pub enum InstanceRolesEvent {
    /// `Core::create_instance_role(draft)`.
    Create(InstanceRoleDraft),
    /// `Core::update_instance_role(role_id, draft)`.
    Update {
        role_id: String,
        draft: InstanceRoleDraft,
    },
    /// Confirmed: `Core::delete_instance_role(role_id)`.
    Delete { role_id: String },
    /// The users list opened: the owner feeds `set_role_users` from `Core::instance_role_users`.
    OpenUsers { role_id: String },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct InstanceRolesPage {
    caps: InstanceAdminCaps,
    view: InstanceRolesView,
    role_users: Option<InstanceRoleUsersView>,
}

impl EventEmitter<InstanceRolesEvent> for InstanceRolesPage {}

impl InstanceRolesPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: InstanceRolesView::default(),
            role_users: None,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::instance_roles()`.
    pub fn set_view(&mut self, view: InstanceRolesView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// `Core::instance_role_users(role_id)` for the open role.
    pub fn set_role_users(
        &mut self,
        role_users: Option<InstanceRoleUsersView>,
        cx: &mut Context<Self>,
    ) {
        self.role_users = role_users;
        cx.notify();
    }
}

impl Render for InstanceRolesPage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("instancerolespage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
