//! The invites tab, after `InviteManagement.tsx` (which the web never mounts): my invites that
//! include this community, each with its code, a copy-link button, its uses, when it expires and
//! its status; creating one with a use limit and an expiry preset; deleting behind a confirm.

use super::common::{
    Confirm, action_icon, card, empty_line, list, loading_rows, locked_button, mono, page, row,
    server_error, tone_chip,
};
use super::rules::{
    ExpiryPreset, InviteStatus, Outcome, Pending, act, date_label, failure, failure_of,
    invite_status, invite_url, needs, parse_max_uses, running, uses_label,
};
use crate::kit::{Button, ButtonSize, Dialog, TextField, Variant, spacing, text, text_state};
use crate::messages::TimeFormat;
use crate::panel::PanelClock;
use crate::panel::common::{design_icon, error_block};
use crate::theme::SemTheme;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, CommunityCaps, InviteDraft, InviteRow, InvitesView, LoadState,
};
use semaphore_design::Icon as DesignIcon;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvitesEvent {
    /// "Create Invite": `Core::create_invite(community, draft)`.
    Create(InviteDraft),
    /// Confirmed: `Core::delete_invite(code)`.
    Delete { code: String },
    /// The list failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct InvitesTab {
    view: InvitesView,
    caps: CommunityCaps,
    clock: PanelClock,
    time: TimeFormat,
    link_base: String,
    pending: Vec<Pending>,
    creating: bool,
    tried: bool,
    max_uses: Entity<InputState>,
    expiry: ExpiryPreset,
    copied: Option<String>,
    deleting: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<InvitesEvent> for InvitesTab {}

impl InvitesTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let max_uses = text_state(window, cx, false);
        let _subscriptions = vec![cx.observe(&max_uses, |_, _, cx| cx.notify())];
        Self {
            view: InvitesView::default(),
            caps: CommunityCaps::default(),
            clock: PanelClock::default(),
            time: TimeFormat::default(),
            link_base: String::new(),
            pending: Vec::new(),
            creating: false,
            tried: false,
            max_uses,
            expiry: ExpiryPreset::Never,
            copied: None,
            deleting: None,
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::community_invites(community)`.
    pub fn set_view(&mut self, view: InvitesView, cx: &mut Context<Self>) {
        let mut created = false;
        self.pending
            .retain_mut(|pending| match pending.observe(&view.op) {
                Outcome::Waiting => true,
                Outcome::Failed => false,
                Outcome::Succeeded => {
                    created |= pending.action.kind == AdminActionKind::CreateInvite;
                    false
                }
            });
        if created {
            self.creating = false;
        }
        self.view = view;
        cx.notify();
    }

    /// The server the links point at (the web's `getInstanceUrl()`): `https://chat.example.com`.
    pub fn set_link_base(&mut self, base: impl Into<String>, cx: &mut Context<Self>) {
        self.link_base = base.into();
        cx.notify();
    }

    /// What "expired" and the expiry presets are measured from. The real clock unless a story fixes
    /// it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    /// The zone "Expires …" and "Created …" are written in: the app's, unless a story fixes it.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// Opens the create dialog filled in, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn open_create(
        &mut self,
        max_uses: &str,
        expiry: ExpiryPreset,
        tried: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.creating = true;
        self.tried = tried;
        self.expiry = expiry;
        let max_uses = max_uses.to_owned();
        self.max_uses
            .update(cx, |field, cx| field.set_value(max_uses, window, cx));
    }

    #[cfg(feature = "stories")]
    pub(crate) fn mark_copied(&mut self, code: &str) {
        self.copied = Some(code.to_owned());
    }

    fn create_action() -> AdminAction {
        act(AdminActionKind::CreateInvite, None)
    }

    fn busy_creating(&self) -> bool {
        running(&self.view.op, &Self::create_action())
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if !self.caps.create_invite || self.busy_creating() {
            return;
        }
        self.tried = true;
        let Ok(max_uses) = parse_max_uses(&self.max_uses.read(cx).value()) else {
            cx.notify();
            return;
        };
        self.pending
            .push(Pending::new(Self::create_action(), &self.view.op));
        cx.emit(InvitesEvent::Create(InviteDraft {
            max_uses,
            valid_until_ms: self.expiry.valid_until(self.clock.now_ms()),
        }));
        cx.notify();
    }

    fn copy(&mut self, code: &str, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(invite_url(&self.link_base, code)));
        self.copied = Some(code.to_owned());
        cx.notify();
    }

    fn invite_row(&self, invite: &InviteRow, now: i64, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let status = invite_status(invite, now);
        let chip = match status {
            InviteStatus::Active => tone_chip(status.label(), sem.success),
            _ => tone_chip(status.label(), sem.error),
        };
        let code = invite.code.clone();
        let copy_code = code.clone();
        let delete_code = code.clone();
        let copied = self.copied.as_deref() == Some(code.as_str());
        let deleting = running(
            &self.view.op,
            &act(AdminActionKind::DeleteInvite, Some(&code)),
        );
        let mut details = vec![uses_label(invite)];
        if let Some(until) = invite.valid_until_ms {
            details.push(format!("Expires: {}", date_label(&self.time, until)));
        }
        details.push(format!(
            "Created: {}",
            date_label(&self.time, invite.created_at_ms)
        ));
        row(
            SharedString::from(format!("invite-{code}")),
            format!("Invite {code}"),
            cx,
        )
        .child(design_icon(DesignIcon::Link, 20., sem.text_secondary))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(spacing(1.))
                        .child(mono(code.clone(), cx).min_w_0().truncate())
                        .child(chip),
                )
                .child(
                    text(Variant::Caption, details.join(" \u{b7} ")).text_color(sem.text_secondary),
                ),
        )
        .child(action_icon(
            format!("invite-copy-{code}"),
            if copied {
                DesignIcon::Check
            } else {
                DesignIcon::ContentCopy
            },
            if copied {
                "Copied!".to_owned()
            } else {
                "Copy invite link".to_owned()
            },
            None,
            false,
            Some(sem.primary),
            cx.listener(move |tab, _, _, cx| tab.copy(&copy_code, cx)),
        ))
        .child(action_icon(
            format!("invite-delete-{code}"),
            DesignIcon::Delete,
            format!("Delete invite {code}"),
            (!self.caps.delete_invite).then(|| needs("Delete invites")),
            deleting,
            Some(sem.error),
            cx.listener(move |tab, _, _, cx| {
                tab.deleting = Some(delete_code.clone());
                cx.notify();
            }),
        ))
        .into_any_element()
    }

    fn create_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let sem = cx.sem().clone();
        let busy = self.busy_creating();
        let create_error = failure(&self.view.op, &Self::create_action()).cloned();
        let uses_error = parse_max_uses(&self.max_uses.read(cx).value()).err();
        let mut uses = TextField::new("invite-max-uses", &self.max_uses, "Max Uses")
            .placeholder("Unlimited")
            .disabled(busy)
            .error(uses_error.is_some())
            .helper(
                uses_error
                    .clone()
                    .unwrap_or_else(|| "Leave empty for unlimited uses".to_owned()),
            );
        if uses_error.is_some() {
            uses = uses.error(true);
        }
        let presets =
            div()
                .flex()
                .flex_wrap()
                .gap(spacing(1.))
                .children(ExpiryPreset::ALL.into_iter().map(|preset| {
                    let button = Button::new(
                        SharedString::from(format!("invite-expiry-{}", preset.key())),
                        preset.label(),
                    )
                    .size(ButtonSize::Small)
                    .disabled(busy)
                    .on_click(cx.listener(move |tab, _, _, cx| {
                        tab.expiry = preset;
                        cx.notify();
                    }));
                    if preset == self.expiry {
                        button.contained()
                    } else {
                        button.outlined()
                    }
                }));
        let expires = match self.expiry.valid_until(self.clock.now_ms()) {
            Some(until) => format!("Expires {}", date_label(&self.time, until)),
            None => "Never expires".to_owned(),
        };
        let cancel = cx.weak_entity();
        let close = cx.weak_entity();
        let submit = cx.weak_entity();
        Dialog::new("Create Invite")
            .width(480.)
            .body(
                div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(server_error(create_error.as_ref()))
                    .child(
                        text(
                            Variant::Body2,
                            "Anyone with the link can join this community.",
                        )
                        .text_color(sem.text_secondary),
                    )
                    .child(uses)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(
                                text(Variant::Caption, "Expires after")
                                    .text_color(sem.text_secondary),
                            )
                            .child(presets)
                            .child(text(Variant::Caption, expires).text_color(sem.text_secondary)),
                    ),
            )
            .action(
                Button::new("invite-create-cancel", "Cancel")
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
                Button::new("invite-create-submit", "Create Invite")
                    .contained()
                    .loading(busy)
                    .disabled(uses_error.is_some())
                    .on_click(move |_, _, cx| {
                        submit.update(cx, |tab, cx| tab.submit(cx)).ok();
                    }),
            )
            .on_close(move |_, cx| {
                close
                    .update(cx, |tab, cx| {
                        if !tab.busy_creating() {
                            tab.creating = false;
                            cx.notify();
                        }
                    })
                    .ok();
            })
    }
}

impl Render for InvitesTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let create = locked_button(
            Button::new("invite-create", "Create Invite")
                .contained()
                .start_icon(DesignIcon::Add)
                .on_click(cx.listener(|tab, _, window, cx| {
                    tab.creating = true;
                    tab.tried = false;
                    tab.expiry = ExpiryPreset::Never;
                    tab.max_uses
                        .update(cx, |field, cx| field.set_value("", window, cx));
                    cx.notify();
                })),
            "invite-create-locked",
            (!self.caps.create_invite).then(|| {
                "You need the \u{201c}Create invites\u{201d} and \u{201c}Create instance invites\u{201d} permissions".to_owned()
            }),
            cx,
        );
        let delete_error = failure_of(&self.view.op, &[AdminActionKind::DeleteInvite])
            .and_then(|(_, error)| server_error(Some(error)));
        let now = self.clock.now_ms();
        let listing: AnyElement = match &self.view.state {
            LoadState::Loading => loading_rows("invites-loading", "Loading invites", 3),
            LoadState::Failed { .. } => error_block(
                "invites-retry",
                "Failed to load invites",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(InvitesEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.invites.is_empty() => {
                empty_line("No invites created yet", cx).into_any_element()
            }
            LoadState::Ready => {
                let invites = self.view.invites.clone();
                let rows: Vec<_> = invites
                    .iter()
                    .map(|invite| self.invite_row(invite, now, cx))
                    .collect();
                list("invites-list", "Invites")
                    .children(rows)
                    .into_any_element()
            }
        };
        let title = match self.view.state {
            LoadState::Ready => format!("Your Invites ({})", self.view.invites.len()),
            _ => "Your Invites".to_owned(),
        };
        let body = div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .children(delete_error)
            .child(card(title, listing, cx));
        let mut overlays: Vec<AnyElement> = Vec::new();
        if self.creating {
            overlays.push(self.create_dialog(cx).into_any_element());
        }
        if let Some(code) = self.deleting.clone() {
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            overlays.push(
                Confirm {
                    id: "invite-delete",
                    title: "Delete Invite",
                    message: format!("Delete the invite {code}? Its link stops working at once."),
                    confirm: "Delete",
                    busy: false,
                }
                .dialog(
                    move |_, cx| {
                        confirm
                            .update(cx, |tab, cx| {
                                tab.deleting = None;
                                let action = act(AdminActionKind::DeleteInvite, Some(&code));
                                tab.pending.push(Pending::new(action, &tab.view.op));
                                cx.emit(InvitesEvent::Delete { code: code.clone() });
                                cx.notify();
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
                )
                .into_any_element(),
            );
        }
        div()
            .relative()
            .size_full()
            .child(page(
                "community-invites",
                "Invites",
                Some("Invite links you made for this community.".into()),
                vec![create],
                body,
                window,
                cx,
            ))
            .children(overlays)
    }
}
