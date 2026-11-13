//! The page: the search and filters, the users list a page at a time, and the per-user menu.
//!
//! The rows follow the members tab (`community_settings/members.rs`): the face and names, the
//! role's chips, and one entry per user, here a menu whose every item says why it is off when core
//! says so (`AdminUserActions`). The list itself, its states and the "Load more" foot follow the
//! web's `AdminUsersPage`.

use super::{Panel, UsersEvent, UsersPage};
use crate::community_settings::common::{
    card, empty_line, list, loading_rows, locked_note, page, phone, row, server_error, tone_chip,
    who,
};
use crate::community_settings::rules::{act, date_label, failure, needs, running, size_label};
use crate::dms::face::user_face;
use crate::kit::{Button, IconButton, Menu, MenuItem, SecondaryTone, Variant, spacing, text};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminActionKind, AdminNotAllowed, AdminOp, AdminUserRow, LoadState};
use semaphore_design::Icon as DesignIcon;

/// What a menu item does once picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Choice {
    Ban,
    Unban,
    ResetPassword,
    Owner,
    Roles,
    Quota,
    Delete,
}

impl UsersPage {
    /// The whole screen: the heading, the filter card and the users card.
    pub(super) fn body(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let narrow = phone(window);
        if !self.caps.users_read {
            return page(
                "admin-users",
                "User Management",
                Some("Manage instance users, roles, and bans".into()),
                Vec::new(),
                card(
                    "Users",
                    locked_note("admin-users-locked", needs("View users"), cx),
                    cx,
                ),
                window,
                cx,
            );
        }
        let filters = self.filters(narrow, cx);
        let users = self.users_card(narrow, cx);
        page(
            "admin-users",
            "User Management",
            Some("Manage instance users, roles, and bans".into()),
            Vec::new(),
            div()
                .flex()
                .flex_col()
                .gap(spacing(3.))
                .child(filters)
                .child(users),
            window,
            cx,
        )
    }

    fn filters(&self, narrow: bool, cx: &Context<Self>) -> Div {
        card(
            "Filters",
            div()
                .flex()
                .when(narrow, |filters| filters.flex_col())
                .when(!narrow, |filters| filters.flex_row().items_center())
                .gap(spacing(2.))
                .child(
                    div()
                        .when(narrow, |field| field.w_full())
                        .when(!narrow, |field| field.w(px(320.)))
                        .child(
                            crate::kit::TextField::new(
                                "admin-users-search",
                                &self.search,
                                "Search users",
                            )
                            .placeholder("Search users\u{2026}"),
                        ),
                )
                .child(
                    div()
                        .when(narrow, |field| field.w_full())
                        .when(!narrow, |field| field.w(px(160.)))
                        .child(crate::kit::SelectField::new(
                            "admin-users-status",
                            &self.status,
                            "Status",
                        )),
                )
                .child(
                    div()
                        .when(narrow, |field| field.w_full())
                        .when(!narrow, |field| field.w(px(160.)))
                        .child(crate::kit::SelectField::new(
                            "admin-users-role",
                            &self.role,
                            "Role",
                        )),
                ),
            cx,
        )
    }

    fn users_card(&mut self, narrow: bool, cx: &mut Context<Self>) -> Div {
        let title = match self.view.state {
            LoadState::Ready => format!("Users ({})", self.view.rows.len()),
            _ => "Users".to_owned(),
        };
        let body: AnyElement = match &self.view.state {
            LoadState::Loading => loading_rows("admin-users-loading", "Loading users", 6),
            LoadState::Failed { error } => div()
                .flex()
                .flex_col()
                .items_start()
                .gap(spacing(1.5))
                .children(server_error(Some(error)))
                .child(
                    Button::new("admin-users-retry", "Try again")
                        .outlined()
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(UsersEvent::Retry))),
                )
                .into_any_element(),
            LoadState::Ready if self.view.rows.is_empty() => {
                empty_line("No users match these filters", cx).into_any_element()
            }
            LoadState::Ready => {
                let rows = self.view.rows.clone();
                let items: Vec<_> = rows
                    .iter()
                    .map(|row| self.user_row(row, narrow, cx))
                    .collect();
                list("admin-users-list", "Users")
                    .children(items)
                    .into_any_element()
            }
        };
        let more = (self.view.state == LoadState::Ready && self.view.more).then(|| {
            div().flex().justify_center().pt(spacing(1.)).child(
                Button::new("admin-users-more", "Load more")
                    .outlined()
                    .loading(self.view.loading_more)
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(UsersEvent::LoadMore))),
            )
        });
        card(
            title,
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(body)
                .children(more),
            cx,
        )
    }

    /// One user: who they are, their email, the Owner and Banned chips, their storage, when they
    /// joined, and the menu that holds every action core allows (or its reason).
    fn user_row(&self, person: &AdminUserRow, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let user_id = person.user.id.clone();
        let name = who(&person.user);
        // `None` when the user has neither chip: nothing is drawn or spaced for them.
        let chips = || {
            (person.is_owner || person.banned).then(|| {
                div()
                    .flex()
                    .flex_wrap()
                    .flex_shrink_0()
                    .items_center()
                    .gap(spacing(1.))
                    .when(person.is_owner, |chips| {
                        chips.child(tone_chip("Owner", sem.primary))
                    })
                    .when(person.banned, |chips| {
                        chips.child(tone_chip("Banned", sem.error))
                    })
            })
        };
        let email = person
            .email
            .clone()
            .filter(|email| !email.trim().is_empty());
        let display = person
            .user
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty() && *name != person.user.username);
        // The face, then the username, the display name and the email as one column, so the email
        // follows whichever line comes before it.
        let who_block = div()
            .flex_1()
            .min_w_0()
            .flex()
            .items_center()
            .gap(spacing(1.5))
            .child(user_face(&person.user, 36., None, cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        text(Variant::Body1, person.user.username.clone())
                            .font_weight(FontWeight(500.))
                            .truncate()
                            .text_color(sem.text_primary),
                    )
                    .children(display.map(|name| {
                        text(Variant::Body2, name.to_owned())
                            .truncate()
                            .text_color(sem.text_secondary)
                    }))
                    .children(email.map(|email| {
                        text(Variant::Caption, email)
                            .truncate()
                            .text_color(sem.text_secondary)
                    })),
            );
        let storage = text(Variant::Body2, storage_text(person))
            .whitespace_nowrap()
            .flex_shrink_0()
            .text_color(sem.text_secondary);
        let joined = text(
            Variant::Body2,
            format!("Joined {}", date_label(&self.time, person.created_at_ms)),
        )
        .whitespace_nowrap()
        .flex_shrink_0()
        .text_color(sem.text_secondary);
        // A phone's row is one column: the chips and the figures go under the name.
        let content = if narrow {
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(who_block)
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(spacing(1.5))
                        .children(chips())
                        .child(storage)
                        .child(joined),
                )
        } else {
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .items_center()
                .gap(spacing(2.))
                .child(who_block)
                .children(chips())
                .child(storage)
                .child(joined)
        };
        let menu_open =
            self.panel == Some(Panel::Menu) && self.open_id.as_deref() == Some(user_id.as_str());
        let menu_button = IconButton::new(
            SharedString::from(format!("admin-user-menu-{user_id}")),
            DesignIcon::MoreVert,
            format!("Actions for {name}"),
        )
        .small()
        .selected(menu_open)
        .on_click(cx.listener({
            let user_id = user_id.clone();
            move |page, _, _, cx| {
                if page.panel == Some(Panel::Menu)
                    && page.open_id.as_deref() == Some(user_id.as_str())
                {
                    page.close(cx);
                } else {
                    page.open_user(user_id.clone(), cx);
                }
            }
        }));
        let mut actions = div().relative().flex_shrink_0().child(menu_button);
        if menu_open {
            actions = actions.child(self.menu(person, narrow, cx));
        }
        row(
            SharedString::from(format!("admin-user-{user_id}")),
            name,
            cx,
        )
        // A phone's row is tall: its menu button belongs on the first line, not in the middle.
        .when(narrow, |row| row.items_start())
        .child(content)
        .child(actions)
        .into_any_element()
    }

    /// The open row's menu, anchored under its button. Every item core turns off keeps its place
    /// and says why under the label.
    fn menu(&self, person: &AdminUserRow, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let user_id = person.user.id.clone();
        let name = who(&person.user);
        let op = self.user_op();
        let mut items = Vec::new();
        // A banned user is unbanned; everyone else is banned.
        if person.banned {
            items.push(self.menu_item(
                "admin-user-unban",
                "Unban User",
                DesignIcon::CheckCircle,
                person.actions.unban,
                Some(AdminActionKind::UnbanUser),
                false,
                Choice::Unban,
                narrow,
                &op,
                &user_id,
                cx,
            ));
        } else {
            items.push(self.menu_item(
                "admin-user-ban",
                "Ban User",
                DesignIcon::Block,
                person.actions.ban,
                Some(AdminActionKind::BanUser),
                true,
                Choice::Ban,
                narrow,
                &op,
                &user_id,
                cx,
            ));
        }
        if person.is_owner {
            items.push(self.menu_item(
                "admin-user-remove-owner",
                "Demote to User",
                DesignIcon::Person,
                person.actions.set_owner,
                Some(AdminActionKind::SetOwner),
                false,
                Choice::Owner,
                narrow,
                &op,
                &user_id,
                cx,
            ));
        } else {
            items.push(self.menu_item(
                "admin-user-make-owner",
                "Promote to Owner",
                DesignIcon::Star,
                person.actions.set_owner,
                Some(AdminActionKind::SetOwner),
                false,
                Choice::Owner,
                narrow,
                &op,
                &user_id,
                cx,
            ));
        }
        items.push(self.menu_item(
            "admin-user-roles",
            "Manage Instance Roles",
            DesignIcon::Security,
            person.actions.edit_roles,
            None,
            false,
            Choice::Roles,
            narrow,
            &op,
            &user_id,
            cx,
        ));
        items.push(self.menu_item(
            "admin-user-reset-password",
            "Reset Password",
            DesignIcon::LockReset,
            person.actions.reset_password,
            Some(AdminActionKind::SetUserPassword),
            false,
            Choice::ResetPassword,
            narrow,
            &op,
            &user_id,
            cx,
        ));
        items.push(self.menu_item(
            "admin-user-quota",
            "Set Storage Quota",
            DesignIcon::Storage,
            person.actions.set_quota,
            None,
            false,
            Choice::Quota,
            narrow,
            &op,
            &user_id,
            cx,
        ));
        items.push(self.menu_item(
            "admin-user-delete",
            "Delete User",
            DesignIcon::Delete,
            person.actions.delete,
            Some(AdminActionKind::DeleteUser),
            true,
            Choice::Delete,
            narrow,
            &op,
            &user_id,
            cx,
        ));
        div()
            .absolute()
            .top(px(34.))
            .right_0()
            .child(
                deferred(
                    anchored()
                        .anchor(Anchor::TopRight)
                        .snap_to_window_with_margin(px(8.))
                        .child(
                            div()
                                .w(px(300.))
                                .max_w_full()
                                .occlude()
                                .on_mouse_down_out(cx.listener(|page, _, _, cx| page.close(cx)))
                                .child(Menu::new(format!("Actions for {name}"), items)),
                        ),
                )
                .with_priority(1),
            )
            .into_any_element()
    }

    /// One menu item: off with core's reason, or the change's progress and refusal in its own
    /// second line, so nothing leaves the row it belongs to.
    #[allow(clippy::too_many_arguments)]
    fn menu_item(
        &self,
        id: &'static str,
        label: &'static str,
        icon: DesignIcon,
        reason: Option<AdminNotAllowed>,
        kind: Option<AdminActionKind>,
        destructive: bool,
        choice: Choice,
        narrow: bool,
        op: &AdminOp,
        user_id: &str,
        cx: &Context<Self>,
    ) -> MenuItem {
        let action = kind.map(|kind| act(kind, Some(user_id)));
        let busy = action.as_ref().is_some_and(|action| running(op, action));
        let refused = action
            .as_ref()
            .and_then(|action| failure(op, action))
            .map(|error| format!("Last try failed: {}", error.message));
        let secondary = match (reason, busy, refused) {
            (Some(reason), _, _) => Some((not_allowed(reason).to_owned(), SecondaryTone::Muted)),
            (None, true, _) => Some(("In progress\u{2026}".to_owned(), SecondaryTone::Muted)),
            (None, false, Some(refused)) => Some((refused, SecondaryTone::Error)),
            (None, false, None) => None,
        };
        let mut item = MenuItem::new(id, label, choose(cx, choice))
            .icon(icon)
            .disabled(reason.is_some() || busy)
            .min_height(if narrow { 48. } else { 36. });
        if destructive {
            item = item.destructive();
        }
        if let Some((secondary, tone)) = secondary {
            item = item.secondary(secondary).secondary_tone(tone);
        }
        item
    }

    /// A menu item picked: open its dialog, send the change a confirm-free action sends, or close.
    fn choose(&mut self, choice: Choice, window: &mut Window, cx: &mut Context<Self>) {
        let Some(user_id) = self.open_id.clone() else {
            return;
        };
        match choice {
            Choice::Ban => self.open_panel(Panel::Ban, window, cx),
            Choice::Delete => self.open_panel(Panel::Delete, window, cx),
            Choice::Owner => self.open_panel(Panel::Owner, window, cx),
            Choice::Roles => self.open_panel(Panel::Roles, window, cx),
            Choice::ResetPassword => self.open_panel(Panel::ResetPassword, window, cx),
            Choice::Quota => self.open_panel(Panel::Quota, window, cx),
            Choice::Unban => {
                // No confirm, as the web: the change goes and the menu closes.
                self.send(
                    AdminActionKind::UnbanUser,
                    UsersEvent::Unban {
                        user_id: user_id.clone(),
                    },
                    cx,
                );
                self.close(cx);
            }
        }
    }
}

/// A menu item's handler: runs `choice` on the page.
fn choose(cx: &Context<UsersPage>, choice: Choice) -> impl Fn(&mut Window, &mut App) + 'static {
    let page = cx.weak_entity();
    move |window, cx| {
        page.update(cx, |page, cx| page.choose(choice, window, cx))
            .ok();
    }
}

/// The reason `AdminUserActions` gives, in the words `AdminNotAllowed` documents.
fn not_allowed(reason: AdminNotAllowed) -> &'static str {
    match reason {
        AdminNotAllowed::Myself => "That's you",
        AdminNotAllowed::Owner => "That's an instance owner",
        AdminNotAllowed::OnlyOwner => "Only an instance owner can grant or remove the owner role",
        AdminNotAllowed::LastOwner => "The last owner can't be demoted",
        AdminNotAllowed::Rank => "They hold permissions you don't have",
        AdminNotAllowed::NoPermission => "You don't have permission to do that",
    }
}

/// "1.2 GB of 50 GB", as the admin area writes storage: `size_label`'s KB and MB steps, with the
/// GB one the instance quotas use.
fn storage_text(row: &AdminUserRow) -> String {
    format!(
        "{} of {}",
        size_text(row.storage_used_bytes),
        size_text(row.storage_quota_bytes)
    )
}

fn size_text(bytes: u64) -> String {
    const GIB: f64 = 1024. * 1024. * 1024.;
    let value = bytes as f64 / GIB;
    if value < 1. {
        return size_label(bytes);
    }
    if (value - value.round()).abs() < 0.05 {
        format!("{} GB", value.round() as u64)
    } else {
        format!("{value:.1} GB")
    }
}
