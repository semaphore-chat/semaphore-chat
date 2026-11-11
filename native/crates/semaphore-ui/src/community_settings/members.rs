//! The members tab, after `MemberManagement.tsx`: the members with their top role and when they
//! joined, the entry points to the roles lane's assignment dialog and the moderation lane's menu
//! (ban, kick, timeout; "Remove" is that kick), and adding users found by search (the W5 default,
//! not the web's admin-only user list).

use super::common::{
    action_icon, card, empty_line, list, loading_rows, locked_note, page, row, server_error,
    user_line,
};
use super::rules::{Outcome, Pending, act, date_label, failure_of, needs, running, running_of};
use crate::dms::picker::{DEBOUNCE, Found, PickerModel};
use crate::kit::{
    Alert, Button, ButtonSize, Chip, Severity, Spinner, TextField, Variant, spacing, text,
};
use crate::theme::SemTheme;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminActionKind, AdminOp, CommunityCaps, MemberList, MemberView, UserView,
};
use semaphore_design::Icon as DesignIcon;
use std::collections::HashSet;

/// From this window width the rows have room for "Joined …" (the web's 800 px card, beside the
/// 260 px nav).
const JOINED_MIN_WINDOW: f32 = 1060.;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MembersEvent {
    /// Debounced, 300 ms after typing stops: `Core::search_users_to_add(community, query)`,
    /// answered with `set_search_results` for this same query.
    Search { query: String },
    /// "Add": `Core::add_member(community, user_id)`. Its progress is the settings op.
    Add { user_id: String },
    /// "Manage roles": the owner opens the roles lane's assignment dialog for this member.
    ManageRoles { user_id: String },
    /// The moderation button: the owner opens the moderation lane's menu (ban, kick, timeout) for
    /// this member, which reads `Core::moderation_target`.
    Moderate { user_id: String },
}

pub struct MembersTab {
    members: Option<MemberList>,
    me: Option<String>,
    caps: CommunityCaps,
    op: AdminOp,
    /// Adds on their way, each followed through its own entry.
    pending: Vec<Pending>,
    added: HashSet<String>,
    field: Entity<InputState>,
    search: PickerModel,
    debounce: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<MembersEvent> for MembersTab {}

impl MembersTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx));
        let _subscriptions = vec![
            cx.subscribe_in(&field, window, |this, field, event, _, cx| {
                if let InputEvent::Change = event {
                    let text = field.read(cx).value().to_string();
                    this.query_changed(&text, cx);
                }
            }),
        ];
        Self {
            members: None,
            me: None,
            caps: CommunityCaps::default(),
            op: AdminOp::default(),
            pending: Vec::new(),
            added: HashSet::new(),
            field,
            search: PickerModel::new(false),
            debounce: None,
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::members(community)`: `None` until the first page has loaded.
    pub fn set_members(&mut self, members: Option<MemberList>, cx: &mut Context<Self>) {
        self.members = members;
        cx.notify();
    }

    /// This user's id: their own row has no moderation entry.
    pub fn set_me(&mut self, user_id: Option<String>, cx: &mut Context<Self>) {
        self.me = user_id;
        cx.notify();
    }

    /// `CommunitySettingsView::op`, which adding a member reports on.
    pub fn set_op(&mut self, op: AdminOp, cx: &mut Context<Self>) {
        let added = &mut self.added;
        self.pending
            .retain_mut(|pending| match pending.observe(&op) {
                Outcome::Waiting => true,
                Outcome::Failed => false,
                Outcome::Succeeded => {
                    if let Some(user_id) = &pending.action.target_id {
                        added.insert(user_id.clone());
                    }
                    false
                }
            });
        self.op = op;
        cx.notify();
    }

    /// What `Core::search_users_to_add` returned for `query`, or its error's message.
    pub fn set_search_results(
        &mut self,
        query: &str,
        results: Result<Vec<UserView>, String>,
        cx: &mut Context<Self>,
    ) {
        if self.search.accept(query, results) {
            cx.notify();
        }
    }

    fn joined_at(&self, member: &MemberView) -> Option<i64> {
        member.joined_at_ms
    }

    pub(crate) fn query_changed(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.search.set_text(text) {
            self.debounce = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(DEBOUNCE).await;
                this.update(cx, |this, cx| {
                    this.debounce = None;
                    if let Some(query) = this.search.debounce_elapsed() {
                        cx.emit(MembersEvent::Search { query });
                    }
                    cx.notify();
                })
                .ok();
            }));
        } else if text.trim().is_empty() {
            self.debounce = None;
        }
        cx.notify();
    }

    /// As if `query` was typed and answered, and `adding` was sent: for stories.
    #[cfg(feature = "stories")]
    pub(crate) fn preset_search(
        &mut self,
        query: &str,
        found: Found,
        adding: Option<&str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let typed = query.to_owned();
        self.field
            .update(cx, |field, cx| field.set_value(typed, window, cx));
        self.debounce = None;
        self.search.preset(query, found);
        if let Some(user_id) = adding {
            self.pending.push(Pending::new(
                act(AdminActionKind::AddMember, Some(user_id)),
                &self.op,
            ));
        }
    }

    fn add(&mut self, user_id: String, cx: &mut Context<Self>) {
        let action = act(AdminActionKind::AddMember, Some(&user_id));
        if !self.caps.add_members || running(&self.op, &action) {
            return;
        }
        self.pending.push(Pending::new(action, &self.op));
        cx.emit(MembersEvent::Add { user_id });
        cx.notify();
    }

    /// Whether adding this user is on its way.
    fn adding(&self, user_id: &str) -> bool {
        running_of(&self.op, &[AdminActionKind::AddMember])
            .any(|state| state.action.target_id.as_deref() == Some(user_id))
    }

    /// The newest failed add, by the server's words.
    fn add_error(&self) -> Option<Alert> {
        failure_of(&self.op, &[AdminActionKind::AddMember])
            .and_then(|(_, error)| server_error(Some(error)))
    }

    fn member_row(
        &self,
        member: &MemberView,
        wide: bool,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let user_id = member.user.id.clone();
        let mine = self.me.as_deref() == Some(user_id.as_str());
        let role = member
            .display_role
            .as_ref()
            .map(|role| role.name.clone())
            .unwrap_or_else(|| "Member".to_owned());
        let role_chip = Chip::new(role).colors(transparent_black(), sem.primary, sem.primary);
        let joined = wide.then(|| self.joined_at(member)).flatten().map(|ms| {
            text(Variant::Body2, format!("Joined {}", date_label(ms)))
                .flex_shrink_0()
                .whitespace_nowrap()
                .text_color(sem.text_secondary)
        });
        let roles_locked = (!self.caps.assign_roles).then(|| needs("Edit members"));
        let moderate_locked = if mine {
            Some("This is you".to_owned())
        } else if !(self.caps.kick || self.caps.ban || self.caps.timeout) {
            Some(needs("Kick users"))
        } else {
            None
        };
        let roles_id = user_id.clone();
        let moderate_id = user_id.clone();
        let name = super::common::who(&member.user);
        let chips = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(spacing(1.))
            .when(mine, |chips| chips.child(Chip::new("You")))
            .child(role_chip);
        // On a phone the chips go under the name, which then keeps the row's width.
        let who_and_chips = if narrow {
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(user_line(&member.user, cx))
                .child(chips.pl(px(48.)))
        } else {
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .items_center()
                .gap(spacing(1.5))
                .child(user_line(&member.user, cx))
                .child(chips.flex_shrink_0())
        };
        row(
            SharedString::from(format!("member-{user_id}")),
            name.clone(),
            cx,
        )
        .child(who_and_chips)
        .children(joined)
        .child(
            div()
                .flex()
                .flex_shrink_0()
                .items_center()
                .child(action_icon(
                    format!("member-roles-{user_id}"),
                    DesignIcon::Settings,
                    format!("Manage roles for {name}"),
                    roles_locked,
                    false,
                    Some(sem.primary),
                    cx.listener(move |_, _, _, cx| {
                        cx.emit(MembersEvent::ManageRoles {
                            user_id: roles_id.clone(),
                        })
                    }),
                ))
                .child(action_icon(
                    format!("member-moderate-{user_id}"),
                    DesignIcon::MoreVert,
                    format!("Moderate {name}"),
                    moderate_locked,
                    false,
                    None,
                    cx.listener(move |_, _, _, cx| {
                        cx.emit(MembersEvent::Moderate {
                            user_id: moderate_id.clone(),
                        })
                    }),
                )),
        )
        .into_any_element()
    }

    fn current(&self, wide: bool, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let Some(members) = self.members.clone() else {
            return card(
                "Current Members",
                loading_rows("members-loading", "Loading members", 5),
                cx,
            )
            .into_any_element();
        };
        let title = format!("Current Members ({})", members.members.len());
        let body: AnyElement = if members.members.is_empty() {
            empty_line("No members yet", cx).into_any_element()
        } else {
            let rows: Vec<_> = members
                .members
                .iter()
                .map(|member| self.member_row(member, wide, narrow, cx))
                .collect();
            list("members-list", "Members")
                .children(rows)
                .into_any_element()
        };
        let truncated = members.truncated.then(|| {
            Alert::new(
                Severity::Info,
                "This community has more members than are shown here.",
            )
        });
        card(
            title,
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .children(truncated)
                .child(body),
            cx,
        )
        .into_any_element()
    }

    fn found_row(&self, user: &UserView, cx: &mut Context<Self>) -> AnyElement {
        let user_id = user.id.clone();
        let member = self.added.contains(&user_id)
            || self
                .members
                .as_ref()
                .is_some_and(|list| list.members.iter().any(|m| m.user.id == user_id));
        let this_adding = self.adding(&user_id);
        let button = if member {
            Button::new(SharedString::from(format!("member-add-{user_id}")), "Added")
                .size(ButtonSize::Small)
                .disabled(true)
        } else {
            let id = user_id.clone();
            Button::new(SharedString::from(format!("member-add-{user_id}")), "Add")
                .outlined()
                .size(ButtonSize::Small)
                .start_icon(DesignIcon::PersonAdd)
                .loading(this_adding)
                .on_click(cx.listener(move |tab, _, _, cx| tab.add(id.clone(), cx)))
        };
        row(
            SharedString::from(format!("member-found-{user_id}")),
            super::common::who(user),
            cx,
        )
        .when(member, |row| row.opacity(0.6))
        .child(user_line(user, cx))
        .child(button)
        .into_any_element()
    }

    fn add_section(&self, cx: &mut Context<Self>) -> AnyElement {
        if !self.caps.add_members {
            return card(
                "Add New Members",
                locked_note("members-add-locked", needs("Add members"), cx),
                cx,
            )
            .into_any_element();
        }
        let sem = cx.sem().clone();
        let results: AnyElement = match self.search.found().clone() {
            Found::Idle => text(Variant::Body2, "Search by username to find someone to add.")
                .text_color(sem.text_secondary)
                .into_any_element(),
            Found::Loading => div()
                .py(spacing(2.))
                .flex()
                .justify_center()
                .child(Spinner::new("members-search-spinner").size(24.))
                .into_any_element(),
            Found::Failed(message) => Alert::new(
                Severity::Error,
                format!("Failed to search users: {message}"),
            )
            .into_any_element(),
            Found::Ready(users) if users.is_empty() => {
                empty_line("No users found", cx).into_any_element()
            }
            Found::Ready(users) => {
                let rows: Vec<_> = users.iter().map(|user| self.found_row(user, cx)).collect();
                list("members-found", "Users found")
                    .children(rows)
                    .into_any_element()
            }
        };
        card(
            "Add New Members",
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.5))
                .children(self.add_error())
                .child(
                    TextField::new("members-search", &self.field, "Search users")
                        .placeholder("Search by username"),
                )
                .child(results),
            cx,
        )
        .into_any_element()
    }
}

impl Render for MembersTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let wide = f32::from(window.viewport_size().width) >= JOINED_MIN_WINDOW;
        let current = self.current(wide, super::common::phone(window), cx);
        let add = self.add_section(cx);
        page(
            "community-members",
            "Members",
            None,
            Vec::new(),
            div()
                .flex()
                .flex_col()
                .gap(spacing(3.))
                .child(current)
                .child(add),
            window,
            cx,
        )
    }
}
