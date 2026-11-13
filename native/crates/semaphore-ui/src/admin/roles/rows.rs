//! The instance roles list: one row per role (its name, Default/Custom chip, a preview of its
//! permissions, how many it holds, and the users, edit and delete actions), in each state the
//! read can be in, after `RoleManagement.tsx`'s accordion rows. Each change reads its own entry in
//! `AdminOp::actions`, so a delete running on one row and a refusal on another show on their own
//! rows.

use super::{InstanceRolesEvent, InstanceRolesPage, delete_action, update_action};
use crate::community_settings::common::{empty_line, list, loading_rows, row, tone_chip};
use crate::community_settings::rules::{failure, needs, running};
use crate::kit::{Alert, Button, Chip, Severity, Spinner, Variant, spacing, text};
use crate::roles::rules::{actions_preview, permissions_count};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{InstanceRoleRow, LoadState};
use semaphore_design::Icon as DesignIcon;

/// Why the edit action is off, or `None` when it can be pressed.
fn edit_block(page: &InstanceRolesPage, role: &InstanceRoleRow) -> Option<String> {
    if !page.can_write() {
        return Some(needs("Update instance settings"));
    }
    (!role.editable).then(|| "It has permissions you don't have".to_owned())
}

/// Why the delete action is off, or `None` when it can be pressed.
fn delete_block(page: &InstanceRolesPage, role: &InstanceRoleRow) -> Option<String> {
    if !page.can_write() {
        return Some(needs("Update instance settings"));
    }
    (!role.deletable).then(|| {
        if role.is_default {
            "The Instance Admin role can't be deleted".to_owned()
        } else {
            "It has permissions you don't have".to_owned()
        }
    })
}

impl InstanceRolesPage {
    pub(super) fn list_card(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let title = match self.view.state {
            LoadState::Ready => format!("Roles ({})", self.view.roles.len()),
            _ => "Roles".to_owned(),
        };
        let body: AnyElement = match &self.view.state {
            LoadState::Loading => loading_rows("admin-roles-loading", "Loading roles", 4),
            LoadState::Failed { error } => div()
                .flex()
                .flex_col()
                .items_start()
                .gap(spacing(1.5))
                .child(Alert::new(
                    Severity::Error,
                    format!("Failed to load instance roles: {}", error.message),
                ))
                .child(
                    Button::new("admin-roles-retry", "Try again")
                        .outlined()
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(InstanceRolesEvent::Retry))),
                )
                .into_any_element(),
            LoadState::Ready if self.view.roles.is_empty() => {
                let sem = cx.sem().clone();
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(spacing(1.))
                    .child(empty_line("No instance roles found", cx))
                    .child(
                        text(
                            Variant::Body2,
                            "Create a role to delegate admin permissions to users.",
                        )
                        .text_center()
                        .text_color(sem.text_secondary),
                    )
                    .into_any_element()
            }
            LoadState::Ready => {
                let roles = self.view.roles.clone();
                let rows: Vec<AnyElement> = roles
                    .iter()
                    .map(|role| self.role_row(role, narrow, cx))
                    .collect();
                list("admin-roles-list", "Instance roles")
                    .children(rows)
                    .into_any_element()
            }
        };
        crate::community_settings::common::card(title, body, cx).into_any_element()
    }

    /// One role: its name and kind, the first permissions, its count, and its actions.
    fn role_row(&self, role: &InstanceRoleRow, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let id = role.id.clone();
        let deleting = running(&self.view.op, &delete_action(&id));
        let row_error = failure(&self.view.op, &delete_action(&id))
            .or_else(|| {
                // An edit that failed after its editor closed.
                let open = self
                    .editor
                    .as_ref()
                    .is_some_and(|editor| editor.role_id.as_deref() == Some(id.as_str()));
                (!open)
                    .then(|| failure(&self.view.op, &update_action(&id)))
                    .flatten()
            })
            .map(|error| error.message.clone());
        let chip = if role.is_default {
            Chip::new("Default")
        } else {
            tone_chip("Custom", sem.primary)
        };
        let name_block = div()
            .w_full()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .min_w_0()
            .child(
                text(Variant::Subtitle1, role.name.clone())
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .font_weight(FontWeight(500.))
                    .text_color(sem.text_primary),
            )
            .child(chip);
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
        let count = text(Variant::Caption, permissions_count(role.actions.len()))
            .whitespace_nowrap()
            .flex_shrink_0()
            .text_color(sem.text_secondary);
        let (users_id, edit_id, delete_id) = (id.clone(), id.clone(), id.clone());
        let delete_button: AnyElement = if deleting {
            div()
                .id(SharedString::from(format!("admin-role-deleting-{id}")))
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label(format!("Deleting {}", role.name))
                .size(px(34.))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    Spinner::new(SharedString::from(format!("admin-role-deleting-spin-{id}")))
                        .size(18.),
                )
                .into_any_element()
        } else {
            crate::community_settings::common::action_icon(
                format!("admin-role-delete-{id}"),
                DesignIcon::DeleteOutline,
                format!("Delete {}", role.name),
                delete_block(self, role),
                false,
                Some(sem.error),
                cx.listener(move |page, _, _, cx| page.ask_delete(&delete_id, cx)),
            )
        };
        let actions = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .child(crate::community_settings::common::action_icon(
                format!("admin-role-users-{id}"),
                DesignIcon::People,
                format!("View users of {}", role.name),
                None,
                false,
                None,
                cx.listener(move |page, _, _, cx| page.open_users(&users_id, cx)),
            ))
            .child(crate::community_settings::common::action_icon(
                format!("admin-role-edit-{id}"),
                DesignIcon::Edit,
                format!("Edit {}", role.name),
                edit_block(self, role),
                false,
                Some(sem.primary),
                cx.listener(move |page, _, window, cx| page.open_edit(&edit_id, window, cx)),
            ))
            .child(delete_button);
        let error =
            row_error.map(|message| div().w_full().child(Alert::new(Severity::Error, message)));
        let base = row(
            SharedString::from(format!("admin-role-{id}")),
            role.name.clone(),
            cx,
        )
        .when(deleting, |row| row.opacity(0.6));
        if narrow {
            base.flex_col()
                .items_start()
                .gap(spacing(1.))
                .child(name_block)
                .child(
                    div()
                        .w_full()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(spacing(1.))
                        .child(count)
                        .child(actions),
                )
                .child(div().w_full().child(chips))
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
                        .child(
                            div()
                                .w(px(240.))
                                .flex_shrink_0()
                                .min_w_0()
                                .child(name_block),
                        )
                        .child(div().flex_1().min_w_0().child(chips))
                        .child(count)
                        .child(actions),
                )
                .children(error)
                .into_any_element()
        }
    }
}
