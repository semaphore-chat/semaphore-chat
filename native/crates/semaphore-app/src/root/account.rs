//! W3's signed-in wiring: profiles, the settings page, Home and creating a community.
//!
//! - **Profiles.** A click on a user (a message's author or avatar, a mention, a member, a friend's
//!   "View Profile", a one-to-one DM's name) opens `ProfileModal` over the shell; "View Profile"
//!   goes to `Route::Profile`, and on this user's own page "Edit Profile" to `Route::ProfileEdit`,
//!   whose pictures come from the file picker (`crate::pick_files`). Driven by `Core::profile`,
//!   `Core::profile_edit` and `Core::update_profile`.
//! - **Settings** (`Route::Settings { tab }`), one `SettingsScreen` per session: notifications
//!   (W2's section, unchanged), voice and video (the local settings, applied to the engine at once),
//!   appearance (`Core::appearance`, drawn by the whole app as soon as it's read), sessions, and the
//!   desktop app (close to tray, `semaphore://` links, link preview images).
//! - **Home** (`Route::Home`): `HomeScreen`, or `ZeroCommunityGate` for someone in no community.
//!   "Create a community" there and the rail's "+" open `CreateCommunityForm`; a created community
//!   opens.
//! - **`CoreEvent::DesktopSignedIn`**: a banner until dismissed, with a way to the sessions.

use super::AppRoot;
use crate::settings::{InputMode, MicQuality, ShareSize};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{
    ChannelKind, DraftFile, LoadState, ProfileView, SessionState, ShareResolution, ViewKey,
};
use semaphore_core::platform::CoreError;
use semaphore_ui::home::{
    CreateCommunityEvent, CreateCommunityForm, HomeData, HomeEvent, HomeMention, HomeScreen,
    HomeVoiceChannel, Section, ZeroCommunityGate,
};
use semaphore_ui::kit::{Alert, Button, Severity};
use semaphore_ui::nav::Route;
use semaphore_ui::panel::PanelClock;
use semaphore_ui::profile::{
    FriendAction, ProfileActions, ProfileEditEvent, ProfileEditForm, ProfileEvent, ProfileModal,
    ProfilePage,
};
use semaphore_ui::settings::{
    AppearanceEvent, AppearanceSettings, DesktopAppEvent, DesktopAppSettings, DesktopAppState,
    DeviceLists, DeviceOption, LinkHandler, Processing, SessionsEvent, SessionsSettings,
    SettingsScreen, SettingsShellEvent, SettingsTab, ShareQuality, VoiceLimits, VoiceSettingsEvent,
    VoiceVideoSettings, VoiceVideoState,
};

/// How often the mic test's meter is fed while a test runs.
const MIC_TEST_POLL: std::time::Duration = std::time::Duration::from_millis(50);

/// What the voice tab says in place of what this build can't do yet.
pub const PUSH_TO_TALK_LIMIT: &str = "The key is saved, but this version doesn't listen for it \
     yet: hold the voice bar's Push to Talk button to transmit.";

/// A desktop app signed in to this account: where from, and when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopSignIn {
    pub ip_address: Option<String>,
    pub at_ms: i64,
}

#[derive(Default)]
pub(super) struct Account {
    settings: Option<Entity<SettingsScreen>>,
    modal: Option<Entity<ProfileModal>>,
    page: Option<Entity<ProfilePage>>,
    edit: Option<Entity<ProfileEditForm>>,
    home: Option<Entity<HomeScreen>>,
    gate: Option<Entity<ZeroCommunityGate>>,
    create: Option<Entity<CreateCommunityForm>>,
    desktop_sign_in: Option<DesktopSignIn>,
    links: LinkHandler,
    /// W4: the settings page's mic test while it runs, and the task feeding its meter. Dropping it
    /// closes the mic.
    mic_test: Option<(semaphore_media_livekit::InputTest, Task<()>)>,
    subscriptions: Vec<Subscription>,
}

impl AppRoot {
    /// The session's account screens, with the shell.
    pub(super) fn build_account(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let screen = cx.new(|cx| SettingsScreen::new(window, cx));
        let home = cx.new(HomeScreen::new);
        let gate = cx.new(ZeroCommunityGate::new);
        let (notifications, voice, appearance, sessions, desktop) = {
            let screen = screen.read(cx);
            (
                screen.notifications(),
                screen.voice(),
                screen.appearance(),
                screen.sessions(),
                screen.desktop(),
            )
        };
        notifications.update(cx, |section, cx| {
            section.set_local_timezone(semaphore_core::notify::system_timezone(), cx)
        });
        voice.update(cx, |voice, cx| {
            voice.set_limits(
                VoiceLimits {
                    mic_test: None,
                    push_to_talk: Some(PUSH_TO_TALK_LIMIT.into()),
                },
                cx,
            )
        });
        let clock = self
            .config
            .time
            .now_ms
            .map(PanelClock::fixed)
            .unwrap_or_default();
        sessions.update(cx, |sessions, cx| sessions.set_clock(clock, cx));
        self.account = Account {
            subscriptions: vec![
                cx.subscribe_in(&screen, window, Self::on_settings_shell),
                cx.subscribe_in(&voice, window, Self::on_voice_settings),
                cx.subscribe_in(&appearance, window, Self::on_appearance),
                cx.subscribe_in(&sessions, window, Self::on_sessions),
                cx.subscribe_in(&desktop, window, Self::on_desktop_settings),
                cx.subscribe_in(&home, window, Self::on_home),
                cx.subscribe_in(&gate, window, Self::on_home),
            ],
            settings: Some(screen),
            home: Some(home),
            gate: Some(gate),
            ..Account::default()
        };
        // W2's notification settings section, now the settings page's first tab.
        self.adopt_notification_settings(notifications, window, cx);
        self.refresh_voice_tab(window, cx);
        self.refresh_appearance(cx);
        self.refresh_desktop_tab(cx);
        self.refresh_links(cx);
        self.refresh_home(cx);
    }

    /// Signed out: nothing of this session's account stays.
    pub(super) fn drop_account(&mut self) {
        self.account = Account::default();
    }

    pub(super) fn account_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ViewChanged {
                view: ViewKey::Profile { user_id },
            } => self.refresh_profile(user_id, cx),
            CoreEvent::ViewChanged {
                view: ViewKey::ProfileEdit,
            } => self.refresh_profile_edit(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Sessions,
            } => self.refresh_sessions(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Appearance,
            } => self.refresh_appearance(cx),
            CoreEvent::ViewChanged {
                view:
                    ViewKey::Communities
                    | ViewKey::Channels { .. }
                    | ViewKey::DirectMessages
                    | ViewKey::InstancePermissions,
            } => self.refresh_home(cx),
            CoreEvent::DesktopSignedIn { ip_address, at_ms } => {
                self.account.desktop_sign_in = Some(DesktopSignIn {
                    ip_address: ip_address.clone(),
                    at_ms: *at_ms,
                });
                cx.notify();
            }
            _ => {}
        }
    }

    /// The shell went somewhere: the page there reads what it shows.
    pub(super) fn account_navigated(
        &mut self,
        route: &Route,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // The mic test is the voice tab's: leaving it closes the mic.
        if !matches!(
            route,
            Route::Settings {
                tab: SettingsTab::VoiceVideo
            }
        ) {
            self.stop_mic_test(cx);
        }
        match route {
            Route::Settings { tab } => {
                if let Some(screen) = self.account.settings.clone()
                    && screen.read(cx).tab() != *tab
                {
                    screen.update(cx, |screen, cx| screen.set_tab(*tab, cx));
                }
                // As the web's list refetching when it mounts: another device's sign-in comes with
                // no event to this one.
                if *tab == SettingsTab::Sessions
                    && let Some(core) = self.core()
                {
                    core.invalidate(&semaphore_core::cache::keys::op(
                        semaphore_core::cache::keys::SESSIONS,
                    ));
                }
                self.refresh_sessions(cx);
                self.refresh_voice_tab(window, cx);
                self.refresh_desktop_tab(cx);
                self.refresh_links(cx);
            }
            Route::Profile { user_id } => {
                if self
                    .account
                    .page
                    .as_ref()
                    .is_none_or(|page| page.read(cx).user_id() != user_id)
                {
                    let page = cx.new(|cx| ProfilePage::new(user_id.clone(), cx));
                    self.account.subscriptions.push(cx.subscribe_in(
                        &page,
                        window,
                        Self::on_profile,
                    ));
                    let own = self.my_id().as_deref() == Some(user_id.as_str());
                    self.replay_profile_opened(&page, user_id, own, window, cx);
                    self.account.page = Some(page);
                }
                self.refresh_profile(user_id, cx);
            }
            Route::Invite { invite_code } => self.signed_in_invite(invite_code, window, cx),
            Route::ProfileEdit => {
                let form = cx.new(|cx| ProfileEditForm::new(window, cx));
                self.account.subscriptions.push(cx.subscribe_in(
                    &form,
                    window,
                    Self::on_profile_edit,
                ));
                if let Some(max) = self
                    .server_info
                    .as_ref()
                    .and_then(|info| info.max_file_bytes)
                {
                    form.update(cx, |form, cx| form.set_max_file_bytes(Some(max), cx));
                }
                self.account.edit = Some(form);
                if let Some(me) = self.my_id() {
                    self.refresh_profile(&me, cx);
                }
                self.refresh_profile_edit(cx);
            }
            _ => {}
        }
    }

    /// The middle column for the routes this module owns.
    pub(super) fn account_content(&self, route: &Route, cx: &App) -> Option<AnyElement> {
        match route {
            Route::Settings { .. } => self
                .account
                .settings
                .clone()
                .map(IntoElement::into_any_element),
            Route::Profile { .. } => self.account.page.clone().map(IntoElement::into_any_element),
            Route::ProfileEdit => self.account.edit.clone().map(IntoElement::into_any_element),
            Route::Invite { invite_code } => self.signed_in_invite_element(invite_code),
            Route::Home => {
                let communities = self.home_communities();
                if ZeroCommunityGate::applies(&communities) {
                    self.account.gate.clone().map(IntoElement::into_any_element)
                } else {
                    let _ = cx;
                    self.account.home.clone().map(IntoElement::into_any_element)
                }
            }
            _ => None,
        }
    }

    /// The account's dialogs and banner over the shell.
    pub(super) fn account_overlays(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut overlays: Vec<AnyElement> = Vec::new();
        if let Some(modal) = &self.account.modal {
            overlays.push(modal.clone().into_any_element());
        }
        if let Some(form) = &self.account.create {
            overlays.push(form.clone().into_any_element());
        }
        if let Some(signed_in) = &self.account.desktop_sign_in {
            overlays.push(self.desktop_sign_in_banner(signed_in, cx));
        }
        overlays
    }

    fn my_id(&self) -> Option<String> {
        match self.core()?.session() {
            SessionState::SignedIn { me } => Some(me.id),
            _ => None,
        }
    }

    pub(super) fn shell_navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        if let Some(shell) = self.shell.clone() {
            shell.update(cx, |shell, cx| shell.navigate(route, cx));
        }
    }

    fn shell_back(&mut self, cx: &mut Context<Self>) {
        if let Some(shell) = self.shell.clone() {
            shell.update(cx, |shell, cx| shell.go_back(cx));
        }
    }

    /// Opens the settings page on `tab`.
    pub fn open_settings(&mut self, tab: SettingsTab, cx: &mut Context<Self>) {
        self.shell_navigate(Route::Settings { tab }, cx);
    }

    // ---- Profiles. ----

    /// The profile card for this user, over whatever is on screen.
    pub fn open_profile(&mut self, user_id: String, window: &mut Window, cx: &mut Context<Self>) {
        if user_id.is_empty() {
            return;
        }
        let modal = cx.new(|cx| ProfileModal::new(user_id.clone(), cx));
        self.account
            .subscriptions
            .push(cx.subscribe_in(&modal, window, Self::on_profile));
        self.account.modal = Some(modal);
        self.refresh_profile(&user_id, cx);
        cx.notify();
    }

    /// Whose profile card is open, for the rig.
    pub fn profile_open(&self, cx: &App) -> Option<String> {
        self.account
            .modal
            .as_ref()
            .map(|modal| modal.read(cx).user_id().to_owned())
    }

    fn profile_actions(&self, user_id: &str) -> ProfileActions {
        let Some(core) = self.core() else {
            return ProfileActions::default();
        };
        let friends = core.friends();
        let friend = if friends.friends.iter().any(|row| row.user.id == user_id) {
            FriendAction::Friends
        } else if friends
            .incoming
            .iter()
            .chain(&friends.outgoing)
            .any(|row| row.user.id == user_id)
        {
            FriendAction::Pending
        } else {
            FriendAction::Add
        };
        ProfileActions {
            can_message: true,
            friend,
        }
    }

    fn refresh_profile(&mut self, user_id: &str, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let wanted = |id: &str| id == user_id;
        let view = || core.profile(user_id.to_owned());
        let actions = self.profile_actions(user_id);
        if let Some(modal) = self.account.modal.clone()
            && wanted(modal.read(cx).user_id())
        {
            let view = view();
            modal.update(cx, |modal, cx| {
                modal.set_view(view, cx);
                modal.set_actions(actions, cx);
            });
        }
        if let Some(page) = self.account.page.clone()
            && wanted(page.read(cx).user_id())
        {
            let view = view();
            page.update(cx, |page, cx| {
                page.set_view(view, cx);
                page.set_actions(actions, cx);
            });
        }
        if let Some(form) = self.account.edit.clone()
            && self.my_id().as_deref() == Some(user_id)
        {
            let view: ProfileView = view();
            // In a frame of its own: this may run inside the window's own update (a route change).
            let window = self.window;
            cx.defer(move |cx| {
                window
                    .update(cx, |_, window, cx| {
                        form.update(cx, |form, cx| form.set_view(view, window, cx));
                    })
                    .ok();
            });
        }
    }

    fn refresh_profile_edit(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(form)) = (self.core(), self.account.edit.clone()) else {
            return;
        };
        let edit = core.profile_edit();
        form.update(cx, |form, cx| form.set_edit(edit, cx));
    }

    fn on_profile<T: 'static>(
        &mut self,
        _: &Entity<T>,
        event: &ProfileEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match event.clone() {
            ProfileEvent::Close => {
                self.account.modal = None;
                cx.notify();
            }
            ProfileEvent::OpenPage { user_id } => {
                self.account.modal = None;
                self.shell_navigate(Route::Profile { user_id }, cx);
            }
            ProfileEvent::Edit => {
                self.account.modal = None;
                self.shell_navigate(Route::ProfileEdit, cx);
            }
            ProfileEvent::Message { user_id } => {
                self.account.modal = None;
                exec.run(
                    window,
                    cx,
                    async move { core.create_dm(vec![user_id], None).await },
                    |this, result, _, cx| match result {
                        Ok(dm_id) => {
                            this.shell_navigate(Route::DirectMessage { dm_group_id: dm_id }, cx)
                        }
                        Err(error) => log::warn!("opening the DM failed: {error}"),
                    },
                );
            }
            ProfileEvent::AddFriend { user_id } => {
                let shown = user_id.clone();
                exec.run(
                    window,
                    cx,
                    async move { core.send_friend_request(user_id).await },
                    move |this, result, _, cx| {
                        if let Err(error) = result {
                            log::warn!("sending a friend request failed: {error}");
                        }
                        this.refresh_profile(&shown, cx);
                    },
                );
            }
            ProfileEvent::Back => self.shell_back(cx),
            ProfileEvent::Retry => core.retry_failed(),
        }
    }

    fn on_profile_edit(
        &mut self,
        form: &Entity<ProfileEditForm>,
        event: &ProfileEditEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match event.clone() {
            ProfileEditEvent::PickImage { slot } => {
                let picked = crate::pick_files(
                    crate::PickRequest {
                        multiple: false,
                        prompt: "Choose",
                    },
                    cx,
                );
                let form = form.downgrade();
                cx.spawn_in(window, async move |_, cx| {
                    let Some(path) = picked.await.and_then(|paths| paths.into_iter().next()) else {
                        return;
                    };
                    let read = cx.background_spawn(async move { read_image(&path) }).await;
                    form.update(cx, |form, cx| match read {
                        Ok(file) => form.set_picked(slot, file, cx),
                        Err(message) => form.set_pick_error(slot, message, cx),
                    })
                    .ok();
                })
                .detach();
            }
            ProfileEditEvent::Save { patch } => exec.run(
                window,
                cx,
                async move { core.update_profile(*patch).await },
                |this, result, _, cx| match result {
                    // Saved: back to where the edit started (the profile page).
                    Ok(()) => this.shell_back(cx),
                    Err(error) => log::warn!("saving the profile failed: {error}"),
                },
            ),
            ProfileEditEvent::Cancel => self.shell_back(cx),
            ProfileEditEvent::Retry => core.retry_failed(),
        }
    }

    // ---- Settings. ----

    fn on_settings_shell(
        &mut self,
        _: &Entity<SettingsScreen>,
        event: &SettingsShellEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            SettingsShellEvent::TabChanged(tab) => {
                if let Some(shell) = self.shell.clone() {
                    let tab = *tab;
                    shell.update(cx, |shell, cx| {
                        shell.replace_route(Route::Settings { tab }, cx)
                    });
                }
            }
            SettingsShellEvent::Close => self.shell_back(cx),
        }
    }

    fn voice_tab(&self, cx: &App) -> Option<Entity<VoiceVideoSettings>> {
        self.account
            .settings
            .as_ref()
            .map(|screen| screen.read(cx).voice())
    }

    /// The voice tab from the settings, and the engine's devices.
    fn refresh_voice_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tab) = self.voice_tab(cx) else {
            return;
        };
        let state = voice_state(&self.settings.get().voice);
        let devices = self.device_lists();
        tab.update(cx, |tab, cx| {
            tab.set_devices(devices, window, cx);
            tab.set_state(state, window, cx);
        });
    }

    fn device_lists(&self) -> DeviceLists {
        let Some(voice) = &self.voice else {
            return DeviceLists::default();
        };
        let audio = voice.devices();
        let option = |device: semaphore_media_livekit::audio::AudioDevice| DeviceOption {
            id: device.id,
            name: device.name,
            is_default: device.is_default,
        };
        DeviceLists {
            state: LoadState::Ready,
            inputs: audio.inputs.into_iter().map(option).collect(),
            outputs: audio.outputs.into_iter().map(option).collect(),
            cameras: voice
                .engine
                .cameras()
                .into_iter()
                .map(|(id, name)| DeviceOption {
                    id,
                    name,
                    is_default: false,
                })
                .collect(),
        }
    }

    fn on_voice_settings(
        &mut self,
        _: &Entity<VoiceVideoSettings>,
        event: &VoiceSettingsEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            VoiceSettingsEvent::Changed(state) => {
                let state = state.clone();
                self.update_settings(|settings| apply_voice_state(&mut settings.voice, &state));
                if let Some(voice) = &self.voice {
                    voice.apply_settings(&self.settings.get().voice);
                }
                // The in-app players play on the same output as calls.
                if let Some(players) = &self.players {
                    players.set_output_device(self.settings.get().voice.output_device.clone());
                }
            }
            VoiceSettingsEvent::PlayTestSound => {
                self.play_test_sound();
            }
            VoiceSettingsEvent::RefreshDevices => self.refresh_voice_tab(window, cx),
            VoiceSettingsEvent::StartMicTest => self.start_mic_test(cx),
            VoiceSettingsEvent::StopMicTest => self.stop_mic_test(cx),
        }
    }

    /// W4: the mic test: the selected input's level into the tab's meter, no playback.
    fn start_mic_test(&mut self, cx: &mut Context<Self>) {
        let Some(voice) = self.voice.clone() else {
            return;
        };
        let test = match voice.engine.start_input_test(false) {
            Ok(test) => test,
            Err(error) => {
                log::warn!("mic test: {error}");
                if let Some(tab) = self.voice_tab(cx) {
                    tab.update(cx, |tab, cx| tab.set_mic_level(None, cx));
                }
                return;
            }
        };
        let feed = cx.spawn(async move |this, cx| {
            loop {
                let fed = this.update(cx, |this, cx| {
                    // A call that started took the mic and stopped the test: the button and the
                    // meter say so.
                    if this
                        .account
                        .mic_test
                        .as_ref()
                        .is_some_and(|(test, _)| !test.is_running())
                    {
                        this.stop_mic_test(cx);
                        return false;
                    }
                    let level = this.account.mic_test.as_ref().map(|(test, _)| test.level());
                    if let (Some(level), Some(tab)) = (level, this.voice_tab(cx)) {
                        tab.update(cx, |tab, cx| tab.set_mic_level(Some(level), cx));
                    }
                    level.is_some()
                });
                if !matches!(fed, Ok(true)) {
                    return;
                }
                cx.background_executor().timer(MIC_TEST_POLL).await;
            }
        });
        self.account.mic_test = Some((test, feed));
        if let Some(tab) = self.voice_tab(cx) {
            tab.update(cx, |tab, cx| tab.set_mic_level(Some(0.), cx));
        }
    }

    /// Stops the mic test, if one runs: its mic closes, its meter goes.
    pub(super) fn stop_mic_test(&mut self, cx: &mut Context<Self>) {
        if self.account.mic_test.take().is_some()
            && let Some(tab) = self.voice_tab(cx)
        {
            tab.update(cx, |tab, cx| tab.set_mic_level(None, cx));
        }
    }

    /// The mic test's level now, for the rig: `None` while none runs.
    pub fn mic_test_level(&self) -> Option<f32> {
        self.account
            .mic_test
            .as_ref()
            .filter(|(test, _)| test.is_running())
            .map(|(test, _)| test.level())
    }

    // ---- Appearance. ----

    /// The appearance tab, and the whole app drawn in it: as soon as core has it, and on every
    /// change (core shows a change at once).
    fn refresh_appearance(&mut self, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        if !matches!(core.session(), SessionState::SignedIn { .. }) {
            return;
        }
        let view = core.appearance();
        if let Some(tab) = self.appearance_tab(cx) {
            let view = view.clone();
            tab.update(cx, |tab, cx| tab.set_view(view, cx));
        }
        if view.state != LoadState::Ready {
            return;
        }
        let choice = semaphore_ui::settings::theme_choice(view.appearance);
        let current = cx
            .try_global::<semaphore_ui::theme::Sem>()
            .map(|sem| sem.choice);
        if current != Some(choice) {
            semaphore_ui::theme::apply(choice, cx);
        }
        let name = choice.name();
        if self.settings.get().theme.as_deref() != Some(name.as_str()) {
            self.update_settings(|settings| settings.theme = Some(name));
        }
    }

    fn appearance_tab(&self, cx: &App) -> Option<Entity<AppearanceSettings>> {
        self.account
            .settings
            .as_ref()
            .map(|screen| screen.read(cx).appearance())
    }

    fn on_appearance(
        &mut self,
        _: &Entity<AppearanceSettings>,
        event: &AppearanceEvent,
        _: &mut Window,
        _: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match *event {
            AppearanceEvent::Update(patch) => exec.fire(async move {
                if let Err(error) = core.update_appearance(patch).await {
                    log::warn!("saving the appearance failed: {error}");
                }
            }),
            AppearanceEvent::Retry => core.retry_failed(),
        }
    }

    // ---- Sessions. ----

    fn sessions_tab(&self, cx: &App) -> Option<Entity<SessionsSettings>> {
        self.account
            .settings
            .as_ref()
            .map(|screen| screen.read(cx).sessions())
    }

    /// Only while the settings page is open: the list is a request of its own.
    fn refresh_sessions(&mut self, cx: &mut Context<Self>) {
        let on_settings = self
            .shell
            .as_ref()
            .is_some_and(|shell| matches!(shell.read(cx).nav().current(), Route::Settings { .. }));
        let (Some(core), Some(tab)) = (self.core(), self.sessions_tab(cx)) else {
            return;
        };
        if !on_settings {
            return;
        }
        let view = core.sessions();
        tab.update(cx, |tab, cx| tab.set_view(view, cx));
    }

    fn on_sessions(
        &mut self,
        tab: &Entity<SessionsSettings>,
        event: &SessionsEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        let tab = tab.downgrade();
        match event.clone() {
            SessionsEvent::Revoke { session_id } => exec.run(
                window,
                cx,
                async move { core.revoke_session(session_id).await },
                move |_, result, _, cx| {
                    let notice = result.err().map(|error| {
                        (
                            Severity::Error,
                            failure("Couldn't sign that device out", &error),
                        )
                    });
                    tab.update(cx, |tab, cx| tab.set_notice(notice, cx)).ok();
                },
            ),
            SessionsEvent::RevokeOthers => exec.run(
                window,
                cx,
                async move { core.revoke_other_sessions().await },
                move |_, result, _, cx| {
                    let notice = match result {
                        Ok(count) => (
                            Severity::Success,
                            match count {
                                1 => "Signed out 1 other device".to_owned(),
                                count => format!("Signed out {count} other devices"),
                            },
                        ),
                        Err(error) => (
                            Severity::Error,
                            failure("Couldn't sign the other devices out", &error),
                        ),
                    };
                    tab.update(cx, |tab, cx| tab.set_notice(Some(notice), cx))
                        .ok();
                },
            ),
            SessionsEvent::Retry => core.retry_failed(),
        }
    }

    // ---- The desktop app. ----

    fn desktop_tab(&self, cx: &App) -> Option<Entity<DesktopAppSettings>> {
        self.account
            .settings
            .as_ref()
            .map(|screen| screen.read(cx).desktop())
    }

    fn refresh_desktop_tab(&mut self, cx: &mut Context<Self>) {
        let Some(tab) = self.desktop_tab(cx) else {
            return;
        };
        let settings = self.settings.get();
        let registrar = self.config.links.clone();
        let server_url = self
            .services
            .as_ref()
            .and_then(|services| services.backend.server_url())
            .unwrap_or_default();
        let state = DesktopAppState {
            close_to_tray: settings.close_to_tray,
            links: self.account.links,
            link_preview_images: settings.link_preview_images,
            server_url,
            server_name: self.server.as_ref().map(|(_, name)| name.clone()),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            server_version: None,
            links_note: registrar.as_ref().and_then(|links| links.note()),
            links_blocked: registrar.as_ref().and_then(|links| links.blocked()),
        };
        tab.update(cx, |tab, cx| tab.set_state(state, cx));
    }

    /// Asks the OS who opens `semaphore://` links, off the UI thread.
    fn refresh_links(&mut self, cx: &mut Context<Self>) {
        let (Some(registrar), Some(services)) = (self.config.links.clone(), &self.services) else {
            return;
        };
        let asked = services
            .exec
            .handle()
            .spawn_blocking(move || registrar.status());
        cx.spawn(async move |this, cx| {
            let Ok(links) = asked.await else {
                return;
            };
            this.update(cx, |this, cx| {
                this.account.links = links;
                this.refresh_desktop_tab(cx);
            })
            .ok();
        })
        .detach();
    }

    fn on_desktop_settings(
        &mut self,
        _: &Entity<DesktopAppSettings>,
        event: &DesktopAppEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match *event {
            DesktopAppEvent::SetCloseToTray(on) => {
                self.update_settings(|settings| settings.close_to_tray = on);
                if let Some(tray) = cx
                    .try_global::<crate::desktop::DesktopShell>()
                    .and_then(|shell| shell.tray())
                {
                    tray.set_close_to_tray(on);
                }
                self.refresh_desktop_tab(cx);
            }
            DesktopAppEvent::SetLinkPreviewImages(on) => {
                self.update_settings(|settings| settings.link_preview_images = on);
                if let Some(media) = &self.media {
                    media.previews.set_allowed(on);
                }
                self.refresh_desktop_tab(cx);
                cx.refresh_windows();
            }
            DesktopAppEvent::RegisterLinkHandler => {
                let (Some(registrar), Some(services)) = (self.config.links.clone(), &self.services)
                else {
                    return;
                };
                let asked = services
                    .exec
                    .handle()
                    .spawn_blocking(move || registrar.register());
                cx.spawn(async move |this, cx| {
                    let Ok(result) = asked.await else {
                        return;
                    };
                    this.update(cx, |this, cx| {
                        match result {
                            Ok(links) => this.account.links = links,
                            Err(error) => log::warn!("registering semaphore:// links: {error}"),
                        }
                        this.refresh_desktop_tab(cx);
                    })
                    .ok();
                })
                .detach();
            }
            // Another server: sign out here, then the server step.
            DesktopAppEvent::ChangeServer => {
                self.server = None;
                self.sign_out(cx);
            }
        }
    }

    // ---- Home and creating a community. ----

    fn home_communities(&self) -> Section<String> {
        let Some(core) = self.core() else {
            return Section::Loading;
        };
        match core.load_state(ViewKey::Communities) {
            LoadState::Loading => Section::Loading,
            LoadState::Failed { error } => Section::Failed(error),
            LoadState::Ready => {
                Section::Ready(core.communities().into_iter().map(|row| row.id).collect())
            }
        }
    }

    fn refresh_home(&mut self, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        if !matches!(core.session(), SessionState::SignedIn { .. }) {
            return;
        }
        let communities = self.home_communities();
        let rows = core.communities();
        let mut mentions = Vec::new();
        let mut voice = Vec::new();
        for community in &rows {
            // Only communities with something to say: each one's channels are a request.
            if community.mention_count == 0 && community.unread_count == 0 {
                continue;
            }
            for channel in core.channels(community.id.clone()) {
                if channel.mention_count > 0 {
                    mentions.push(HomeMention {
                        community_id: community.id.clone(),
                        community_name: community.name.clone(),
                        channel_id: channel.id.clone(),
                        channel_name: channel.name.clone(),
                        mention_count: channel.mention_count,
                    });
                }
                if channel.kind == ChannelKind::Voice && !channel.voice_users.is_empty() {
                    voice.push(HomeVoiceChannel {
                        community_id: community.id.clone(),
                        community_name: community.name.clone(),
                        channel_id: channel.id,
                        channel_name: channel.name,
                        users: channel.voice_users,
                    });
                }
            }
        }
        let dms = core.dm_list();
        let unread_dms = match dms.state {
            LoadState::Loading => Section::Loading,
            LoadState::Failed { error } => Section::Failed(error),
            LoadState::Ready => {
                Section::Ready(dms.rows.into_iter().filter(|row| row.unread > 0).collect())
            }
        };
        fn ready<T>(communities: &Section<String>, items: Vec<T>) -> Section<T> {
            match communities {
                Section::Ready(_) => Section::Ready(items),
                Section::Failed(error) => Section::Failed(error.clone()),
                Section::Loading => Section::Loading,
            }
        }
        let data = HomeData {
            mentions: ready(&communities, mentions),
            voice: ready(&communities, voice),
            unread_dms,
            communities,
        };
        let can_create = core.instance_permissions().can_create_community;
        if let Some(home) = self.account.home.clone() {
            home.update(cx, |home, cx| {
                home.set_data(data, cx);
                home.set_can_create_community(can_create, cx);
            });
        }
        if let Some(gate) = self.account.gate.clone() {
            gate.update(cx, |gate, cx| gate.set_can_create_community(can_create, cx));
        }
    }

    fn on_home<T: 'static>(
        &mut self,
        _: &Entity<T>,
        event: &HomeEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            HomeEvent::OpenChannel {
                community_id,
                channel_id,
            } => self.shell_navigate(
                Route::Channel {
                    community_id,
                    channel_id,
                },
                cx,
            ),
            HomeEvent::OpenDm { group_id } => self.shell_navigate(
                Route::DirectMessage {
                    dm_group_id: group_id,
                },
                cx,
            ),
            HomeEvent::OpenNotifications => self.toggle_centre(cx),
            HomeEvent::OpenDms => self.shell_navigate(Route::DirectMessages, cx),
            HomeEvent::Retry(_) => {
                if let Some(core) = self.core() {
                    core.retry_failed();
                }
            }
            HomeEvent::CreateCommunity => self.open_create_community(window, cx),
        }
    }

    pub(super) fn open_create_community(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let form = cx.new(|cx| CreateCommunityForm::new(window, cx));
        self.account
            .subscriptions
            .push(cx.subscribe_in(&form, window, Self::on_create_community));
        self.account.create = Some(form);
        cx.notify();
    }

    fn on_create_community(
        &mut self,
        form: &Entity<CreateCommunityForm>,
        event: &CreateCommunityEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            CreateCommunityEvent::Submit(community) => {
                let (Some(core), Some(exec)) = (
                    self.core(),
                    self.services.as_ref().map(|services| services.exec.clone()),
                ) else {
                    return;
                };
                form.update(cx, |form, cx| {
                    form.set_error(None, cx);
                    form.set_busy(true, cx);
                });
                let form = form.downgrade();
                exec.run(
                    window,
                    cx,
                    async move { core.create_community(community).await },
                    move |this, result, _, cx| match result {
                        Ok(created) => {
                            this.account.create = None;
                            this.shell_navigate(
                                Route::Community {
                                    community_id: created.id,
                                },
                                cx,
                            );
                        }
                        Err(error) => {
                            form.update(cx, |form, cx| {
                                form.set_busy(false, cx);
                                form.set_error(Some(failure("Couldn't create it", &error)), cx);
                            })
                            .ok();
                        }
                    },
                );
            }
            CreateCommunityEvent::Cancel => {
                self.account.create = None;
                cx.notify();
            }
        }
    }

    // ---- The desktop sign-in banner. ----

    fn desktop_sign_in_banner(
        &self,
        signed_in: &DesktopSignIn,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let message = match &signed_in.ip_address {
            Some(ip) => format!(
                "A desktop app signed in to your account from {ip}. If this wasn't you, change your password."
            ),
            None => {
                "A desktop app signed in to your account. If this wasn't you, change your password."
                    .to_owned()
            }
        };
        let review = cx.entity().downgrade();
        let dismiss = review.clone();
        div()
            .absolute()
            .top(px(12.))
            .left_0()
            .right_0()
            .flex()
            .justify_center()
            .px(px(16.))
            .child(
                div()
                    .id("desktop-sign-in-banner")
                    .test_support()
                    .occlude()
                    .w_full()
                    .max_w(px(640.))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .p(px(8.))
                    .rounded(px(8.))
                    .bg(cx.sem().paper)
                    .shadow_lg()
                    .child(Alert::new(Severity::Warning, message))
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .gap(px(8.))
                            .child(Button::new("desktop-sign-in-dismiss", "Dismiss").on_click(
                                move |_, _, cx| {
                                    dismiss
                                        .update(cx, |this, cx| {
                                            this.account.desktop_sign_in = None;
                                            cx.notify();
                                        })
                                        .ok();
                                },
                            ))
                            .child(
                                Button::new("desktop-sign-in-review", "Review sessions")
                                    .contained()
                                    .on_click(move |_, _, cx| {
                                        review
                                            .update(cx, |this, cx| {
                                                this.account.desktop_sign_in = None;
                                                this.open_settings(SettingsTab::Sessions, cx);
                                            })
                                            .ok();
                                    }),
                            ),
                    ),
            )
            .into_any_element()
    }

    /// The banner's notice, for the rig.
    pub fn desktop_sign_in(&self) -> Option<&DesktopSignIn> {
        self.account.desktop_sign_in.as_ref()
    }
}

use semaphore_ui::theme::SemTheme as _;

fn failure(what: &str, error: &CoreError) -> String {
    match error {
        CoreError::Failed { message } => format!("{what}: {message}"),
        CoreError::Unavailable { what: why } => format!("{what}: {why}"),
    }
}

/// A picked image's bytes, for `ProfileEditForm::set_picked` (which checks type and size).
fn read_image(path: &std::path::Path) -> Result<DraftFile, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("Couldn't read that file: {error}"))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_owned());
    Ok(DraftFile {
        mime_type: crate::conversation::mime_for(&name),
        name,
        bytes,
    })
}

/// The voice tab's values, from the local settings.
pub fn voice_state(voice: &crate::settings::VoiceSettings) -> VoiceVideoState {
    VoiceVideoState {
        processing: Processing {
            echo_cancellation: voice.echo_cancellation,
            noise_suppression: voice.noise_suppression,
            auto_gain: voice.auto_gain,
        },
        mic_quality: match voice.mic_quality {
            MicQuality::Standard => semaphore_ui::settings::MicQuality::Standard,
            MicQuality::High => semaphore_ui::settings::MicQuality::High,
            MicQuality::Music => semaphore_ui::settings::MicQuality::Music,
        },
        input_mode: match voice.input_mode {
            InputMode::VoiceActivity { threshold } => {
                semaphore_ui::settings::InputMode::VoiceActivity { threshold }
            }
            InputMode::PushToTalk => semaphore_ui::settings::InputMode::PushToTalk,
        },
        ptt_key: voice.push_to_talk_key.clone(),
        input_device: voice.input_device.clone(),
        output_device: voice.output_device.clone(),
        camera: voice.camera_device.clone(),
        share: ShareQuality {
            resolution: voice.screen_share.resolution.resolution(),
            fps: voice.screen_share.fps,
            audio: voice.screen_share.audio,
        },
    }
}

/// The voice tab's values, into the local settings.
pub fn apply_voice_state(voice: &mut crate::settings::VoiceSettings, state: &VoiceVideoState) {
    voice.echo_cancellation = state.processing.echo_cancellation;
    voice.noise_suppression = state.processing.noise_suppression;
    voice.auto_gain = state.processing.auto_gain;
    voice.mic_quality = match state.mic_quality {
        semaphore_ui::settings::MicQuality::Standard => MicQuality::Standard,
        semaphore_ui::settings::MicQuality::High => MicQuality::High,
        semaphore_ui::settings::MicQuality::Music => MicQuality::Music,
    };
    voice.input_mode = match state.input_mode {
        semaphore_ui::settings::InputMode::VoiceActivity { threshold } => {
            InputMode::VoiceActivity { threshold }
        }
        semaphore_ui::settings::InputMode::PushToTalk => InputMode::PushToTalk,
    };
    voice.push_to_talk_key = state.ptt_key.clone();
    voice.input_device = state.input_device.clone();
    voice.output_device = state.output_device.clone();
    voice.camera_device = state.camera.clone();
    voice.screen_share.resolution = share_size(state.share.resolution);
    voice.screen_share.fps = state.share.fps;
    voice.screen_share.audio = state.share.audio;
}

fn share_size(resolution: ShareResolution) -> ShareSize {
    ShareSize::ALL
        .into_iter()
        .find(|size| size.resolution() == resolution)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::VoiceSettings;
    use core::prelude::v1::test;

    #[test]
    fn the_voice_tab_round_trips_through_the_settings() {
        let mut voice = VoiceSettings {
            input_device: Some("mic".into()),
            camera_device: Some("cam".into()),
            input_mode: InputMode::VoiceActivity { threshold: 40 },
            mic_quality: MicQuality::Standard,
            push_to_talk_key: Some("f13".into()),
            ..VoiceSettings::default()
        };
        voice.screen_share.resolution = ShareSize::P720;
        let state = voice_state(&voice);
        assert_eq!(
            state.input_mode,
            semaphore_ui::settings::InputMode::VoiceActivity { threshold: 40 }
        );
        assert_eq!(state.share.resolution, ShareResolution::P720);
        let mut back = VoiceSettings::default();
        apply_voice_state(&mut back, &state);
        assert_eq!(back, voice);
        let ptt = VoiceVideoState {
            input_mode: semaphore_ui::settings::InputMode::PushToTalk,
            ..state
        };
        apply_voice_state(&mut back, &ptt);
        assert_eq!(back.input_mode, InputMode::PushToTalk);
    }
}
