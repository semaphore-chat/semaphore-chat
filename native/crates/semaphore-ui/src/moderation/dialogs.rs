//! The moderation dialogs, one entity for all five: ban (`BanDialog.tsx`), kick
//! (`KickConfirmDialog.tsx`), timeout (`TimeoutDialog.tsx`), and the unban and remove-timeout
//! confirms (`BanListPanel.tsx`, `TimeoutListPanel.tsx`). Each has an optional reason (soft cap
//! 512) and the ban and timeout dialogs a length.
//!
//! The owner opens one (`open_ban(user)`, ...), and on its event calls core. It follows its own
//! action's entry in the op it is fed (`set_op`): Ban, Kick, Timeout and RemoveTimeout are on
//! `ModerationTargetView::op` (the member), Unban on `BanListView::op`, RemoveTimeout also on
//! `TimeoutListView::op`. While that entry runs the dialog is busy; when it fails the dialog shows
//! the server's words and stays open, as the web does; when it goes, the dialog closes and emits
//! `Succeeded`. Another action's entry on the same member (a timeout failing beside a running ban)
//! doesn't touch it.
//!
//! Without an op (the W4 participant menu's kick, until it is wired to core's), `set_busy`,
//! `set_error` and `close` drive it by hand, as that menu's `set_kick_busy` and `set_kick_error`.

use super::common::reason_field;
use super::format::{
    BAN_DEFAULT_SECONDS, BanChoice, TIMEOUT_DEFAULT_SECONDS, admin_action, duration_label,
    ends_label, pick_preset, presets_or_default, reason_error, reason_for_send, timeout_request,
};
use crate::community_settings::rules::{Outcome, Pending, failure, running};
use crate::dms::names::user_name;
use crate::kit::{Alert, Button, ButtonTone, Dialog, Radio, Severity, Variant, spacing, text};
use crate::messages::TimeFormat;
use crate::theme::SemTheme;
use gpui_kit::component::input::TextareaState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminOp, BAN_PRESETS_SECONDS, BanRequest,
    TIMEOUT_PRESETS_SECONDS, TimeoutRequest, UserView,
};

/// Which dialog is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogKind {
    Ban,
    Kick,
    Timeout,
    Unban,
    RemoveTimeout,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModerationDialogEvent {
    /// `Core::ban_member(community, user_id, request)`.
    Ban {
        user_id: String,
        request: BanRequest,
    },
    /// `Core::kick_member(community, user_id, reason)`.
    Kick {
        user_id: String,
        reason: Option<String>,
    },
    /// `Core::timeout_member(community, user_id, request)`.
    Timeout {
        user_id: String,
        request: TimeoutRequest,
    },
    /// `Core::unban_member(community, user_id, reason)`.
    Unban {
        user_id: String,
        reason: Option<String>,
    },
    /// `Core::remove_timeout(community, user_id, reason)`.
    RemoveTimeout {
        user_id: String,
        reason: Option<String>,
    },
    /// Cancel, Escape or the backdrop: the dialog has closed itself.
    Cancel,
    /// Its action's entry went from the op: it worked, and the dialog has closed itself.
    Succeeded { kind: DialogKind, user_id: String },
}

/// The op entry a dialog's action has.
pub fn action_of(kind: DialogKind, user_id: &str) -> AdminAction {
    admin_action(
        match kind {
            DialogKind::Ban => AdminActionKind::Ban,
            DialogKind::Kick => AdminActionKind::Kick,
            DialogKind::Timeout => AdminActionKind::Timeout,
            DialogKind::Unban => AdminActionKind::Unban,
            DialogKind::RemoveTimeout => AdminActionKind::RemoveTimeout,
        },
        user_id,
    )
}

struct Open {
    kind: DialogKind,
    user: UserView,
    busy: bool,
    error: Option<String>,
}

pub struct ModerationDialog {
    open: Option<Open>,
    reason: Entity<TextareaState>,
    ban: BanChoice,
    timeout_seconds: u32,
    ban_presets: Vec<u32>,
    timeout_presets: Vec<u32>,
    time: TimeFormat,
    /// The op this dialog's action is followed in.
    op: AdminOp,
    /// The action sent, until its entry ends.
    pending: Option<Pending>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ModerationDialogEvent> for ModerationDialog {}

impl ModerationDialog {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let reason = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(2, 5)
                .placeholder("Shown in the moderation log")
        });
        let _subscriptions = vec![cx.observe(&reason, |_, _, cx| cx.notify())];
        Self {
            open: None,
            reason,
            ban: BanChoice::default(),
            timeout_seconds: TIMEOUT_DEFAULT_SECONDS,
            ban_presets: BAN_PRESETS_SECONDS.to_vec(),
            timeout_presets: TIMEOUT_PRESETS_SECONDS.to_vec(),
            time: TimeFormat::default(),
            op: AdminOp::default(),
            pending: None,
            _subscriptions,
        }
    }

    /// The op of the view the open action lives on (see the module docs), as it changes.
    pub fn set_op(&mut self, op: AdminOp, cx: &mut Context<Self>) {
        if let Some(pending) = self.pending.as_mut() {
            match pending.observe(&op) {
                Outcome::Waiting => {}
                Outcome::Failed => {
                    let message = failure(&op, &pending.action)
                        .map(|error| error.message.clone())
                        .unwrap_or_else(|| "Something went wrong. Please try again.".to_owned());
                    self.pending = None;
                    if let Some(open) = &mut self.open {
                        open.busy = false;
                        open.error = Some(message);
                    }
                }
                Outcome::Succeeded => {
                    self.pending = None;
                    if let Some(open) = self.open.take() {
                        cx.emit(ModerationDialogEvent::Succeeded {
                            kind: open.kind,
                            user_id: open.user.id,
                        });
                    }
                }
            }
        }
        self.op = op;
        cx.notify();
    }

    /// The open action is on its way: sent by hand (`set_busy`), or its entry running.
    pub fn busy(&self) -> bool {
        self.open.as_ref().is_some_and(|open| {
            open.busy || running(&self.op, &action_of(open.kind, &open.user.id))
        })
    }

    /// What the dialog shows as refused.
    pub fn error(&self) -> Option<&str> {
        self.open.as_ref().and_then(|open| open.error.as_deref())
    }

    /// The lengths offered: core's `BAN_PRESETS_SECONDS` and `TIMEOUT_PRESETS_SECONDS` unless
    /// set. Empty lists fall back to those.
    pub fn set_presets(&mut self, ban: Vec<u32>, timeout: Vec<u32>, cx: &mut Context<Self>) {
        self.ban_presets = presets_or_default(&ban, false);
        self.timeout_presets = presets_or_default(&timeout, true);
        cx.notify();
    }

    /// The zone and clock "Until …" is written in: the app's, unless a story fixes them.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    pub fn open_ban(&mut self, user: UserView, window: &mut Window, cx: &mut Context<Self>) {
        self.open_kind(DialogKind::Ban, user, window, cx);
    }

    pub fn open_kick(&mut self, user: UserView, window: &mut Window, cx: &mut Context<Self>) {
        self.open_kind(DialogKind::Kick, user, window, cx);
    }

    pub fn open_timeout(&mut self, user: UserView, window: &mut Window, cx: &mut Context<Self>) {
        self.open_kind(DialogKind::Timeout, user, window, cx);
    }

    pub fn open_unban(&mut self, user: UserView, window: &mut Window, cx: &mut Context<Self>) {
        self.open_kind(DialogKind::Unban, user, window, cx);
    }

    pub fn open_remove_timeout(
        &mut self,
        user: UserView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_kind(DialogKind::RemoveTimeout, user, window, cx);
    }

    /// Opens `kind` for `user`, empty: no reason, the web's default length, no error.
    pub fn open_kind(
        &mut self,
        kind: DialogKind,
        user: UserView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open = Some(Open {
            kind,
            user,
            busy: false,
            error: None,
        });
        self.pending = None;
        self.ban = BanChoice {
            permanent: true,
            seconds: pick_preset(&self.ban_presets, None, BAN_DEFAULT_SECONDS)
                .unwrap_or(BAN_DEFAULT_SECONDS),
        };
        self.timeout_seconds = pick_preset(&self.timeout_presets, None, TIMEOUT_DEFAULT_SECONDS)
            .unwrap_or(TIMEOUT_DEFAULT_SECONDS);
        self.reason
            .update(cx, |field, cx| field.set_value("", window, cx));
        cx.notify();
    }

    /// Done: the action went through, or the owner drops it.
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.open = None;
        self.pending = None;
        cx.notify();
    }

    pub fn is_open(&self) -> bool {
        self.open.is_some()
    }

    pub fn kind(&self) -> Option<DialogKind> {
        self.open.as_ref().map(|open| open.kind)
    }

    /// Busy clears the last error.
    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        if let Some(open) = &mut self.open {
            open.busy = busy;
            if busy {
                open.error = None;
            }
            cx.notify();
        }
    }

    /// The server refused: its message, and the dialog is no longer busy.
    pub fn set_error(&mut self, error: Option<String>, cx: &mut Context<Self>) {
        if let Some(open) = &mut self.open {
            open.error = error;
            open.busy = false;
            cx.notify();
        }
    }

    /// What the reason field holds: for stories and tests.
    pub fn set_reason(&mut self, reason: &str, window: &mut Window, cx: &mut Context<Self>) {
        let reason = reason.to_owned();
        self.reason
            .update(cx, |field, cx| field.set_value(reason, window, cx));
        cx.notify();
    }

    /// The ban's length: permanent, or a preset (one not offered becomes the default).
    pub fn set_ban_choice(&mut self, permanent: bool, seconds: u32, cx: &mut Context<Self>) {
        self.ban = BanChoice {
            permanent,
            seconds: pick_preset(&self.ban_presets, Some(seconds), BAN_DEFAULT_SECONDS)
                .unwrap_or(BAN_DEFAULT_SECONDS),
        };
        cx.notify();
    }

    /// The timeout's length (one not offered becomes the default).
    pub fn set_timeout_seconds(&mut self, seconds: u32, cx: &mut Context<Self>) {
        self.timeout_seconds = pick_preset(
            &self.timeout_presets,
            Some(seconds),
            TIMEOUT_DEFAULT_SECONDS,
        )
        .unwrap_or(TIMEOUT_DEFAULT_SECONDS);
        cx.notify();
    }

    pub fn ban_choice(&self) -> BanChoice {
        self.ban
    }

    pub fn timeout_seconds(&self) -> u32 {
        self.timeout_seconds
    }

    /// "Ban User" and the like: sends the event and turns busy. Nothing while busy, or with a
    /// reason over the cap.
    pub fn confirm(&mut self, cx: &mut Context<Self>) {
        let raw = self.reason.read(cx).value().to_string();
        let Some(open) = &self.open else {
            return;
        };
        if self.busy() || reason_error(&raw).is_some() {
            return;
        }
        let user_id = open.user.id.clone();
        self.pending = Some(Pending::new(action_of(open.kind, &user_id), &self.op));
        let event = match open.kind {
            DialogKind::Ban => ModerationDialogEvent::Ban {
                user_id,
                request: self.ban.request(&raw),
            },
            DialogKind::Kick => ModerationDialogEvent::Kick {
                user_id,
                reason: reason_for_send(&raw),
            },
            DialogKind::Timeout => ModerationDialogEvent::Timeout {
                user_id,
                request: timeout_request(self.timeout_seconds, &raw),
            },
            DialogKind::Unban => ModerationDialogEvent::Unban {
                user_id,
                reason: reason_for_send(&raw),
            },
            DialogKind::RemoveTimeout => ModerationDialogEvent::RemoveTimeout {
                user_id,
                reason: reason_for_send(&raw),
            },
        };
        self.set_busy(true, cx);
        cx.emit(event);
    }

    /// Cancel: closes, unless busy.
    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        if self.busy() {
            return;
        }
        self.open = None;
        self.pending = None;
        cx.emit(ModerationDialogEvent::Cancel);
        cx.notify();
    }

    fn lengths(&self, busy: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let heading =
            |label: &'static str| text(Variant::Subtitle2, label).text_color(sem.text_primary);
        let grid = || div().flex().flex_wrap().gap_x(spacing(1.));
        match self.open.as_ref().map(|open| open.kind) {
            Some(DialogKind::Ban) => {
                let permanent = self.ban.permanent;
                let kinds = grid()
                    .child(
                        Radio::new("ban-temporary", "Temporary", !permanent)
                            .disabled(busy)
                            .on_select(pick(cx, |dialog, cx| {
                                dialog.ban.permanent = false;
                                cx.notify();
                            })),
                    )
                    .child(
                        Radio::new("ban-permanent", "Permanent", permanent)
                            .disabled(busy)
                            .on_select(pick(cx, |dialog, cx| {
                                dialog.ban.permanent = true;
                                cx.notify();
                            })),
                    );
                let mut section = div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(heading("Ban Duration"))
                    .child(kinds);
                if !permanent {
                    let presets = grid().children(self.ban_presets.iter().map(|&seconds| {
                        Radio::new(
                            SharedString::from(format!("ban-length-{seconds}")),
                            duration_label(seconds),
                            self.ban.seconds == seconds,
                        )
                        .disabled(busy)
                        .on_select(pick(cx, move |dialog, cx| {
                            dialog.ban.seconds = seconds;
                            cx.notify();
                        }))
                    }));
                    section = section
                        .child(div().pt(spacing(1.)).child(heading("Duration")))
                        .child(presets)
                        .child(
                            text(Variant::Caption, ends_label(&self.time, self.ban.seconds))
                                .text_color(sem.text_secondary),
                        );
                }
                section.into_any_element()
            }
            Some(DialogKind::Timeout) => {
                let presets = grid().children(self.timeout_presets.iter().map(|&seconds| {
                    Radio::new(
                        SharedString::from(format!("timeout-length-{seconds}")),
                        duration_label(seconds),
                        self.timeout_seconds == seconds,
                    )
                    .disabled(busy)
                    .on_select(pick(cx, move |dialog, cx| {
                        dialog.timeout_seconds = seconds;
                        cx.notify();
                    }))
                }));
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(heading("Duration"))
                    .child(presets)
                    .child(
                        text(
                            Variant::Caption,
                            ends_label(&self.time, self.timeout_seconds),
                        )
                        .text_color(sem.text_secondary),
                    )
                    .into_any_element()
            }
            _ => div().into_any_element(),
        }
    }
}

/// A radio's handler that changes the dialog.
fn pick(
    cx: &Context<ModerationDialog>,
    change: impl Fn(&mut ModerationDialog, &mut Context<ModerationDialog>) + 'static,
) -> impl Fn(&mut Window, &mut App) + 'static {
    let this = cx.weak_entity();
    move |_, cx| {
        this.update(cx, |dialog, cx| change(dialog, cx)).ok();
    }
}

/// What each dialog says.
struct Words {
    title: String,
    sentence: &'static str,
    confirm: &'static str,
    busy: &'static str,
}

fn words(kind: DialogKind, name: &str, permanent: bool) -> Words {
    match kind {
        DialogKind::Ban => Words {
            title: format!("Ban {name}"),
            sentence: if permanent {
                "This user will be removed from the community and prevented from rejoining."
            } else {
                "This user will be removed from the community and prevented from rejoining until \
                 the ban expires."
            },
            confirm: "Ban User",
            busy: "Banning\u{2026}",
        },
        DialogKind::Kick => Words {
            title: format!("Kick {name}"),
            sentence: "This user will be removed from the community but can rejoin if they have \
                       an invite link.",
            confirm: "Kick User",
            busy: "Kicking\u{2026}",
        },
        DialogKind::Timeout => Words {
            title: format!("Timeout {name}"),
            sentence: "This user will be unable to send messages in this community for the \
                       selected duration.",
            confirm: "Timeout User",
            busy: "Timing out\u{2026}",
        },
        DialogKind::Unban => Words {
            title: format!("Unban {name}"),
            sentence: "Are you sure you want to unban this user? They will be able to rejoin the \
                       community.",
            confirm: "Unban User",
            busy: "Unbanning\u{2026}",
        },
        DialogKind::RemoveTimeout => Words {
            title: format!("Remove Timeout for {name}"),
            sentence: "Are you sure you want to remove this timeout? The user will be able to \
                       send messages immediately.",
            confirm: "Remove Timeout",
            busy: "Removing\u{2026}",
        },
    }
}

impl Render for ModerationDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(open) = &self.open else {
            return div().into_any_element();
        };
        let sem = cx.sem().clone();
        let (kind, busy, error) = (open.kind, self.busy(), open.error.clone());
        let name = user_name(&open.user);
        let words = words(kind, &name, self.ban.permanent);
        let over = reason_error(&self.reason.read(cx).value()).is_some();
        let tone = match kind {
            DialogKind::Ban => ButtonTone::Danger,
            DialogKind::Kick | DialogKind::Timeout => ButtonTone::Warning,
            DialogKind::Unban | DialogKind::RemoveTimeout => ButtonTone::Default,
        };
        let id = match kind {
            DialogKind::Ban => "ban",
            DialogKind::Kick => "kick",
            DialogKind::Timeout => "timeout",
            DialogKind::Unban => "unban",
            DialogKind::RemoveTimeout => "remove-timeout",
        };
        let lengths = self.lengths(busy, cx);
        let confirm = cx.listener(|dialog, _, _, cx| dialog.confirm(cx));
        let cancel = cx.listener(|dialog, _, _, cx| dialog.cancel(cx));
        let close = cx.entity().downgrade();
        let dialog = Dialog::new(words.title)
            .width(480.)
            .body(
                div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(error.map(|error| Alert::new(Severity::Error, error)))
                    .child(text(Variant::Body2, words.sentence).text_color(sem.text_secondary))
                    .child(reason_field(
                        "moderation-reason",
                        &self.reason,
                        busy,
                        window,
                        cx,
                    ))
                    .child(lengths),
            )
            .action(
                Button::new(SharedString::from(format!("{id}-cancel")), "Cancel")
                    .disabled(busy)
                    .on_click(cancel),
            )
            .action(
                Button::new(
                    SharedString::from(format!("{id}-confirm")),
                    if busy { words.busy } else { words.confirm },
                )
                .contained()
                .tone(tone)
                .disabled(over)
                .loading(busy)
                .on_click(confirm),
            )
            .on_close(move |_, cx| {
                close.update(cx, |dialog, cx| dialog.cancel(cx)).ok();
            });
        div().absolute().inset_0().child(dialog).into_any_element()
    }
}
