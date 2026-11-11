//! W3's signed-out wiring: registering, a forgotten password, an invite's page, and signing in
//! with the browser.
//!
//! - **Pages.** The sign-in screen (`AuthScreen`) is the default; "Register here", "Forgot
//!   password?" and an invite link swap in `RegisterScreen`, `ForgotPasswordScreen` and
//!   `InviteScreen`, whose Back returns to it. Registering signs in, and the session takes over.
//! - **The server** is asked what it offers each time the sign-in screen shows for it (a remembered
//!   server after a restart, or a sign-out): who may register, password reset, browser sign-in.
//! - **Browser sign-in.** `Core::start_browser_sign_in` listens on `DesktopLoopback` (handed to
//!   core at start) and returns the instance's `/#/desktop-login` URL, which opens in the browser
//!   (`crate::open_url`; the rig records it and plays the browser). `ViewKey::BrowserSignIn`
//!   drives the button's state; success arrives as the session.
//! - **Invite links** (`semaphore://invite/CODE`) signed out open the invite's page; signed in,
//!   `Route::Invite` shows it with the signed-in message.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{SessionState, ViewKey};
use semaphore_core::platform::CoreError;
use semaphore_ui::auth::{
    AuthStep, BrowserLogin, ForgotEvent, ForgotPasswordScreen, InviteEvent, InviteScreen,
    RegisterEvent, RegisterScreen,
};
use semaphore_ui::nav::Route;

/// What the signed-out side shows.
#[derive(Default, Clone)]
pub(super) enum Page {
    #[default]
    SignIn,
    Register(Entity<RegisterScreen>),
    Forgot(Entity<ForgotPasswordScreen>),
    Invite {
        code: String,
        screen: Entity<InviteScreen>,
    },
}

#[derive(Default)]
pub(super) struct Onboarding {
    pub(super) page: Page,
    /// Signed in, on `Route::Invite`: the invite's page, with the signed-in message.
    signed_in_invite: Option<(String, Entity<InviteScreen>)>,
    subscriptions: Vec<Subscription>,
}

fn message(error: &CoreError) -> String {
    match error {
        CoreError::Failed { message } => message.clone(),
        CoreError::Unavailable { what } => format!("not available: {what}"),
    }
}

impl AppRoot {
    /// The sign-in step for this server, with what it offers.
    pub(super) fn sign_in_step(
        &self,
        server_url: String,
        server_name: String,
        notice: Option<String>,
    ) -> AuthStep {
        let info = self
            .server_info
            .as_ref()
            .filter(|info| info.url == server_url);
        let browser = match (info, self.core()) {
            (Some(info), Some(core)) => {
                BrowserLogin::from_view(&core.browser_sign_in(), info.browser_sign_in)
            }
            _ => BrowserLogin::Unavailable,
        };
        AuthStep::SignIn {
            server_url,
            server_name,
            browser,
            notice,
            password_reset: info.is_some_and(|info| info.password_reset),
        }
    }

    /// The sign-in screen again for the server it's on, keeping its notice.
    pub(super) fn refresh_sign_in_step(&mut self, cx: &mut Context<Self>) {
        let Some(auth) = self.auth.clone() else {
            return;
        };
        let AuthStep::SignIn {
            server_url,
            server_name,
            notice,
            ..
        } = auth.read(cx).step().clone()
        else {
            return;
        };
        let registration = self
            .server_info
            .as_ref()
            .filter(|info| info.url == server_url)
            .map(|info| info.registration);
        let step = self.sign_in_step(server_url, server_name, notice);
        auth.update(cx, |auth, cx| {
            auth.set_step(step, cx);
            if let Some(mode) = registration {
                auth.set_registration(mode, cx);
            }
        });
    }

    /// Asks a remembered server what it offers, once, for the sign-in screen.
    pub(super) fn probe_for_sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some((url, _)), Some(services)) = (self.server.clone(), &self.services) else {
            return;
        };
        // Asked on each sign-out: what a server offers can change while signed in.
        if !matches!(
            services.core.session(),
            SessionState::SignedOut | SessionState::SignInFailed { .. }
        ) {
            return;
        }
        let core = services.core.clone();
        services.exec.run(
            window,
            cx,
            async move { core.probe_server(url).await },
            |this, result, _, cx| match result {
                Ok(info) => {
                    this.server_info = Some(info);
                    this.refresh_sign_in_step(cx);
                }
                Err(error) => log::info!("asking the server what it offers: {error}"),
            },
        );
    }

    pub(super) fn onboarding_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ViewChanged {
                view: ViewKey::BrowserSignIn,
            } => self.refresh_sign_in_step(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::InvitePreview { code },
            } => self.refresh_invite(code, cx),
            _ => {}
        }
    }

    /// The signed-out page to draw instead of the sign-in screen, if any.
    pub(super) fn onboarding_page(&self) -> Option<AnyElement> {
        match &self.onboarding.page {
            Page::SignIn => None,
            Page::Register(screen) => Some(screen.clone().into_any_element()),
            Page::Forgot(screen) => Some(screen.clone().into_any_element()),
            Page::Invite { screen, .. } => Some(screen.clone().into_any_element()),
        }
    }

    /// Signed in: the signed-out pages go.
    pub(super) fn drop_onboarding_pages(&mut self) {
        self.onboarding.page = Page::SignIn;
    }

    fn show_page(&mut self, page: Page, cx: &mut Context<Self>) {
        self.onboarding.page = page;
        cx.notify();
    }

    // ---- Register. ----

    pub(super) fn open_register(
        &mut self,
        invite_code: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let screen = cx.new(|cx| RegisterScreen::new(window, cx));
        let (url, name) = self.server.clone().unzip();
        let mode = self
            .server_info
            .as_ref()
            .map(|info| info.registration)
            .unwrap_or_default();
        screen.update(cx, |screen, cx| {
            screen.set_mode(mode, cx);
            if let Some(url) = url {
                screen.set_server(url, name, cx);
            }
            if let Some(code) = invite_code {
                screen.set_invite_code(code, window, cx);
            }
        });
        self.onboarding
            .subscriptions
            .push(cx.subscribe_in(&screen, window, Self::on_register));
        self.show_page(Page::Register(screen), cx);
    }

    fn on_register(
        &mut self,
        screen: &Entity<RegisterScreen>,
        event: &RegisterEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            RegisterEvent::Submit(form) => {
                let (Some(core), Some(exec)) = (
                    self.core(),
                    self.services.as_ref().map(|services| services.exec.clone()),
                ) else {
                    return;
                };
                screen.update(cx, |screen, cx| {
                    screen.set_error(None, cx);
                    screen.set_busy(true, cx);
                });
                let screen = screen.downgrade();
                exec.run(
                    window,
                    cx,
                    async move { core.register(form).await },
                    move |_, result, _, cx| {
                        // Registered: signed in, and the session takes the screens over.
                        if let Err(error) = result {
                            screen
                                .update(cx, |screen, cx| {
                                    screen.set_busy(false, cx);
                                    screen.set_error(Some(message(&error)), cx);
                                })
                                .ok();
                        }
                    },
                );
            }
            RegisterEvent::SignIn => self.show_page(Page::SignIn, cx),
            RegisterEvent::ChangeServer => {
                self.show_page(Page::SignIn, cx);
                if let Some(auth) = self.auth.clone() {
                    self.on_auth_event(
                        &auth,
                        &semaphore_ui::auth::AuthEvent::ChangeServer,
                        window,
                        cx,
                    );
                }
            }
        }
    }

    // ---- A forgotten password. ----

    pub(super) fn open_forgot_password(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let screen = cx.new(|cx| ForgotPasswordScreen::new(window, cx));
        self.onboarding
            .subscriptions
            .push(cx.subscribe_in(&screen, window, Self::on_forgot));
        self.show_page(Page::Forgot(screen), cx);
    }

    fn on_forgot(
        &mut self,
        screen: &Entity<ForgotPasswordScreen>,
        event: &ForgotEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            ForgotEvent::Submit { email } => {
                let (Some(core), Some(exec)) = (
                    self.core(),
                    self.services.as_ref().map(|services| services.exec.clone()),
                ) else {
                    return;
                };
                screen.update(cx, |screen, cx| {
                    screen.set_error(None, cx);
                    screen.set_busy(true, cx);
                });
                let screen = screen.downgrade();
                exec.run(
                    window,
                    cx,
                    async move { core.forgot_password(email).await },
                    move |_, result, _, cx| {
                        screen
                            .update(cx, |screen, cx| {
                                screen.set_busy(false, cx);
                                match result {
                                    Ok(()) => screen.set_sent(true, cx),
                                    Err(error) => screen.set_error(Some(message(&error)), cx),
                                }
                            })
                            .ok();
                    },
                );
            }
            ForgotEvent::Back => self.show_page(Page::SignIn, cx),
        }
    }

    // ---- Invites. ----

    /// An invite's page while signed out.
    pub(super) fn open_invite(&mut self, code: String, window: &mut Window, cx: &mut Context<Self>) {
        let screen = cx.new(InviteScreen::new);
        self.onboarding
            .subscriptions
            .push(cx.subscribe_in(&screen, window, Self::on_invite));
        self.onboarding.page = Page::Invite {
            code: code.clone(),
            screen,
        };
        self.refresh_invite(&code, cx);
        cx.notify();
    }

    /// Signed in, on `Route::Invite`: the same page, saying so.
    pub(super) fn signed_in_invite(
        &mut self,
        code: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self
            .onboarding
            .signed_in_invite
            .as_ref()
            .is_none_or(|(shown, _)| shown != code)
        {
            let screen = cx.new(|cx| {
                let mut screen = InviteScreen::new(cx);
                screen.set_signed_in(true, cx);
                screen
            });
            self.onboarding
                .subscriptions
                .push(cx.subscribe_in(&screen, window, Self::on_invite));
            self.onboarding.signed_in_invite = Some((code.to_owned(), screen));
        }
        self.refresh_invite(code, cx);
    }

    pub(super) fn signed_in_invite_element(&self, code: &str) -> Option<AnyElement> {
        self.onboarding
            .signed_in_invite
            .as_ref()
            .filter(|(shown, _)| shown == code)
            .map(|(_, screen)| screen.clone().into_any_element())
    }

    fn refresh_invite(&mut self, code: &str, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let mut screens = Vec::new();
        if let Page::Invite { code: shown, screen } = &self.onboarding.page
            && shown == code
        {
            screens.push(screen.clone());
        }
        if let Some((shown, screen)) = &self.onboarding.signed_in_invite
            && shown == code
        {
            screens.push(screen.clone());
        }
        for screen in screens {
            let view = core.invite_preview(code.to_owned());
            screen.update(cx, |screen, cx| screen.set_view(view, cx));
        }
    }

    fn on_invite(
        &mut self,
        _: &Entity<InviteScreen>,
        event: &InviteEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            InviteEvent::Accept { code } => self.open_register(Some(code), window, cx),
            InviteEvent::SignIn => self.show_page(Page::SignIn, cx),
            InviteEvent::Retry => {
                if let Some(core) = self.core() {
                    core.retry_failed();
                }
            }
            InviteEvent::Close => {
                if let Some(shell) = self.shell.clone() {
                    shell.update(cx, |shell, cx| shell.go_back(cx));
                }
            }
        }
    }

    /// An invite link: its page now if signed out on a known server, `Route::Invite` signed in.
    /// True if it was handled here.
    pub(super) fn route_invite_link(
        &mut self,
        code: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let signed_out = self
            .core()
            .is_some_and(|core| !matches!(core.session(), SessionState::SignedIn { .. }));
        if signed_out && self.server.is_some() && self.auth.is_some() {
            self.open_invite(code.to_owned(), window, cx);
            return true;
        }
        if self.shell.is_some() {
            self.shell_navigate(
                Route::Invite {
                    invite_code: code.to_owned(),
                },
                cx,
            );
            return true;
        }
        false
    }

    // ---- Browser sign-in. ----

    pub(super) fn start_browser_sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        exec.run(
            window,
            cx,
            async move { core.start_browser_sign_in().await },
            |this, result, _, cx| {
                match result {
                    // The instance's page, in the system's browser.
                    Ok(url) => crate::open_url(&url, cx),
                    Err(error) => log::warn!("signing in with the browser: {error}"),
                }
                this.refresh_sign_in_step(cx);
            },
        );
    }
}
