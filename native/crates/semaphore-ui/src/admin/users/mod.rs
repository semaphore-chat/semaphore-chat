//! UA3: users: search and filters, the list a page at a time, the per-user menu with each
//! action's reason when it's off (`AdminUserActions`), and its dialogs (reset password, instance
//! roles, storage quota, confirms), after `pages/admin/AdminUsersPage.tsx` and
//! `components/admin/ResetPasswordDialog.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `UsersEvent`) is what the app
//! wiring lane builds against while UA3 draws the screen; change it only with the coordinator.
//! Until UA3 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminUserQuery, AdminUserRolesView, AdminUserView, AdminUsersView, InstanceAdminCaps,
};

#[derive(Debug, Clone, PartialEq)]
pub enum UsersEvent {
    /// The filters changed: the owner reads `Core::admin_users(query)` and calls `set_view`.
    Query(AdminUserQuery),
    /// `Core::load_more_admin_users(query)`.
    LoadMore,
    /// A row's menu or a dialog opened for this user: the owner feeds `set_user` and
    /// `set_user_roles` from `Core::admin_user` and `Core::admin_user_roles`.
    OpenUser { user_id: String },
    /// The menu or dialog closed.
    CloseUser,
    /// `Core::ban_user`.
    Ban { user_id: String },
    /// `Core::unban_user`.
    Unban { user_id: String },
    /// Confirmed: `Core::delete_user`.
    Delete { user_id: String },
    /// `Core::reset_user_password(user_id, password)`.
    ResetPassword { user_id: String, password: String },
    /// `Core::set_user_owner(user_id, owner)`.
    SetOwner { user_id: String, owner: bool },
    /// `Core::assign_instance_role(user_id, role_id)`.
    AssignRole { user_id: String, role_id: String },
    /// `Core::unassign_instance_role(user_id, role_id)`.
    UnassignRole { user_id: String, role_id: String },
    /// `Core::set_user_quota(user_id, quota_bytes)` (the dialog takes GiB).
    SetQuota { user_id: String, quota_bytes: u64 },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct UsersPage {
    caps: InstanceAdminCaps,
    view: AdminUsersView,
    user: Option<AdminUserView>,
    user_roles: Option<AdminUserRolesView>,
}

impl EventEmitter<UsersEvent> for UsersPage {}

impl UsersPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminUsersView::default(),
            user: None,
            user_roles: None,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_users(query)`.
    pub fn set_view(&mut self, view: AdminUsersView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// `Core::admin_user(id)` for the open menu or dialog; `None` when none is open.
    pub fn set_user(&mut self, user: Option<AdminUserView>, cx: &mut Context<Self>) {
        self.user = user;
        cx.notify();
    }

    /// `Core::admin_user_roles(id)` for the roles dialog.
    pub fn set_user_roles(
        &mut self,
        user_roles: Option<AdminUserRolesView>,
        cx: &mut Context<Self>,
    ) {
        self.user_roles = user_roles;
        cx.notify();
    }
}

impl Render for UsersPage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("userspage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
