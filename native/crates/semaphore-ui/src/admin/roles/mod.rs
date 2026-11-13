//! UA5: instance roles: the list, the editor (name and the grouped actions of
//! `instance_action_groups()`, only `grantable` ones on), a role's users, delete, after
//! `pages/admin/AdminRolesPage.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `InstanceRolesEvent`) is what the app
//! wiring lane builds against while UA5 draws the screen; change it only with the coordinator.
//!
//! The page decides nothing: whether the list may be read, a role may be changed or deleted, and
//! which actions may be granted come from `InstanceAdminCaps` and the view's `roles` /
//! `grantable`, and every change's progress and refusal from its own entry in `AdminOp::actions`.

mod editor;
mod rows;
mod rules;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use self::editor::EditorState;
use crate::community_settings::common::{Confirm, card, locked_note, page, phone};
use crate::community_settings::rules::{Outcome, Pending, act, needs, running};
use crate::kit::{Alert, Button, Dialog, Severity, Variant, spacing, text};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, InstanceAdminCaps, InstanceRoleDraft, InstanceRoleUsersView,
    InstanceRolesView, LoadState,
};
use semaphore_design::Icon as DesignIcon;

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

#[derive(Debug, Clone, PartialEq, Eq)]
enum Confirming {
    Delete { role_id: String, name: String },
}

pub struct InstanceRolesPage {
    caps: InstanceAdminCaps,
    view: InstanceRolesView,
    role_users: Option<InstanceRoleUsersView>,
    /// The role being made or edited, replacing the list, as the community's editor does.
    editor: Option<EditorState>,
    /// The role whose users dialog is open.
    users_for: Option<String>,
    confirming: Option<Confirming>,
    /// The editor's changes, followed until core records that they ended (`AdminOp::finished`):
    /// a saved role closes its editor.
    pending: Vec<Pending>,
}

impl EventEmitter<InstanceRolesEvent> for InstanceRolesPage {}

fn role_action(kind: AdminActionKind, target_id: Option<&str>) -> AdminAction {
    act(kind, target_id)
}

fn create_action() -> AdminAction {
    role_action(AdminActionKind::CreateInstanceRole, None)
}

fn update_action(role_id: &str) -> AdminAction {
    role_action(AdminActionKind::UpdateInstanceRole, Some(role_id))
}

fn delete_action(role_id: &str) -> AdminAction {
    role_action(AdminActionKind::DeleteInstanceRole, Some(role_id))
}

impl InstanceRolesPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: InstanceRolesView::default(),
            role_users: None,
            editor: None,
            users_for: None,
            confirming: None,
            pending: Vec::new(),
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::instance_roles()`.
    pub fn set_view(&mut self, view: InstanceRolesView, cx: &mut Context<Self>) {
        let mut done = Vec::new();
        self.pending
            .retain_mut(|pending| match pending.observe(&view.op) {
                Outcome::Waiting => true,
                Outcome::Failed => false,
                Outcome::Succeeded => {
                    done.push(pending.action.clone());
                    false
                }
            });
        for action in done {
            // A saved role closes its editor.
            if self
                .editor
                .as_ref()
                .is_some_and(|editor| editor.action() == action)
            {
                self.editor = None;
            }
        }
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

    fn can_write(&self) -> bool {
        self.caps.roles_write
    }

    /// Sends one change and waits on its own entry in the view's op.
    fn send(&mut self, action: AdminAction, event: InstanceRolesEvent, cx: &mut Context<Self>) {
        if running(&self.view.op, &action) {
            return;
        }
        self.pending.push(Pending::new(action, &self.view.op));
        cx.emit(event);
        cx.notify();
    }

    // ---- The editor. ----

    pub(crate) fn open_create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_write() || running(&self.view.op, &create_action()) {
            return;
        }
        self.editor = Some(EditorState::create(window, cx));
        cx.notify();
    }

    pub(crate) fn open_edit(&mut self, role_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(role) = self
            .view
            .roles
            .iter()
            .find(|role| role.id == role_id)
            .cloned()
        else {
            return;
        };
        if !self.can_write() || !role.editable {
            return;
        }
        if running(&self.view.op, &update_action(role_id)) {
            return;
        }
        self.editor = Some(EditorState::edit(&role, window, cx));
        cx.notify();
    }

    pub(crate) fn close_editor(&mut self, cx: &mut Context<Self>) {
        self.editor = None;
        cx.notify();
    }

    // ---- Deleting. ----

    pub(crate) fn ask_delete(&mut self, role_id: &str, cx: &mut Context<Self>) {
        let Some(role) = self.view.roles.iter().find(|role| role.id == role_id) else {
            return;
        };
        if !self.can_write() || !role.deletable || running(&self.view.op, &delete_action(role_id)) {
            return;
        }
        self.confirming = Some(Confirming::Delete {
            role_id: role.id.clone(),
            name: role.name.clone(),
        });
        cx.notify();
    }

    /// The confirm's action pressed: the dialog closes and the change shows on its row.
    pub(crate) fn confirm(&mut self, cx: &mut Context<Self>) {
        if let Some(Confirming::Delete { role_id, .. }) = self.confirming.take() {
            self.send(
                delete_action(&role_id),
                InstanceRolesEvent::Delete { role_id },
                cx,
            );
        }
        cx.notify();
    }

    fn cancel_confirm(&mut self, cx: &mut Context<Self>) {
        self.confirming = None;
        cx.notify();
    }

    // ---- A role's users. ----

    pub(crate) fn open_users(&mut self, role_id: &str, cx: &mut Context<Self>) {
        self.users_for = Some(role_id.to_owned());
        self.role_users = None;
        cx.emit(InstanceRolesEvent::OpenUsers {
            role_id: role_id.to_owned(),
        });
        cx.notify();
    }

    fn close_users(&mut self, cx: &mut Context<Self>) {
        self.users_for = None;
        self.role_users = None;
        cx.notify();
    }

    // ---- Drawing. ----

    fn header_actions(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let create = Button::new("admin-roles-new", "New role")
            .contained()
            .start_icon(DesignIcon::PersonAdd)
            .on_click(cx.listener(|page, _, window, cx| page.open_create(window, cx)));
        vec![crate::community_settings::common::locked_button(
            create,
            "admin-roles-new-locked",
            (!self.can_write()).then(|| needs("Update instance settings")),
            cx,
        )]
    }

    fn body(&mut self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        if !self.caps.roles_read {
            return card(
                "Roles",
                locked_note("admin-roles-locked", needs("View instance settings"), cx),
                cx,
            )
            .into_any_element();
        }
        if self.editor.is_some() {
            return self.editor_view(narrow, cx);
        }
        self.list_card(narrow, cx)
    }

    fn confirm_dialog(&self, cx: &mut Context<Self>) -> Option<Dialog> {
        let Some(Confirming::Delete { name, .. }) = self.confirming.clone() else {
            return None;
        };
        let page = cx.weak_entity();
        let cancel = cx.weak_entity();
        Some(
            Confirm {
                id: "admin-role-delete",
                title: "Delete Role",
                message: format!(
                    "Are you sure you want to delete the role \u{201c}{name}\u{201d}? This action cannot be undone and will remove the role from all users who have it assigned."
                ),
                confirm: "Delete Role",
                busy: false,
            }
            .dialog(
                move |_, cx| {
                    page.update(cx, |page, cx| page.confirm(cx)).ok();
                },
                move |_, cx| {
                    cancel
                        .update(cx, |page, cx| page.cancel_confirm(cx))
                        .ok();
                },
                cx,
            ),
        )
    }

    fn users_dialog(&self, cx: &mut Context<Self>) -> Option<Dialog> {
        let role_id = self.users_for.clone()?;
        let name = self
            .view
            .roles
            .iter()
            .find(|role| role.id == role_id)
            .map(|role| role.name.clone())
            .unwrap_or_else(|| role_id.clone());
        let body: AnyElement = match &self.role_users {
            None => crate::community_settings::common::loading_rows(
                "admin-roles-users-loading",
                "Loading users",
                3,
            ),
            Some(view) => match &view.state {
                LoadState::Loading => crate::community_settings::common::loading_rows(
                    "admin-roles-users-loading",
                    "Loading users",
                    3,
                ),
                LoadState::Failed { error } => Alert::new(
                    Severity::Error,
                    format!("Failed to load this role's users: {}", error.message),
                )
                .into_any_element(),
                LoadState::Ready if view.users.is_empty() => {
                    crate::community_settings::common::empty_line(
                        "No users have this role yet.",
                        cx,
                    )
                    .into_any_element()
                }
                LoadState::Ready => {
                    let rows = view.users.iter().map(|user| {
                        crate::community_settings::common::row(
                            SharedString::from(format!("admin-role-user-{}", user.id)),
                            user.username.clone(),
                            cx,
                        )
                        .child(crate::community_settings::common::user_line(user, cx))
                    });
                    div()
                        .flex()
                        .flex_col()
                        .gap(spacing(1.))
                        .child(
                            text(
                                Variant::Body2,
                                format!("Assigned users ({})", view.users.len()),
                            )
                            .text_color(cx.sem().text_secondary),
                        )
                        .child(
                            crate::community_settings::common::list(
                                "admin-roles-users-list",
                                "Role users",
                            )
                            .children(rows),
                        )
                        .into_any_element()
                }
            },
        };
        let close = cx.weak_entity();
        let close_button = cx.weak_entity();
        Some(
            Dialog::new(format!("Role Users: {name}"))
                .body(
                    div()
                        .id("admin-roles-users-body")
                        .max_h(px(420.))
                        .overflow_y_scroll()
                        .child(body),
                )
                .action(Button::new("admin-roles-users-close", "Close").on_click(
                    move |_, _, cx| {
                        close_button
                            .update(cx, |page, cx| page.close_users(cx))
                            .ok();
                    },
                ))
                .on_close(move |_, cx| {
                    close.update(cx, |page, cx| page.close_users(cx)).ok();
                }),
        )
    }
}

impl Render for InstanceRolesPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = phone(window);
        let actions = if self.editor.is_some() {
            Vec::new()
        } else {
            self.header_actions(cx)
        };
        let body = self.body(narrow, cx);
        let page = page(
            "admin-roles",
            "Instance Roles",
            Some(
                "Manage instance-level roles that can be assigned to users. These roles grant \
                 administrative permissions across the entire instance."
                    .into(),
            ),
            actions,
            body,
            window,
            cx,
        );
        let mut overlays: Vec<AnyElement> = Vec::new();
        if let Some(dialog) = self.confirm_dialog(cx) {
            overlays.push(dialog.into_any_element());
        }
        if let Some(dialog) = self.users_dialog(cx) {
            overlays.push(dialog.into_any_element());
        }
        div().relative().size_full().child(page).children(overlays)
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}

#[cfg(any(test, feature = "stories"))]
impl InstanceRolesPage {
    /// For stories and tests: types a name as if into the field.
    pub(crate) fn type_name(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(editor) = self.editor.as_mut() {
            let typed = name.to_owned();
            editor
                .field
                .update(cx, |field, cx| field.set_value(typed, window, cx));
            editor.draft.name = name.to_owned();
            editor.touched = true;
        }
    }
}
