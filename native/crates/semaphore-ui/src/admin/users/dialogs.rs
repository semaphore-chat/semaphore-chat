//! The page's dialogs, after `AdminUsersPage.tsx` and `ResetPasswordDialog.tsx`: the ban, delete
//! and owner confirms, the reset-password form, the instance-role assignment and the storage
//! quota. Each waits on its own change (`Pending`, as `moderation/dialogs.rs` does): while it runs
//! its button spins, when it fails the server's words stay beside it, and when it succeeds the
//! dialog goes.
//!
//! The quota is the one exception: core records `SetUserQuota` on `AdminStorage { min_percent: 0 }`,
//! a view this page is never fed, so nothing here can follow it. Its dialog sends and closes; a
//! refusal shows on the storage page, as it does on the web.

use super::{Panel, UsersEvent, UsersPage};
use crate::community_settings::common::{field_error, loading_rows, server_error, who};
use crate::community_settings::rules::{act, failure, js_len, running};
use crate::kit::{
    Alert, Button, ButtonSize, ButtonTone, Dialog, Severity, TextField, Variant, spacing, text,
};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminActionKind, AdminUserRow, InstanceRoleRef, LoadState};
use std::rc::Rc;

/// A dialog button's handler: a click, or the dialog's own close request.
type PressHandler = Rc<dyn Fn(&mut Window, &mut App)>;

/// What a dialog's button does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Press {
    Ban,
    Delete,
    Owner,
    Reset,
    Quota,
    Cancel,
}

const PASSWORD_MIN: usize = 8;
const PASSWORD_MAX: usize = 128;
const GIB: u64 = 1 << 30;

/// The password's length rule, as `ResetPasswordDto` and the web's `maxLength` count it. An empty
/// field is not an error yet; it just can't be sent.
fn password_error(typed: &str) -> Option<&'static str> {
    let length = js_len(typed);
    if length == 0 {
        None
    } else if length < PASSWORD_MIN {
        Some("Password must be at least 8 characters")
    } else if length > PASSWORD_MAX {
        Some("Password must be at most 128 characters")
    } else {
        None
    }
}

/// "Enter a whole number of GB": empty says nothing until Save is pressed, anything but digits
/// (or far too large) says why not.
fn quota_error(typed: &str) -> Option<&'static str> {
    let typed = typed.trim();
    if typed.is_empty() {
        return None;
    }
    parse_gb(typed).err()
}

fn parse_gb(typed: &str) -> Result<u64, &'static str> {
    let typed = typed.trim();
    let whole = !typed.is_empty() && typed.chars().all(|c| c.is_ascii_digit());
    match typed.parse::<u64>() {
        Ok(gb) if whole && gb.checked_mul(GIB).is_some() => Ok(gb),
        _ => Err("Enter a whole number of GB"),
    }
}

impl UsersPage {
    /// Opens a dialog for the open user, empty (the quota starts at what they have).
    pub(super) fn open_panel(&mut self, panel: Panel, window: &mut Window, cx: &mut Context<Self>) {
        self.panel = Some(panel);
        self.pending = None;
        self.error = None;
        match panel {
            Panel::ResetPassword => self
                .password
                .update(cx, |field, cx| field.set_value("", window, cx)),
            Panel::Quota => {
                let gib = self
                    .open_row()
                    .map(|row| row.storage_quota_bytes / GIB)
                    .unwrap_or(0);
                self.quota
                    .update(cx, |field, cx| field.set_value(gib.to_string(), window, cx));
            }
            _ => {}
        }
        cx.notify();
    }

    /// The open dialog, over the page. Nothing for the menu.
    pub(super) fn dialog(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let panel = self.panel?;
        if panel == Panel::Menu {
            return None;
        }
        let row = self.open_row()?.clone();
        let name = who(&row.user);
        let cancel = press(cx, Press::Cancel);
        Some(match panel {
            Panel::Menu => return None,
            Panel::Ban => {
                let busy = self.busy(AdminActionKind::BanUser);
                self.confirm(
                    "admin-ban",
                    AdminActionKind::BanUser,
                    "Ban User",
                    format!("Ban {name}? They're signed out and can't sign in until unbanned."),
                    "Ban",
                    true,
                    busy,
                    cx,
                )
                .into_any_element()
            }
            Panel::Delete => {
                let busy = self.busy(AdminActionKind::DeleteUser);
                self.confirm(
                    "admin-delete",
                    AdminActionKind::DeleteUser,
                    "Delete User",
                    format!("Delete {name}? This can't be undone."),
                    "Delete",
                    true,
                    busy,
                    cx,
                )
                .into_any_element()
            }
            Panel::Owner if row.is_owner => {
                let busy = self.busy(AdminActionKind::SetOwner);
                self.confirm(
                    "admin-owner",
                    AdminActionKind::SetOwner,
                    "Remove Owner",
                    format!("Remove {name}'s owner role?"),
                    "Remove Owner",
                    false,
                    busy,
                    cx,
                )
                .into_any_element()
            }
            Panel::Owner => {
                let busy = self.busy(AdminActionKind::SetOwner);
                self.confirm(
                    "admin-owner",
                    AdminActionKind::SetOwner,
                    "Make Instance Owner",
                    format!("Make {name} an instance owner? Owners can do everything."),
                    "Make Owner",
                    false,
                    busy,
                    cx,
                )
                .into_any_element()
            }
            Panel::ResetPassword => {
                let typed = self.password.read(cx).value().to_string();
                let invalid = password_error(&typed);
                let busy = self.busy(AdminActionKind::SetUserPassword);
                let sem = cx.sem().clone();
                let save = press(cx, Press::Reset);
                Dialog::new(format!("Reset Password for {name}"))
                    .width(480.)
                    .body(
                        div()
                            .pt(spacing(1.))
                            .flex()
                            .flex_col()
                            .gap(spacing(2.))
                            .children(
                                (!busy)
                                    .then(|| self.refusal(AdminActionKind::SetUserPassword))
                                    .flatten()
                                    .map(|error| Alert::new(Severity::Error, error)),
                            )
                            .child(
                                text(Variant::Body2, "Their sessions end.")
                                    .text_color(sem.text_secondary),
                            )
                            .child(
                                TextField::new(
                                    "admin-reset-password-field",
                                    &self.password,
                                    "New password",
                                )
                                .disabled(busy)
                                .error(invalid.is_some()),
                            )
                            .children(invalid.map(|message| {
                                inline_error("admin-reset-password-error", message, cx)
                            })),
                    )
                    .action(
                        Button::new("admin-reset-password-cancel", "Cancel")
                            .disabled(busy)
                            .on_click(as_click(cancel.clone())),
                    )
                    .action(
                        Button::new("admin-reset-password-save", "Reset Password")
                            .contained()
                            .loading(busy)
                            .disabled(invalid.is_some() || typed.is_empty())
                            .on_click(as_click(save.clone())),
                    )
                    .on_close(move |window, cx| cancel(window, cx))
                    .into_any_element()
            }
            Panel::Quota => {
                let typed = self.quota.read(cx).value().to_string();
                let invalid = quota_error(&typed);
                let sem = cx.sem().clone();
                let save = press(cx, Press::Quota);
                Dialog::new(format!("Storage Quota for {name}"))
                    .width(480.)
                    .body(
                        div()
                            .pt(spacing(1.))
                            .flex()
                            .flex_col()
                            .gap(spacing(2.))
                            .child(
                                text(
                                    Variant::Body2,
                                    "The most this user's files may take, in GB. 0 sets no quota.",
                                )
                                .text_color(sem.text_secondary),
                            )
                            .child(
                                TextField::new("admin-quota-field", &self.quota, "Quota (GB)")
                                    .error(invalid.is_some()),
                            )
                            .children(
                                invalid
                                    .map(|message| inline_error("admin-quota-error", message, cx)),
                            ),
                    )
                    .action(
                        Button::new("admin-quota-cancel", "Cancel")
                            .on_click(as_click(cancel.clone())),
                    )
                    .action(
                        Button::new("admin-quota-save", "Save")
                            .contained()
                            .disabled(invalid.is_some() || typed.trim().is_empty())
                            .on_click(as_click(save.clone())),
                    )
                    .on_close(move |window, cx| cancel(window, cx))
                    .into_any_element()
            }
            Panel::Roles => self.roles_dialog(&row, cancel, cx),
        })
    }

    /// The web's ConfirmDialog, with the change's refusal under the question and its spinner on the
    /// action: `common::Confirm` has no room for core's words, which stay in the dialog.
    #[allow(clippy::too_many_arguments)]
    fn confirm(
        &self,
        id: &'static str,
        kind: AdminActionKind,
        title: &'static str,
        message: String,
        confirm: &'static str,
        danger: bool,
        busy: bool,
        cx: &Context<Self>,
    ) -> Dialog {
        let cancel = press(cx, Press::Cancel);
        let go = match id {
            "admin-delete" => press(cx, Press::Delete),
            "admin-owner" => press(cx, Press::Owner),
            _ => press(cx, Press::Ban),
        };
        let mut action = Button::new(SharedString::from(format!("{id}-confirm")), confirm)
            .contained()
            .loading(busy);
        if danger {
            action = action.tone(ButtonTone::Danger);
        }
        let refusal = (!busy).then(|| self.refusal(kind)).flatten();
        Dialog::new(title)
            .width(480.)
            .body(
                div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(refusal.map(|error| Alert::new(Severity::Error, error)))
                    .child(text(Variant::Body2, message)),
            )
            .action(
                Button::new(SharedString::from(format!("{id}-cancel")), "Cancel")
                    .disabled(busy)
                    .on_click(as_click(cancel.clone())),
            )
            .action(action.on_click(as_click(go.clone())))
            .on_close(move |window, cx| cancel(window, cx))
    }

    fn roles_dialog(
        &self,
        row: &AdminUserRow,
        cancel: PressHandler,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let name = who(&row.user);
        let view = self.user_roles.clone();
        let body: AnyElement = match &view {
            None => loading_rows("admin-roles-loading", "Loading instance roles", 3),
            Some(view) => match &view.state {
                LoadState::Loading => {
                    loading_rows("admin-roles-loading", "Loading instance roles", 3)
                }
                LoadState::Failed { error } => div()
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(spacing(1.5))
                    .children(server_error(Some(error)))
                    .child(
                        Button::new("admin-roles-retry", "Try again")
                            .outlined()
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(UsersEvent::Retry))),
                    )
                    .into_any_element(),
                LoadState::Ready => {
                    let mut sections = div().flex().flex_col().gap(spacing(2.));
                    if row.is_owner {
                        sections = sections.child(Alert::new(
                            Severity::Info,
                            "This user is an instance owner and automatically has all permissions. \
                             Assigning roles gives them permissions if they are demoted.",
                        ));
                    }
                    sections = sections.child(
                        text(
                            Variant::Body2,
                            "Assign instance-level roles to grant administrative permissions.",
                        )
                        .text_color(sem.text_secondary),
                    );
                    if view.held.is_empty() && view.available.is_empty() {
                        sections = sections.child(
                            text(
                                Variant::Body2,
                                "No instance roles available. Create roles in the Roles page \
                                 first.",
                            )
                            .text_color(sem.text_secondary),
                        );
                    }
                    if !view.held.is_empty() {
                        sections = sections.child(self.role_section(
                            "Assigned Roles",
                            &view.held,
                            true,
                            cx,
                        ));
                    }
                    if !view.available.is_empty() {
                        sections = sections.child(self.role_section(
                            "Available Roles",
                            &view.available,
                            false,
                            cx,
                        ));
                    }
                    sections.into_any_element()
                }
            },
        };
        let dialog = Dialog::new(format!("Manage Instance Roles for {name}"))
            .width(520.)
            .body(div().pt(spacing(1.)).child(body))
            .action(
                Button::new("admin-user-roles-close", "Close").on_click(as_click(cancel.clone())),
            )
            .on_close(move |window, cx| cancel(window, cx));
        div()
            .id("admin-user-roles-dialog")
            .test_support()
            .child(dialog)
            .into_any_element()
    }

    fn role_section(
        &self,
        title: &'static str,
        roles: &[InstanceRoleRef],
        held: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let rows: Vec<_> = roles
            .iter()
            .map(|role| self.role_row(role, held, cx))
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .child(text(Variant::Subtitle2, title).text_color(sem.text_primary))
            .children(rows)
            .into_any_element()
    }

    fn role_row(&self, role: &InstanceRoleRef, held: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let op = self.roles_op();
        let kind = if held {
            AdminActionKind::UnassignInstanceRole
        } else {
            AdminActionKind::AssignInstanceRole
        };
        let action = act(kind, Some(&role.id));
        let busy = running(&op, &action);
        let refused =
            failure(&op, &action).map(|error| format!("Last try failed: {}", error.message));
        let id = role.id.clone();
        let button = if held {
            Button::new(
                SharedString::from(format!("admin-role-remove-{}", role.id)),
                "Remove",
            )
            .outlined()
            .color(sem.error)
            .size(ButtonSize::Small)
            .loading(busy)
            .on_click(cx.listener(move |page, _, _, cx| page.toggle_role(id.clone(), true, cx)))
        } else {
            Button::new(
                SharedString::from(format!("admin-role-assign-{}", role.id)),
                "Assign",
            )
            .contained()
            .size(ButtonSize::Small)
            .loading(busy)
            .on_click(cx.listener(move |page, _, _, cx| page.toggle_role(id.clone(), false, cx)))
        };
        crate::community_settings::common::row(
            SharedString::from(format!("admin-role-{}", role.id)),
            role.name.clone(),
            cx,
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    text(Variant::Body1, role.name.clone())
                        .truncate()
                        .text_color(sem.text_primary),
                )
                .children(
                    refused.map(|message| text(Variant::Caption, message).text_color(sem.error)),
                ),
        )
        .child(button)
        .into_any_element()
    }

    /// Assigning or removing one instance role: each waits on its own entry in
    /// `AdminUserRolesView::op`, so one role's failure never covers another's row.
    fn toggle_role(&mut self, role_id: String, held: bool, cx: &mut Context<Self>) {
        let Some(user_id) = self.open_id.clone() else {
            return;
        };
        let kind = if held {
            AdminActionKind::UnassignInstanceRole
        } else {
            AdminActionKind::AssignInstanceRole
        };
        if running(&self.roles_op(), &act(kind, Some(&role_id))) {
            return;
        }
        let event = if held {
            UsersEvent::UnassignRole { user_id, role_id }
        } else {
            UsersEvent::AssignRole { user_id, role_id }
        };
        cx.emit(event);
        cx.notify();
    }

    fn pressed(&mut self, what: Press, cx: &mut Context<Self>) {
        if what == Press::Cancel {
            // A change on its way keeps its dialog, as the web's busy dialogs do.
            let waiting = self
                .panel
                .and_then(Panel::action)
                .is_some_and(|kind| self.busy(kind));
            if !waiting {
                self.close(cx);
            }
            return;
        }
        let Some(user_id) = self.open_id.clone() else {
            return;
        };
        match what {
            Press::Ban => self.send(AdminActionKind::BanUser, UsersEvent::Ban { user_id }, cx),
            Press::Delete => self.send(
                AdminActionKind::DeleteUser,
                UsersEvent::Delete { user_id },
                cx,
            ),
            Press::Owner => {
                let owner = !self.open_row().map(|row| row.is_owner).unwrap_or(false);
                self.send(
                    AdminActionKind::SetOwner,
                    UsersEvent::SetOwner { user_id, owner },
                    cx,
                );
            }
            Press::Reset => {
                let password = self.password.read(cx).value().to_string();
                if password_error(&password).is_some() || password.is_empty() {
                    return;
                }
                self.send(
                    AdminActionKind::SetUserPassword,
                    UsersEvent::ResetPassword { user_id, password },
                    cx,
                );
            }
            Press::Quota => {
                let typed = self.quota.read(cx).value().to_string();
                let Ok(gb) = parse_gb(&typed) else {
                    return;
                };
                let Some(quota_bytes) = gb.checked_mul(GIB) else {
                    return;
                };
                self.send(
                    AdminActionKind::SetUserQuota,
                    UsersEvent::SetQuota {
                        user_id,
                        quota_bytes,
                    },
                    cx,
                );
                // See the module docs: this page is not fed the storage op the change lives on.
                self.close(cx);
            }
            Press::Cancel => {}
        }
    }
}

/// A field's error line where the web puts `helperText`, named so a screen reader and a test can
/// read the sentence.
fn inline_error(id: &'static str, message: &'static str, cx: &App) -> AnyElement {
    div()
        .id(id)
        .test_support()
        .role(Role::Alert)
        .aria_label(message.to_owned())
        .child(field_error(message, cx))
        .into_any_element()
}

/// A dialog button's handler: runs `what` on the page.
fn press(cx: &Context<UsersPage>, what: Press) -> PressHandler {
    let page = cx.weak_entity();
    Rc::new(move |_window, cx| {
        page.update(cx, |page, cx| page.pressed(what, cx)).ok();
    })
}

/// The same handler for a `Button::on_click`.
fn as_click(handler: PressHandler) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    move |_, window, cx| handler(window, cx)
}
