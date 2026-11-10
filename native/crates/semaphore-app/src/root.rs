//! The window's content: a splash while core starts, the sign-in screens while signed out, the shell
//! once signed in. It follows core's session, so a sign-out from anywhere, a refused session
//! included, comes back here.

use crate::AppConfig;
use crate::conversation::ConversationPane;
use crate::runtime::Activity;
use crate::services::{self, Services};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    ChannelKind, CommunityRow, LoadState, SessionState, SignOutReason, ViewKey,
};
use semaphore_core::{Core, CoreEvent};
use semaphore_ui::Shell;
use semaphore_ui::auth::{AuthEvent, AuthScreen, AuthStep, BrowserLogin};
use semaphore_ui::kit::{Button, Dialog, Spinner, Variant, emit_core_event, on_core_event, text};
use semaphore_ui::nav::Route;
use semaphore_ui::shell::{ContentProps, CoreSource, ShellEvent};
use semaphore_ui::theme::SemTheme as _;
use std::rc::Rc;
use std::sync::Arc;

/// What `SIGN_OUT_MESSAGES` says on the web when the server ended the session.
const EXPIRED_NOTICE: &str = "Your session has expired. Please sign in again.";

pub struct AppRoot {
    config: Rc<AppConfig>,
    activity: Arc<Activity>,
    services: Option<Services>,
    /// The server the sign-in step is for, once one answered.
    server: Option<(String, String)>,
    auth: Option<Entity<AuthScreen>>,
    shell: Option<Entity<Shell>>,
    pane: Option<Entity<ConversationPane>>,
    /// The session the screens were last built for.
    shown: Option<SessionState>,
    /// Signed-in sessions go to their first community once, as the web's last route would.
    landed: bool,
    account_open: bool,
    _subscriptions: Vec<Subscription>,
}

impl AppRoot {
    pub fn new(config: AppConfig, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let activity = Arc::new(Activity::default());
        let started = services::start(
            config.secrets.clone(),
            config.clock.clone(),
            activity.clone(),
        );
        // Core's events, a batch per wake, onto the bus every view listens to.
        let events = started.events;
        cx.spawn(async move |_, cx| {
            while let Ok(first) = events.recv().await {
                let mut batch = vec![first];
                while let Ok(event) = events.try_recv() {
                    batch.push(event);
                }
                cx.update(|cx| {
                    for event in &batch {
                        emit_core_event(event, cx);
                    }
                });
            }
        })
        .detach();
        let services = started.services;
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(services) = services.recv().await {
                this.update_in(cx, |this, window, cx| this.started(services, window, cx))
                    .ok();
            }
        })
        .detach();
        on_core_event(cx.entity().downgrade(), Self::on_core, cx);
        let activation = cx.observe_window_activation(window, |this, window, cx| {
            let active = window.is_window_active();
            if let Some(core) = this.core() {
                core.set_focused(active);
            }
            if let Some(pane) = &this.pane {
                pane.update(cx, |pane, cx| pane.set_focused(active, cx));
            }
        });
        Self {
            config: Rc::new(config),
            activity,
            services: None,
            server: None,
            auth: None,
            shell: None,
            pane: None,
            shown: None,
            landed: false,
            account_open: false,
            _subscriptions: vec![activation],
        }
    }

    pub fn core(&self) -> Option<Arc<Core>> {
        self.services.as_ref().map(|services| services.core.clone())
    }

    /// Moves whenever an event or a command result arrives, for the headless rig.
    pub fn activity(&self) -> Arc<Activity> {
        self.activity.clone()
    }

    pub fn pane(&self) -> Option<&Entity<ConversationPane>> {
        self.pane.as_ref()
    }

    pub fn shell(&self) -> Option<&Entity<Shell>> {
        self.shell.as_ref()
    }

    /// Ends core and the socket. The stored session stays.
    pub fn shutdown(&mut self) {
        if let Some(services) = &mut self.services {
            services.shutdown();
        }
    }

    fn started(&mut self, services: Services, window: &mut Window, cx: &mut Context<Self>) {
        let core = services.core.clone();
        let pane = cx.new(|cx| {
            ConversationPane::new(
                core,
                services.exec.clone(),
                self.config.time,
                self.config.scrollbar,
                window,
                cx,
            )
        });
        self.pane = Some(pane);
        self.services = Some(services);
        cx.notify();
    }

    fn on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ViewChanged {
                view: ViewKey::Session,
            } => cx.notify(),
            CoreEvent::ViewChanged {
                view: ViewKey::Communities,
            } => self.land(cx),
            _ => {}
        }
    }

    /// After sign-in, the first community instead of an empty home.
    fn land(&mut self, cx: &mut Context<Self>) {
        if self.landed {
            return;
        }
        let (Some(core), Some(shell)) = (self.core(), self.shell.clone()) else {
            return;
        };
        if core.load_state(ViewKey::Communities) != LoadState::Ready {
            return;
        }
        let first: Option<CommunityRow> = core.communities().into_iter().next();
        self.landed = true;
        if let Some(first) = first
            && *shell.read(cx).nav().current() == Route::Home
        {
            shell.update(cx, |shell, cx| {
                shell.navigate(
                    Route::Community {
                        community_id: first.id,
                    },
                    cx,
                )
            });
        }
    }

    /// Builds or updates the screens for the session core has now.
    fn reconcile(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let session = core.session();
        if self.shown.as_ref() == Some(&session) {
            return;
        }
        self.shown = Some(session.clone());
        match &session {
            SessionState::SignedIn { .. } => {
                self.auth = None;
                if self.shell.is_none() {
                    self.shell = Some(self.build_shell(core.clone(), window, cx));
                    self.landed = false;
                    self.land(cx);
                }
            }
            SessionState::SignedOut
            | SessionState::SignInFailed { .. }
            | SessionState::SigningIn => {
                self.shell = None;
                self.account_open = false;
                let notice = (matches!(session, SessionState::SignedOut)
                    && core.last_sign_out() == Some(SignOutReason::Expired))
                .then(|| EXPIRED_NOTICE.to_owned());
                let auth = match &self.auth {
                    Some(auth) => auth.clone(),
                    None => self.build_auth(window, cx),
                };
                if notice.is_some()
                    && let Some((url, name)) = self.server.clone()
                {
                    auth.update(cx, |auth, cx| {
                        auth.set_step(sign_in_step(url, name, notice), cx)
                    });
                }
                auth.update(cx, |auth, cx| auth.set_session(session.clone(), cx));
                self.auth = Some(auth);
            }
        }
    }

    fn build_auth(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<AuthScreen> {
        let step = match self.server.clone() {
            Some((url, name)) => sign_in_step(url, name, None),
            None => AuthStep::ServerUrl {
                testing: false,
                error: None,
            },
        };
        let prefill = self.config.server_url.clone();
        let auth = cx.new(|cx| {
            let mut auth = AuthScreen::new(step, window, cx);
            if let Some(url) = &prefill {
                auth.set_server_url(url, window, cx);
            }
            auth
        });
        self._subscriptions
            .push(cx.subscribe_in(&auth, window, Self::on_auth_event));
        auth
    }

    fn on_auth_event(
        &mut self,
        auth: &Entity<AuthScreen>,
        event: &AuthEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(services) = &self.services else {
            return;
        };
        let (core, exec) = (services.core.clone(), services.exec.clone());
        match event.clone() {
            AuthEvent::ConnectServer { url, name } => {
                auth.update(cx, |auth, cx| {
                    auth.set_step(
                        AuthStep::ServerUrl {
                            testing: true,
                            error: None,
                        },
                        cx,
                    )
                });
                let auth = auth.downgrade();
                exec.run(
                    window,
                    cx,
                    async move { core.probe_server(url).await },
                    move |this, result, _, cx| {
                        let step = match result {
                            Ok(info) => {
                                let shown = name
                                    .filter(|name| !name.trim().is_empty())
                                    .or(info.name)
                                    .unwrap_or_else(|| info.url.clone());
                                this.server = Some((info.url.clone(), shown.clone()));
                                sign_in_step(info.url, shown, None)
                            }
                            Err(error) => AuthStep::ServerUrl {
                                testing: false,
                                error: Some(format!("Couldn't reach that server: {error}")),
                            },
                        };
                        auth.update(cx, |auth, cx| auth.set_step(step, cx)).ok();
                    },
                );
            }
            AuthEvent::SignIn {
                server_url,
                username,
                password,
            } => exec.fire(async move {
                if let Err(error) = core.sign_in(server_url, username, password).await {
                    log::warn!("signing in: {error}");
                }
            }),
            AuthEvent::ChangeServer => {
                self.server = None;
                auth.update(cx, |auth, cx| {
                    auth.set_step(
                        AuthStep::ServerUrl {
                            testing: false,
                            error: None,
                        },
                        cx,
                    )
                });
            }
            // The web client does these; send the user there.
            AuthEvent::Register | AuthEvent::ForgotPassword => {
                if let Some((url, _)) = &self.server {
                    cx.open_url(url);
                }
            }
            AuthEvent::BrowserSignIn { .. } | AuthEvent::CancelBrowserSignIn => {
                log::info!("browser sign-in needs the client-type backend: a follow-up");
            }
        }
    }

    fn build_shell(
        &mut self,
        core: Arc<Core>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<Shell> {
        let pane = self.pane.clone().expect("the pane exists once core does");
        let content = Rc::new(
            move |props: &ContentProps, window: &mut Window, cx: &mut App| {
                content(&pane, props, window, cx)
            },
        );
        let connection = core.connection();
        let shell = cx.new(|cx| {
            Shell::new(
                Rc::new(CoreSource(core.clone())),
                Route::Home,
                content,
                connection,
                cx,
            )
        });
        self._subscriptions
            .push(cx.subscribe_in(&shell, window, Self::on_shell_event));
        shell
    }

    fn on_shell_event(
        &mut self,
        _: &Entity<Shell>,
        event: &ShellEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event {
            ShellEvent::Retry => core.retry_failed(),
            ShellEvent::OpenAccountMenu => {
                self.account_open = true;
                cx.notify();
            }
            ShellEvent::Navigated(_) => {}
            ShellEvent::JoinVoice { channel_id } => {
                log::info!("joining voice in {channel_id}: voice is phase 2");
            }
            other => log::info!("{other:?}: not in this build yet"),
        }
    }

    fn sign_out(&mut self, cx: &mut Context<Self>) {
        self.account_open = false;
        if let Some(services) = &self.services {
            let core = services.core.clone();
            services.exec.fire(async move {
                if let Err(error) = core.sign_out().await {
                    log::warn!("signing out: {error}");
                }
            });
        }
        cx.notify();
    }

    fn account_dialog(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let name = match self.core().map(|core| core.session()) {
            Some(SessionState::SignedIn { me }) => me
                .display_name
                .filter(|name| !name.is_empty())
                .unwrap_or(me.username),
            _ => String::new(),
        };
        let close = cx.entity().downgrade();
        let cancel = close.clone();
        let sign_out = close.clone();
        Dialog::new(format!("Signed in as {name}"))
            .body(text(
                Variant::Body2,
                "Signing out forgets this session on this computer.",
            ))
            .action(
                Button::new("account-cancel", "Cancel").on_click(move |_, _, cx| {
                    cancel
                        .update(cx, |this, cx| {
                            this.account_open = false;
                            cx.notify();
                        })
                        .ok();
                }),
            )
            .action(
                Button::new("account-sign-out", "Sign out")
                    .contained()
                    .on_click(move |_, _, cx| {
                        sign_out.update(cx, |this, cx| this.sign_out(cx)).ok();
                    }),
            )
            .on_close(move |_, cx| {
                close
                    .update(cx, |this, cx| {
                        this.account_open = false;
                        cx.notify();
                    })
                    .ok();
            })
    }
}

fn sign_in_step(server_url: String, server_name: String, notice: Option<String>) -> AuthStep {
    AuthStep::SignIn {
        server_url,
        server_name,
        browser: BrowserLogin::Unavailable,
        notice,
        password_reset: false,
    }
}

/// The middle column for a route.
fn content(
    pane: &Entity<ConversationPane>,
    props: &ContentProps,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let sem = cx.sem().clone();
    let placeholder = |title: String, body: &'static str| {
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .text_color(sem.text_secondary)
            .child(text(Variant::H5, title))
            .child(text(Variant::Body1, body))
            .into_any_element()
    };
    match (&props.route, &props.channel) {
        (_, Some(channel)) if channel.kind == ChannelKind::Text => {
            let conversation = props.route.conversation();
            if let Some(conversation) = conversation {
                let community = props.route.community_id().map(str::to_owned);
                let channel = Some(channel.clone());
                pane.update(cx, |pane, cx| {
                    pane.show(conversation, community, channel, window, cx)
                });
            }
            pane.clone().into_any_element()
        }
        (_, Some(channel)) => placeholder(
            channel.name.clone(),
            "Voice channels arrive in the next build.",
        ),
        (Route::DirectMessages | Route::DirectMessage { .. }, _) => placeholder(
            "Direct messages".into(),
            "Direct messages arrive in a later build.",
        ),
        (route, None) if route.community_id().is_some() => match &props.community {
            Some(community) => placeholder(
                format!("Welcome to {}", community.name),
                "Select a channel from the sidebar to get started",
            ),
            None => placeholder("Loading".into(), ""),
        },
        _ => placeholder("Home".into(), "Pick a community from the rail."),
    }
}

impl Render for AppRoot {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.reconcile(window, cx);
        let sem = cx.sem().clone();
        let root = div()
            .id("app-root")
            .size_full()
            .relative()
            .bg(sem.background_default)
            .text_color(sem.text_primary);
        if let Some(shell) = &self.shell {
            return root.child(shell.clone()).when(self.account_open, |root| {
                root.child(self.account_dialog(cx))
            });
        }
        if let Some(auth) = &self.auth {
            return root.child(auth.clone());
        }
        root.flex()
            .items_center()
            .justify_center()
            .child(Spinner::new("app-starting"))
    }
}
