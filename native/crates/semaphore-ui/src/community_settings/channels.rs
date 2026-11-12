//! The channels tab, after `ChannelManagement.tsx`: text and voice channels in their groups, moved
//! one place at a time within a group, created (`CreateChannelDialog.tsx`), renamed and deleted.
//! The edit dialog (`EditChannelDialog.tsx`) renames only; a text channel's webhooks live in it
//! (`WebhookManagement.tsx`), and its Permissions tab is the roles lane's override editor (a slot).

use super::common::{
    Confirm, action_icon, card, empty_line, list, loading_rows, locked_button, locked_note, mono,
    page, phone, row, server_error, tone_chip,
};
use super::rules::{
    Outcome, Pending, act, check_channel_name, check_webhook_name, date_label, failure, needs,
    preset_label, running, running_of,
};
use crate::kit::{
    Alert, Button, ButtonSize, Dialog, IconButton, Severity, Switch, TextField, Variant, spacing,
    text, text_state,
};
use crate::messages::TimeFormat;
use crate::panel::common::{design_icon, error_block};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminOp, ChannelDraft, ChannelKind, ChannelMove, ChannelRow,
    CommunityCaps, CreatedWebhook, LoadState, WebhooksView,
};
use semaphore_design::Icon as DesignIcon;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelsEvent {
    /// "Create Channel" in the dialog: `Core::create_channel(community, draft)`.
    Create(ChannelDraft),
    /// "Update Channel": `Core::update_channel(channel_id, draft)`. Only the name changes; the
    /// rest is the row's.
    Update {
        channel_id: String,
        draft: ChannelDraft,
    },
    /// Confirmed: `Core::delete_channel(channel_id)`.
    Delete { channel_id: String },
    /// `Core::move_channel(channel_id, direction)`.
    Move {
        channel_id: String,
        direction: ChannelMove,
    },
    /// The edit dialog opened: the owner feeds `set_webhooks` (`Core::webhooks(channel_id)`) for a
    /// text channel, and `set_permissions_slot` with the roles lane's override editor.
    OpenEdit { channel_id: String },
    /// The edit dialog closed.
    CloseEdit,
    /// `Core::create_webhook(channel_id, name, avatar_url)`, answered with `set_created_webhook`.
    CreateWebhook {
        channel_id: String,
        name: String,
        avatar_url: Option<String>,
    },
    /// Confirmed: `Core::delete_webhook(channel_id, webhook_id)`.
    DeleteWebhook {
        channel_id: String,
        webhook_id: String,
    },
    /// The webhooks failed to load and the user asked again: `Core::retry_failed`.
    RetryWebhooks,
    /// The channels failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EditTab {
    General,
    Permissions,
}

struct Editing {
    channel_id: String,
    tab: EditTab,
    tried: bool,
}

pub struct ChannelsTab {
    state: LoadState,
    channels: Vec<ChannelRow>,
    caps: CommunityCaps,
    op: AdminOp,
    /// Channel changes on their way, each followed through its own entry.
    pending: Vec<Pending>,
    creating: bool,
    create_tried: bool,
    create_kind: ChannelKind,
    create_private: bool,
    create_name: Entity<InputState>,
    editing: Option<Editing>,
    edit_name: Entity<InputState>,
    deleting: Option<String>,
    webhooks: WebhooksView,
    webhook_pending: Vec<Pending>,
    webhook_tried: bool,
    webhook_name: Entity<InputState>,
    webhook_avatar: Entity<InputState>,
    deleting_webhook: Option<String>,
    created: Option<CreatedWebhook>,
    copied: bool,
    permissions_slot: Option<AnyView>,
    time: TimeFormat,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ChannelsEvent> for ChannelsTab {}

fn kind_label(kind: ChannelKind) -> &'static str {
    match kind {
        ChannelKind::Voice => "Voice Channel",
        _ => "Text Channel",
    }
}

impl ChannelsTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let create_name = text_state(window, cx, false);
        let edit_name = text_state(window, cx, false);
        let webhook_name = text_state(window, cx, false);
        let webhook_avatar = text_state(window, cx, false);
        let _subscriptions = [&create_name, &edit_name, &webhook_name, &webhook_avatar]
            .into_iter()
            .map(|field| cx.observe(field, |_, _, cx| cx.notify()))
            .collect();
        Self {
            state: LoadState::Loading,
            channels: Vec::new(),
            caps: CommunityCaps::default(),
            op: AdminOp::default(),
            pending: Vec::new(),
            creating: false,
            create_tried: false,
            create_kind: ChannelKind::Text,
            create_private: false,
            create_name,
            editing: None,
            edit_name,
            deleting: None,
            webhooks: WebhooksView::default(),
            webhook_pending: Vec::new(),
            webhook_tried: false,
            webhook_name,
            webhook_avatar,
            deleting_webhook: None,
            created: None,
            copied: false,
            permissions_slot: None,
            time: TimeFormat::default(),
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// The zone a webhook's "Created …" is written in: the app's, unless a story fixes it.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// `Core::channels(community)`, and whether they have loaded.
    pub fn set_channels(
        &mut self,
        state: LoadState,
        channels: Vec<ChannelRow>,
        cx: &mut Context<Self>,
    ) {
        self.state = state;
        self.channels = channels;
        if let Some(editing) = &self.editing
            && !self.channels.iter().any(|c| c.id == editing.channel_id)
            && matches!(self.state, LoadState::Ready)
        {
            self.editing = None;
        }
        cx.notify();
    }

    /// `CommunitySettingsView::op`, which channel changes report on.
    pub fn set_op(&mut self, op: AdminOp, cx: &mut Context<Self>) {
        let mut done = Vec::new();
        self.pending
            .retain_mut(|pending| match pending.observe(&op) {
                Outcome::Waiting => true,
                Outcome::Failed => false,
                Outcome::Succeeded => {
                    done.push(pending.action.clone());
                    false
                }
            });
        for action in done {
            match action.kind {
                AdminActionKind::CreateChannel => self.creating = false,
                AdminActionKind::UpdateChannel
                    if self.editing.as_ref().map(|e| e.channel_id.as_str())
                        == action.target_id.as_deref() =>
                {
                    self.editing = None;
                    cx.emit(ChannelsEvent::CloseEdit);
                }
                _ => {}
            }
        }
        self.op = op;
        cx.notify();
    }

    /// `Core::webhooks(channel_id)` for the channel being edited.
    pub fn set_webhooks(
        &mut self,
        view: WebhooksView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mut created = false;
        self.webhook_pending
            .retain_mut(|pending| match pending.observe(&view.op) {
                Outcome::Waiting => true,
                Outcome::Failed => false,
                Outcome::Succeeded => {
                    created |= pending.action.kind == AdminActionKind::CreateWebhook;
                    false
                }
            });
        if created {
            self.webhook_name
                .update(cx, |field, cx| field.set_value("", window, cx));
            self.webhook_avatar
                .update(cx, |field, cx| field.set_value("", window, cx));
            self.webhook_tried = false;
        }
        self.webhooks = view;
        cx.notify();
    }

    /// What `Core::create_webhook` returned: its URL shows once, with a copy button.
    pub fn set_created_webhook(&mut self, created: CreatedWebhook, cx: &mut Context<Self>) {
        self.created = Some(created);
        self.copied = false;
        cx.notify();
    }

    /// The roles lane's channel permission overrides, for the edit dialog's Permissions tab.
    pub fn set_permissions_slot(&mut self, view: Option<AnyView>, cx: &mut Context<Self>) {
        self.permissions_slot = view;
        cx.notify();
    }

    /// Opens the create dialog with these fields: the sidebar's "+" (W5-app, `""`, text, not
    /// private), stories and tests.
    pub fn open_create(
        &mut self,
        name: &str,
        kind: ChannelKind,
        private: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.creating = true;
        self.create_kind = kind;
        self.create_private = private;
        let name = name.to_owned();
        self.create_name
            .update(cx, |field, cx| field.set_value(name, window, cx));
    }

    /// Opens the edit dialog on `channel_id`, for stories and tests.
    #[cfg(feature = "stories")]
    pub(crate) fn open_edit(
        &mut self,
        channel_id: &str,
        permissions: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.start_edit(channel_id.to_owned(), window, cx);
        if permissions && let Some(editing) = self.editing.as_mut() {
            editing.tab = EditTab::Permissions;
        }
    }

    #[cfg(feature = "stories")]
    pub(crate) fn open_delete(&mut self, channel_id: &str) {
        self.deleting = Some(channel_id.to_owned());
    }

    fn send(&mut self, action: AdminAction, event: ChannelsEvent, cx: &mut Context<Self>) {
        self.pending.push(Pending::new(action, &self.op));
        cx.emit(event);
        cx.notify();
    }

    fn create_action() -> AdminAction {
        act(AdminActionKind::CreateChannel, None)
    }

    /// A move is on its way: the web moves one channel at a time.
    fn moving(&self) -> bool {
        running_of(&self.op, &[AdminActionKind::MoveChannel])
            .next()
            .is_some()
    }

    fn start_edit(&mut self, channel_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(channel) = self.channels.iter().find(|c| c.id == channel_id) else {
            return;
        };
        let name = channel.name.clone();
        self.edit_name
            .update(cx, |field, cx| field.set_value(name, window, cx));
        self.editing = Some(Editing {
            channel_id: channel_id.clone(),
            tab: EditTab::General,
            tried: false,
        });
        self.webhooks = WebhooksView {
            channel_id: channel_id.clone(),
            ..WebhooksView::default()
        };
        self.webhook_tried = false;
        cx.emit(ChannelsEvent::OpenEdit { channel_id });
        cx.notify();
    }

    fn close_edit(&mut self, cx: &mut Context<Self>) {
        if self.editing.take().is_some() {
            cx.emit(ChannelsEvent::CloseEdit);
        }
        cx.notify();
    }

    pub(crate) fn submit_create(&mut self, cx: &mut Context<Self>) {
        if !self.caps.create_channel || running(&self.op, &Self::create_action()) {
            return;
        }
        self.create_tried = true;
        let name = self.create_name.read(cx).value().trim().to_owned();
        if check_channel_name(&name).is_err() {
            cx.notify();
            return;
        }
        let draft = ChannelDraft {
            name,
            kind: self.create_kind,
            is_private: self.create_private,
            slowmode_seconds: 0,
        };
        self.send(Self::create_action(), ChannelsEvent::Create(draft), cx);
    }

    pub(crate) fn submit_edit(&mut self, cx: &mut Context<Self>) {
        let Some(editing) = self.editing.as_mut() else {
            return;
        };
        if !self.caps.update_channel {
            return;
        }
        editing.tried = true;
        let channel_id = editing.channel_id.clone();
        let name = self.edit_name.read(cx).value().trim().to_owned();
        let Some(channel) = self.channels.iter().find(|c| c.id == channel_id) else {
            return;
        };
        if check_channel_name(&name).is_err() {
            cx.notify();
            return;
        }
        // The edit renames only: the kind is fixed, privacy and slowmode stay as they are.
        let draft = ChannelDraft {
            name,
            kind: channel.kind,
            is_private: channel.is_private,
            slowmode_seconds: channel.slowmode_seconds,
        };
        self.send(
            act(AdminActionKind::UpdateChannel, Some(&channel_id)),
            ChannelsEvent::Update { channel_id, draft },
            cx,
        );
    }

    pub(crate) fn submit_webhook(&mut self, cx: &mut Context<Self>) {
        let Some(editing) = &self.editing else {
            return;
        };
        let create = act(AdminActionKind::CreateWebhook, None);
        if !self.caps.manage_webhooks || running(&self.webhooks.op, &create) {
            return;
        }
        self.webhook_tried = true;
        let name = self.webhook_name.read(cx).value().trim().to_owned();
        if check_webhook_name(&name).is_err() {
            cx.notify();
            return;
        }
        let avatar = self.webhook_avatar.read(cx).value().trim().to_owned();
        self.webhook_pending
            .push(Pending::new(create, &self.webhooks.op));
        cx.emit(ChannelsEvent::CreateWebhook {
            channel_id: editing.channel_id.clone(),
            name,
            avatar_url: (!avatar.is_empty()).then_some(avatar),
        });
        cx.notify();
    }

    fn group(&self, kind: ChannelKind) -> Vec<ChannelRow> {
        let mut rows: Vec<_> = self
            .channels
            .iter()
            .filter(|channel| match kind {
                ChannelKind::Voice => channel.kind == ChannelKind::Voice,
                _ => channel.kind != ChannelKind::Voice,
            })
            .cloned()
            .collect();
        rows.sort_by_key(|channel| channel.position);
        rows
    }

    fn channel_row(
        &self,
        channel: &ChannelRow,
        first: bool,
        last: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let moving = self.moving();
        let delete_action = act(AdminActionKind::DeleteChannel, Some(&channel.id));
        let move_action = act(AdminActionKind::MoveChannel, Some(&channel.id));
        let deleting_this = running(&self.op, &delete_action);
        let this_busy = deleting_this || running(&self.op, &move_action);
        // This row's own failure: its delete's, else its move's.
        let row_error = failure(&self.op, &delete_action)
            .or_else(|| failure(&self.op, &move_action))
            .map(|error| error.message.clone());
        let update_locked = (!self.caps.update_channel).then(|| needs("Edit channels"));
        let delete_locked = (!self.caps.delete_channel).then(|| needs("Delete channels"));
        let id = channel.id.clone();
        let (up, down, edit, delete) = (id.clone(), id.clone(), id.clone(), id.clone());
        let icon = if channel.kind == ChannelKind::Voice {
            DesignIcon::VolumeUp
        } else {
            DesignIcon::Tag
        };
        let preset = preset_label(channel.preset).map(|label| tone_chip(label, sem.info));
        let row = row(
            SharedString::from(format!("channel-row-{id}")),
            channel.name.clone(),
            cx,
        )
        .child(design_icon(icon, 20., sem.text_secondary))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(spacing(1.))
                .child(
                    text(Variant::Body2, channel.name.clone())
                        .font_weight(FontWeight(500.))
                        .min_w_0()
                        .truncate()
                        .text_color(sem.text_primary),
                )
                .when(channel.is_private, |names| {
                    names.child(tone_chip("Private", sem.warning))
                })
                .children(preset),
        )
        .child(
            div()
                .flex()
                .flex_shrink_0()
                .items_center()
                .when(this_busy, |actions| {
                    actions.child(
                        crate::kit::Spinner::new(SharedString::from(format!("channel-busy-{id}")))
                            .size(18.),
                    )
                })
                .child(action_icon(
                    format!("channel-up-{id}"),
                    DesignIcon::ArrowUpward,
                    format!("Move {} up", channel.name),
                    update_locked.clone(),
                    first || moving,
                    None,
                    cx.listener(move |tab, _, _, cx| {
                        tab.send(
                            act(AdminActionKind::MoveChannel, Some(&up)),
                            ChannelsEvent::Move {
                                channel_id: up.clone(),
                                direction: ChannelMove::Up,
                            },
                            cx,
                        )
                    }),
                ))
                .child(action_icon(
                    format!("channel-down-{id}"),
                    DesignIcon::ArrowDownward,
                    format!("Move {} down", channel.name),
                    update_locked.clone(),
                    last || moving,
                    None,
                    cx.listener(move |tab, _, _, cx| {
                        tab.send(
                            act(AdminActionKind::MoveChannel, Some(&down)),
                            ChannelsEvent::Move {
                                channel_id: down.clone(),
                                direction: ChannelMove::Down,
                            },
                            cx,
                        )
                    }),
                ))
                .child(action_icon(
                    format!("channel-edit-{id}"),
                    DesignIcon::Edit,
                    format!("Edit {}", channel.name),
                    update_locked,
                    false,
                    Some(sem.primary),
                    cx.listener(move |tab, _, window, cx| tab.start_edit(edit.clone(), window, cx)),
                ))
                .child(action_icon(
                    format!("channel-delete-{id}"),
                    DesignIcon::Delete,
                    format!("Delete {}", channel.name),
                    delete_locked,
                    deleting_this,
                    Some(sem.error),
                    cx.listener(move |tab, _, _, cx| {
                        tab.deleting = Some(delete.clone());
                        cx.notify();
                    }),
                )),
        );
        match row_error {
            None => row.into_any_element(),
            Some(message) => div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(row)
                .child(
                    div()
                        .id(SharedString::from(format!("channel-error-{id}")))
                        .test_support()
                        .role(Role::Alert)
                        .aria_label(SharedString::from(message.clone()))
                        .px(spacing(1.5))
                        .child(super::common::field_error(message, cx)),
                )
                .into_any_element(),
        }
    }

    fn group_card(&self, kind: ChannelKind, cx: &mut Context<Self>) -> AnyElement {
        let rows = self.group(kind);
        let (title, key) = match kind {
            ChannelKind::Voice => ("Voice Channels", "voice"),
            _ => ("Text Channels", "text"),
        };
        let count = rows.len();
        let body: AnyElement = if rows.is_empty() {
            empty_line(
                match kind {
                    ChannelKind::Voice => "No voice channels yet",
                    _ => "No text channels yet",
                },
                cx,
            )
            .into_any_element()
        } else {
            let items: Vec<_> = rows
                .iter()
                .enumerate()
                .map(|(index, channel)| {
                    self.channel_row(channel, index == 0, index + 1 == count, cx)
                })
                .collect();
            list(SharedString::from(format!("channels-{key}")), title)
                .children(items)
                .into_any_element()
        };
        card(format!("{title} ({count})"), body, cx).into_any_element()
    }

    fn create_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let sem = cx.sem().clone();
        let busy = running(&self.op, &Self::create_action());
        let create_error = failure(&self.op, &Self::create_action()).cloned();
        let name_error = check_channel_name(&self.create_name.read(cx).value())
            .err()
            .filter(|_| self.create_tried);
        let mut name = TextField::new("channel-create-name", &self.create_name, "Channel Name")
            .placeholder("general, announcements, etc.")
            .required(true)
            .disabled(busy)
            .error(name_error.is_some());
        if let Some(error) = name_error {
            name = name.helper(error);
        }
        let kinds = div().flex().flex_wrap().gap(spacing(1.)).children(
            [ChannelKind::Text, ChannelKind::Voice]
                .into_iter()
                .map(|kind| {
                    let key = if kind == ChannelKind::Voice {
                        "voice"
                    } else {
                        "text"
                    };
                    let button = Button::new(
                        SharedString::from(format!("channel-create-kind-{key}")),
                        kind_label(kind),
                    )
                    .size(ButtonSize::Small)
                    .start_icon(if kind == ChannelKind::Voice {
                        DesignIcon::VolumeUp
                    } else {
                        DesignIcon::Tag
                    })
                    .disabled(busy)
                    .on_click(cx.listener(move |tab, _, _, cx| {
                        tab.create_kind = kind;
                        cx.notify();
                    }));
                    if self.create_kind == kind {
                        button.contained()
                    } else {
                        button.outlined()
                    }
                }),
        );
        let private = self.create_private;
        let toggle = cx.weak_entity();
        let close = cx.weak_entity();
        let cancel = cx.weak_entity();
        let submit = cx.weak_entity();
        Dialog::new("Create New Channel")
            .width(480.)
            .body(
                div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(server_error(create_error.as_ref()))
                    .child(name)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(
                                text(Variant::Caption, "Channel Type")
                                    .text_color(sem.text_secondary),
                            )
                            .child(kinds),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.))
                            .child(
                                Switch::new("channel-create-private", "Private Channel", private)
                                    .disabled(busy)
                                    .on_change(move |on, _, cx| {
                                        toggle
                                            .update(cx, |tab, cx| {
                                                tab.create_private = on;
                                                cx.notify();
                                            })
                                            .ok();
                                    }),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        text(Variant::Body1, "Private Channel")
                                            .text_color(sem.text_primary),
                                    )
                                    .child(
                                        text(Variant::Caption, "Only members you add can see it.")
                                            .text_color(sem.text_secondary),
                                    ),
                            ),
                    ),
            )
            .action(
                Button::new("channel-create-cancel", "Cancel")
                    .disabled(busy)
                    .on_click(move |_, _, cx| {
                        cancel
                            .update(cx, |tab, cx| {
                                tab.creating = false;
                                cx.notify();
                            })
                            .ok();
                    }),
            )
            .action(
                Button::new("channel-create-submit", "Create Channel")
                    .contained()
                    .loading(busy)
                    .disabled(self.create_name.read(cx).value().trim().is_empty())
                    .on_click(move |_, _, cx| {
                        submit.update(cx, |tab, cx| tab.submit_create(cx)).ok();
                    }),
            )
            .on_close(move |_, cx| {
                close
                    .update(cx, |tab, cx| {
                        if !running(&tab.op, &Self::create_action()) {
                            tab.creating = false;
                            cx.notify();
                        }
                    })
                    .ok();
            })
    }

    fn webhooks_section(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        if !self.caps.manage_webhooks {
            return div()
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(text(Variant::Subtitle1, "Webhooks").text_color(sem.text_primary))
                .child(locked_note("webhooks-locked", needs("Manage webhooks"), cx))
                .into_any_element();
        }
        let create = act(AdminActionKind::CreateWebhook, None);
        let creating = running(&self.webhooks.op, &create);
        let create_error = failure(&self.webhooks.op, &create).cloned();
        let name_error = check_webhook_name(&self.webhook_name.read(cx).value())
            .err()
            .filter(|_| self.webhook_tried);
        let mut name = TextField::new("webhook-name", &self.webhook_name, "Name")
            .placeholder("CI Bot")
            .disabled(creating)
            .error(name_error.is_some());
        if let Some(error) = name_error {
            name = name.helper(error);
        }
        let form = div()
            .flex()
            .flex_col()
            .gap(spacing(1.5))
            .child(name)
            .child(
                TextField::new(
                    "webhook-avatar",
                    &self.webhook_avatar,
                    "Avatar URL (optional)",
                )
                .placeholder("https://example.com/avatar.png")
                .disabled(creating),
            )
            .child(
                div().flex().justify_end().child(
                    Button::new("webhook-create", "Create Webhook")
                        .contained()
                        .start_icon(DesignIcon::Add)
                        .loading(creating)
                        .disabled(self.webhook_name.read(cx).value().trim().is_empty())
                        .on_click(cx.listener(|tab, _, _, cx| tab.submit_webhook(cx))),
                ),
            );
        let listing: AnyElement = match &self.webhooks.state {
            LoadState::Loading => loading_rows("webhooks-loading", "Loading webhooks", 2),
            LoadState::Failed { .. } => error_block(
                "webhooks-retry",
                "Failed to load webhooks",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(ChannelsEvent::RetryWebhooks)),
                cx,
            ),
            LoadState::Ready if self.webhooks.webhooks.is_empty() => {
                empty_line("No webhooks yet", cx).into_any_element()
            }
            LoadState::Ready => {
                let rows: Vec<_> = self
                    .webhooks
                    .webhooks
                    .iter()
                    .map(|hook| {
                        let id = hook.id.clone();
                        let delete = act(AdminActionKind::DeleteWebhook, Some(&hook.id));
                        let busy = running(&self.webhooks.op, &delete);
                        let delete_error =
                            failure(&self.webhooks.op, &delete).map(|error| error.message.clone());
                        row(
                            SharedString::from(format!("webhook-{id}")),
                            hook.name.clone(),
                            cx,
                        )
                        .child(design_icon(DesignIcon::Link, 20., sem.text_secondary))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .child(
                                    text(Variant::Body2, hook.name.clone())
                                        .truncate()
                                        .text_color(sem.text_primary),
                                )
                                .child(
                                    text(
                                        Variant::Caption,
                                        format!(
                                            "Created {}",
                                            date_label(&self.time, hook.created_at_ms)
                                        ),
                                    )
                                    .text_color(sem.text_secondary),
                                )
                                .children(
                                    delete_error
                                        .map(|message| super::common::field_error(message, cx)),
                                ),
                        )
                        .child(action_icon(
                            format!("webhook-delete-{id}"),
                            DesignIcon::Delete,
                            format!("Delete webhook {}", hook.name),
                            None,
                            busy,
                            Some(sem.error),
                            cx.listener(move |tab, _, _, cx| {
                                tab.deleting_webhook = Some(id.clone());
                                cx.notify();
                            }),
                        ))
                        .into_any_element()
                    })
                    .collect();
                list("webhooks-list", "Webhooks")
                    .children(rows)
                    .into_any_element()
            }
        };
        div()
            .id("webhooks")
            .test_support()
            .role(Role::Group)
            .aria_label("Webhooks")
            .flex()
            .flex_col()
            .gap(spacing(1.5))
            .child(text(Variant::Subtitle1, "Webhooks").text_color(sem.text_primary))
            .child(
                text(
                    Variant::Caption,
                    "Let other services post messages to this channel.",
                )
                .text_color(sem.text_secondary),
            )
            .children(server_error(create_error.as_ref()))
            .child(form)
            .child(listing)
            .into_any_element()
    }

    fn edit_dialog(&self, window: &Window, cx: &mut Context<Self>) -> Option<Dialog> {
        let editing = self.editing.as_ref()?;
        let channel = self
            .channels
            .iter()
            .find(|c| c.id == editing.channel_id)?
            .clone();
        let update = act(AdminActionKind::UpdateChannel, Some(&channel.id));
        let busy = running(&self.op, &update);
        let update_error = failure(&self.op, &update).cloned();
        let can_permissions = self.caps.manage_channel_permissions;
        let tab = if can_permissions {
            editing.tab
        } else {
            EditTab::General
        };
        let tabs = can_permissions.then(|| {
            div().flex().gap(spacing(1.)).pb(spacing(1.)).children(
                [
                    (EditTab::General, "General", "general"),
                    (EditTab::Permissions, "Permissions", "permissions"),
                ]
                .into_iter()
                .map(|(value, label, key)| {
                    let button =
                        Button::new(SharedString::from(format!("channel-edit-tab-{key}")), label)
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(move |tab, _, _, cx| {
                                if let Some(editing) = tab.editing.as_mut() {
                                    editing.tab = value;
                                }
                                cx.notify();
                            }));
                    if value == tab {
                        button.contained()
                    } else {
                        button.outlined()
                    }
                }),
            )
        });
        let close = cx.weak_entity();
        let cancel = cx.weak_entity();
        let submit = cx.weak_entity();
        let narrow = phone(window);
        let mut dialog = Dialog::new(format!("Edit Channel: {}", channel.name)).width(600.);
        let body = div()
            .id("channel-edit-body")
            .max_h(px(if narrow { 520. } else { 600. }))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .children(tabs);
        if tab == EditTab::Permissions {
            let slot: AnyElement = match &self.permissions_slot {
                Some(view) => view.clone().into_any_element(),
                None => empty_line("Not available yet.", cx).into_any_element(),
            };
            dialog = dialog.body(body.child(slot)).action(
                Button::new("channel-edit-close", "Close").on_click(move |_, _, cx| {
                    cancel.update(cx, |tab, cx| tab.close_edit(cx)).ok();
                }),
            );
        } else {
            let name_error = check_channel_name(&self.edit_name.read(cx).value())
                .err()
                .filter(|_| editing.tried);
            let mut name = TextField::new("channel-edit-name", &self.edit_name, "Channel Name")
                .required(true)
                .disabled(busy)
                .error(name_error.is_some());
            if let Some(error) = name_error {
                name = name.helper(error);
            }
            let webhooks = (channel.kind != ChannelKind::Voice).then(|| self.webhooks_section(cx));
            dialog = dialog
                .body(
                    body.pt(spacing(1.))
                        .children(server_error(update_error.as_ref()))
                        .child(name)
                        .children(webhooks),
                )
                .action(
                    Button::new("channel-edit-cancel", "Cancel")
                        .disabled(busy)
                        .on_click(move |_, _, cx| {
                            cancel.update(cx, |tab, cx| tab.close_edit(cx)).ok();
                        }),
                )
                .action(
                    Button::new("channel-edit-submit", "Update Channel")
                        .contained()
                        .loading(busy)
                        .disabled(self.edit_name.read(cx).value().trim().is_empty())
                        .on_click(move |_, _, cx| {
                            submit.update(cx, |tab, cx| tab.submit_edit(cx)).ok();
                        }),
                );
        }
        Some(dialog.on_close(move |_, cx| {
            close
                .update(cx, |tab, cx| {
                    if tab.created.is_none() && tab.deleting_webhook.is_none() {
                        tab.close_edit(cx)
                    }
                })
                .ok();
        }))
    }

    fn created_dialog(&self, cx: &mut Context<Self>) -> Option<Dialog> {
        let created = self.created.as_ref()?;
        let sem = cx.sem().clone();
        let url = created.url.clone();
        let done = cx.weak_entity();
        let close = cx.weak_entity();
        let copy = cx.weak_entity();
        Some(
            Dialog::new("Webhook Created")
                .width(520.)
                .body(
                    div()
                        .flex()
                        .flex_col()
                        .gap(spacing(1.5))
                        .child(Alert::new(
                            Severity::Warning,
                            "Copy this URL now \u{2014} for security, you won't be able to see it again.",
                        ))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(spacing(1.))
                                .p(spacing(1.))
                                .rounded(px(4.))
                                .border_1()
                                .border_color(sem.divider)
                                .bg(sem.background_default)
                                .child(
                                    div()
                                        .id("webhook-url")
                                        .test_support()
                                        .role(Role::Status)
                                        .aria_label(SharedString::from(url.clone()))
                                        .flex_1()
                                        .min_w_0()
                                        .child(mono(url.clone(), cx)),
                                )
                                .child(
                                    IconButton::new("webhook-copy", DesignIcon::ContentCopy, "Copy webhook URL")
                                        .small()
                                        .on_click(move |_, _, cx| {
                                            cx.write_to_clipboard(ClipboardItem::new_string(url.clone()));
                                            copy.update(cx, |tab, cx| {
                                                tab.copied = true;
                                                cx.notify();
                                            })
                                            .ok();
                                        }),
                                ),
                        )
                        .when(self.copied, |col| {
                            col.child(
                                div()
                                    .id("webhook-copied")
                                    .test_support()
                                    .role(Role::Status)
                                    .child(text(Variant::Caption, "Copied to clipboard.").text_color(sem.success)),
                            )
                        }),
                )
                .action(Button::new("webhook-created-done", "Done").contained().on_click(
                    move |_, _, cx| {
                        done.update(cx, |tab, cx| {
                            tab.created = None;
                            cx.notify();
                        })
                        .ok();
                    },
                ))
                .on_close(move |_, cx| {
                    close
                        .update(cx, |tab, cx| {
                            tab.created = None;
                            cx.notify();
                        })
                        .ok();
                }),
        )
    }

    fn confirm_dialogs(&self, cx: &mut Context<Self>) -> Vec<Dialog> {
        let mut dialogs = Vec::new();
        if let Some(channel) = self
            .deleting
            .as_ref()
            .and_then(|id| self.channels.iter().find(|c| c.id == *id))
        {
            let id = channel.id.clone();
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            dialogs.push(
                Confirm {
                    id: "channel-delete",
                    title: "Delete Channel",
                    message: format!(
                        "Are you sure you want to delete the channel \u{201c}{}\u{201d}? This action cannot be undone and all messages in this channel will be permanently lost.",
                        channel.name
                    ),
                    confirm: "Delete Channel",
                    busy: false,
                }
                .dialog(
                    move |_, cx| {
                        confirm
                            .update(cx, |tab, cx| {
                                tab.deleting = None;
                                tab.send(
                                    act(AdminActionKind::DeleteChannel, Some(&id)),
                                    ChannelsEvent::Delete { channel_id: id.clone() },
                                    cx,
                                );
                            })
                            .ok();
                    },
                    move |_, cx| {
                        cancel
                            .update(cx, |tab, cx| {
                                tab.deleting = None;
                                cx.notify();
                            })
                            .ok();
                    },
                    cx,
                ),
            );
        }
        if let (Some(webhook_id), Some(editing)) =
            (self.deleting_webhook.clone(), self.editing.as_ref())
        {
            let name = self
                .webhooks
                .webhooks
                .iter()
                .find(|hook| hook.id == webhook_id)
                .map(|hook| hook.name.clone())
                .unwrap_or_default();
            let channel_id = editing.channel_id.clone();
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            dialogs.push(
                Confirm {
                    id: "webhook-delete",
                    title: "Delete Webhook",
                    message: format!(
                        "Delete the webhook \u{201c}{name}\u{201d}? Anything posting to its URL will stop working."
                    ),
                    confirm: "Delete",
                    busy: false,
                }
                .dialog(
                    move |_, cx| {
                        confirm
                            .update(cx, |tab, cx| {
                                tab.deleting_webhook = None;
                                let action =
                                    act(AdminActionKind::DeleteWebhook, Some(&webhook_id));
                                tab.webhook_pending
                                    .push(Pending::new(action, &tab.webhooks.op));
                                cx.emit(ChannelsEvent::DeleteWebhook {
                                    channel_id: channel_id.clone(),
                                    webhook_id: webhook_id.clone(),
                                });
                                cx.notify();
                            })
                            .ok();
                    },
                    move |_, cx| {
                        cancel
                            .update(cx, |tab, cx| {
                                tab.deleting_webhook = None;
                                cx.notify();
                            })
                            .ok();
                    },
                    cx,
                ),
            );
        }
        dialogs
    }
}

impl Render for ChannelsTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let create_locked = (!self.caps.create_channel).then(|| needs("Create channels"));
        let create = locked_button(
            Button::new("channel-create", "Create Channel")
                .contained()
                .start_icon(DesignIcon::Add)
                .on_click(cx.listener(|tab, _, window, cx| {
                    tab.creating = true;
                    tab.create_tried = false;
                    tab.create_kind = ChannelKind::Text;
                    tab.create_private = false;
                    tab.create_name
                        .update(cx, |field, cx| field.set_value("", window, cx));
                    cx.notify();
                })),
            "channel-create-locked",
            create_locked,
            cx,
        );
        let body: AnyElement = match &self.state {
            LoadState::Loading => loading_rows("channels-loading", "Loading channels", 5),
            LoadState::Failed { .. } => error_block(
                "channels-retry",
                "Failed to load channels",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(ChannelsEvent::Retry)),
                cx,
            ),
            LoadState::Ready => {
                let text_card = self.group_card(ChannelKind::Text, cx);
                let voice_card = self.group_card(ChannelKind::Voice, cx);
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(3.))
                    .child(text_card)
                    .child(voice_card)
                    .into_any_element()
            }
        };
        let mut overlays: Vec<AnyElement> = Vec::new();
        if self.creating {
            overlays.push(self.create_dialog(cx).into_any_element());
        }
        if let Some(dialog) = self.edit_dialog(window, cx) {
            overlays.push(dialog.into_any_element());
        }
        for dialog in self.confirm_dialogs(cx) {
            overlays.push(dialog.into_any_element());
        }
        if let Some(dialog) = self.created_dialog(cx) {
            overlays.push(dialog.into_any_element());
        }
        div()
            .relative()
            .size_full()
            .child(page(
                "community-channels",
                "Channels",
                None,
                vec![create],
                body,
                window,
                cx,
            ))
            .children(overlays)
    }
}
