//! `ResetPasswordScreen`, after `pages/ResetPasswordPage.tsx`: the new password twice, the link's
//! token from `?token=`, and what became of it. A missing token, a refusal and success are three
//! states of the same card; success leads back to sign-in with the new password.

use super::{PASSWORD_MAX, PASSWORD_MIN, card, event_link, page};
use crate::kit::{Alert, Button, Icon, Severity, TextField, Variant, spacing, text, text_state};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;

/// What the web's helpers say, in its words.
pub const TOO_SHORT: &str = "Must be at least 8 characters";
pub const TOO_LONG: &str = "Must be at most 128 characters";
pub const MISMATCH: &str = "Passwords do not match";
pub const MISSING_TOKEN: &str = "This reset link is missing or invalid.";
pub const DONE: &str = "Password has been reset. Sign in with your new password.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResetEvent {
    /// "Reset Password": `Core::reset_password(token, password)`. Answer with `set_busy(true)`,
    /// then `set_success` or `set_error`.
    Submit { token: String, password: String },
    /// The success card's "Sign in", and "Back to login".
    SignIn,
    /// "Request a new reset link": the forgot screen.
    RequestNewLink,
}

/// Which field is wrong, for the helpers under each field.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ResetErrors {
    pub too_short: bool,
    pub too_long: bool,
    pub mismatch: bool,
}

/// The web's field rules: a password being typed may be short until it is long enough, and the
/// confirmation is only compared once something is in it.
pub fn validate_reset(password: &str, confirm: &str) -> ResetErrors {
    let length = password.chars().count();
    ResetErrors {
        too_short: length > 0 && length < PASSWORD_MIN,
        too_long: length > PASSWORD_MAX,
        mismatch: !confirm.is_empty() && password != confirm,
    }
}

/// Whether the button runs: a token to redeem, a password the server will take, the same one
/// twice, and nothing already happening.
pub fn can_submit(
    token: Option<&str>,
    password: &str,
    confirm: &str,
    busy: bool,
    success: bool,
) -> bool {
    let errors = validate_reset(password, confirm);
    let length = password.chars().count();
    token.is_some_and(|token| !token.is_empty())
        && (PASSWORD_MIN..=PASSWORD_MAX).contains(&length)
        && !errors.too_short
        && !errors.too_long
        && !errors.mismatch
        && password == confirm
        && !busy
        && !success
}

/// The line on the card that says where the new password goes: a pasted token and a
/// `semaphore://` link don't name a server, so the card does.
pub fn target_line(host: &str) -> String {
    format!("This will reset your password on {host}.")
}

pub struct ResetPasswordScreen {
    token: Option<String>,
    /// The host of the server the reset is sent to, shown on the card.
    server_host: Option<String>,
    password: Entity<InputState>,
    confirm: Entity<InputState>,
    busy: bool,
    success: bool,
    error: Option<String>,
    tried: bool,
    took_focus: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ResetEvent> for ResetPasswordScreen {}

impl ResetPasswordScreen {
    /// `server_host`: where `Submit` will post, named on the card (see [`super::server_host`]).
    pub fn new(
        token: Option<String>,
        server_host: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let password = text_state(window, cx, true);
        let confirm = text_state(window, cx, true);
        let _subscriptions = vec![
            cx.observe(&password, |_, _, cx| cx.notify()),
            cx.observe(&confirm, |_, _, cx| cx.notify()),
        ];
        Self {
            token,
            server_host,
            password,
            confirm,
            busy: false,
            success: false,
            error: None,
            tried: false,
            took_focus: false,
            _subscriptions,
        }
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    pub fn server_host(&self) -> Option<&str> {
        self.server_host.as_deref()
    }

    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        if busy {
            self.error = None;
        }
        cx.notify();
    }

    /// The server took the new password: the card says so and offers sign-in.
    pub fn set_success(&mut self, success: bool, cx: &mut Context<Self>) {
        self.success = success;
        self.busy = false;
        cx.notify();
    }

    /// The server's refusal ("Invalid or expired reset token") or a network error.
    pub fn set_error(&mut self, error: Option<String>, cx: &mut Context<Self>) {
        self.error = error;
        self.busy = false;
        cx.notify();
    }

    /// Fills both fields, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn preset(
        &mut self,
        password: &str,
        confirm: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (password, confirm) = (password.to_owned(), confirm.to_owned());
        self.password
            .update(cx, |field, cx| field.set_value(password, window, cx));
        self.confirm
            .update(cx, |field, cx| field.set_value(confirm, window, cx));
        cx.notify();
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        self.tried = true;
        let (password, confirm) = {
            let password = self.password.read(cx).value();
            let confirm = self.confirm.read(cx).value();
            (password.to_string(), confirm.to_string())
        };
        if !can_submit(
            self.token.as_deref(),
            &password,
            &confirm,
            self.busy,
            self.success,
        ) {
            cx.notify();
            return;
        }
        let token = self.token.clone().unwrap_or_default();
        cx.emit(ResetEvent::Submit { token, password });
        cx.notify();
    }
}

impl Render for ResetPasswordScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus && self.token.is_some() && !self.success {
            self.took_focus = true;
            self.password
                .update(cx, |field, cx| field.focus(window, cx));
        }
        let sem = cx.sem().clone();
        let request_new = |cx: &mut Context<Self>| {
            div().text_color(sem.text_secondary).child(event_link(
                "reset-password-request-new",
                "Request a new reset link",
                ResetEvent::RequestNewLink,
                cx,
            ))
        };
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
            .child(text(Variant::H5, "Reset Password").mb(spacing(2.)));
        let body = if self.token.is_none() {
            head.child(
                div()
                    .id("reset-password-invalid")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(Severity::Error, MISSING_TOKEN)),
            )
            .child(request_new(cx))
        } else if self.success {
            head.child(
                div()
                    .id("reset-password-done")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(DONE)
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(Severity::Success, DONE)),
            )
            .child(
                div().w_full().child(
                    Button::new("reset-password-sign-in", "Sign in")
                        .contained()
                        .full_width()
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(ResetEvent::SignIn))),
                ),
            )
        } else {
            let password = self.password.read(cx).value().to_string();
            let confirm = self.confirm.read(cx).value().to_string();
            let errors = validate_reset(&password, &confirm);
            let length = password.chars().count();
            let empty_password = self.tried && length == 0;
            let empty_confirm = self.tried && confirm.is_empty();
            let can = can_submit(
                self.token.as_deref(),
                &password,
                &confirm,
                self.busy,
                self.success,
            );
            head.children(self.server_host.as_deref().map(|host| {
                div()
                    .id("reset-password-target")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(
                        text(Variant::Body2, target_line(host))
                            .text_color(sem.text_secondary)
                            .text_center(),
                    )
            }))
            .children(self.error.clone().map(|message| {
                div()
                    .id("reset-password-error")
                    .test_support()
                    .role(Role::Alert)
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(
                        Severity::Error,
                        if message.is_empty() {
                            "Failed to reset password. Please try again.".to_owned()
                        } else {
                            message
                        },
                    ))
            }))
            .children(
                self.error
                    .as_ref()
                    .map(|_| div().w_full().mb(spacing(2.)).child(request_new(cx))),
            )
            .child(div().w_full().mb(spacing(2.)).child({
                let helper = if empty_password {
                    Some("Enter a new password")
                } else if errors.too_short {
                    Some(TOO_SHORT)
                } else if errors.too_long {
                    Some(TOO_LONG)
                } else {
                    None
                };
                let field = TextField::new("reset-password", &self.password, "New password")
                    .required(true)
                    .disabled(self.busy)
                    .error(helper.is_some())
                    .surface(sem.background_default);
                match helper {
                    Some(helper) => field.helper(helper),
                    None => field,
                }
            }))
            .child(div().w_full().mb(spacing(2.)).child({
                let helper = if errors.mismatch {
                    Some(MISMATCH)
                } else if empty_confirm {
                    Some("Confirm the new password")
                } else {
                    None
                };
                let field = TextField::new(
                    "reset-password-confirm",
                    &self.confirm,
                    "Confirm new password",
                )
                .required(true)
                .disabled(self.busy)
                .error(helper.is_some())
                .surface(sem.background_default);
                match helper {
                    Some(helper) => field.helper(helper),
                    None => field,
                }
            }))
            .child(
                div().w_full().mb(spacing(2.)).child(
                    Button::new("reset-password-submit", "Reset Password")
                        .contained()
                        .full_width()
                        .loading(self.busy)
                        .disabled(!can)
                        .on_click(cx.listener(|screen, _, _, cx| screen.submit(cx))),
                ),
            )
            .child(div().text_color(sem.text_secondary).child(event_link(
                "reset-password-back",
                "Back to login",
                ResetEvent::SignIn,
                cx,
            )))
        };
        page(
            "reset-password-screen",
            &sem,
            card(sem.background_default, body),
        )
    }
}

#[cfg(feature = "stories")]
pub(super) fn stories() -> Vec<crate::stories::Story> {
    use crate::stories::Story;

    fn screen(
        window: &mut Window,
        cx: &mut App,
        token: Option<&str>,
        setup: impl FnOnce(&mut ResetPasswordScreen, &mut Window, &mut Context<ResetPasswordScreen>),
    ) -> AnyView {
        let token = token.map(str::to_owned);
        cx.new(|cx| {
            let mut screen =
                ResetPasswordScreen::new(token, Some("chat.example.com".into()), window, cx);
            setup(&mut screen, window, cx);
            screen
        })
        .into()
    }

    vec![
        Story::new("auth-reset", |_, window, cx| {
            screen(window, cx, Some("aB3x9Q2w"), |_, _, _| {})
        }),
        Story::new("auth-reset-short", |_, window, cx| {
            screen(window, cx, Some("aB3x9Q2w"), |screen, window, cx| {
                screen.preset("short", "short", window, cx);
                screen.tried = true;
            })
        }),
        Story::new("auth-reset-mismatch", |_, window, cx| {
            screen(window, cx, Some("aB3x9Q2w"), |screen, window, cx| {
                screen.preset("a long password", "another password", window, cx);
                screen.tried = true;
            })
        }),
        Story::new("auth-reset-busy", |_, window, cx| {
            screen(window, cx, Some("aB3x9Q2w"), |screen, window, cx| {
                screen.preset("a long password", "a long password", window, cx);
                screen.set_busy(true, cx);
            })
        }),
        Story::new("auth-reset-missing-token", |_, window, cx| {
            screen(window, cx, None, |_, _, _| {})
        }),
        Story::new("auth-reset-error", |_, window, cx| {
            screen(window, cx, Some("aB3x9Q2w"), |screen, window, cx| {
                screen.preset("a long password", "a long password", window, cx);
                screen.set_error(Some("Invalid or expired reset token".into()), cx);
            })
        }),
        Story::new("auth-reset-done", |_, window, cx| {
            screen(window, cx, Some("aB3x9Q2w"), |screen, _, cx| {
                screen.set_success(true, cx)
            })
        }),
    ]
}
