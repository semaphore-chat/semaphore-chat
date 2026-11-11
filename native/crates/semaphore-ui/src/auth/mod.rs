//! Auth screens: server URL (`ConnectionWizard`'s details step), sign-in (`LoginPage`), and the entry
//! to browser sign-in (`BrowserLoginPanel`). The flow only draws and reports: [`AuthEvent`] goes to
//! the owner, who calls `Core::sign_in` and sets [`AuthScreen::set_session`] from what comes back.
//!
//! W3-ui-auth adds, each its own view the owner swaps in like `AuthScreen`:
//! - `RegisterScreen` (`RegisterPage.tsx`): by the server's `RegistrationMode`, always with an
//!   invite code; a "registration is closed" card when it's closed.
//! - `ForgotPasswordScreen` (`ForgotPasswordPage.tsx`): the email form only; the reset itself
//!   finishes in the web app the email opens.
//! - `InviteScreen` (`JoinInvitePage.tsx`): an invite link's preview, usable or invalid, and the message
//!   for one opened while signed in.

mod forgot;
mod invite;
mod register;
#[cfg(test)]
mod tests;

pub use forgot::{ForgotEvent, ForgotPasswordScreen};
pub use invite::{InviteEvent, InviteScreen};
pub use register::{
    PASSWORD_MAX, PASSWORD_MIN, RegisterEvent, RegisterField, RegisterScreen, USERNAME_MAX,
    USERNAME_MIN, validate_register,
};

use crate::kit::{
    Alert, Button, ButtonSize, Icon, Severity, Spinner, TextField, Variant, link, spacing, text,
    text_state,
};
use crate::theme::{FONT_FAMILY, SemTheme};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    BrowserSignInFailure, BrowserSignInView, RegistrationMode, SessionState,
};
use semaphore_design::Icon as IconName;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthEvent {
    /// Test and save this server.
    ConnectServer {
        url: String,
        name: Option<String>,
    },
    SignIn {
        server_url: String,
        username: String,
        password: String,
    },
    BrowserSignIn {
        server_url: String,
    },
    CancelBrowserSignIn,
    ChangeServer,
    ForgotPassword,
    Register,
}

/// `BrowserLoginPhase` and `BrowserLoginError`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BrowserLogin {
    /// This server has no browser sign-in.
    Unavailable,
    #[default]
    Idle,
    Waiting,
    Finishing,
    Denied,
    TimedOut,
    Failed,
}

impl BrowserLogin {
    /// What the sign-in screen shows for `Core::browser_sign_in`, on a server that offers it
    /// (`ServerInfo::browser_sign_in`) or not.
    pub fn from_view(view: &BrowserSignInView, offered: bool) -> Self {
        if !offered {
            return Self::Unavailable;
        }
        match view {
            BrowserSignInView::Idle => Self::Idle,
            BrowserSignInView::Waiting { .. } => Self::Waiting,
            BrowserSignInView::Redeeming => Self::Finishing,
            BrowserSignInView::Failed { reason } => match reason {
                BrowserSignInFailure::Denied => Self::Denied,
                BrowserSignInFailure::TimedOut => Self::TimedOut,
                BrowserSignInFailure::NotOffered => Self::Unavailable,
                BrowserSignInFailure::Refused { .. }
                | BrowserSignInFailure::ListenFailed { .. } => Self::Failed,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthStep {
    ServerUrl {
        /// Set while the connection is being tested.
        testing: bool,
        error: Option<String>,
    },
    SignIn {
        server_url: String,
        server_name: String,
        browser: BrowserLogin,
        /// Why we're back here: `SIGN_OUT_MESSAGES`.
        notice: Option<String>,
        password_reset: bool,
    },
}

pub struct AuthScreen {
    step: AuthStep,
    session: SessionState,
    registration: RegistrationMode,
    server_url: Entity<InputState>,
    server_name: Entity<InputState>,
    username: Entity<InputState>,
    password: Entity<InputState>,
    focus: FocusHandle,
    took_focus: bool,
}

impl EventEmitter<AuthEvent> for AuthScreen {}

impl AuthScreen {
    pub fn new(step: AuthStep, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            step,
            session: SessionState::SignedOut,
            registration: RegistrationMode::default(),
            server_url: text_state(window, cx, false),
            server_name: text_state(window, cx, false),
            username: text_state(window, cx, false),
            password: text_state(window, cx, true),
            focus: cx.focus_handle(),
            took_focus: false,
        }
    }

    pub fn set_step(&mut self, step: AuthStep, cx: &mut Context<Self>) {
        self.step = step;
        cx.notify();
    }

    /// Fills in the server URL field, for an app that remembers or was told one.
    pub fn set_server_url(&mut self, url: &str, window: &mut Window, cx: &mut Context<Self>) {
        let url = url.to_owned();
        self.server_url
            .update(cx, |field, cx| field.set_value(url, window, cx));
        cx.notify();
    }

    pub fn set_session(&mut self, session: SessionState, cx: &mut Context<Self>) {
        self.session = session;
        cx.notify();
    }

    /// `ServerInfo::registration`: "Register here" shows unless it's `Closed`.
    pub fn set_registration(&mut self, mode: RegistrationMode, cx: &mut Context<Self>) {
        self.registration = mode;
        cx.notify();
    }

    fn render_server_url(
        &self,
        testing: bool,
        error: Option<String>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem().clone();
        let view = cx.entity().downgrade();
        let (url_state, name_state) = (self.server_url.clone(), self.server_name.clone());
        let can_connect = !testing && !url_state.read(cx).value().trim().is_empty();
        card(
            sem.background_default,
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(spacing(2.))
                .child(text(Variant::H6, "Enter Server Details"))
                .child(
                    TextField::new("auth-server-url", &self.server_url, "Server URL")
                        .placeholder("https://chat.example.com")
                        .error(error.is_some() && !testing)
                        .helper(
                            error.clone().filter(|_| !testing).unwrap_or_else(|| {
                                "Enter the full URL including https://".to_owned()
                            }),
                        )
                        .surface(sem.background_default),
                )
                .child(
                    TextField::new(
                        "auth-server-name",
                        &self.server_name,
                        "Server Name (Optional)",
                    )
                    .placeholder("My Semaphore Chat Server")
                    .helper("A friendly name to identify this server")
                    .surface(sem.background_default),
                )
                .when(testing, |form| {
                    form.child(
                        div()
                            .id("auth-testing")
                            .test_support()
                            .role(Role::Status)
                            .flex()
                            .items_center()
                            .gap(spacing(1.))
                            .text_color(sem.text_secondary)
                            .child(Spinner::new("auth-testing-spinner").size(20.))
                            .child(text(Variant::Body2, "Testing connection...")),
                    )
                })
                .child(
                    Button::new("auth-connect", "Connect")
                        .contained()
                        .full_width()
                        .disabled(!can_connect)
                        .on_click(move |_, _, cx| {
                            let url = url_state.read(cx).value().trim().to_owned();
                            let name = name_state.read(cx).value().trim().to_owned();
                            view.update(cx, |_, cx| {
                                cx.emit(AuthEvent::ConnectServer {
                                    url,
                                    name: (!name.is_empty()).then_some(name),
                                });
                            })
                            .ok();
                        }),
                ),
        )
    }

    fn render_sign_in(
        &self,
        server_url: String,
        server_name: String,
        browser: BrowserLogin,
        notice: Option<String>,
        password_reset: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem().clone();
        let view = cx.entity().downgrade();
        let signing_in = matches!(self.session, SessionState::SigningIn);
        let failed = matches!(self.session, SessionState::SignInFailed { .. });
        let server_line = {
            let view = view.clone();
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .justify_center()
                .gap_x(px(4.))
                .text_color(sem.text_secondary)
                .child(text(Variant::Body2, "Server:"))
                .child(
                    text(Variant::Body2, server_name)
                        .font_weight(FontWeight(700.))
                        .truncate(),
                )
                .child(text(Variant::Body2, "·"))
                .child(link(
                    "auth-change-server",
                    "Change server",
                    cx,
                    move |_, cx| {
                        view.update(cx, |_, cx| cx.emit(AuthEvent::ChangeServer))
                            .ok();
                    },
                ))
        };

        let (username_state, password_state) = (self.username.clone(), self.password.clone());
        let submit = {
            let view = view.clone();
            let server_url = server_url.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                let username = username_state.read(cx).value().to_string();
                let password = password_state.read(cx).value().to_string();
                let server_url = server_url.clone();
                view.update(cx, |_, cx| {
                    cx.emit(AuthEvent::SignIn {
                        server_url,
                        username,
                        password,
                    });
                })
                .ok();
            }
        };
        let browser_available = browser != BrowserLogin::Unavailable;
        let login = Button::new("auth-login", "Login")
            .full_width()
            .loading(signing_in)
            .on_click(submit);
        let login = if browser_available {
            login.outlined()
        } else {
            login.contained()
        };
        let reset_view = view.clone();
        let register_view = view.clone();
        let can_register = self.registration != RegistrationMode::Closed;

        card(
            sem.background_default,
            div()
                .w_full()
                .flex()
                .flex_col()
                .items_center()
                .child(
                    div().mb(spacing(2.)).child(
                        Icon::new(IconName::LockOutlined)
                            .size(40.)
                            .color(rgb(0x1976d2).into()),
                    ),
                )
                .child(text(Variant::H5, "Login").mb(spacing(2.)))
                .when(failed, |form| {
                    form.child(div().w_full().mb(spacing(2.)).child(Alert::new(
                        Severity::Error,
                        "Login failed. Please try again.",
                    )))
                })
                .when_some(notice.filter(|_| !failed), |form, notice| {
                    form.child(
                        div()
                            .w_full()
                            .mb(spacing(2.))
                            .child(Alert::new(Severity::Info, notice)),
                    )
                })
                .child(div().mb(spacing(2.)).child(server_line))
                .when(browser_available, |form| {
                    let error = match browser {
                        BrowserLogin::Denied => {
                            Some((Severity::Info, "Sign-in was cancelled in the browser."))
                        }
                        BrowserLogin::TimedOut => Some((
                            Severity::Error,
                            "The browser didn't finish signing in in time. Try again.",
                        )),
                        BrowserLogin::Failed => Some((
                            Severity::Error,
                            "Couldn't sign in through the browser. Try again.",
                        )),
                        _ => None,
                    };
                    form.child(browser_panel(
                        browser,
                        error,
                        server_url.clone(),
                        view.clone(),
                        &sem,
                    ))
                    .child(or_divider(&sem))
                })
                .child(
                    div().w_full().mb(spacing(2.)).child(
                        TextField::new("auth-username", &self.username, "Username")
                            .required(true)
                            .surface(sem.background_default),
                    ),
                )
                .child(
                    div().w_full().mb(spacing(2.)).child(
                        TextField::new("auth-password", &self.password, "Password")
                            .required(true)
                            .surface(sem.background_default),
                    ),
                )
                .child(div().w_full().mb(spacing(2.)).child(login))
                .when(password_reset, |form| {
                    form.child(div().mb(spacing(1.)).child(link(
                        "auth-forgot",
                        "Forgot password?",
                        cx,
                        move |_, cx| {
                            reset_view
                                .update(cx, |_, cx| cx.emit(AuthEvent::ForgotPassword))
                                .ok();
                        },
                    )))
                })
                .when(can_register, |form| {
                    form.child(
                        div()
                            .flex()
                            .flex_wrap()
                            .justify_center()
                            .gap_x(px(4.))
                            .text_color(sem.text_secondary)
                            .child(text(Variant::Body2, "Don't have an account?"))
                            .child(link("auth-register", "Register here", cx, move |_, cx| {
                                register_view
                                    .update(cx, |_, cx| cx.emit(AuthEvent::Register))
                                    .ok();
                            })),
                    )
                }),
        )
    }
}

/// The login card: `boxShadow: 3` and the page's own colour. GPUI paints a shadow as a filled shape
/// under the element, so with CSS's "no fill" the card would show the shadow through it.
pub(super) fn card(surface: Hsla, child: impl IntoElement) -> Div {
    div()
        .w_full()
        .max_w(px(400.))
        .p(spacing(4.))
        .rounded(px(8.))
        .bg(surface)
        .shadow_lg()
        .child(child)
}

/// A link that emits `event` from the view it's drawn in.
pub(super) fn event_link<V, E>(
    id: &'static str,
    label: &'static str,
    event: E,
    cx: &mut Context<V>,
) -> AnyElement
where
    V: EventEmitter<E> + 'static,
    E: Clone + 'static,
{
    let view = cx.weak_entity();
    link(id, label, cx, move |_, cx| {
        view.update(cx, |_, cx| cx.emit(event.clone())).ok();
    })
    .into_any_element()
}

/// The auth screens' page: the default background, the card centred, scrolling when it's taller.
pub(super) fn page(
    id: &'static str,
    sem: &crate::theme::Sem,
    body: impl IntoElement,
) -> Stateful<Div> {
    div()
        .id(id)
        .size_full()
        .font_family(FONT_FAMILY)
        .text_color(sem.text_primary)
        .bg(sem.background_default)
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .items_center()
        .p(spacing(2.))
        .child(
            // Centred when it fits; from the top, scrolling, when it doesn't.
            div()
                .w_full()
                .flex_grow(1.)
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .child(body),
        )
}

fn or_divider(sem: &crate::theme::Sem) -> impl IntoElement + use<> {
    let line = || div().flex_1().h(px(1.)).bg(sem.divider);
    div()
        .w_full()
        .my(spacing(2.))
        .flex()
        .items_center()
        .gap(spacing(1.25))
        .text_color(sem.text_secondary)
        .child(line())
        .child(text(Variant::Body2, "or use your password"))
        .child(line())
}

fn browser_panel(
    browser: BrowserLogin,
    error: Option<(Severity, &'static str)>,
    server_url: String,
    view: WeakEntity<AuthScreen>,
    sem: &crate::theme::Sem,
) -> AnyElement {
    if matches!(browser, BrowserLogin::Waiting | BrowserLogin::Finishing) {
        let signing_in = browser == BrowserLogin::Finishing;
        return div()
            .id("auth-browser-status")
            .test_support()
            .role(Role::Status)
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .gap(spacing(1.5))
            .py(spacing(1.))
            .child(Spinner::new("auth-browser-spinner").size(28.))
            .child(text(
                Variant::Subtitle1,
                if signing_in {
                    "Signing you in…"
                } else {
                    "Waiting for your browser…"
                },
            ))
            .when(!signing_in, |panel| {
                panel
                    .child(
                        text(
                            Variant::Body2,
                            "Finish signing in in the browser window that opened, then come back here.",
                        )
                        .text_color(sem.text_secondary)
                        .text_center(),
                    )
                    .child(Button::new("auth-browser-cancel", "Cancel").on_click(
                        move |_, _, cx| {
                            view.update(cx, |_, cx| cx.emit(AuthEvent::CancelBrowserSignIn))
                                .ok();
                        },
                    ))
            })
            .into_any_element();
    }
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(spacing(1.))
        .children(error.map(|(severity, message)| Alert::new(severity, message)))
        .child(
            Button::new("auth-browser", "Sign in with browser")
                .contained()
                .size(ButtonSize::Large)
                .full_width()
                .start_icon(IconName::OpenInBrowser)
                .on_click(move |_, _, cx| {
                    let server_url = server_url.clone();
                    view.update(cx, |_, cx| {
                        cx.emit(AuthEvent::BrowserSignIn { server_url })
                    })
                    .ok();
                }),
        )
        .child(
            text(
                Variant::Body2,
                "Opens your browser, so you can use its password manager or the session you already have.",
            )
            .text_color(sem.text_secondary)
            .text_center(),
        )
        .into_any_element()
}

impl Render for AuthScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // The wizard's `autoFocus`; on the login screen the root, so Tab works from the start.
        if !self.took_focus {
            self.took_focus = true;
            match self.step {
                AuthStep::ServerUrl { .. } => {
                    self.server_url
                        .update(cx, |state, cx| state.focus(window, cx));
                }
                AuthStep::SignIn { .. } => window.focus(&self.focus, cx),
            }
        }
        let sem = cx.sem().clone();
        let body = match self.step.clone() {
            AuthStep::ServerUrl { testing, error } => self
                .render_server_url(testing, error, cx)
                .into_any_element(),
            AuthStep::SignIn {
                server_url,
                server_name,
                browser,
                notice,
                password_reset,
            } => self
                .render_sign_in(server_url, server_name, browser, notice, password_reset, cx)
                .into_any_element(),
        };
        div()
            .id("auth-screen")
            .track_focus(&self.focus)
            .size_full()
            .font_family(FONT_FAMILY)
            .text_color(sem.text_primary)
            .bg(sem.background_default)
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .p(spacing(2.))
            .child(body)
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    use crate::stories::Story;
    use semaphore_core::model::ErrorView;

    fn sign_in(browser: BrowserLogin, notice: Option<&str>) -> AuthStep {
        AuthStep::SignIn {
            server_url: "https://chat.example.com".into(),
            server_name: "Ladle".into(),
            browser,
            notice: notice.map(str::to_owned),
            password_reset: true,
        }
    }

    fn screen(step: AuthStep, session: SessionState, window: &mut Window, cx: &mut App) -> AnyView {
        cx.new(|cx| {
            let mut screen = AuthScreen::new(step, window, cx);
            screen.session = session;
            screen
        })
        .into()
    }

    vec![
        Story::new("auth-server-url", |_, window, cx| {
            screen(
                AuthStep::ServerUrl {
                    testing: false,
                    error: None,
                },
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-server-testing", |_, window, cx| {
            screen(
                AuthStep::ServerUrl {
                    testing: true,
                    error: None,
                },
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-server-error", |_, window, cx| {
            screen(
                AuthStep::ServerUrl {
                    testing: false,
                    error: Some(
                        "Could not connect to server. Please check the URL and try again.".into(),
                    ),
                },
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-sign-in", |_, window, cx| {
            screen(
                sign_in(BrowserLogin::Idle, None),
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-sign-in-password-only", |_, window, cx| {
            screen(
                sign_in(BrowserLogin::Unavailable, None),
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-signing-in", |_, window, cx| {
            screen(
                sign_in(BrowserLogin::Idle, None),
                SessionState::SigningIn,
                window,
                cx,
            )
        }),
        Story::new("auth-sign-in-failed", |_, window, cx| {
            screen(
                sign_in(BrowserLogin::Idle, None),
                SessionState::SignInFailed {
                    error: ErrorView {
                        code: "UNAUTHORIZED".into(),
                        message: "Bad credentials".into(),
                        retryable: false,
                        retry_after_ms: None,
                    },
                },
                window,
                cx,
            )
        }),
        Story::new("auth-signed-out-notice", |_, window, cx| {
            screen(
                sign_in(
                    BrowserLogin::Unavailable,
                    Some("Your password was changed. Please sign in again."),
                ),
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-browser-waiting", |_, window, cx| {
            screen(
                sign_in(BrowserLogin::Waiting, None),
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-browser-failed", |_, window, cx| {
            screen(
                sign_in(
                    BrowserLogin::from_view(
                        &semaphore_core::model::BrowserSignInView::Failed {
                            reason: semaphore_core::model::BrowserSignInFailure::ListenFailed {
                                message: "address in use".into(),
                            },
                        },
                        true,
                    ),
                    None,
                ),
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
        Story::new("auth-registration-closed", |_, window, cx| {
            cx.new(|cx| {
                let mut screen = AuthScreen::new(sign_in(BrowserLogin::Idle, None), window, cx);
                screen.registration = RegistrationMode::Closed;
                screen
            })
            .into()
        }),
        Story::new("auth-browser-timed-out", |_, window, cx| {
            screen(
                sign_in(BrowserLogin::TimedOut, None),
                SessionState::SignedOut,
                window,
                cx,
            )
        }),
    ]
    .into_iter()
    .chain(register::stories())
    .chain(forgot::stories())
    .chain(invite::stories())
    .collect()
}
