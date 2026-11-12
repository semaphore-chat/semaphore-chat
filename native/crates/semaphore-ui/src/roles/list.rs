//! The Roles tab, after `RoleManagement.tsx`: the community's roles by rank with their
//! permissions, moving one up or down, creating, editing (the editor replaces the list, as on the
//! web), deleting behind a confirm, resetting the default roles behind a confirm, and who holds a
//! role. What the user may do comes from `RolesView`'s flags; what they can't shows disabled with
//! its reason. Each change reads its own entry in `AdminOp::actions`, so a delete running on one
//! row and a failed one on another show on their own rows.

use super::common::{
    Confirm, action_icon, card, empty_line, list, loading_rows, locked_button, phone, row,
    tone_chip, user_line,
};
use super::editor::EditorState;
use super::rules::{
    Outcome, Pending, actions_preview, delete_block, edit_block, failure, move_block, moved_order,
    needs, permissions_count, role_action, running,
};
use crate::kit::{Alert, Button, Chip, Dialog, Severity, Spinner, Variant, spacing, text};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, LoadState, PermissionGroup, RoleDraft, RoleMembersView,
    RolePatch, RoleRow, RolesView,
};
use semaphore_design::Icon as DesignIcon;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RolesEvent {
    /// `Core::create_role(community, draft)`.
    Create { draft: RoleDraft },
    /// `Core::update_role(community, role_id, patch)`: only what changed.
    Update { role_id: String, patch: RolePatch },
    /// Confirmed: `Core::delete_role(community, role_id)`.
    Delete { role_id: String },
    /// `Core::reorder_roles(community, role_ids)`: every role but Member, highest first.
    Reorder { role_ids: Vec<String> },
    /// Confirmed: `Core::reset_default_roles(community)`.
    ResetDefaults,
    /// The members dialog opened: feed `set_role_members(Core::role_members(community, role_id))`.
    ShowMembers { role_id: String },
    /// The members dialog closed.
    CloseMembers,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Confirming {
    Delete { role_id: String, name: String },
    Reset,
}

pub struct RolesPanel {
    pub(super) view: RolesView,
    pub(super) catalog: Vec<PermissionGroup>,
    members: Option<RoleMembersView>,
    showing_members: Option<String>,
    confirming: Option<Confirming>,
    pub(super) editor: Option<EditorState>,
    pending: Vec<Pending>,
    /// The zone and clock dates are written in: the app's, unless a story fixes them.
    time: crate::messages::TimeFormat,
}

impl EventEmitter<RolesEvent> for RolesPanel {}

fn reorder() -> AdminAction {
    role_action(AdminActionKind::ReorderRoles, None)
}

fn reset() -> AdminAction {
    role_action(AdminActionKind::ResetDefaults, None)
}

fn delete(role_id: &str) -> AdminAction {
    role_action(AdminActionKind::DeleteRole, Some(role_id))
}

impl RolesPanel {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            view: RolesView::default(),
            catalog: Vec::new(),
            members: None,
            showing_members: None,
            confirming: None,
            editor: None,
            pending: Vec::new(),
            time: crate::messages::TimeFormat::default(),
        }
    }

    /// A role's "Created" date, in the panel's zone.
    pub(crate) fn created_label(&self, ms: i64) -> String {
        crate::community_settings::rules::date_label(&self.time, ms)
    }

    /// The zone and clock the roles' dates are written in.
    pub fn set_time(&mut self, time: crate::messages::TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// `Core::roles(community)`, again on `ViewKey::Roles`.
    pub fn set_roles(&mut self, view: RolesView, cx: &mut Context<Self>) {
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

    /// `Core::permission_catalog()`: the matrix's groups.
    pub fn set_catalog(&mut self, catalog: Vec<PermissionGroup>, cx: &mut Context<Self>) {
        self.catalog = catalog;
        cx.notify();
    }

    /// `Core::role_members(community, role_id)` for the open members dialog, again on
    /// `ViewKey::RoleMembers`.
    pub fn set_role_members(&mut self, members: Option<RoleMembersView>, cx: &mut Context<Self>) {
        self.members = members;
        cx.notify();
    }

    pub(super) fn send(&mut self, action: AdminAction, event: RolesEvent, cx: &mut Context<Self>) {
        if running(&self.view.op, &action) {
            return;
        }
        self.pending.retain(|pending| pending.action != action);
        self.pending.push(Pending::new(action, &self.view.op));
        cx.emit(event);
        cx.notify();
    }

    pub(crate) fn open_create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.view.can_create {
            return;
        }
        self.editor = Some(EditorState::new(None, None, window, cx));
        cx.notify();
    }

    pub(crate) fn open_edit(&mut self, role_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(role) = self.view.roles.iter().find(|r| r.id == role_id).cloned() else {
            return;
        };
        let read_only = edit_block(&role);
        self.editor = Some(EditorState::new(Some(&role), read_only, window, cx));
        cx.notify();
    }

    pub(crate) fn close_editor(&mut self, cx: &mut Context<Self>) {
        self.editor = None;
        cx.notify();
    }

    pub(crate) fn move_role(&mut self, role_id: &str, up: bool, cx: &mut Context<Self>) {
        let Some(role) = self.view.roles.iter().find(|r| r.id == role_id) else {
            return;
        };
        if move_block(&self.view, role, up, running(&self.view.op, &reorder())).is_some() {
            return;
        }
        if let Some(role_ids) = moved_order(&self.view.roles, role_id, up) {
            self.send(reorder(), RolesEvent::Reorder { role_ids }, cx);
        }
    }

    pub(crate) fn ask_delete(&mut self, role_id: &str, cx: &mut Context<Self>) {
        let Some(role) = self.view.roles.iter().find(|r| r.id == role_id) else {
            return;
        };
        if !role.deletable || running(&self.view.op, &delete(role_id)) {
            return;
        }
        self.confirming = Some(Confirming::Delete {
            role_id: role.id.clone(),
            name: role.name.clone(),
        });
        cx.notify();
    }

    pub(crate) fn ask_reset(&mut self, cx: &mut Context<Self>) {
        if self.view.can_reset_defaults && !running(&self.view.op, &reset()) {
            self.confirming = Some(Confirming::Reset);
            cx.notify();
        }
    }

    /// The confirm's action pressed: the dialog closes and the change shows on its row (or on
    /// Reset Defaults), so several can run at once.
    pub(crate) fn confirm(&mut self, cx: &mut Context<Self>) {
        match self.confirming.take() {
            Some(Confirming::Delete { role_id, .. }) => {
                self.send(delete(&role_id), RolesEvent::Delete { role_id }, cx)
            }
            Some(Confirming::Reset) => self.send(reset(), RolesEvent::ResetDefaults, cx),
            None => {}
        }
        cx.notify();
    }

    fn cancel_confirm(&mut self, cx: &mut Context<Self>) {
        self.confirming = None;
        cx.notify();
    }

    pub(crate) fn show_members(&mut self, role_id: &str, cx: &mut Context<Self>) {
        self.showing_members = Some(role_id.to_owned());
        self.members = None;
        cx.emit(RolesEvent::ShowMembers {
            role_id: role_id.to_owned(),
        });
        cx.notify();
    }

    fn close_members(&mut self, cx: &mut Context<Self>) {
        self.showing_members = None;
        self.members = None;
        cx.emit(RolesEvent::CloseMembers);
        cx.notify();
    }

    // ---- Drawing. ----

    fn header_actions(&self, narrow: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let resetting = running(&self.view.op, &reset());
        let reset_button = Button::new("roles-reset", "Reset Defaults")
            .outlined()
            .start_icon(DesignIcon::RestartAlt)
            .loading(resetting)
            .disabled(resetting)
            .on_click(cx.listener(|panel, _, _, cx| panel.ask_reset(cx)));
        let create = Button::new("roles-create", "Create Role")
            .contained()
            .start_icon(DesignIcon::PersonAdd)
            .on_click(cx.listener(|panel, _, window, cx| panel.open_create(window, cx)));
        vec![
            locked_button(
                reset_button,
                "roles-reset-locked",
                (!self.view.can_reset_defaults).then(|| needs("UPDATE_ROLE")),
                narrow,
                cx,
            ),
            locked_button(
                create,
                "roles-create-locked",
                (!self.view.can_create).then(|| needs("CREATE_ROLE")),
                narrow,
                cx,
            ),
        ]
    }

    fn role_row(&self, role: &RoleRow, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let id = role.id.clone();
        let moving = running(&self.view.op, &reorder());
        let deleting = running(&self.view.op, &delete(&id));
        let row_error = failure(&self.view.op, &delete(&id))
            .or_else(|| {
                // An edit that failed after its editor closed.
                let open = self
                    .editor
                    .as_ref()
                    .is_some_and(|editor| editor.role_id.as_deref() == Some(id.as_str()));
                (!open)
                    .then(|| {
                        failure(
                            &self.view.op,
                            &role_action(AdminActionKind::UpdateRole, Some(&id)),
                        )
                    })
                    .flatten()
            })
            .cloned();
        let arrows = (!role.fixed).then(|| {
            let (up_id, down_id) = (id.clone(), id.clone());
            div()
                .flex()
                .flex_shrink_0()
                .items_center()
                .child(action_icon(
                    format!("role-up-{id}"),
                    DesignIcon::ArrowUpward,
                    format!("Move {} up", role.name),
                    move_block(&self.view, role, true, moving),
                    None,
                    cx.listener(move |panel, _, _, cx| panel.move_role(&up_id, true, cx)),
                ))
                .child(action_icon(
                    format!("role-down-{id}"),
                    DesignIcon::ArrowDownward,
                    format!("Move {} down", role.name),
                    move_block(&self.view, role, false, moving),
                    None,
                    cx.listener(move |panel, _, _, cx| panel.move_role(&down_id, false, cx)),
                ))
        });
        let kind_chip = if role.is_default {
            Chip::new("Default")
        } else {
            tone_chip("Custom", sem.primary)
        };
        let name = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(spacing(1.))
            .min_w_0()
            .child(
                text(Variant::Body2, role.name.clone())
                    .font_weight(FontWeight(500.))
                    .text_color(sem.text_primary)
                    .min_w_0(),
            )
            .child(kind_chip);
        let (shown, more) = actions_preview(&role.actions, 3);
        let chips = div()
            .flex()
            .flex_wrap()
            .gap(px(4.))
            .children(shown.into_iter().map(Chip::new))
            .when(more > 0, |chips| {
                chips.child(Chip::new(format!("+{more} more")))
            })
            .when(role.actions.is_empty(), |chips| {
                chips.child(text(Variant::Caption, "No permissions").text_color(sem.text_secondary))
            });
        let created = role.created_at_ms.map(|ms| {
            text(Variant::Body2, self.created_label(ms))
                .text_color(sem.text_secondary)
                .whitespace_nowrap()
        });
        let (members_id, edit_id, delete_id) = (id.clone(), id.clone(), id.clone());
        let editable = role.editable;
        let delete_button: AnyElement = if deleting {
            div()
                .id(SharedString::from(format!("role-deleting-{id}")))
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label(format!("Deleting {}", role.name))
                .size(px(34.))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    Spinner::new(SharedString::from(format!("role-deleting-spin-{id}"))).size(18.),
                )
                .into_any_element()
        } else {
            action_icon(
                format!("role-delete-{id}"),
                DesignIcon::DeleteOutline,
                format!("Delete {}", role.name),
                delete_block(role),
                Some(sem.error),
                cx.listener(move |panel, _, _, cx| panel.ask_delete(&delete_id, cx)),
            )
        };
        let actions = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .child(action_icon(
                format!("role-members-{id}"),
                DesignIcon::People,
                format!("View members of {}", role.name),
                None,
                None,
                cx.listener(move |panel, _, _, cx| panel.show_members(&members_id, cx)),
            ))
            .child(action_icon(
                format!("role-edit-{id}"),
                if editable {
                    DesignIcon::Edit
                } else {
                    DesignIcon::Visibility
                },
                if editable {
                    format!("Edit {}", role.name)
                } else {
                    format!("View {} (read-only)", role.name)
                },
                None,
                Some(sem.primary),
                cx.listener(move |panel, _, window, cx| panel.open_edit(&edit_id, window, cx)),
            ))
            .child(delete_button);
        let error = row_error.map(|error| {
            div()
                .w_full()
                .child(Alert::new(Severity::Error, error.message))
        });
        let base = row(
            SharedString::from(format!("role-{id}")),
            role.name.clone(),
            cx,
        )
        .when(deleting, |row| row.opacity(0.6));
        if narrow {
            base.flex_col()
                .gap(spacing(1.))
                .child(name)
                .child(
                    text(Variant::Caption, permissions_count(role.actions.len()))
                        .text_color(sem.text_secondary),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(div().children(arrows))
                        .child(actions),
                )
                .children(error)
                .into_any_element()
        } else {
            base.flex_col()
                .child(
                    div()
                        .w_full()
                        .flex()
                        .items_center()
                        .gap(spacing(1.5))
                        .child(div().w(px(68.)).flex_shrink_0().children(arrows))
                        .child(div().w(px(200.)).flex_shrink_0().min_w_0().child(name))
                        .child(div().flex_1().min_w_0().child(chips))
                        .children(created.map(|created| div().w(px(110.)).child(created)))
                        .child(actions),
                )
                .children(error)
                .into_any_element()
        }
    }

    fn list_body(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        if !self.view.can_read && self.view.state != LoadState::Loading {
            {
                return Alert::new(
                    Severity::Info,
                    "You don't have permission to view roles in this community.",
                )
                .into_any_element();
            }
        }
        match &self.view.state {
            LoadState::Loading => return loading_rows("roles-loading", "Loading roles", 4),
            LoadState::Failed { error } => {
                return Alert::new(
                    Severity::Error,
                    format!("Failed to load roles: {}", error.message),
                )
                .into_any_element();
            }
            LoadState::Ready => {}
        }
        let sem = cx.sem().clone();
        if self.view.roles.is_empty() {
            return div()
                .flex()
                .flex_col()
                .items_center()
                .gap(spacing(1.))
                .child(empty_line("No roles yet", cx))
                .child(
                    text(
                        Variant::Body2,
                        "Create the first role. Default roles (Admin, Moderator, Member) are created automatically.",
                    )
                    .text_center()
                    .text_color(sem.text_secondary),
                )
                .into_any_element();
        }
        let roles = self.view.roles.clone();
        let rows: Vec<AnyElement> = roles
            .iter()
            .map(|role| self.role_row(role, narrow, cx))
            .collect();
        let errors: Vec<Alert> = [
            failure(&self.view.op, &reorder()),
            failure(&self.view.op, &reset()),
        ]
        .into_iter()
        .flatten()
        .map(|error| Alert::new(Severity::Error, error.message.clone()))
        .collect();
        let resetting = running(&self.view.op, &reset());
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.5))
            .children(errors)
            .when(resetting, |body| {
                body.child(Alert::new(
                    Severity::Info,
                    "Resetting the default roles\u{2026}",
                ))
            })
            .child(
                text(
                    Variant::Body2,
                    "Roles higher in the list rank above the ones below them.",
                )
                .text_color(sem.text_secondary),
            )
            .child(list("roles-list", "Roles").children(rows))
            .into_any_element()
    }

    fn confirm_dialog(&self, cx: &mut Context<Self>) -> Option<Dialog> {
        let confirming = self.confirming.clone()?;
        let (id, title, message, label, danger) = match &confirming {
            Confirming::Delete { name, .. } => (
                "role-delete",
                "Delete Role".to_owned(),
                format!(
                    "Are you sure you want to delete the role \u{201c}{name}\u{201d}? This action cannot be undone and will remove the role from all users who have it assigned."
                ),
                "Delete Role",
                true,
            ),
            Confirming::Reset => (
                "roles-reset",
                "Reset Default Roles".to_owned(),
                "This will restore the default roles (Community Admin, Moderator, Member) to their original permissions. Missing default roles will be recreated. Custom roles and user assignments will not be affected.".to_owned(),
                "Reset Defaults",
                false,
            ),
        };
        let confirm = cx.weak_entity();
        let cancel = cx.weak_entity();
        Some(
            Confirm {
                id,
                title,
                message,
                confirm: label,
                danger,
                busy: false,
                error: None,
            }
            .dialog(
                move |_, cx| {
                    confirm.update(cx, |panel, cx| panel.confirm(cx)).ok();
                },
                move |_, cx| {
                    cancel.update(cx, |panel, cx| panel.cancel_confirm(cx)).ok();
                },
            ),
        )
    }

    fn members_dialog(&self, cx: &mut Context<Self>) -> Option<Dialog> {
        let role_id = self.showing_members.clone()?;
        let name = self
            .view
            .roles
            .iter()
            .find(|r| r.id == role_id)
            .map(|r| r.name.clone())
            .unwrap_or_default();
        let body: AnyElement = match &self.members {
            None => loading_rows("role-members-loading", "Loading members", 3),
            Some(view) => match &view.state {
                LoadState::Loading => loading_rows("role-members-loading", "Loading members", 3),
                LoadState::Failed { error } => Alert::new(
                    Severity::Error,
                    format!("Failed to load the role's members: {}", error.message),
                )
                .into_any_element(),
                LoadState::Ready if view.users.is_empty() => {
                    empty_line("No users have this role yet.", cx).into_any_element()
                }
                LoadState::Ready => list("role-members-list", "Role members")
                    .children(view.users.iter().map(|user| {
                        row(
                            SharedString::from(format!("role-member-{}", user.id)),
                            user.username.clone(),
                            cx,
                        )
                        .items_center()
                        .child(user_line(user, cx))
                    }))
                    .into_any_element(),
            },
        };
        let close = cx.weak_entity();
        let close_button = cx.weak_entity();
        Some(
            Dialog::new(format!("Role Members: {name}"))
                .body(
                    div()
                        .id("role-members-body")
                        .max_h(px(420.))
                        .overflow_y_scroll()
                        .child(body),
                )
                .action(
                    Button::new("role-members-close", "Close").on_click(move |_, _, cx| {
                        close_button
                            .update(cx, |panel, cx| panel.close_members(cx))
                            .ok();
                    }),
                )
                .on_close(move |_, cx| {
                    close.update(cx, |panel, cx| panel.close_members(cx)).ok();
                }),
        )
    }

    /// Whether any change of the list is on its way (for tests).
    #[cfg(test)]
    pub(crate) fn anything_running(&self) -> bool {
        super::rules::any_running(
            &self.view.op,
            &[
                AdminActionKind::CreateRole,
                AdminActionKind::UpdateRole,
                AdminActionKind::DeleteRole,
                AdminActionKind::ReorderRoles,
                AdminActionKind::ResetDefaults,
            ],
        )
    }
}

impl Render for RolesPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = phone(window);
        let sem = cx.sem().clone();
        let content: AnyElement = if self.editor.is_some() {
            self.editor_view(narrow, cx)
        } else {
            let heading =
                div()
                    .flex()
                    .when(narrow, |h| h.flex_col().items_start())
                    .when(!narrow, |h| h.items_start().justify_between())
                    .gap(spacing(1.))
                    .child(text(Variant::H6, "Role Management").text_color(sem.text_primary))
                    .child(div().flex().flex_wrap().gap(spacing(1.)).children(
                        if self.view.can_read {
                            self.header_actions(narrow, cx)
                        } else {
                            Vec::new()
                        },
                    ));
            let body = self.list_body(narrow, cx);
            div()
                .flex()
                .flex_col()
                .gap(spacing(2.))
                .child(heading)
                .child(card("Roles", body, cx))
                .into_any_element()
        };
        let mut overlays: Vec<AnyElement> = Vec::new();
        if let Some(dialog) = self.confirm_dialog(cx) {
            overlays.push(dialog.into_any_element());
        }
        if let Some(dialog) = self.members_dialog(cx) {
            overlays.push(dialog.into_any_element());
        }
        div()
            .relative()
            .size_full()
            .child(
                div()
                    .id("community-roles")
                    .test_support()
                    .role(Role::Region)
                    .aria_label("Roles")
                    .size_full()
                    .bg(sem.background_default)
                    .child(
                        div()
                            .id("community-roles-scroll")
                            .size_full()
                            .overflow_y_scroll()
                            .p(spacing(if narrow { 2. } else { 3. }))
                            .child(content),
                    ),
            )
            .children(overlays)
    }
}
