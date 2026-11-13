//! `ForgotPasswordScreen`, after `ForgotPasswordPage.tsx`: the email, then "we've sent a reset
//! link". The mail's link is a web URL; its success card also takes one pasted back here (the
//! whole URL or just the token) and opens the native reset screen with it.

use super::{card, event_link, page};
use crate::kit::{Alert, Button, Icon, Severity, TextField, Variant, spacing, text, text_state};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForgotEvent {
    /// "Send reset link": `Core::forgot_password(email)`. Answer with `set_sent(true)`, or
    /// `set_error`.
    Submit { email: String },
    /// A reset link or token pasted into the success card: the owner opens the reset screen.
    OpenReset { token: String },
    /// "Back to login".
    Back,
}

/// The token in a pasted reset link or token: the mail's web URL
/// (`https://host/reset-password?token=...`, with or without a `#`), or the bare token. `None`
/// when it doesn't look like one.
pub fn reset_token_from_input(input: &str) -> Option<String> {
    let input = input.trim();
    if input.is_empty() {
        return None;
    }
    let raw = input
        .split(['?', '&', '#'])
        .find_map(|part| part.strip_prefix("token="))
        .map(|token| token.split('#').next().unwrap_or(token))
        .unwrap_or(input);
    let token = percent_decode(raw)?;
    let length = token.chars().count();
    (length > 0
        && length <= 128
        && !token.contains(['/', '\\', '?', '#', '&', '='])
        && token.chars().all(|c| c.is_ascii_graphic()))
    .then_some(token)
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub struct ForgotPasswordScreen {
    email: Entity<InputState>,
    /// The pasted reset link or token, on the success card.
    reset_link: Entity<InputState>,
    busy: bool,
    sent: bool,
    error: Option<String>,
    /// Why the pasted link wasn't one, under its field.
    link_error: Option<String>,
    tried: bool,
    took_focus: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ForgotEvent> for ForgotPasswordScreen {}

impl ForgotPasswordScreen {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let email = text_state(window, cx, false);
        let reset_link = text_state(window, cx, false);
        let _subscriptions = vec![
            cx.observe(&email, |_, _, cx| cx.notify()),
            cx.observe(&reset_link, |_, _, cx| cx.notify()),
        ];
        Self {
            email,
            reset_link,
            busy: false,
            sent: false,
            error: None,
            link_error: None,
            tried: false,
            took_focus: false,
            _subscriptions,
        }
    }

    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        if busy {
            self.error = None;
        }
        cx.notify();
    }

    /// The server took it: "If an account with that email exists, we've sent a reset link."
    pub fn set_sent(&mut self, sent: bool, cx: &mut Context<Self>) {
        self.sent = sent;
        self.busy = false;
        self.link_error = None;
        cx.notify();
    }

    pub fn set_error(&mut self, error: Option<String>, cx: &mut Context<Self>) {
        self.error = error;
        self.busy = false;
        cx.notify();
    }

    /// Fills the email, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn preset(&mut self, email: &str, window: &mut Window, cx: &mut Context<Self>) {
        let email = email.to_owned();
        self.email
            .update(cx, |field, cx| field.set_value(email, window, cx));
        cx.notify();
    }

    /// "Continue" under the pasted link: the token it carries, or why it doesn't carry one.
    pub(crate) fn open_pasted_link(&mut self, cx: &mut Context<Self>) {
        let pasted = self.reset_link.read(cx).value().to_string();
        match reset_token_from_input(&pasted) {
            Some(token) => {
                self.link_error = None;
                cx.emit(ForgotEvent::OpenReset { token });
            }
            None => self.link_error = Some("That doesn't look like a reset link.".into()),
        }
        cx.notify();
    }

    /// Fills the pasted-link field, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn preset_reset_link(
        &mut self,
        link: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let link = link.to_owned();
        self.reset_link
            .update(cx, |field, cx| field.set_value(link, window, cx));
        cx.notify();
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.tried = true;
        let email = self.email.read(cx).value().trim().to_owned();
        if !email.is_empty() {
            cx.emit(ForgotEvent::Submit { email });
        }
        cx.notify();
    }
}

impl Render for ForgotPasswordScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus && !self.sent {
            self.took_focus = true;
            self.email.update(cx, |field, cx| field.focus(window, cx));
        }
        let sem = cx.sem().clone();
        let back = div().text_color(sem.text_secondary).child(event_link(
            "forgot-back",
            "Back to login",
            ForgotEvent::Back,
            cx,
        ));
        let head = div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .child(
                div().mb(spacing(2.)).child(
                    Icon::new(IconName::LockOutlined)
                        .size(40.)
                        .color(sem.primary),
                ),
            )
            .child(text(Variant::H5, "Forgot Password").mb(spacing(2.)));
        let body = if self.sent {
            head.child(
                div()
                    .id("forgot-sent")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(
                        Severity::Success,
                        "If an account with that email exists, we've sent a reset link. Open it to choose a new password, then sign in here.",
                    )),
            )
            .child(
                div()
                    .id("forgot-paste")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .child(
                        text(
                            Variant::Body2,
                            "Have a reset link? Paste it here to finish in the app.",
                        )
                        .text_color(sem.text_secondary),
                    )
                    .child({
                        let field = TextField::new(
                            "forgot-reset-link",
                            &self.reset_link,
                            "Reset link or token",
                        )
                        .error(self.link_error.is_some())
                        .surface(sem.background_default);
                        match self.link_error.clone() {
                            Some(message) => field.helper(message),
                            None => field,
                        }
                    })
                    .child(
                        Button::new("forgot-reset-open", "Continue")
                            .outlined()
                            .full_width()
                            .on_click(
                                cx.listener(|screen, _, _, cx| screen.open_pasted_link(cx)),
                            ),
                    ),
            )
            .child(back)
        } else {
            let empty = self.tried && self.email.read(cx).value().trim().is_empty();
            head.child(
                text(
                    Variant::Body2,
                    "Enter your account email and we'll send you a link to reset your password.",
                )
                .text_color(sem.text_secondary)
                .text_center()
                .mb(spacing(2.)),
            )
            .children(self.error.clone().map(|message| {
                div()
                    .id("forgot-error")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(
                        Severity::Error,
                        if message.is_empty() {
                            "Something went wrong. Please try again.".to_owned()
                        } else {
                            message
                        },
                    ))
            }))
            .child(
                div().w_full().mb(spacing(2.)).child(
                    TextField::new("forgot-email", &self.email, "Email")
                        .required(true)
                        .disabled(self.busy)
                        .error(empty)
                        .when(empty, |field| field.helper("Enter your email"))
                        .surface(sem.background_default),
                ),
            )
            .child(
                div().w_full().mb(spacing(2.)).child(
                    Button::new("forgot-submit", "Send reset link")
                        .contained()
                        .full_width()
                        .loading(self.busy)
                        .on_click(cx.listener(|screen, _, _, cx| screen.submit(cx))),
                ),
            )
            .child(back)
        };
        page("forgot-screen", &sem, card(sem.background_default, body))
    }
}

#[cfg(feature = "stories")]
pub(super) fn stories() -> Vec<crate::stories::Story> {
    use crate::stories::Story;

    fn screen(
        window: &mut Window,
        cx: &mut App,
        setup: impl FnOnce(&mut ForgotPasswordScreen, &mut Window, &mut Context<ForgotPasswordScreen>),
    ) -> AnyView {
        cx.new(|cx| {
            let mut screen = ForgotPasswordScreen::new(window, cx);
            setup(&mut screen, window, cx);
            screen
        })
        .into()
    }

    vec![
        Story::new("auth-forgot", |_, window, cx| {
            screen(window, cx, |_, _, _| {})
        }),
        Story::new("auth-forgot-empty", |_, window, cx| {
            screen(window, cx, |screen, _, _| screen.tried = true)
        }),
        Story::new("auth-forgot-busy", |_, window, cx| {
            screen(window, cx, |screen, window, cx| {
                screen.preset("ava@example.com", window, cx);
                screen.set_busy(true, cx);
            })
        }),
        Story::new("auth-forgot-sent", |_, window, cx| {
            screen(window, cx, |screen, _, cx| screen.set_sent(true, cx))
        }),
        Story::new("auth-forgot-sent-pasted", |_, window, cx| {
            screen(window, cx, |screen, window, cx| {
                screen.set_sent(true, cx);
                screen.preset_reset_link(
                    "https://chat.example.com/reset-password?token=aB3x9Q2w",
                    window,
                    cx,
                );
            })
        }),
        Story::new("auth-forgot-sent-bad-link", |_, window, cx| {
            screen(window, cx, |screen, _, cx| {
                screen.set_sent(true, cx);
                screen.link_error = Some("That doesn't look like a reset link.".into());
            })
        }),
        Story::new("auth-forgot-failed", |_, window, cx| {
            screen(window, cx, |screen, window, cx| {
                screen.preset("ava@example.com", window, cx);
                screen.set_error(Some(String::new()), cx);
            })
        }),
    ]
}
