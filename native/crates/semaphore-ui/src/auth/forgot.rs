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

/// What a pasted reset link or token comes to, checked against the server this app uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PastedReset {
    /// A token to redeem on this app's server: a bare token, a `semaphore://reset-password` link
    /// (neither names a server; the reset card says where it posts), or a web link from this
    /// server.
    Token(String),
    /// A web link from another server. Its token is never sent to this one.
    WrongServer { link: String, server: String },
    /// A web link, but this app has no server to compare it with.
    NoServer,
    /// Not a reset link or token.
    NotALink,
}

/// A web origin: scheme, host and port, with the scheme's default port filled in. Compared whole:
/// `https://chat.example.com` and `https://chat.example.com:443/x` are the same origin;
/// `http://` and another port are not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    scheme: String,
    host: String,
    port: u16,
}

impl Origin {
    /// The origin of an `http` or `https` URL. `None` for any other scheme, and for an authority
    /// a reset link never has (credentials, a backslash, an escape, a bad port or host).
    pub fn parse(url: &str) -> Option<Self> {
        let (scheme, rest) = url.trim().split_once("://")?;
        let scheme = scheme.to_ascii_lowercase();
        let default = match scheme.as_str() {
            "https" => 443,
            "http" => 80,
            _ => return None,
        };
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        if authority.is_empty() || authority.contains(['@', '\\', '%']) {
            return None;
        }
        let (host, port) = if let Some(bracketed) = authority.strip_prefix('[') {
            let (address, after) = bracketed.split_once(']')?;
            if address.is_empty()
                || !address
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() || matches!(c, ':' | '.'))
            {
                return None;
            }
            let port = match after {
                "" => None,
                after => Some(after.strip_prefix(':')?),
            };
            (format!("[{}]", address.to_ascii_lowercase()), port)
        } else {
            let (host, port) = match authority.split_once(':') {
                Some((host, port)) => (host, Some(port)),
                None => (authority, None),
            };
            let host = host.strip_suffix('.').unwrap_or(host).to_lowercase();
            if host.is_empty()
                || !host
                    .chars()
                    .all(|c| c.is_alphanumeric() || matches!(c, '-' | '.' | '_'))
            {
                return None;
            }
            (host, port)
        };
        let port = match port {
            None | Some("") => default,
            Some(port) if port.bytes().all(|b| b.is_ascii_digit()) && port.len() <= 5 => {
                port.parse().ok()?
            }
            Some(_) => return None,
        };
        Some(Self { scheme, host, port })
    }

    /// The host as a person reads it: with the port only when it isn't the scheme's default.
    pub fn display_host(&self) -> String {
        let default = if self.scheme == "https" { 443 } else { 80 };
        if self.port == default {
            self.host.clone()
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

/// The host to name on the reset card for the app's server URL, or the URL as it is when it
/// won't parse (it was accepted as the server, so it is still what the app talks to).
pub fn server_host(server_url: &str) -> String {
    Origin::parse(server_url).map_or_else(
        || server_url.trim().to_owned(),
        |origin| origin.display_host(),
    )
}

/// A pasted reset link or token, checked against `server_url` (the server this app uses).
///
/// - The mail's web link: `${PUBLIC_APP_URL}/reset-password?token=...`, where the app may be served
///   under a path (`https://host/chat/reset-password?...`) or with a hash route
///   (`https://host/#/reset-password?...`). Its origin must be the server's, or the token never
///   leaves: the server would otherwise receive another server's token and the new password.
/// - `semaphore://reset-password?token=...`, and a bare token: they name no server.
pub fn reset_from_input(input: &str, server_url: Option<&str>) -> PastedReset {
    let input = input.trim();
    if input.is_empty() {
        return PastedReset::NotALink;
    }
    let raw = if let Some((scheme, _)) = input.split_once("://") {
        if scheme.eq_ignore_ascii_case("semaphore") {
            return match crate::nav::parse_deep_link(input) {
                Some(crate::nav::DeepLink::ResetPassword { token: Some(token) }) => {
                    valid_token(&token).map_or(PastedReset::NotALink, PastedReset::Token)
                }
                _ => PastedReset::NotALink,
            };
        }
        let Some(origin) = Origin::parse(input) else {
            return PastedReset::NotALink;
        };
        let Some(raw) = web_link_token(input) else {
            return PastedReset::NotALink;
        };
        let Some(server) = server_url.and_then(Origin::parse) else {
            return PastedReset::NoServer;
        };
        if origin != server {
            let (mut link, mut server_name) = (origin.display_host(), server.display_host());
            if link == server_name {
                // Only the scheme differs: say so, or the message names one host twice.
                link = format!("{}://{link}", origin.scheme);
                server_name = format!("{}://{server_name}", server.scheme);
            }
            return PastedReset::WrongServer {
                link,
                server: server_name,
            };
        }
        raw
    } else {
        input
    };
    percent_decode(raw)
        .and_then(|token| valid_token(&token))
        .map_or(PastedReset::NotALink, PastedReset::Token)
}

/// The raw `token` of a web reset link: from the query of a path ending `/reset-password`, or of a
/// hash route `#/reset-password?...`.
fn web_link_token(url: &str) -> Option<&str> {
    let (_, rest) = url.split_once("://")?;
    let after_authority = rest.find(['/', '?', '#']).map_or("", |at| &rest[at..]);
    let (before_fragment, fragment) = match after_authority.split_once('#') {
        Some((before, fragment)) => (before, Some(fragment)),
        None => (after_authority, None),
    };
    [Some(before_fragment), fragment]
        .into_iter()
        .flatten()
        .find_map(|part| {
            let (path, query) = part.split_once('?')?;
            let last = path.trim_end_matches('/').rsplit('/').next()?;
            if last != "reset-password" {
                return None;
            }
            query
                .split('&')
                .find_map(|pair| pair.strip_prefix("token="))
        })
}

/// A token as the server issues it: printable ASCII, no URL syntax, 1 to 128 characters.
fn valid_token(token: &str) -> Option<String> {
    let length = token.chars().count();
    (length > 0
        && length <= 128
        && !token.contains(['/', '\\', '?', '#', '&', '='])
        && token.chars().all(|c| c.is_ascii_graphic()))
    .then(|| token.to_owned())
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

/// Why a link from another server is refused, naming both.
pub fn wrong_server_message(link: &str, server: &str) -> String {
    format!(
        "This reset link is for {link}, but this app is using {server}. Switch the app to {link} first, or open the link in a browser."
    )
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
    /// The server this app uses, which a pasted web link must come from.
    server_url: Option<String>,
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
            server_url: None,
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

    /// Why the pasted link was refused, under its field.
    pub fn link_error(&self) -> Option<&str> {
        self.link_error.as_deref()
    }

    /// The server this app uses: a pasted web reset link must come from it. Without one, a web
    /// link is refused (a bare token still works; the reset card names where it posts).
    pub fn set_server_url(&mut self, server_url: Option<String>, cx: &mut Context<Self>) {
        self.server_url = server_url;
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
        match reset_from_input(&pasted, self.server_url.as_deref()) {
            PastedReset::Token(token) => {
                self.link_error = None;
                cx.emit(ForgotEvent::OpenReset { token });
            }
            PastedReset::WrongServer { link, server } => {
                self.link_error = Some(wrong_server_message(&link, &server));
            }
            PastedReset::NoServer => {
                self.link_error = Some(
                    "Couldn't tell which server this app uses, so the link can't be checked."
                        .into(),
                );
            }
            PastedReset::NotALink => {
                self.link_error = Some("That doesn't look like a reset link.".into());
            }
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
        Story::new("auth-forgot-sent-other-server", |_, window, cx| {
            screen(window, cx, |screen, _, cx| {
                screen.set_sent(true, cx);
                screen.link_error =
                    Some(wrong_server_message("chat.example.org", "chat.example.com"));
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
