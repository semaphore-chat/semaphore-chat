//! `InviteScreen`, after `JoinInvitePage.tsx`: an instance invite's preview before signing in.
//! "Join" goes on to `RegisterScreen` with the code. The server answers a code that can't be used
//! (unknown, expired, used up or disabled) with nothing, so all of those are one "invalid" state.
//! Invites make new accounts, so one opened while signed in only says it can't be applied here.

use super::{card, event_link, page};
use crate::kit::{Alert, Button, Icon, Severity, Spinner, Variant, spacing, text};
use crate::panel::common::error_block;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{InvitePreview, InvitePreviewView, LoadState};
use semaphore_design::Icon as IconName;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InviteEvent {
    /// "Join": the owner opens `RegisterScreen` with `set_invite_code(code)`.
    Accept { code: String },
    /// "Login here", or "Back to sign in" from an invite that can't be used.
    SignIn,
    /// The preview got no answer and the user asked again: `Core::retry_failed`.
    Retry,
    /// "Close" on the signed-in message.
    Close,
}

pub struct InviteScreen {
    view: InvitePreviewView,
    signed_in: bool,
}

impl EventEmitter<InviteEvent> for InviteScreen {}

/// `formatDate`: "Nov 11, 2026".
pub(crate) fn invite_date(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|date| date.format("%b %-d, %Y").to_string())
        .unwrap_or_default()
}

impl InviteScreen {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            view: InvitePreviewView::default(),
            signed_in: false,
        }
    }

    /// `Core::invite_preview(code)`, read again on `ViewChanged { InvitePreview { code } }`.
    pub fn set_view(&mut self, view: InvitePreviewView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// The link was opened while signed in: only the message shows.
    pub fn set_signed_in(&mut self, signed_in: bool, cx: &mut Context<Self>) {
        self.signed_in = signed_in;
        cx.notify();
    }

    fn heading(icon: IconName, color: Hsla, title: &'static str) -> Div {
        div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .child(
                div()
                    .mb(spacing(2.))
                    .child(Icon::new(icon).size(40.).color(color)),
            )
            .child(text(Variant::H5, title).mb(spacing(2.)).text_center())
    }

    fn back_button(cx: &mut Context<Self>) -> impl IntoElement + use<> {
        Button::new("invite-sign-in", "Back to sign in")
            .contained()
            .full_width()
            .on_click(cx.listener(|_, _, _, cx| cx.emit(InviteEvent::SignIn)))
    }

    fn details(invite: &InvitePreview, cx: &App) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let line = |label: &'static str, value: String| {
            div()
                .flex()
                .justify_between()
                .gap(spacing(2.))
                .child(text(Variant::Caption, label).text_color(sem.text_secondary))
                .child(text(Variant::Caption, value).min_w_0().truncate())
        };
        let uses = match invite.max_uses {
            Some(max) => format!("{}/{max}", invite.uses),
            None => invite.uses.to_string(),
        };
        div()
            .id("invite-details")
            .test_support()
            .w_full()
            .mb(spacing(3.))
            .p(spacing(2.))
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .flex()
            .flex_col()
            .gap(spacing(0.5))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .gap(spacing(2.))
                    .mb(spacing(0.5))
                    .child(text(Variant::Subtitle2, "Invite Code").text_color(sem.text_secondary))
                    .child(
                        text(Variant::Body2, invite.code.clone())
                            .font_weight(FontWeight(500.))
                            .min_w_0()
                            .truncate(),
                    ),
            )
            .children(invite.created_by.clone().map(|by| line("Created by", by)))
            .child(line("Uses", uses))
            .children(
                invite
                    .valid_until_ms
                    .map(|until| line("Expires", invite_date(until))),
            )
    }
}

impl Render for InviteScreen {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let body: AnyElement = if self.signed_in {
            Self::heading(IconName::Link, sem.primary, "You're already signed in")
                .child(
                    div()
                        .id("invite-signed-in")
                        .test_support()
                        .w_full()
                        .mb(spacing(2.))
                        .child(Alert::new(
                            Severity::Info,
                            "Invite links create new accounts, so this one can't be applied from here. To join a community, ask one of its admins to add you.",
                        )),
                )
                .child(
                    Button::new("invite-close", "Close")
                        .contained()
                        .full_width()
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(InviteEvent::Close))),
                )
                .into_any_element()
        } else {
            match (&self.view.state, &self.view.invite) {
                (_, Some(invite)) => {
                    let code = invite.code.clone();
                    Self::heading(IconName::PersonAdd, sem.primary, "Join Semaphore Chat")
                        .child(
                            text(
                                Variant::Body2,
                                "You've been invited to make an account here",
                            )
                            .text_color(sem.text_secondary)
                            .text_center()
                            .mb(spacing(3.)),
                        )
                        .child(Self::details(invite, cx))
                        .child(
                            div().w_full().mb(spacing(2.)).child(
                                Button::new("invite-accept", "Join")
                                    .contained()
                                    .full_width()
                                    .on_click(cx.listener(move |_, _, _, cx| {
                                        cx.emit(InviteEvent::Accept { code: code.clone() })
                                    })),
                            ),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .justify_center()
                                .gap_x(px(4.))
                                .text_color(sem.text_secondary)
                                .child(text(Variant::Body2, "Already have an account?"))
                                .child(event_link(
                                    "invite-login",
                                    "Login here",
                                    InviteEvent::SignIn,
                                    cx,
                                )),
                        )
                        .into_any_element()
                }
                (LoadState::Loading, None) => div()
                    .id("invite-loading")
                    .test_support()
                    .role(Role::Status)
                    .w_full()
                    .py(spacing(3.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(spacing(2.))
                    .child(Spinner::new("invite-spinner").size(40.))
                    .child(text(Variant::Body1, "Validating invite..."))
                    .into_any_element(),
                (LoadState::Failed { .. }, None) => error_block(
                    "invite-retry",
                    "Couldn't check this invite",
                    "Check your connection and try again.",
                    cx.listener(|_, _, _, cx| cx.emit(InviteEvent::Retry)),
                    cx,
                ),
                // Read and empty: the server answers an unknown, expired, used-up or disabled code
                // alike, so there is one message for all of them, as the web's "Invalid Invite".
                (LoadState::Ready, None) => {
                    Self::heading(IconName::ErrorOutline, sem.error, "Invalid Invite")
                        .child(
                            div()
                                .id("invite-invalid")
                                .test_support()
                                .w_full()
                                .mb(spacing(2.))
                                .child(Alert::new(
                                    Severity::Error,
                                    "This invite link is invalid or has expired.",
                                )),
                        )
                        .child(Self::back_button(cx))
                        .into_any_element()
                }
            }
        };
        page("invite-screen", &sem, card(sem.background_default, body))
    }
}

#[cfg(feature = "stories")]
pub(super) fn stories() -> Vec<crate::stories::Story> {
    use crate::stories::Story;
    use semaphore_core::model::ErrorView;

    fn invite() -> InvitePreviewView {
        InvitePreviewView {
            state: LoadState::Ready,
            invite: Some(InvitePreview {
                code: "WELCOME-2026".into(),
                created_by: Some("mike".into()),
                uses: 3,
                max_uses: Some(10),
                valid_until_ms: Some(1_798_675_200_000),
            }),
        }
    }

    fn failed(code: &str) -> InvitePreviewView {
        InvitePreviewView {
            state: LoadState::Failed {
                error: ErrorView {
                    code: code.into(),
                    message: "Request failed".into(),
                    retryable: true,
                    retry_after_ms: None,
                },
            },
            invite: None,
        }
    }

    fn screen(view: InvitePreviewView, signed_in: bool, cx: &mut App) -> AnyView {
        cx.new(|cx| {
            let mut screen = InviteScreen::new(cx);
            screen.set_view(view, cx);
            screen.set_signed_in(signed_in, cx);
            screen
        })
        .into()
    }

    vec![
        Story::new("auth-invite-usable", |_, _, cx| screen(invite(), false, cx)),
        Story::new("auth-invite-long", |_, _, cx| {
            let mut view = invite();
            if let Some(invite) = view.invite.as_mut() {
                invite.code = "a-very-long-invite-code-that-someone-pasted-0123456789abcdef".into();
                invite.created_by = Some("maximilian_featherstonehaugh_wolfeschlegel".into());
                invite.max_uses = None;
                invite.valid_until_ms = None;
            }
            screen(view, false, cx)
        }),
        Story::new("auth-invite-invalid", |_, _, cx| {
            screen(
                InvitePreviewView {
                    state: LoadState::Ready,
                    invite: None,
                },
                false,
                cx,
            )
        }),
        Story::new("auth-invite-loading", |_, _, cx| {
            screen(InvitePreviewView::default(), false, cx)
        }),
        Story::new("auth-invite-failed", |_, _, cx| {
            screen(failed("NETWORK"), false, cx)
        }),
        Story::new("auth-invite-signed-in", |_, _, cx| {
            screen(invite(), true, cx)
        }),
    ]
}
