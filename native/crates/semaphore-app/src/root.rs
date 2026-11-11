//! The window's content: a splash while core starts, the sign-in screens while signed out, the shell
//! once signed in. It follows core's session, so a sign-out from anywhere, a refused session
//! included, comes back here.

use crate::AppConfig;
use crate::conversation::{ConversationPane, PaneEvent};
use crate::files::{self, AppMedia, PreviewFetcher};
use crate::runtime::Activity;
use crate::services::{self, Services, StartOptions};
use crate::settings::{SHARE_FPS, SettingsStore, ShareSettings, ShareSize};
use crate::voice::{AppVoice, VoiceRequest};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AttachmentKind, AttachmentView};
use semaphore_core::model::{
    ChannelKind, CommunityRow, ErrorView, LoadState, RestoreOutcome, SessionState, SignOutReason,
    ViewKey,
};
use semaphore_core::platform::CaptureKind;
use semaphore_core::{Core, CoreEvent};
use semaphore_platform_desktop::lifecycle::{self, OsEvent, OsWatcher};
use semaphore_ui::Shell;
use semaphore_ui::auth::{AuthEvent, AuthScreen, AuthStep, BrowserLogin};
use semaphore_ui::kit::{
    Button, Dialog, Menu, MenuItem, Radio, Spinner, Switch, Variant, emit_core_event,
    on_core_event, text,
};
use semaphore_ui::messages::{LruImageCache, MediaRef};
use semaphore_ui::nav::Route;
use semaphore_ui::shell::{ContentProps, CoreSource, ShellEvent};
use semaphore_ui::theme::SemTheme as _;
use semaphore_ui::voice::{
    PickerActions, PickerModel, PickerSource, QualityLevel, VideoFrames, VoiceController,
    VoiceStage, VoiceStageModel, source_picker, voice_bar_element,
};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::Mutex;

/// What `SIGN_OUT_MESSAGES` says on the web when the server ended the session.
const EXPIRED_NOTICE: &str = "Your session has expired. Please sign in again.";

/// Resuming the session stored at the last run.
#[derive(Debug, Clone, PartialEq)]
enum Restore {
    /// Nothing to resume, or done.
    Idle,
    Running,
    /// The server didn't answer. The stored session is kept for another try.
    Unreachable {
        url: String,
        error: ErrorView,
    },
}

/// What the sign-in screen calls a server it hasn't asked the name of: its host.
fn server_label(url: &str) -> String {
    let host = url.split("://").nth(1).unwrap_or(url);
    host.split('/').next().unwrap_or(host).to_owned()
}

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
    restore: Restore,
    /// The server the last-server file names, once written for this session.
    remembered: Option<String>,
    os_watcher: Option<OsWatcher>,
    voice: Option<Arc<AppVoice>>,
    stage: Option<Entity<VoiceStage>>,
    /// The voice channel's name, from when it was joined.
    voice_channel_name: String,
    devices_open: bool,
    /// The narrow bar's "more" sheet.
    more_open: bool,
    /// Our screen picker, while it's open.
    picker: Option<PickerModel>,
    /// The settings, as changed in this run; saved on each change.
    settings: SettingsStore,
    media: Option<Rc<AppMedia>>,
    /// An image open in the viewer, and the decodes it draws from.
    viewer: Option<AttachmentView>,
    viewer_focus: FocusHandle,
    images: Option<Entity<LruImageCache>>,
    _subscriptions: Vec<Subscription>,
}

impl AppRoot {
    pub fn new(config: AppConfig, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let activity = Arc::new(Activity::default());
        let started = services::start(
            StartOptions {
                secrets: config.secrets.clone(),
                clock: config.clock.clone(),
                data_dir: config.data_dir.clone(),
                audio: config.audio.clone(),
                heartbeat: config.heartbeat,
                video_sources: config.video_sources.clone(),
                screen_capture: config.screen_capture.clone(),
            },
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
        let settings = config.settings.clone();
        Self {
            settings,
            more_open: false,
            picker: None,
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
            restore: Restore::Idle,
            remembered: None,
            os_watcher: None,
            voice: None,
            stage: None,
            voice_channel_name: String::new(),
            devices_open: false,
            media: None,
            viewer: None,
            viewer_focus: cx.focus_handle(),
            images: None,
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

    /// The settings as changed in this run.
    pub fn settings(&self) -> &crate::settings::Settings {
        self.settings.get()
    }

    /// Changes the settings and saves them; a failed save is logged and the change kept in memory.
    pub fn update_settings(&mut self, change: impl FnOnce(&mut crate::settings::Settings)) {
        if let Err(error) = self.settings.update(change) {
            log::warn!("saving the settings: {error}");
        }
    }

    /// A `semaphore://` link the OS handed over, already parsed. The app-wiring unit routes it.
    pub fn open_link(&mut self, link: semaphore_ui::nav::DeepLink, _cx: &mut Context<Self>) {
        log::info!("deep link received, not routed yet: {link:?}");
    }

    /// The user clicked the OS notification with this tag. The app-wiring unit routes it.
    pub fn open_notification(&mut self, tag: &str, _cx: &mut Context<Self>) {
        log::info!("notification clicked, not routed yet: {tag}");
    }

    /// Ends core and the socket. The stored session stays.
    pub fn shutdown(&mut self) {
        if let Some(services) = &mut self.services {
            services.shutdown();
        }
    }

    fn started(&mut self, services: Services, window: &mut Window, cx: &mut Context<Self>) {
        let core = services.core.clone();
        // Files: one store for the process, redrawn into whenever a fetch lands.
        let (arrived, landed) = async_channel::unbounded();
        cx.spawn(async move |_, cx| {
            while landed.recv().await.is_ok() {
                while landed.try_recv().is_ok() {}
                cx.update(|cx| cx.refresh_windows());
            }
        })
        .detach();
        let media = Rc::new(AppMedia {
            core: core.clone(),
            exec: services.exec.clone(),
            store: files::store(),
            previews: Arc::new(PreviewFetcher::new(
                self.config.settings.get().link_preview_images,
            )),
            arrived,
            community: std::cell::RefCell::new(None),
        });
        let avatars = media.clone();
        let small = LruImageCache::new(semaphore_ui::messages::SMALL_BUDGET_BYTES, cx);
        cx.set_global(semaphore_ui::kit::AvatarImages {
            resolve: Rc::new(move |file_id| avatars.avatar_resource(file_id)),
            cache: small,
        });
        self.images = Some(LruImageCache::new(
            semaphore_ui::messages::IMAGE_BUDGET_BYTES,
            cx,
        ));
        self.media = Some(media.clone());
        let opener = cx.entity().downgrade();
        let open_attachment: crate::conversation::OpenAttachment =
            Rc::new(move |attachment, window, cx| {
                opener
                    .update(cx, |root, cx| root.open_attachment(attachment, window, cx))
                    .ok();
            });
        let backend = services.backend.clone();
        let server_url: crate::conversation::ServerUrl = Rc::new(move || backend.server_url());
        let pane = cx.new(|cx| {
            ConversationPane::new(
                core,
                services.exec.clone(),
                self.config.time,
                self.config.scrollbar,
                media,
                open_attachment,
                server_url,
                window,
                cx,
            )
        });
        self._subscriptions
            .push(cx.subscribe_in(&pane, window, Self::on_pane_event));
        let last_server = services.last_server.clone();
        // Voice: frames for this window, the controls, and the stage, made once.
        let frames = VideoFrames::for_window(window);
        services.frames.attach(frames.clone());
        let (requests, asks) = async_channel::unbounded();
        let voice = Arc::new(AppVoice {
            core: services.core.clone(),
            engine: services.engine.clone(),
            exec: services.exec.clone(),
            screens: services.screens.clone(),
            share_settings: Mutex::new(self.settings.get().voice.screen_share),
            requests,
        });
        cx.spawn(async move |this, cx| {
            while let Ok(ask) = asks.recv().await {
                let gone = this
                    .update(cx, |this, cx| {
                        this.voice_request(ask);
                        this.refresh_stage(cx);
                        cx.notify();
                    })
                    .is_err();
                if gone {
                    return;
                }
            }
        })
        .detach();
        let controller: Arc<dyn VoiceController> = voice.clone();
        let model = VoiceStageModel::default();
        self.stage = Some(cx.new(|cx| VoiceStage::new(model, frames, controller, window, cx)));
        self.voice = Some(voice);
        self.pane = Some(pane);
        self.services = Some(services);
        if self.config.watch_os {
            let handle = self.services.as_ref().map(|services| services.exec.clone());
            if let (Some(exec), Some(core)) = (handle, self.core()) {
                let sink: lifecycle::OsEventSink = Arc::new(move |event| {
                    let core = core.clone();
                    exec.fire(async move { apply_os_event(&core, event) });
                });
                self.os_watcher = Some(lifecycle::watch(sink));
            }
        }
        if let Some(url) = last_server {
            self.server = Some((url.clone(), server_label(&url)));
            self.restore_session(url, window, cx);
        }
        cx.notify();
    }

    /// What the stage and the bar draw: core's view of the call, with quality from its participants
    /// and the audio share from the app.
    fn stage_model(&self) -> VoiceStageModel {
        let Some(core) = self.core() else {
            return VoiceStageModel::default();
        };
        let voice = core.voice();
        let quality = voice
            .participants
            .iter()
            .map(|p| (p.identity.clone(), QualityLevel::from_core(p.quality)))
            .collect();
        let local_quality = voice
            .participants
            .iter()
            .find(|p| p.is_self)
            .map_or(QualityLevel::Unknown, |p| {
                QualityLevel::from_core(p.quality)
            });
        VoiceStageModel {
            reconnect_attempt: voice.reconnect_attempt,
            voice,
            channel_name: self.voice_channel_name.clone(),
            is_dm: false,
            quality,
            local_quality,
            ptt: None,
            always_show_overlays: false,
        }
    }

    fn refresh_stage(&mut self, cx: &mut Context<Self>) {
        let model = self.stage_model();
        // The picker is for this call's share: a call that ended takes it away.
        if model.voice.channel_id.is_none() {
            self.picker = None;
            self.more_open = false;
        }
        if let Some(stage) = &self.stage {
            stage.update(cx, |stage, cx| stage.set_model(model, cx));
        }
        cx.notify();
    }

    /// Joins a voice channel and shows it.
    pub fn join_voice(&mut self, channel_id: String, cx: &mut Context<Self>) {
        let (Some(services), Some(shell)) = (&self.services, self.shell.clone()) else {
            return;
        };
        let community = shell
            .read(cx)
            .nav()
            .current()
            .community_id()
            .map(str::to_owned);
        if let Some(community) = &community
            && let Some(channel) = services
                .core
                .channels(community.clone())
                .into_iter()
                .find(|channel| channel.id == channel_id)
        {
            self.voice_channel_name = channel.name;
        }
        let core = services.core.clone();
        let joining = channel_id.clone();
        services.exec.fire(async move {
            if let Err(error) = core.join_voice(joining).await {
                log::warn!("joining voice: {error}");
            }
        });
        if let Some(community_id) = community {
            shell.update(cx, |shell, cx| {
                shell.navigate(
                    Route::Channel {
                        community_id,
                        channel_id,
                    },
                    cx,
                )
            });
        }
        cx.notify();
    }

    /// An attachment clicked in the list: images open in the viewer, anything else goes to Save as.
    fn open_attachment(
        &mut self,
        attachment: AttachmentView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if attachment.kind == AttachmentKind::Image {
            self.viewer = Some(attachment);
            window.focus(&self.viewer_focus, cx);
            cx.notify();
            return;
        }
        self.save_attachment(attachment, cx);
    }

    /// Asks where, then fetches the file and writes it there, off the UI thread.
    fn save_attachment(&mut self, attachment: AttachmentView, cx: &mut Context<Self>) {
        let Some(services) = &self.services else {
            return;
        };
        let name = files::safe_file_name(&attachment.filename);
        let directory = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let chosen = cx.prompt_for_new_path(&directory, Some(&name));
        let (core, handle) = (services.core.clone(), services.exec.handle().clone());
        cx.spawn(async move |_, _| {
            let Ok(Ok(Some(path))) = chosen.await else {
                return;
            };
            let file_id = attachment.file_id.clone();
            let saved = handle
                .spawn(async move {
                    let bytes = core.file(file_id, false).await.map_err(|e| e.to_string())?;
                    tokio::task::spawn_blocking(move || {
                        std::fs::write(&path, bytes).map_err(|e| e.to_string())
                    })
                    .await
                    .map_err(|e| e.to_string())?
                })
                .await;
            match saved {
                Ok(Ok(())) => log::info!("saved {}", attachment.filename),
                other => log::warn!("saving {}: {other:?}", attachment.filename),
            }
        })
        .detach();
    }

    /// The open image, fit to the window. Escape or a click outside it closes it.
    fn viewer_overlay(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let attachment = self.viewer.as_ref()?;
        let media = self.media.as_ref()?;
        let images = self.images.clone()?;
        let full = media.full_image(attachment);
        let close = cx.entity().downgrade();
        let escape = close.clone();
        let picture: AnyElement = match full {
            MediaRef::Resource(resource) => img(ImageSource::Resource(resource))
                .image_cache(&images)
                .size_full()
                .object_fit(ObjectFit::Contain)
                .into_any_element(),
            MediaRef::Pending => Spinner::new("viewer-loading").into_any_element(),
            _ => text(Variant::Body1, "This image can't be shown.").into_any_element(),
        };
        Some(
            div()
                .id("image-viewer")
                .track_focus(&self.viewer_focus)
                .role(Role::Dialog)
                .aria_label(attachment.filename.clone())
                .absolute()
                .inset_0()
                .p(px(32.))
                .flex()
                .items_center()
                .justify_center()
                .bg(hsla(0., 0., 0., 0.85))
                .text_color(gpui_kit::white())
                .on_key_down(move |event, _, cx| {
                    if event.keystroke.key == "escape" {
                        escape
                            .update(cx, |root, cx| {
                                root.viewer = None;
                                cx.notify();
                            })
                            .ok();
                    }
                })
                .on_click(move |_, _, cx| {
                    close
                        .update(cx, |root, cx| {
                            root.viewer = None;
                            cx.notify();
                        })
                        .ok();
                })
                .child(picture)
                .into_any_element(),
        )
    }

    pub fn viewer_open(&self) -> bool {
        self.viewer.is_some()
    }

    /// The stage, for the rig's checks.
    pub fn stage(&self) -> Option<&Entity<VoiceStage>> {
        self.stage.as_ref()
    }

    pub fn app_voice(&self) -> Option<&Arc<AppVoice>> {
        self.voice.as_ref()
    }

    /// Resumes the stored session. The splash stays up meanwhile.
    fn restore_session(&mut self, url: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(services) = &self.services else {
            return;
        };
        self.restore = Restore::Running;
        let core = services.core.clone();
        let asked = url.clone();
        services.exec.run(
            window,
            cx,
            async move { core.restore_session(asked).await },
            move |this, outcome, _, cx| {
                this.restore = match outcome {
                    Ok(RestoreOutcome::Unreachable { error }) => {
                        Restore::Unreachable { url, error }
                    }
                    Ok(outcome) => {
                        log::info!("restoring the session: {outcome:?}");
                        Restore::Idle
                    }
                    Err(error) => {
                        log::warn!("restoring the session: {error}");
                        Restore::Idle
                    }
                };
                // Whatever the session is now, the screens follow it again.
                this.shown = None;
                cx.notify();
            },
        );
        cx.notify();
    }

    /// What the OS said, as the watcher would hand it over. The rig calls this directly.
    pub fn os_event(&self, event: OsEvent) {
        if let (Some(services), Some(core)) = (&self.services, self.core()) {
            services
                .exec
                .fire(async move { apply_os_event(&core, event) });
        }
    }

    /// Remembers the server of a session that's signed in, for the next start to resume.
    fn remember_server(&mut self) {
        let Some(services) = &self.services else {
            return;
        };
        let Some(url) = services.backend.server_url() else {
            return;
        };
        if self.remembered.as_ref() == Some(&url) {
            return;
        }
        self.remembered = Some(url.clone());
        self.server = Some((
            url.clone(),
            self.server
                .as_ref()
                .filter(|(known, _)| *known == url)
                .map_or_else(|| server_label(&url), |(_, name)| name.clone()),
        ));
        let data_dir = services.data_dir.clone();
        services.exec.handle().spawn_blocking(move || {
            services::write_last_server(&data_dir, &url);
        });
    }

    fn on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ViewChanged {
                view: ViewKey::Session,
            } => cx.notify(),
            CoreEvent::ViewChanged {
                view: ViewKey::Communities,
            } => self.land(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Voice,
            } => self.refresh_stage(cx),
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
        // The splash, or the retry screen, until a restore has its answer.
        if self.restore != Restore::Idle {
            return;
        }
        let session = core.session();
        if self.shown.as_ref() == Some(&session) {
            return;
        }
        self.shown = Some(session.clone());
        match &session {
            SessionState::SignedIn { .. } => {
                self.auth = None;
                self.remember_server();
                if self.shell.is_none() {
                    self.shell = Some(self.build_shell(core.clone(), window, cx));
                    self.landed = false;
                    self.land(cx);
                }
            }
            SessionState::SignedOut
            | SessionState::SignInFailed { .. }
            | SessionState::SigningIn => {
                // Nothing of the last session's files stays in memory.
                if matches!(session, SessionState::SignedOut) {
                    files::store().clear();
                }
                self.viewer = None;
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
        let stage = self.stage.clone().expect("the stage exists once core does");
        let root = cx.entity().downgrade();
        let content_core = core.clone();
        // The channel the middle column shows, as the shell last drew it. It draws the column
        // before the bar, and the bar can't read the shell while the shell is drawing.
        let showing: Rc<std::cell::RefCell<Option<String>>> = Rc::default();
        let shown = showing.clone();
        let content = Rc::new(
            move |props: &ContentProps, window: &mut Window, cx: &mut App| {
                *shown.borrow_mut() = props.route.channel_id().map(str::to_owned);
                content(&pane, &stage, &content_core, &root, props, window, cx)
            },
        );
        let connection = core.connection();
        let bar_root = cx.entity().downgrade();
        let shell = cx.new(|cx| {
            // The call's bar under the columns, wherever the user is but the call's own channel.
            let bar: semaphore_ui::shell::VoiceBarSlot = Rc::new(move |window, cx| {
                let root = bar_root.upgrade()?;
                let (model, controller) = {
                    let root = root.read(cx);
                    let model = root.stage_model();
                    model.voice.channel_id.as_ref()?;
                    let controller: Arc<dyn VoiceController> = root.voice.clone()?;
                    (model, controller)
                };
                let on_its_channel =
                    showing.borrow().as_deref() == model.voice.channel_id.as_deref();
                if on_its_channel {
                    return None;
                }
                let narrow = window.viewport_size().width < px(600.);
                Some(voice_bar_element(&model, narrow, controller))
            });
            Shell::new(
                Rc::new(CoreSource(core.clone())),
                Route::Home,
                content,
                connection,
                cx,
            )
            .with_voice_bar(bar)
        });
        self._subscriptions
            .push(cx.subscribe_in(&shell, window, Self::on_shell_event));
        shell
    }

    /// What the conversation pane asks of the shell.
    fn on_pane_event(
        &mut self,
        _: &Entity<ConversationPane>,
        event: &PaneEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(shell) = self.shell.clone() else {
            return;
        };
        match event.clone() {
            PaneEvent::SidePanel(panel) => {
                shell.update(cx, |shell, cx| shell.set_side_panel(panel, cx));
            }
            PaneEvent::Navigate {
                community_id,
                channel_id,
            } => shell.update(cx, |shell, cx| {
                shell.navigate(
                    Route::Channel {
                        community_id,
                        channel_id,
                    },
                    cx,
                )
            }),
            PaneEvent::PinnedCount(count) => shell.update(cx, |shell, cx| {
                shell.pinned_count = count;
                cx.notify();
            }),
        }
    }

    fn on_shell_event(
        &mut self,
        _: &Entity<Shell>,
        event: &ShellEvent,
        window: &mut Window,
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
            ShellEvent::JoinVoice { channel_id } => self.join_voice(channel_id.clone(), cx),
            ShellEvent::OpenPins => {
                if let Some(pane) = &self.pane {
                    pane.update(cx, |pane, cx| pane.toggle_pins(window, cx));
                }
            }
            ShellEvent::OpenSearch => {
                if let Some(pane) = &self.pane {
                    pane.update(cx, |pane, cx| pane.toggle_search(window, cx));
                }
            }
            ShellEvent::CloseSidePanel => {
                if let Some(pane) = &self.pane {
                    pane.update(cx, |pane, cx| pane.close_side(cx));
                }
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

impl AppRoot {
    fn voice_request(&mut self, ask: VoiceRequest) {
        match ask {
            VoiceRequest::Redraw => {}
            VoiceRequest::OpenDevices => self.devices_open = true,
            VoiceRequest::OpenMore => self.more_open = true,
            VoiceRequest::OpenPicker => self.picker = Some(PickerModel::loading()),
            // Only into a picker still open and still loading: a cancelled one stays closed.
            VoiceRequest::PickerSources(listed) => {
                if let Some(picker) = &mut self.picker
                    && matches!(picker.state, semaphore_ui::voice::PickerState::Loading)
                {
                    *picker = match listed {
                        Ok(sources) => PickerModel::ready(
                            sources.iter().map(PickerSource::from_capture).collect(),
                        ),
                        Err(why) => PickerModel::failed(why),
                    };
                }
            }
        }
    }

    /// Our screen picker, over the window. Share starts the share and closes it.
    fn picker_dialog(
        &self,
        picker: &PickerModel,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let this = cx.entity().downgrade();
        let (tab, select, share, cancel) = (this.clone(), this.clone(), this.clone(), this);
        source_picker(
            picker,
            PickerActions {
                on_tab: Rc::new(move |kind: CaptureKind, _, cx| {
                    tab.update(cx, |root, cx| {
                        if let Some(picker) = &mut root.picker {
                            picker.set_tab(kind);
                        }
                        cx.notify();
                    })
                    .ok();
                }),
                on_select: Rc::new(move |id: String, _, cx| {
                    select
                        .update(cx, |root, cx| {
                            if let Some(picker) = &mut root.picker {
                                picker.select(&id);
                            }
                            cx.notify();
                        })
                        .ok();
                }),
                on_share: Rc::new(move |id: String, _, cx| {
                    share
                        .update(cx, |root, cx| {
                            root.picker = None;
                            if let Some(voice) = &root.voice {
                                voice.start_share(Some(id));
                            }
                            cx.notify();
                        })
                        .ok();
                }),
                on_cancel: Rc::new(move |_, cx| {
                    cancel
                        .update(cx, |root, cx| {
                            root.picker = None;
                            cx.notify();
                        })
                        .ok();
                }),
            },
        )
    }

    /// The narrow bar's "more": the screen share, which has no room on the bar, and settings.
    fn more_dialog(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let local = self
            .core()
            .map(|core| core.voice().local)
            .unwrap_or_default();
        let look = semaphore_ui::voice::ShareLook::of(&local.screen, local.may_share);
        let share_label = semaphore_ui::voice::screen_label(look);
        let this = cx.entity().downgrade();
        let (share, settings, close, done) = (this.clone(), this.clone(), this.clone(), this);
        let shut = |root: &mut AppRoot, cx: &mut Context<AppRoot>| {
            root.more_open = false;
            cx.notify();
        };
        Dialog::new("Call options")
            .width(320.)
            .body(Menu::new(
                "Call options",
                vec![
                    MenuItem::new("more-share", share_label, move |_, cx| {
                        share
                            .update(cx, |root, cx| {
                                shut(root, cx);
                                if let Some(voice) = &root.voice {
                                    voice.toggle_screen_share();
                                }
                            })
                            .ok();
                    })
                    .disabled(!look.clickable()),
                    MenuItem::new("more-settings", "Voice settings", move |_, cx| {
                        settings
                            .update(cx, |root, cx| {
                                shut(root, cx);
                                root.devices_open = true;
                            })
                            .ok();
                    }),
                ],
            ))
            .action(Button::new("more-done", "Close").on_click(move |_, _, cx| {
                done.update(cx, shut).ok();
            }))
            .on_close(move |_, cx| {
                close.update(cx, shut).ok();
            })
    }

    /// Saves a change to the screen-share settings, and hands it to the next share.
    fn set_share_settings(
        &mut self,
        change: impl FnOnce(&mut ShareSettings),
        cx: &mut Context<Self>,
    ) {
        let mut next = self.settings.get().voice.screen_share;
        change(&mut next);
        if let Err(error) = self.settings.update(|s| s.voice.screen_share = next) {
            log::warn!("saving the screen-share settings: {error}");
        }
        if let Some(voice) = &self.voice {
            voice.set_share_settings(next);
        }
        cx.notify();
    }

    /// Which microphone and speakers: the two lists the engine knows, nothing else.
    fn devices_dialog(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let devices = self
            .voice
            .as_ref()
            .map(|voice| voice.devices())
            .unwrap_or_default();
        let sem = cx.sem().clone();
        let close = cx.entity().downgrade();
        let done = close.clone();
        let list = |title: &'static str,
                    prefix: &'static str,
                    devices: Vec<semaphore_media_livekit::audio::AudioDevice>,
                    input: bool| {
            let mut column = div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(text(Variant::Subtitle2, title).text_color(sem.text_primary));
            if devices.is_empty() {
                column = column.child(text(Variant::Body2, "None found"));
            }
            for (index, device) in devices.into_iter().enumerate() {
                let voice = self.voice.clone();
                let id = device.id.clone();
                let label = if device.is_default {
                    format!("{} (default)", device.name)
                } else {
                    device.name.clone()
                };
                column = column.child(
                    Button::new(ElementId::NamedInteger(prefix.into(), index as u64), label)
                        .on_click(move |_, _, _| {
                            if let Some(voice) = &voice {
                                if input {
                                    voice.engine.select_input(Some(id.clone()));
                                } else {
                                    voice.engine.select_output(Some(id.clone()));
                                }
                            }
                        }),
                );
            }
            column
        };
        let cameras = self
            .voice
            .as_ref()
            .map(|voice| voice.engine.cameras())
            .unwrap_or_default();
        let mut camera_column = div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(text(Variant::Subtitle2, "Camera").text_color(sem.text_primary));
        if cameras.is_empty() {
            camera_column = camera_column.child(text(Variant::Body2, "None found"));
        }
        for (index, (id, name)) in cameras.into_iter().enumerate() {
            let voice = self.voice.clone();
            camera_column = camera_column.child(
                Button::new(
                    ElementId::NamedInteger("device-camera".into(), index as u64),
                    name,
                )
                .on_click(move |_, _, _| {
                    if let Some(voice) = &voice {
                        voice.engine.select_camera(Some(id.clone()));
                    }
                }),
            );
        }
        let share = self.settings.get().voice.screen_share;
        let this = cx.entity().downgrade();
        let sizes = ShareSize::ALL.iter().map(|size| {
            let (size, this) = (*size, this.clone());
            Radio::new(
                ElementId::Name(format!("share-size-{}", size.label()).into()),
                size.label(),
                share.resolution == size,
            )
            .on_select(move |_, cx| {
                this.update(cx, |root, cx| {
                    root.set_share_settings(|s| s.resolution = size, cx)
                })
                .ok();
            })
        });
        let rates = SHARE_FPS.iter().map(|fps| {
            let (fps, this) = (*fps, this.clone());
            Radio::new(
                ElementId::Name(format!("share-fps-{fps}").into()),
                format!("{fps} fps"),
                share.fps == fps,
            )
            .on_select(move |_, cx| {
                this.update(cx, |root, cx| root.set_share_settings(|s| s.fps = fps, cx))
                    .ok();
            })
        });
        let audio_this = this.clone();
        let share_column = div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(text(Variant::Subtitle2, "Screen share").text_color(sem.text_primary))
            .child(div().flex().flex_wrap().children(sizes))
            .child(div().flex().flex_wrap().children(rates))
            .child(
                Switch::new("share-audio", "Share system audio", share.audio).on_change(
                    move |on, _, cx| {
                        audio_this
                            .update(cx, |root, cx| root.set_share_settings(|s| s.audio = on, cx))
                            .ok();
                    },
                ),
            );
        Dialog::new("Voice settings")
            .body(
                div()
                    .id("voice-settings-body")
                    .max_h(px(520.))
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(list("Input", "device-input", devices.inputs, true))
                    .child(list("Output", "device-output", devices.outputs, false))
                    .child(camera_column)
                    .child(share_column),
            )
            .action(
                Button::new("devices-done", "Done").on_click(move |_, _, cx| {
                    done.update(cx, |this, cx| {
                        this.devices_open = false;
                        cx.notify();
                    })
                    .ok();
                }),
            )
            .on_close(move |_, cx| {
                close
                    .update(cx, |this, cx| {
                        this.devices_open = false;
                        cx.notify();
                    })
                    .ok();
            })
    }

    /// The stored session couldn't be checked: offer another try, or a sign-in elsewhere.
    fn unreachable(
        &self,
        url: String,
        error: ErrorView,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem().clone();
        let retry = cx.entity().downgrade();
        let elsewhere = retry.clone();
        let retry_url = url.clone();
        div()
            .id("restore-unreachable")
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(12.))
            .child(text(Variant::H5, format!("Can't reach {}", server_label(&url))))
            .child(
                div()
                    .max_w(px(480.))
                    .text_color(sem.text_secondary)
                    .child(text(
                        Variant::Body2,
                        format!(
                            "You're still signed in there. Check your connection, then try again. ({})",
                            error.message
                        ),
                    )),
            )
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        Button::new("restore-sign-in", "Sign in again").on_click(move |_, _, cx| {
                            elsewhere
                                .update(cx, |this, cx| {
                                    this.restore = Restore::Idle;
                                    this.shown = None;
                                    cx.notify();
                                })
                                .ok();
                        }),
                    )
                    .child(
                        Button::new("restore-retry", "Try again")
                            .contained()
                            .on_click(move |_, window, cx| {
                                let url = retry_url.clone();
                                retry
                                    .update(cx, |this, cx| this.restore_session(url, window, cx))
                                    .ok();
                            }),
                    ),
            )
    }
}

/// Core's side of an OS event. On the net runtime: `resume` and `network_changed` reach the socket,
/// which spawns.
fn apply_os_event(core: &Core, event: OsEvent) {
    log::info!("OS: {event:?}");
    match event {
        OsEvent::Suspending => core.suspend(),
        OsEvent::Resumed => {
            core.resume();
        }
        OsEvent::Network(network) => {
            core.network_changed(network);
        }
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
#[allow(clippy::too_many_arguments)]
fn content(
    pane: &Entity<ConversationPane>,
    stage: &Entity<VoiceStage>,
    core: &Core,
    root: &WeakEntity<AppRoot>,
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
                let take_focus = props.take_focus;
                pane.update(cx, |pane, cx| {
                    pane.show(conversation, community, channel, window, cx);
                    // Opening another conversation focuses the composer; landing on (or clicking)
                    // the one already open has to as well.
                    if take_focus {
                        pane.focus_composer(window, cx);
                    }
                });
            }
            pane.clone().into_any_element()
        }
        (_, Some(channel)) if core.voice().channel_id.as_deref() == Some(&channel.id) => {
            stage.clone().into_any_element()
        }
        (_, Some(channel)) => {
            let join = root.clone();
            let channel_id = channel.id.clone();
            div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(12.))
                .text_color(sem.text_secondary)
                .child(text(Variant::H5, channel.name.clone()))
                .child(text(Variant::Body1, "You're not in this call."))
                .child(
                    Button::new("voice-join", "Join voice")
                        .contained()
                        .on_click(move |_, _, cx| {
                            let channel_id = channel_id.clone();
                            join.update(cx, |root, cx| root.join_voice(channel_id, cx))
                                .ok();
                        }),
                )
                .into_any_element()
        }
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
        if let Restore::Unreachable { url, error } = self.restore.clone() {
            return root.child(self.unreachable(url, error, cx));
        }
        if self.restore == Restore::Running {
            return root
                .flex()
                .items_center()
                .justify_center()
                .child(Spinner::new("app-restoring"));
        }
        if let Some(shell) = &self.shell {
            return root
                .child(shell.clone())
                .when(self.account_open, |root| {
                    root.child(self.account_dialog(cx))
                })
                .when(self.devices_open, |root| {
                    root.child(self.devices_dialog(cx))
                })
                .when(self.more_open, |root| root.child(self.more_dialog(cx)))
                .when_some(self.picker.clone(), |root, picker| {
                    root.child(self.picker_dialog(&picker, cx))
                })
                .children(self.viewer_overlay(cx));
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
