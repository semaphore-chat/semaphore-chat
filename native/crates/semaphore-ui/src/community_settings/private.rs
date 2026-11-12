//! The private channels tab, after `PrivateChannelMembership.tsx` and its `ChannelSelector`,
//! `ChannelMembersList` and `AddChannelMembers`: pick a private channel, see who is in it, remove
//! them behind a confirm, and add community members who aren't.

use super::common::{
    Confirm, card, empty_line, list, loading_rows, locked_note, page, row, server_error, user_line,
    who,
};
use super::rules::{Pending, act, date_label, failure_of, needs, running};
use crate::kit::{
    Alert, Button, ButtonSize, Severity, TextField, Variant, spacing, text, text_state,
};
use crate::messages::TimeFormat;
use crate::panel::common::error_block;
use crate::theme::SemTheme;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, ChannelRow, CommunityCaps, LoadState, MemberList,
    PrivateMembersView, UserView,
};
use semaphore_design::Icon as DesignIcon;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrivateChannelsEvent {
    /// A channel was picked (or the first one, on arrival): the owner feeds `set_view` with
    /// `Core::private_members(channel_id)`.
    Select { channel_id: String },
    /// `Core::add_private_member(channel_id, user_id)`.
    Add { channel_id: String, user_id: String },
    /// Confirmed: `Core::remove_private_member(channel_id, user_id)`.
    Remove { channel_id: String, user_id: String },
    /// The members failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct PrivateChannelsTab {
    state: LoadState,
    channels: Vec<ChannelRow>,
    selected: Option<String>,
    view: PrivateMembersView,
    community: Option<MemberList>,
    caps: CommunityCaps,
    pending: Vec<Pending>,
    filter: Entity<InputState>,
    removing: Option<UserView>,
    time: TimeFormat,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<PrivateChannelsEvent> for PrivateChannelsTab {}

impl PrivateChannelsTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter = text_state(window, cx, false);
        let _subscriptions = vec![cx.observe(&filter, |_, _, cx| cx.notify())];
        Self {
            state: LoadState::Loading,
            channels: Vec::new(),
            selected: None,
            view: PrivateMembersView::default(),
            community: None,
            caps: CommunityCaps::default(),
            pending: Vec::new(),
            filter,
            removing: None,
            time: TimeFormat::default(),
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// The zone "Added …" is written in: the app's, unless a story fixes it.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// `Core::channels(community)`: the private ones are offered. With none picked yet, the first
    /// is.
    pub fn set_channels(
        &mut self,
        state: LoadState,
        channels: Vec<ChannelRow>,
        cx: &mut Context<Self>,
    ) {
        let mut private: Vec<_> = channels.into_iter().filter(|c| c.is_private).collect();
        private.sort_by_key(|c| c.position);
        self.channels = private;
        self.state = state;
        let still_there = self
            .selected
            .as_ref()
            .is_some_and(|id| self.channels.iter().any(|c| c.id == *id));
        if !still_there {
            self.selected = None;
            if let Some(first) = self.channels.first().map(|c| c.id.clone()) {
                self.select(first, cx);
            }
        }
        cx.notify();
    }

    /// `Core::private_members(channel_id)` for the picked channel.
    pub fn set_view(&mut self, view: PrivateMembersView, cx: &mut Context<Self>) {
        self.pending
            .retain_mut(|pending| pending.observe(&view.op) == super::rules::Outcome::Waiting);
        self.view = view;
        cx.notify();
    }

    /// `Core::members(community)`: who can be added.
    pub fn set_members(&mut self, members: Option<MemberList>, cx: &mut Context<Self>) {
        self.community = members;
        cx.notify();
    }

    pub fn selected(&self) -> Option<&str> {
        self.selected.as_deref()
    }

    fn select(&mut self, channel_id: String, cx: &mut Context<Self>) {
        if self.selected.as_deref() == Some(channel_id.as_str()) {
            return;
        }
        self.selected = Some(channel_id.clone());
        self.view = PrivateMembersView {
            channel_id: channel_id.clone(),
            ..PrivateMembersView::default()
        };
        cx.emit(PrivateChannelsEvent::Select { channel_id });
        cx.notify();
    }

    fn send(&mut self, action: AdminAction, event: PrivateChannelsEvent, cx: &mut Context<Self>) {
        self.pending.push(Pending::new(action, &self.view.op));
        cx.emit(event);
        cx.notify();
    }

    fn running(&self, kind: AdminActionKind, user_id: &str) -> bool {
        running(&self.view.op, &act(kind, Some(user_id)))
    }

    fn picker(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .child(text(Variant::Caption, "Select Private Channel").text_color(sem.text_secondary))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(spacing(1.))
                    .children(self.channels.iter().map(|channel| {
                        let id = channel.id.clone();
                        let button = Button::new(
                            SharedString::from(format!("private-channel-{id}")),
                            short_name(&channel.name),
                        )
                        .size(ButtonSize::Small)
                        .start_icon(DesignIcon::LockOutlined)
                        .on_click(cx.listener(move |tab, _, _, cx| tab.select(id.clone(), cx)));
                        if self.selected.as_deref() == Some(channel.id.as_str()) {
                            button.contained()
                        } else {
                            button.outlined()
                        }
                    })),
            )
    }

    fn members_card(
        &self,
        channel: &ChannelRow,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let locked = (!self.caps.manage_private_members).then(|| needs("Remove members"));
        let body: AnyElement = match &self.view.state {
            LoadState::Loading => {
                loading_rows("private-members-loading", "Loading channel members", 3)
            }
            LoadState::Failed { .. } => error_block(
                "private-members-retry",
                "Failed to load channel members",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(PrivateChannelsEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.members.is_empty() => {
                empty_line("No members in this channel", cx).into_any_element()
            }
            LoadState::Ready => {
                let rows: Vec<_> = self
                    .view
                    .members
                    .iter()
                    .map(|member| {
                        let user = member.user.clone();
                        let busy = self.running(AdminActionKind::RemovePrivateMember, &user.id);
                        row(
                            SharedString::from(format!("private-member-{}", user.id)),
                            who(&user),
                            cx,
                        )
                        .child(user_line(&user, cx))
                        .when(!narrow, |row| {
                            row.child(
                                text(
                                    Variant::Caption,
                                    format!(
                                        "Added {}",
                                        date_label(&self.time, member.joined_at_ms)
                                    ),
                                )
                                .flex_shrink_0()
                                .text_color(sem.text_secondary),
                            )
                        })
                        .child(super::common::action_icon(
                            format!("private-remove-{}", user.id),
                            DesignIcon::PersonRemove,
                            format!("Remove {} from #{}", who(&user), channel.name),
                            locked.clone(),
                            busy,
                            Some(sem.error),
                            cx.listener(move |tab, _, _, cx| {
                                tab.removing = Some(user.clone());
                                cx.notify();
                            }),
                        ))
                        .into_any_element()
                    })
                    .collect();
                list("private-members", "Channel members")
                    .children(rows)
                    .into_any_element()
            }
        };
        card(
            match self.view.state {
                LoadState::Ready => {
                    format!("Members of #{} ({})", channel.name, self.view.members.len())
                }
                _ => format!("Members of #{}", channel.name),
            },
            body,
            cx,
        )
        .into_any_element()
    }

    fn add_card(&self, channel: &ChannelRow, cx: &mut Context<Self>) -> AnyElement {
        if !self.caps.manage_private_members {
            return card(
                "Add Community Members",
                locked_note("private-add-locked", needs("Add members"), cx),
                cx,
            )
            .into_any_element();
        }
        let body: AnyElement = match &self.community {
            None => loading_rows("private-add-loading", "Loading community members", 3),
            Some(list_of) => {
                let filter = self.filter.read(cx).value().trim().to_lowercase();
                let in_channel: std::collections::HashSet<_> = self
                    .view
                    .members
                    .iter()
                    .map(|m| m.user.id.clone())
                    .collect();
                let available: Vec<_> = list_of
                    .members
                    .iter()
                    .filter(|m| !in_channel.contains(&m.user.id))
                    .filter(|m| {
                        filter.is_empty()
                            || m.user.username.to_lowercase().contains(&filter)
                            || m.user
                                .display_name
                                .as_deref()
                                .is_some_and(|name| name.to_lowercase().contains(&filter))
                    })
                    .map(|m| m.user.clone())
                    .collect();
                let rows: Vec<_> = available
                    .iter()
                    .map(|user| {
                        let id = user.id.clone();
                        let busy = self.running(AdminActionKind::AddPrivateMember, &user.id);
                        let channel_id = channel.id.clone();
                        row(
                            SharedString::from(format!("private-candidate-{id}")),
                            who(user),
                            cx,
                        )
                        .child(user_line(user, cx))
                        .child(
                            Button::new(SharedString::from(format!("private-add-{id}")), "Add")
                                .outlined()
                                .size(ButtonSize::Small)
                                .start_icon(DesignIcon::PersonAdd)
                                .loading(busy)
                                .on_click(cx.listener(move |tab, _, _, cx| {
                                    tab.send(
                                        act(AdminActionKind::AddPrivateMember, Some(&id)),
                                        PrivateChannelsEvent::Add {
                                            channel_id: channel_id.clone(),
                                            user_id: id.clone(),
                                        },
                                        cx,
                                    )
                                })),
                        )
                        .into_any_element()
                    })
                    .collect();
                let listing: AnyElement = if rows.is_empty() {
                    empty_line(
                        if filter.is_empty() {
                            "Every community member is already in this channel."
                        } else {
                            "No members match your search."
                        },
                        cx,
                    )
                    .into_any_element()
                } else {
                    list("private-candidates", "Community members to add")
                        .children(rows)
                        .into_any_element()
                };
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.5))
                    .child(
                        TextField::new("private-filter", &self.filter, "Search members")
                            .placeholder("Filter by name"),
                    )
                    .child(listing)
                    .into_any_element()
            }
        };
        card("Add Community Members", body, cx).into_any_element()
    }
}

impl Render for PrivateChannelsTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let channel = self
            .selected
            .as_ref()
            .and_then(|id| self.channels.iter().find(|c| c.id == *id))
            .cloned();
        let body: AnyElement = match (&self.state, channel) {
            (LoadState::Loading, _) => loading_rows("private-loading", "Loading channels", 3),
            (LoadState::Failed { .. }, _) => Alert::new(Severity::Error, "Failed to load channels. Please try again.").into_any_element(),
            (LoadState::Ready, _) if self.channels.is_empty() => Alert::new(
                Severity::Info,
                "No private channels found. Create a private channel first to manage its membership.",
            )
            .into_any_element(),
            (LoadState::Ready, None) => self.picker(cx).into_any_element(),
            (LoadState::Ready, Some(channel)) => {
                let error = failure_of(
                    &self.view.op,
                    &[
                        AdminActionKind::AddPrivateMember,
                        AdminActionKind::RemovePrivateMember,
                    ],
                )
                .and_then(|(_, error)| server_error(Some(error)));
                let picker = self.picker(cx);
                let members = self.members_card(&channel, super::common::phone(window), cx);
                let add = self.add_card(&channel, cx);
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(3.))
                    .child(picker)
                    .children(error)
                    .child(members)
                    .child(add)
                    .into_any_element()
            }
        };
        let dialog = self.removing.clone().and_then(|user| {
            let channel = self
                .selected
                .as_ref()
                .and_then(|id| self.channels.iter().find(|c| c.id == *id))?
                .clone();
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            let user_id = user.id.clone();
            let channel_id = channel.id.clone();
            Some(
                Confirm {
                    id: "private-remove",
                    title: "Remove Member",
                    message: format!(
                        "Are you sure you want to remove {} from #{}? This action cannot be undone.",
                        who(&user),
                        channel.name
                    ),
                    confirm: "Remove Member",
                    busy: false,
                }
                .dialog(
                    move |_, cx| {
                        confirm
                            .update(cx, |tab, cx| {
                                tab.removing = None;
                                tab.send(
                                    act(AdminActionKind::RemovePrivateMember, Some(&user_id)),
                                    PrivateChannelsEvent::Remove {
                                        channel_id: channel_id.clone(),
                                        user_id: user_id.clone(),
                                    },
                                    cx,
                                );
                            })
                            .ok();
                    },
                    move |_, cx| {
                        cancel
                            .update(cx, |tab, cx| {
                                tab.removing = None;
                                cx.notify();
                            })
                            .ok();
                    },
                    cx,
                ),
            )
        });
        div()
            .relative()
            .size_full()
            .child(page(
                "community-private-channels",
                "Private Channels",
                Some("Choose who can see each private channel.".into()),
                Vec::new(),
                body,
                window,
                cx,
            ))
            .children(dialog)
    }
}

/// A channel's name for its picker button, which can't truncate itself: 28 characters at most.
fn short_name(name: &str) -> String {
    if name.chars().count() > 28 {
        format!("{}\u{2026}", name.chars().take(27).collect::<String>())
    } else {
        name.to_owned()
    }
}
