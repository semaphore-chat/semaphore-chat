//! `RegisterScreen`, after `RegisterPage.tsx`, with the server's rules (`CreateUserDto`): a username
//! of 2 to 32 letters, numbers, `_` and `-`, a password of 8 to 128 characters, an optional email,
//! and the invite code, which today's backend always takes.

use super::{card, event_link, page};
use crate::kit::{Alert, Button, Icon, Severity, TextField, Variant, spacing, text, text_state};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{RegisterForm, RegistrationMode};
use semaphore_design::Icon as IconName;

pub const USERNAME_MIN: usize = 2;
pub const USERNAME_MAX: usize = 32;
pub const PASSWORD_MIN: usize = 8;
pub const PASSWORD_MAX: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RegisterField {
    Username,
    Email,
    Password,
    InviteCode,
}

/// A plain check: something, one `@`, and a dot in what follows. The server checks properly.
fn looks_like_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain
            .split_once('.')
            .is_some_and(|(name, tld)| !name.is_empty() && !tld.is_empty())
        && !email.chars().any(char::is_whitespace)
}

/// What's wrong with each field, in the server's words. An invite-only server needs a code;
/// an open one takes an empty code.
pub fn validate_register(
    form: &RegisterForm,
    invite_required: bool,
) -> Vec<(RegisterField, String)> {
    let mut errors = Vec::new();
    let username = form.username.trim();
    let length = username.chars().count();
    if username.is_empty() {
        errors.push((RegisterField::Username, "Username is required".to_owned()));
    } else if length < USERNAME_MIN {
        errors.push((
            RegisterField::Username,
            format!("Username must be at least {USERNAME_MIN} characters"),
        ));
    } else if length > USERNAME_MAX {
        errors.push((
            RegisterField::Username,
            format!("Username must be at most {USERNAME_MAX} characters"),
        ));
    } else if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        errors.push((
            RegisterField::Username,
            "Username can only contain letters, numbers, underscores, and hyphens".to_owned(),
        ));
    }
    if let Some(email) = form.email.as_deref()
        && !looks_like_email(email.trim())
    {
        errors.push((
            RegisterField::Email,
            "Enter a valid email address".to_owned(),
        ));
    }
    let password = form.password.chars().count();
    if password < PASSWORD_MIN {
        errors.push((
            RegisterField::Password,
            format!("Password must be at least {PASSWORD_MIN} characters"),
        ));
    } else if password > PASSWORD_MAX {
        errors.push((
            RegisterField::Password,
            format!("Password must be at most {PASSWORD_MAX} characters"),
        ));
    }
    if invite_required && form.invite_code.trim().is_empty() {
        errors.push((
            RegisterField::InviteCode,
            "An invite code is required".to_owned(),
        ));
    }
    errors
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegisterEvent {
    /// "Register" with a valid form: `Core::register(form)`, which signs in after. Answer with
    /// `set_busy` and `set_error`.
    Submit(RegisterForm),
    /// "Login here", or "Back to sign in" when registration is closed.
    SignIn,
    ChangeServer,
}

pub struct RegisterScreen {
    mode: RegistrationMode,
    server_url: String,
    server_name: String,
    username: Entity<InputState>,
    email: Entity<InputState>,
    password: Entity<InputState>,
    code: Entity<InputState>,
    /// The code came with an invite link: it's shown, not typed.
    code_locked: bool,
    busy: bool,
    error: Option<String>,
    tried: bool,
    took_focus: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<RegisterEvent> for RegisterScreen {}

impl RegisterScreen {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let username = text_state(window, cx, false);
        let email = text_state(window, cx, false);
        let password = text_state(window, cx, true);
        let code = text_state(window, cx, false);
        let _subscriptions = [&username, &email, &password, &code]
            .into_iter()
            .map(|field| cx.observe(field, |_, _, cx| cx.notify()))
            .collect();
        Self {
            mode: RegistrationMode::default(),
            server_url: String::new(),
            server_name: String::new(),
            username,
            email,
            password,
            code,
            code_locked: false,
            busy: false,
            error: None,
            tried: false,
            took_focus: false,
            _subscriptions,
        }
    }

    /// `ServerInfo::registration`.
    pub fn set_mode(&mut self, mode: RegistrationMode, cx: &mut Context<Self>) {
        self.mode = mode;
        cx.notify();
    }

    /// The server this registers on, for the "Server:" line.
    pub fn set_server(&mut self, url: String, name: Option<String>, cx: &mut Context<Self>) {
        self.server_name = name.unwrap_or_else(|| url.clone());
        self.server_url = url;
        cx.notify();
    }

    /// An invite's code, from its link: filled in and not editable.
    pub fn set_invite_code(&mut self, code: String, window: &mut Window, cx: &mut Context<Self>) {
        self.code
            .update(cx, |field, cx| field.set_value(code, window, cx));
        self.code_locked = true;
        cx.notify();
    }

    /// `Core::register` is on its way (and the sign-in after it).
    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        if busy {
            self.error = None;
        }
        cx.notify();
    }

    /// The server's refusal (`CoreError::Failed`'s message), until the next try.
    pub fn set_error(&mut self, error: Option<String>, cx: &mut Context<Self>) {
        self.error = error;
        self.busy = false;
        cx.notify();
    }

    /// The form as it stands. An empty email is none.
    pub fn form(&self, cx: &App) -> RegisterForm {
        let email = self.email.read(cx).value().trim().to_owned();
        RegisterForm {
            username: self.username.read(cx).value().trim().to_owned(),
            password: self.password.read(cx).value().to_string(),
            email: (!email.is_empty()).then_some(email),
            invite_code: self.code.read(cx).value().trim().to_owned(),
        }
    }

    /// Fills the fields, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn preset(
        &mut self,
        username: &str,
        email: &str,
        password: &str,
        code: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        for (field, value) in [
            (&self.username, username),
            (&self.email, email),
            (&self.password, password),
            (&self.code, code),
        ] {
            let value = value.to_owned();
            field.update(cx, |field, cx| field.set_value(value, window, cx));
        }
        cx.notify();
    }

    /// An invite-only server needs a code; an open one takes an account without it.
    fn invite_required(&self) -> bool {
        self.mode == RegistrationMode::InviteOnly
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if self.busy || self.mode == RegistrationMode::Closed {
            return;
        }
        self.tried = true;
        let form = self.form(cx);
        if validate_register(&form, self.invite_required()).is_empty() {
            cx.emit(RegisterEvent::Submit(form));
        }
        cx.notify();
    }

    fn server_line(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_center()
            .gap_x(px(4.))
            .mb(spacing(2.))
            .text_color(sem.text_secondary)
            .child(text(Variant::Body2, "Server:"))
            .child(
                text(Variant::Body2, self.server_name.clone())
                    .font_weight(FontWeight(700.))
                    .max_w_full()
                    .truncate(),
            )
            .child(text(Variant::Body2, "·"))
            .child(event_link(
                "register-change-server",
                "Change server",
                RegisterEvent::ChangeServer,
                cx,
            ))
    }

    fn closed(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .child(
                div()
                    .mb(spacing(2.))
                    .child(Icon::new(IconName::Block).size(40.).color(sem.text_secondary)),
            )
            .child(text(Variant::H5, "Registration is closed").mb(spacing(1.)))
            .child(self.server_line(cx))
            .child(
                div()
                    .id("register-closed")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(
                        Severity::Info,
                        "This server isn't taking new accounts. Ask one of its admins to make one for you.",
                    )),
            )
            .child(
                Button::new("register-back", "Back to sign in")
                    .contained()
                    .full_width()
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(RegisterEvent::SignIn))),
            )
    }

    fn form_body(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let form = self.form(cx);
        let invite_required = self.invite_required();
        let errors = if self.tried {
            validate_register(&form, invite_required)
        } else {
            Vec::new()
        };
        let error_of = |field: RegisterField| {
            errors
                .iter()
                .find(|(at, _)| *at == field)
                .map(|(_, message)| message.clone())
        };
        let field = |child: TextField| div().w_full().mb(spacing(2.)).child(child);
        let busy = self.busy;
        let (username_error, email_error, password_error, code_error) = (
            error_of(RegisterField::Username),
            error_of(RegisterField::Email),
            error_of(RegisterField::Password),
            error_of(RegisterField::InviteCode),
        );
        let code_helper = if self.code_locked {
            "From your invite link".to_owned()
        } else if invite_required {
            "This server is invite-only: enter the code you were given".to_owned()
        } else {
            "Optional: ask someone on this server for an invite code".to_owned()
        };
        let code_label = if invite_required || self.code_locked {
            "Invite code"
        } else {
            "Invite code (optional)"
        };
        div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .child(
                div()
                    .mb(spacing(2.))
                    .child(Icon::new(IconName::PersonAdd).size(40.).color(sem.primary)),
            )
            .child(text(Variant::H5, "Register").mb(spacing(2.)))
            .child(self.server_line(cx))
            .children(self.error.clone().map(|message| {
                div()
                    .id("register-error")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(
                        Severity::Error,
                        if message.is_empty() {
                            "Registration failed. Please try again.".to_owned()
                        } else {
                            message
                        },
                    ))
            }))
            .child(field(
                TextField::new("register-username", &self.username, "Username")
                    .required(true)
                    .disabled(busy)
                    .error(username_error.is_some())
                    .helper(
                        username_error.unwrap_or_else(|| "Letters, numbers, _ and -".to_owned()),
                    )
                    .surface(sem.background_default),
            ))
            .child(field(
                TextField::new("register-email", &self.email, "Email")
                    .disabled(busy)
                    .error(email_error.is_some())
                    .helper(
                        email_error
                            .unwrap_or_else(|| "Optional: for resetting your password".to_owned()),
                    )
                    .surface(sem.background_default),
            ))
            .child(field(
                TextField::new("register-password", &self.password, "Password")
                    .required(true)
                    .disabled(busy)
                    .error(password_error.is_some())
                    .helper(
                        password_error.unwrap_or_else(|| {
                            format!("Must be at least {PASSWORD_MIN} characters")
                        }),
                    )
                    .surface(sem.background_default),
            ))
            .child(field(
                TextField::new("register-code", &self.code, code_label)
                    .required(invite_required)
                    .disabled(busy || self.code_locked)
                    .error(code_error.is_some())
                    .helper(code_error.unwrap_or(code_helper))
                    .surface(sem.background_default),
            ))
            .child(
                div().w_full().mb(spacing(2.)).child(
                    Button::new("register-submit", "Register")
                        .contained()
                        .full_width()
                        .loading(busy)
                        .on_click(cx.listener(|screen, _, _, cx| screen.submit(cx))),
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
                        "register-sign-in",
                        "Login here",
                        RegisterEvent::SignIn,
                        cx,
                    )),
            )
    }
}

impl Render for RegisterScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus && self.mode != RegistrationMode::Closed {
            self.took_focus = true;
            self.username
                .update(cx, |field, cx| field.focus(window, cx));
        }
        let sem = cx.sem().clone();
        let body = if self.mode == RegistrationMode::Closed {
            self.closed(cx)
        } else {
            self.form_body(cx)
        };
        page("register-screen", &sem, card(sem.background_default, body))
    }
}

#[cfg(feature = "stories")]
pub(super) fn stories() -> Vec<crate::stories::Story> {
    use crate::stories::Story;

    fn screen(
        mode: RegistrationMode,
        window: &mut Window,
        cx: &mut App,
        setup: impl FnOnce(&mut RegisterScreen, &mut Window, &mut Context<RegisterScreen>),
    ) -> AnyView {
        cx.new(|cx| {
            let mut screen = RegisterScreen::new(window, cx);
            screen.set_mode(mode, cx);
            screen.set_server("https://chat.example.com".into(), Some("Ladle".into()), cx);
            setup(&mut screen, window, cx);
            screen
        })
        .into()
    }

    vec![
        Story::new("auth-register-open", |_, window, cx| {
            screen(RegistrationMode::Open, window, cx, |_, _, _| {})
        }),
        Story::new("auth-register-invite-only", |_, window, cx| {
            screen(RegistrationMode::InviteOnly, window, cx, |_, _, _| {})
        }),
        Story::new("auth-register-invite-required", |_, window, cx| {
            screen(
                RegistrationMode::InviteOnly,
                window,
                cx,
                |screen, window, cx| {
                    screen.preset(
                        "ava_chen",
                        "ava@example.com",
                        "hunter2hunter2",
                        "",
                        window,
                        cx,
                    );
                    screen.tried = true;
                },
            )
        }),
        Story::new("auth-register-closed", |_, window, cx| {
            screen(RegistrationMode::Closed, window, cx, |_, _, _| {})
        }),
        Story::new("auth-register-errors", |_, window, cx| {
            screen(
                RegistrationMode::InviteOnly,
                window,
                cx,
                |screen, window, cx| {
                    screen.preset("a b", "not-an-email", "short", "", window, cx);
                    screen.tried = true;
                },
            )
        }),
        Story::new("auth-register-invite-code", |_, window, cx| {
            screen(
                RegistrationMode::InviteOnly,
                window,
                cx,
                |screen, window, cx| {
                    screen.set_invite_code("WELCOME-2026".into(), window, cx);
                },
            )
        }),
        Story::new("auth-register-busy", |_, window, cx| {
            screen(RegistrationMode::Open, window, cx, |screen, window, cx| {
                screen.preset(
                    "ava_chen",
                    "ava@example.com",
                    "hunter2hunter2",
                    "WELCOME",
                    window,
                    cx,
                );
                screen.set_busy(true, cx);
            })
        }),
        Story::new("auth-register-failed", |_, window, cx| {
            screen(
                RegistrationMode::InviteOnly,
                window,
                cx,
                |screen, window, cx| {
                    screen.preset("ava_chen", "", "hunter2hunter2", "OLD-CODE", window, cx);
                    screen.set_error(Some("Invalid or expired invite code".into()), cx);
                },
            )
        }),
    ]
}
