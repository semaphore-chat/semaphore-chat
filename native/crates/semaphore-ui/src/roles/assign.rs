//! The role assignment dialog for one member, after `RoleAssignmentDialog.tsx`, opened from the
//! Members tab's `ManageRoles { user_id }`: a checkbox per role, "Current" on the ones they hold,
//! and Save once something changed. Roles the user can't give or take are off with the reason.
//!
//! Save emits the roles to give and to take; the app runs them one at a time (gives, then takes),
//! as the web does, and closes the dialog when every call succeeded. After a failure it refreshes
//! `set_member_roles` and calls `set_saving(false)`: the error shows, the choice stays, and a retry
//! sends only what is still different.

use super::common::{empty_line, loading_rows, locked_note, tone_chip};
use super::rules::{
    actions_preview, any_running, assign_block, assignment_diff, failure, member_block,
    permissions_count, role_action, running,
};
use crate::kit::{
    Alert, Button, Checkbox, Chip, Dialog, Severity, Variant, spacing, text, with_tip,
};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminActionKind, LoadState, MemberRolesView, RolesView};
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoleAssignmentEvent {
    /// `Core::assign_role` for each of `add`, then `Core::unassign_role` for each of `remove`.
    Save {
        user_id: String,
        add: Vec<String>,
        remove: Vec<String>,
    },
    /// Cancel, Escape or the backdrop.
    Close,
}

pub struct RoleAssignmentDialog {
    user_id: String,
    member_name: String,
    roles: RolesView,
    member: MemberRolesView,
    chosen: Option<BTreeSet<String>>,
    saving: bool,
}

impl EventEmitter<RoleAssignmentEvent> for RoleAssignmentDialog {}

impl RoleAssignmentDialog {
    pub fn new(user_id: String, member_name: String) -> Self {
        Self {
            member: MemberRolesView {
                user_id: user_id.clone(),
                ..MemberRolesView::default()
            },
            user_id,
            member_name,
            roles: RolesView::default(),
            chosen: None,
            saving: false,
        }
    }

    /// `Core::roles(community)`.
    pub fn set_roles(&mut self, roles: RolesView, cx: &mut Context<Self>) {
        self.roles = roles;
        cx.notify();
    }

    /// `Core::member_roles(community, user_id)`, again on `ViewKey::MemberRoles`. The choice
    /// starts from what they hold, once.
    pub fn set_member_roles(&mut self, member: MemberRolesView, cx: &mut Context<Self>) {
        if self.chosen.is_none() && member.state == LoadState::Ready {
            self.chosen = Some(member.held.iter().cloned().collect());
        }
        self.member = member;
        cx.notify();
    }

    /// While the app runs the gives and takes.
    pub fn set_saving(&mut self, saving: bool, cx: &mut Context<Self>) {
        self.saving = saving;
        cx.notify();
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    fn held(&self) -> BTreeSet<String> {
        self.member.held.iter().cloned().collect()
    }

    pub(crate) fn changes(&self) -> (Vec<String>, Vec<String>) {
        match &self.chosen {
            Some(chosen) => assignment_diff(&self.roles.roles, &self.held(), chosen),
            None => (Vec::new(), Vec::new()),
        }
    }

    fn busy(&self) -> bool {
        self.saving
            || any_running(
                &self.member.op,
                &[AdminActionKind::AssignRole, AdminActionKind::UnassignRole],
            )
    }

    /// This role being given or taken right now.
    fn role_running(&self, role_id: &str) -> bool {
        [AdminActionKind::AssignRole, AdminActionKind::UnassignRole]
            .into_iter()
            .any(|kind| running(&self.member.op, &role_action(kind, Some(role_id))))
    }

    /// Why giving or taking this role failed.
    fn role_failure(&self, role_id: &str) -> Option<String> {
        [AdminActionKind::AssignRole, AdminActionKind::UnassignRole]
            .into_iter()
            .find_map(|kind| failure(&self.member.op, &role_action(kind, Some(role_id))))
            .map(|error| error.message.clone())
    }

    /// Why this role's box is off.
    fn role_block(&self, role_id: &str) -> Option<String> {
        if let Some(reason) = self.member.not_allowed {
            return Some(member_block(reason).to_owned());
        }
        if self.member.changeable.iter().any(|id| id == role_id) {
            return None;
        }
        let role = self.roles.roles.iter().find(|r| r.id == role_id)?;
        Some(assign_block(role).unwrap_or_else(|| "This member ranks at or above you".to_owned()))
    }

    pub(crate) fn toggle(&mut self, role_id: &str, cx: &mut Context<Self>) {
        if self.busy() || self.role_block(role_id).is_some() {
            return;
        }
        if let Some(chosen) = self.chosen.as_mut()
            && !chosen.remove(role_id)
        {
            chosen.insert(role_id.to_owned());
        }
        cx.notify();
    }

    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        let (add, remove) = self.changes();
        if self.busy() || (add.is_empty() && remove.is_empty()) {
            return;
        }
        self.saving = true;
        cx.emit(RoleAssignmentEvent::Save {
            user_id: self.user_id.clone(),
            add,
            remove,
        });
        cx.notify();
    }

    fn body(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let failed = match (&self.roles.state, &self.member.state) {
            (LoadState::Failed { error }, _) | (_, LoadState::Failed { error }) => Some(error),
            _ => None,
        };
        if let Some(error) = failed {
            return Alert::new(
                Severity::Error,
                format!("Failed to load role information: {}", error.message),
            )
            .into_any_element();
        }
        let Some(chosen) = self.chosen.clone() else {
            return loading_rows("role-assign-loading", "Loading roles", 3);
        };
        if self.roles.state == LoadState::Loading {
            return loading_rows("role-assign-loading", "Loading roles", 3);
        }
        if self.roles.roles.is_empty() {
            return empty_line("No roles available in this community", cx).into_any_element();
        }
        let held = self.held();
        let busy = self.busy();
        let whole = self.member.not_allowed;
        let rows: Vec<AnyElement> = self
            .roles
            .roles
            .iter()
            .map(|role| {
                let on = chosen.contains(&role.id);
                let block = self.role_block(&role.id);
                let disabled = block.is_some() || busy;
                let id = role.id.clone();
                let (shown, more) = actions_preview(&role.actions, 2);
                let mut summary = permissions_count(role.actions.len());
                if !shown.is_empty() {
                    summary.push_str(&format!(" \u{2022} {}", shown.join(", ")));
                }
                if more > 0 {
                    summary.push_str(&format!(" +{more} more"));
                }
                let entity = cx.weak_entity();
                let checkbox = Checkbox::new(
                    SharedString::from(format!("role-assign-{}", role.id)),
                    role.name.clone(),
                    on,
                )
                .caption(summary)
                .disabled(disabled)
                .dense()
                .on_toggle(move |_, _, cx| {
                    entity.update(cx, |dialog, cx| dialog.toggle(&id, cx)).ok();
                })
                .flex_1();
                let checkbox: AnyElement = match &block {
                    Some(reason) => with_tip(
                        div()
                            .id(SharedString::from(format!(
                                "role-assign-{}-locked",
                                role.id
                            )))
                            .flex_1()
                            .min_w_0(),
                        reason.clone(),
                    )
                    .test_support()
                    .child(checkbox)
                    .into_any_element(),
                    None => checkbox.into_any_element(),
                };
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(spacing(1.))
                            .child(checkbox)
                            .when(held.contains(&role.id), |row| {
                                row.child(tone_chip("Current", sem.primary))
                            }),
                    )
                    .when(self.role_running(&role.id), |row| {
                        row.child(
                            text(Variant::Caption, "Saving\u{2026}")
                                .pl(px(54.))
                                .text_color(sem.text_secondary),
                        )
                    })
                    .when_some(self.role_failure(&role.id), |row, message| {
                        row.child(
                            div()
                                .pl(px(54.))
                                .pt(px(2.))
                                .child(Alert::new(Severity::Error, message)),
                        )
                    })
                    .when_some(block.filter(|_| !busy && whole.is_none()), |row, reason| {
                        row.child(div().pl(px(54.)).pt(px(2.)).child(locked_note(
                            SharedString::from(format!("role-assign-{}-why", role.id)),
                            reason,
                            cx,
                        )))
                    })
                    .into_any_element()
            })
            .collect();
        let count = chosen.len();
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.5))
            .when_some(whole, |body, reason| {
                body.child(Alert::new(Severity::Info, member_block(reason)))
            })
            .child(
                text(
                    Variant::Body2,
                    "Select which roles this user should have in the community:",
                )
                .text_color(sem.text_secondary),
            )
            .child(div().flex().child(if count > 0 {
                tone_chip(
                    format!("{count} role{} selected", if count == 1 { "" } else { "s" }),
                    sem.primary,
                )
            } else {
                Chip::new("0 roles selected")
            }))
            .child(div().h(px(1.)).bg(sem.divider))
            .child(
                div()
                    .id("role-assign-list")
                    .test_support()
                    .flex()
                    .flex_col()
                    .gap(spacing(0.5))
                    .children(rows),
            )
            .into_any_element()
    }
}

impl Render for RoleAssignmentDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = super::common::phone(window);
        let (add, remove) = self.changes();
        let changed = !add.is_empty() || !remove.is_empty();
        let busy = self.busy();
        let body = self.body(cx);
        let cancel = cx.weak_entity();
        let close = cx.weak_entity();
        let save = cx.weak_entity();
        div().relative().size_full().child(
            Dialog::new(format!("Manage Roles for {}", self.member_name))
                .width(if narrow { 360. } else { 520. })
                .body(
                    div()
                        .id("role-assign-body")
                        .max_h(px(if narrow { 480. } else { 520. }))
                        .overflow_y_scroll()
                        .child(body),
                )
                .action(
                    Button::new("role-assign-cancel", "Cancel")
                        .disabled(busy)
                        .on_click(move |_, _, cx| {
                            cancel
                                .update(cx, |_, cx| cx.emit(RoleAssignmentEvent::Close))
                                .ok();
                        }),
                )
                .action(
                    Button::new("role-assign-save", "Save Changes")
                        .contained()
                        .loading(busy)
                        .disabled(!changed || busy)
                        .on_click(move |_, _, cx| {
                            save.update(cx, |dialog, cx| dialog.save(cx)).ok();
                        }),
                )
                .on_close(move |_, cx| {
                    close
                        .update(cx, |dialog, cx| {
                            if !dialog.busy() {
                                cx.emit(RoleAssignmentEvent::Close)
                            }
                        })
                        .ok();
                }),
        )
    }
}
