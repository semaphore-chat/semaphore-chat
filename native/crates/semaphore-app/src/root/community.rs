//! W5: community settings in the app (agent A). `Route::CommunitySettings` shows
//! `CommunitySettingsScreen`; this module builds it per community, feeds every tab from core on
//! its `ViewChanged`, runs the tabs' events as core commands, and handles the picks and uploads
//! (avatar, banner, emoji image, sound file), the soundboard preview, the invite link base and the
//! webhook URL shown once. The Roles and Moderation tabs, and the Edit Channel permissions, are
//! slots `roles.rs` and `moderation.rs` fill (`roles_slot`, `moderation_slot`,
//! `channel_permissions_slot`); the Members tab's per-member actions open their dialogs
//! (`open_role_assignment`, `open_member_menu`).
//!
//! - **One screen, while the route is open.** Opening the route builds it for that community (and
//!   another community's replaces it); leaving the route drops it, so nothing here reads core
//!   while it isn't on screen.
//! - **No view model kept here.** Every feed reads core when it runs and pushes through the tab's
//!   `set_*`. Which `ViewChanged` re-reads which setter is [`feeds`], a pure function of the view
//!   and [`OpenState`] (the open community, tab, edit dialog, private channel and mention group):
//!   only the open tab's views are read, since a read fetches. A tab change feeds that tab once
//!   ([`tab_keys`]).
//! - **Continuations hold a [`Ticket`]**: a weak handle to the screen they're for and its
//!   community. A pick, a search or a preview that lands after the screen was dropped or replaced
//!   is swallowed.
//! - **The soundboard preview** fetches the file (`Core::file`, the session's auth), decodes it
//!   (our WAV reader, else `player::sound_decoder` when built with the player), and plays it
//!   through the app's `Sounds` on the output device setting. One at a time; leaving the tab, the
//!   route or the session stops it.
//!
//! Signing out drops everything here (`drop_community`); `CoreEvent::CommunityRemoved` closes the
//! screen if it's for that community, `CoreEvent::ChannelRemoved` the Edit Channel dialog if it's
//! for that channel.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::model::{ChannelKind, DraftFile, LoadState, SessionState, ViewKey};
use semaphore_core::platform::CoreError;
use semaphore_core::{Core, CoreEvent};
use semaphore_ui::community_settings::rules::first_open_tab;
use semaphore_ui::community_settings::{
    ChannelsEvent, ChannelsTab, CommunitySettingsScreen, CommunityShellEvent, CommunityTab,
    EmojiEvent, EmojiTab, InvitesEvent, InvitesTab, MembersEvent, MembersTab, MentionGroupsEvent,
    MentionGroupsTab, OverviewEvent, OverviewTab, PrivateChannelsEvent, PrivateChannelsTab,
    SoundboardEvent, SoundboardTab,
};
use semaphore_ui::nav::Route;
use semaphore_ui::panel::PanelClock;
use std::path::Path;

/// What the open screen shows, which decides what each `ViewChanged` feeds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenState {
    pub community_id: String,
    pub tab: CommunityTab,
    /// The channel the Edit Channel dialog is open on (`ChannelsEvent::OpenEdit`).
    pub edit_channel: Option<String>,
    /// The private channel picked on its tab (`PrivateChannelsEvent::Select`).
    pub private_channel: Option<String>,
    /// The mention group open in its editor (`MentionGroupsEvent::Open`).
    pub group: Option<String>,
}

impl OpenState {
    pub fn new(community_id: impl Into<String>, tab: CommunityTab) -> Self {
        Self {
            community_id: community_id.into(),
            tab,
            edit_channel: None,
            private_channel: None,
            group: None,
        }
    }
}

/// One setter to call with what core says now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Feed {
    /// `CommunitySettingsScreen::set_permissions`: the nav and every tab's caps.
    Permissions,
    /// `CommunitySettingsScreen::set_settings`: the overview, the name, the shared op.
    Settings,
    /// `ChannelsTab::set_channels`.
    Channels,
    /// `PrivateChannelsTab::set_channels`.
    PrivateChannels,
    /// `MembersTab::set_members`.
    Members,
    /// `PrivateChannelsTab::set_members`: whom a private channel can add.
    PrivateCandidates,
    /// `MentionGroupsTab::set_members`: whom a group can hold.
    GroupCandidates,
    /// `PrivateChannelsTab::set_view` for this channel.
    PrivateMembers(String),
    /// `MentionGroupsTab::set_groups`.
    AliasGroups,
    /// `MentionGroupsTab::set_group` for this group.
    AliasGroup(String),
    /// `EmojiTab::set_view`.
    Emoji,
    /// `SoundboardTab::set_view`.
    Soundboard,
    /// `ChannelsTab::set_webhooks` for the channel being edited.
    Webhooks(String),
    /// `InvitesTab::set_view`.
    Invites,
}

/// Which setters a `ViewChanged { view }` re-reads, with `open` on screen. Views of another
/// community, of a tab that isn't open, or of a channel or group that isn't the one picked feed
/// nothing.
pub fn feeds(view: &ViewKey, open: &OpenState) -> Vec<Feed> {
    let ours = |community_id: &str| community_id == open.community_id;
    let tab = open.tab;
    let feed = match view {
        ViewKey::CommunityPermissions { community_id } if ours(community_id) => Feed::Permissions,
        ViewKey::CommunitySettings { community_id } if ours(community_id) => Feed::Settings,
        ViewKey::Channels { community_id } if ours(community_id) => match tab {
            CommunityTab::Channels => Feed::Channels,
            CommunityTab::PrivateChannels => Feed::PrivateChannels,
            _ => return Vec::new(),
        },
        ViewKey::Members { community_id } if ours(community_id) => match tab {
            CommunityTab::Members => Feed::Members,
            CommunityTab::PrivateChannels => Feed::PrivateCandidates,
            CommunityTab::MentionGroups => Feed::GroupCandidates,
            _ => return Vec::new(),
        },
        ViewKey::PrivateMembers { channel_id }
            if tab == CommunityTab::PrivateChannels
                && open.private_channel.as_deref() == Some(channel_id.as_str()) =>
        {
            Feed::PrivateMembers(channel_id.clone())
        }
        ViewKey::AliasGroups { community_id }
            if ours(community_id) && tab == CommunityTab::MentionGroups =>
        {
            Feed::AliasGroups
        }
        ViewKey::AliasGroup { group_id }
            if tab == CommunityTab::MentionGroups
                && open.group.as_deref() == Some(group_id.as_str()) =>
        {
            Feed::AliasGroup(group_id.clone())
        }
        ViewKey::CustomEmoji { community_id }
            if ours(community_id) && tab == CommunityTab::Emoji =>
        {
            Feed::Emoji
        }
        ViewKey::Soundboard { community_id }
            if ours(community_id) && tab == CommunityTab::Soundboard =>
        {
            Feed::Soundboard
        }
        ViewKey::Webhooks { channel_id }
            if tab == CommunityTab::Channels
                && open.edit_channel.as_deref() == Some(channel_id.as_str()) =>
        {
            Feed::Webhooks(channel_id.clone())
        }
        ViewKey::Invites if tab == CommunityTab::Invites => Feed::Invites,
        _ => return Vec::new(),
    };
    vec![feed]
}

/// The views `open` reads: with `always`, the two every tab needs too (the permissions and the
/// settings, for the nav and the name); without, only the open tab's, for a tab change.
pub fn tab_keys(open: &OpenState, always: bool) -> Vec<ViewKey> {
    let community_id = open.community_id.clone();
    let mut keys = Vec::new();
    if always {
        keys.push(ViewKey::CommunityPermissions {
            community_id: community_id.clone(),
        });
        keys.push(ViewKey::CommunitySettings {
            community_id: community_id.clone(),
        });
    }
    let channels = ViewKey::Channels {
        community_id: community_id.clone(),
    };
    let members = ViewKey::Members {
        community_id: community_id.clone(),
    };
    match open.tab {
        CommunityTab::Overview | CommunityTab::Roles | CommunityTab::Moderation => {}
        CommunityTab::Members => keys.push(members),
        CommunityTab::Channels => {
            keys.push(channels);
            if let Some(channel_id) = &open.edit_channel {
                keys.push(ViewKey::Webhooks {
                    channel_id: channel_id.clone(),
                });
            }
        }
        CommunityTab::PrivateChannels => {
            keys.push(channels);
            keys.push(members);
            if let Some(channel_id) = &open.private_channel {
                keys.push(ViewKey::PrivateMembers {
                    channel_id: channel_id.clone(),
                });
            }
        }
        CommunityTab::MentionGroups => {
            keys.push(ViewKey::AliasGroups { community_id });
            keys.push(members);
            if let Some(group_id) = &open.group {
                keys.push(ViewKey::AliasGroup {
                    group_id: group_id.clone(),
                });
            }
        }
        CommunityTab::Emoji => keys.push(ViewKey::CustomEmoji { community_id }),
        CommunityTab::Soundboard => keys.push(ViewKey::Soundboard { community_id }),
        CommunityTab::Invites => keys.push(ViewKey::Invites),
    }
    keys
}

/// What `open` feeds when it opens (`always`) or its tab changes.
pub fn tab_feeds(open: &OpenState, always: bool) -> Vec<Feed> {
    tab_keys(open, always)
        .iter()
        .flat_map(|key| feeds(key, open))
        .collect()
}

/// What a continuation (a pick being read, a search, a preview being fetched) belongs to: the
/// screen it was started from and its community. Once that screen is dropped or replaced, what it
/// brings back is swallowed.
pub struct Ticket<T> {
    screen: WeakEntity<T>,
    community_id: String,
}

impl<T> Clone for Ticket<T> {
    fn clone(&self) -> Self {
        Self {
            screen: self.screen.clone(),
            community_id: self.community_id.clone(),
        }
    }
}

impl<T: 'static> Ticket<T> {
    pub fn new(screen: &Entity<T>, community_id: impl Into<String>) -> Self {
        Self {
            screen: screen.downgrade(),
            community_id: community_id.into(),
        }
    }

    /// Whether `held` (the screen on show now, for `community_id`) is still the one this was for.
    pub fn holds(&self, held: Option<&Entity<T>>, community_id: Option<&str>) -> bool {
        held.is_some_and(|held| held.entity_id() == self.screen.entity_id())
            && community_id == Some(self.community_id.as_str())
            && self.screen.upgrade().is_some()
    }
}

/// This session's community settings: the screen on show, if any, and what it listens to.
#[derive(Default)]
pub struct CommunityAdmin {
    pub(super) screen: Option<Entity<CommunitySettingsScreen>>,
    open: Option<OpenState>,
    /// The channel list's "+" asked for the create dialog once this community's screen is up.
    pending_create: Option<String>,
    /// Bumped by each preview and each stop: a fetch whose number isn't this any more is dropped.
    preview: u64,
    subscriptions: Vec<Subscription>,
}

impl CommunityAdmin {
    fn ticket(&self) -> Option<Ticket<CommunitySettingsScreen>> {
        let screen = self.screen.as_ref()?;
        Some(Ticket::new(
            screen,
            self.open.as_ref()?.community_id.clone(),
        ))
    }

    fn holds(&self, ticket: &Ticket<CommunitySettingsScreen>) -> bool {
        ticket.holds(
            self.screen.as_ref(),
            self.open.as_ref().map(|open| open.community_id.as_str()),
        )
    }

    fn community_id(&self) -> Option<String> {
        self.open.as_ref().map(|open| open.community_id.clone())
    }
}

/// What a refused change says: the server's words, else what failed.
fn message(what: &str, error: &CoreError) -> String {
    match error {
        CoreError::Failed { message } if !message.trim().is_empty() => message.clone(),
        CoreError::Failed { .. } => what.to_owned(),
        CoreError::Unavailable { what: why } => format!("{what}: {why}"),
    }
}

impl AppRoot {
    /// Signed out: no screen of the last session stays, and its preview stops.
    pub(super) fn drop_community(&mut self) {
        self.stop_sound_preview();
        self.community = CommunityAdmin::default();
    }

    /// The soundboard tab's preview, for the rig: whether one plays, and how many were asked for.
    pub fn sound_preview(&self) -> (bool, usize) {
        self.inbox.sounds().map_or((false, 0), |sounds| {
            (sounds.previewing(), sounds.previews())
        })
    }

    /// The settings screen on show: its community and tab, for the rig.
    pub fn community_settings_open(&self) -> Option<OpenState> {
        self.community.open.clone()
    }

    pub(super) fn community_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        let Some(open) = self.community.open.clone() else {
            return;
        };
        match event {
            CoreEvent::ViewChanged { view } => {
                let feeds = feeds(view, &open);
                if !feeds.is_empty() {
                    self.feed_later(open.community_id, feeds, cx);
                }
            }
            CoreEvent::CommunityRemoved { community_id, .. }
                if *community_id == open.community_id =>
            {
                // B's shell arm routes home; the screen goes now, with what's open in it.
                self.close_community_screen(cx);
                cx.notify();
            }
            CoreEvent::ChannelRemoved {
                community_id,
                channel_id,
            } if *community_id == open.community_id => {
                if open.edit_channel.as_deref() == Some(channel_id.as_str()) {
                    self.close_edit_channel(cx);
                    // The tab closes its dialog once the list it's given lacks the channel.
                    self.feed_later(open.community_id, vec![Feed::Channels], cx);
                }
                if open.private_channel.as_deref() == Some(channel_id.as_str())
                    && let Some(open) = self.community.open.as_mut()
                {
                    open.private_channel = None;
                }
            }
            _ => {}
        }
    }

    /// The route changed: build, retab or drop the screen.
    pub(super) fn community_navigated(
        &mut self,
        route: &Route,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Route::CommunitySettings { community_id, tab } = route else {
            if self.community.screen.is_some() {
                self.close_community_screen(cx);
            }
            return;
        };
        let same = self.community.screen.is_some()
            && self.community.community_id().as_deref() == Some(community_id.as_str());
        if !same {
            self.build_community_screen(community_id, *tab, window, cx);
        } else if let Some(screen) = self.community.screen.clone()
            && screen.read(cx).tab() != *tab
        {
            screen.update(cx, |screen, cx| screen.set_tab(*tab, cx));
        }
        self.community_sync_tab(window, cx);
        if self.community.pending_create.as_deref() == Some(community_id.as_str()) {
            self.community.pending_create = None;
            if let Some(screen) = self.community.screen.clone() {
                if screen.read(cx).tab() != CommunityTab::Channels {
                    screen.update(cx, |screen, cx| screen.set_tab(CommunityTab::Channels, cx));
                    self.community_sync_tab(window, cx);
                }
                let channels = screen.read(cx).channels();
                channels.update(cx, |tab, cx| {
                    tab.open_create("", ChannelKind::Text, false, window, cx);
                    cx.notify();
                });
            }
        }
    }

    /// The middle column for `Route::CommunitySettings`, once the screen is built.
    pub(super) fn community_content(&self, route: &Route, _cx: &App) -> Option<AnyElement> {
        match route {
            Route::CommunitySettings { .. } => self
                .community
                .screen
                .clone()
                .map(IntoElement::into_any_element),
            _ => None,
        }
    }

    /// Dialogs this module draws over the shell: none (the tabs draw their own).
    pub(super) fn community_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// The sidebar's settings button (`ShellEvent::OpenCommunitySettings`): the settings on `tab`
    /// (`None`: the first tab the caps open).
    pub(super) fn open_community_settings(
        &mut self,
        community_id: String,
        tab: Option<CommunityTab>,
        cx: &mut Context<Self>,
    ) {
        let tab = tab.unwrap_or_else(|| {
            self.core()
                .map(|core| core.community_permissions(community_id.clone()))
                .filter(|view| matches!(view.state, LoadState::Ready))
                .map(|view| first_open_tab(&view.caps))
                .unwrap_or_default()
        });
        self.shell_navigate(Route::CommunitySettings { community_id, tab }, cx);
    }

    /// The channel list's "+" (`ShellEvent::CreateChannel`): the Channels tab with its create
    /// dialog open (`ChannelsTab::open_create`), once the route has the screen up.
    pub(super) fn create_channel(
        &mut self,
        community_id: String,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.community.pending_create = Some(community_id.clone());
        self.open_community_settings(community_id, Some(CommunityTab::Channels), cx);
    }

    // ---- The screen. ----

    fn build_community_screen(
        &mut self,
        community_id: &str,
        tab: CommunityTab,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.community.screen.is_some() {
            self.close_community_screen(cx);
        }
        let screen = cx.new(|cx| CommunitySettingsScreen::new(community_id, window, cx));
        let (overview, members, channels, private, groups, emoji, soundboard, invites) = {
            let screen = screen.read(cx);
            (
                screen.overview(),
                screen.members(),
                screen.channels(),
                screen.private_channels(),
                screen.mention_groups(),
                screen.emoji(),
                screen.soundboard(),
                screen.invites(),
            )
        };
        // Dates in the app's zone and clock; links to the server signed in to.
        let time = self.config.time;
        let clock = time.now;
        let me = self.core().and_then(|core| match core.session() {
            SessionState::SignedIn { me } => Some(me.id),
            _ => None,
        });
        let server_url = self
            .services
            .as_ref()
            .and_then(|services| services.backend.server_url())
            .unwrap_or_default();
        let max_file_bytes = self
            .server_info
            .as_ref()
            .and_then(|info| info.max_file_bytes);
        members.update(cx, |tab, cx| {
            tab.set_time(time, cx);
            tab.set_me(me, cx);
        });
        channels.update(cx, |tab, cx| tab.set_time(time, cx));
        private.update(cx, |tab, cx| tab.set_time(time, cx));
        invites.update(cx, |tab, cx| {
            tab.set_time(time, cx);
            tab.set_clock(clock, cx);
            tab.set_link_base(server_url, cx);
        });
        overview.update(cx, |tab, cx| tab.set_max_file_bytes(max_file_bytes, cx));
        // The route named a tab: open it. The default leaves the screen to pick the first its
        // caps open, once they're known.
        if tab != CommunityTab::default() {
            screen.update(cx, |screen, cx| screen.set_tab(tab, cx));
        }
        let subscriptions = vec![
            cx.subscribe_in(&screen, window, Self::on_community_shell),
            cx.subscribe_in(&overview, window, Self::on_overview),
            cx.subscribe_in(&members, window, Self::on_members),
            cx.subscribe_in(&channels, window, Self::on_channels),
            cx.subscribe_in(&private, window, Self::on_private_channels),
            cx.subscribe_in(&groups, window, Self::on_mention_groups),
            cx.subscribe_in(&emoji, window, Self::on_emoji),
            cx.subscribe_in(&soundboard, window, Self::on_soundboard),
            cx.subscribe_in(&invites, window, Self::on_invites),
        ];
        let open = OpenState::new(community_id, screen.read(cx).tab());
        self.community.screen = Some(screen.clone());
        self.community.open = Some(open.clone());
        self.community.subscriptions = subscriptions;
        // The other lanes' views for the Roles and Moderation tabs.
        let roles = self.roles_slot(community_id, window, cx);
        let moderation = self.moderation_slot(community_id, window, cx);
        screen.update(cx, |screen, cx| {
            screen.set_roles_slot(roles, cx);
            screen.set_moderation_slot(moderation, cx);
        });
        self.apply_feeds(&open.community_id, tab_feeds(&open, true), window, cx);
    }

    /// Drops the screen and what's open in it: the channel overrides, the preview.
    fn close_community_screen(&mut self, cx: &mut Context<Self>) {
        if self
            .community
            .open
            .as_ref()
            .is_some_and(|open| open.edit_channel.is_some())
        {
            self.close_channel_permissions(cx);
        }
        self.stop_sound_preview();
        let pending_create = self.community.pending_create.take();
        let preview = self.community.preview;
        self.community = CommunityAdmin {
            pending_create,
            preview,
            ..CommunityAdmin::default()
        };
    }

    /// The screen's tab moved (the user, the route, or the caps' first open tab): keep the route
    /// on it and feed it once. Leaving the soundboard stops its preview.
    fn community_sync_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(screen) = self.community.screen.clone() else {
            return;
        };
        let tab = screen.read(cx).tab();
        let Some(open) = self.community.open.as_mut() else {
            return;
        };
        if open.tab == tab {
            return;
        }
        let left_soundboard = open.tab == CommunityTab::Soundboard;
        open.tab = tab;
        let open = open.clone();
        if left_soundboard {
            self.stop_sound_preview();
        }
        if let Some(shell) = self.shell.clone() {
            let stale = matches!(
                shell.read(cx).nav().current(),
                Route::CommunitySettings { community_id, tab: shown }
                    if *community_id == open.community_id && *shown != tab
            );
            if stale {
                let route = Route::CommunitySettings {
                    community_id: open.community_id.clone(),
                    tab,
                };
                shell.update(cx, |shell, cx| shell.replace_route(route, cx));
            }
        }
        self.apply_feeds(&open.community_id, tab_feeds(&open, false), window, cx);
    }

    /// `feeds` with a window, after the event being handled: if the screen is still this
    /// community's by then.
    fn feed_later(&self, community_id: String, feeds: Vec<Feed>, cx: &mut Context<Self>) {
        let (handle, root) = (self.window, cx.entity().downgrade());
        cx.defer(move |cx| {
            handle
                .update(cx, |_, window, cx| {
                    root.update(cx, |root, cx| {
                        root.apply_feeds(&community_id, feeds, window, cx)
                    })
                    .ok();
                })
                .ok();
        });
    }

    /// Reads core for each feed and pushes it to its tab. The permissions can move the screen to
    /// the first tab they open, which is then fed too.
    fn apply_feeds(
        &mut self,
        community_id: &str,
        feeds: Vec<Feed>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(screen)) = (self.core(), self.community.screen.clone()) else {
            return;
        };
        if self.community.community_id().as_deref() != Some(community_id) {
            return;
        }
        let id = community_id.to_owned();
        // The display clock, as the pane's: the invites' expiry is shown against it.
        let clock = self.config.time.now;
        let mut retab = false;
        for feed in feeds {
            retab |= feed == Feed::Permissions;
            apply_feed(&core, &screen, &id, feed, clock, window, cx);
        }
        if retab {
            self.community_sync_tab(window, cx);
        }
    }

    // ---- Events. ----

    fn on_community_shell(
        &mut self,
        _: &Entity<CommunitySettingsScreen>,
        event: &CommunityShellEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            CommunityShellEvent::TabChanged(_) => self.community_sync_tab(window, cx),
            CommunityShellEvent::Close => {
                if let Some(community_id) = self.community.community_id() {
                    self.shell_navigate(Route::Community { community_id }, cx);
                }
            }
            CommunityShellEvent::RetryPermissions => {
                if let Some(core) = self.core() {
                    core.retry_failed();
                }
            }
        }
    }

    /// Runs a command whose outcome core reports on the view's op (its end in `AdminOp::finished`,
    /// which the tabs follow).
    fn admin_fire<T, F>(&self, what: &'static str, work: F)
    where
        F: std::future::Future<Output = Result<T, CoreError>> + Send + 'static,
    {
        if let Some(services) = &self.services {
            services.exec.fire(async move {
                if let Err(error) = work.await {
                    log::info!("{what}: {error}");
                }
            });
        }
    }

    fn on_overview(
        &mut self,
        tab: &Entity<OverviewTab>,
        event: &OverviewEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id)) = (self.core(), self.community.community_id()) else {
            return;
        };
        match event.clone() {
            OverviewEvent::PickImage { slot } => {
                let tab = tab.downgrade();
                self.pick_for_screen(
                    super::account::read_image,
                    window,
                    cx,
                    move |file, _, cx| {
                        tab.update(cx, |tab, cx| match file {
                            Ok(file) => tab.set_picked(slot, file, cx),
                            Err(message) => tab.set_pick_error(slot, message, cx),
                        })
                        .ok();
                    },
                );
            }
            OverviewEvent::Save { patch } => self.admin_fire("saving the community", async move {
                core.update_community(community_id, *patch).await
            }),
            OverviewEvent::Delete => self.admin_fire("deleting the community", async move {
                core.delete_community(community_id).await
            }),
            OverviewEvent::Retry => core.retry_failed(),
        }
    }

    fn on_members(
        &mut self,
        tab: &Entity<MembersTab>,
        event: &MembersEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id), Some(ticket)) = (
            self.core(),
            self.community.community_id(),
            self.community.ticket(),
        ) else {
            return;
        };
        match event.clone() {
            MembersEvent::Search { query } => {
                let Some(exec) = self.services.as_ref().map(|s| s.exec.clone()) else {
                    return;
                };
                let (tab, asked) = (tab.downgrade(), query.clone());
                exec.run(
                    window,
                    cx,
                    async move { core.search_users_to_add(community_id, query).await },
                    move |root, result, _, cx| {
                        if !root.community.holds(&ticket) {
                            return;
                        }
                        let result = result.map_err(|error| message("Search failed", &error));
                        tab.update(cx, |tab, cx| tab.set_search_results(&asked, result, cx))
                            .ok();
                    },
                );
            }
            MembersEvent::Add { user_id } => self.admin_fire("adding a member", async move {
                core.add_member(community_id, user_id).await
            }),
            MembersEvent::ManageRoles { user_id } => {
                self.open_role_assignment(community_id, user_id, window, cx)
            }
            MembersEvent::Moderate { user_id } => {
                self.open_member_menu(community_id, user_id, None, window, cx)
            }
        }
    }

    fn on_channels(
        &mut self,
        tab: &Entity<ChannelsTab>,
        event: &ChannelsEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id), Some(ticket)) = (
            self.core(),
            self.community.community_id(),
            self.community.ticket(),
        ) else {
            return;
        };
        match event.clone() {
            ChannelsEvent::Create(draft) => self.admin_fire("creating a channel", async move {
                core.create_channel(community_id, draft).await
            }),
            ChannelsEvent::Update { channel_id, draft } => self
                .admin_fire("updating a channel", async move {
                    core.update_channel(channel_id, draft).await
                }),
            ChannelsEvent::Delete { channel_id } => self
                .admin_fire("deleting a channel", async move {
                    core.delete_channel(channel_id).await
                }),
            ChannelsEvent::Move {
                channel_id,
                direction,
            } => self.admin_fire("moving a channel", async move {
                core.move_channel(channel_id, direction).await
            }),
            ChannelsEvent::OpenEdit { channel_id } => {
                if let Some(open) = self.community.open.as_mut() {
                    open.edit_channel = Some(channel_id.clone());
                }
                // Webhooks are a text channel's.
                let text = core
                    .channels(community_id.clone())
                    .iter()
                    .any(|channel| channel.id == channel_id && channel.kind == ChannelKind::Text);
                if text {
                    let view = core.webhooks(channel_id.clone());
                    tab.update(cx, |tab, cx| tab.set_webhooks(view, window, cx));
                }
                let slot = self.channel_permissions_slot(&community_id, &channel_id, window, cx);
                tab.update(cx, |tab, cx| tab.set_permissions_slot(slot, cx));
            }
            ChannelsEvent::CloseEdit => self.close_edit_channel(cx),
            ChannelsEvent::CreateWebhook {
                channel_id,
                name,
                avatar_url,
            } => {
                let Some(exec) = self.services.as_ref().map(|s| s.exec.clone()) else {
                    return;
                };
                let (tab, for_channel) = (tab.downgrade(), channel_id.clone());
                exec.run(
                    window,
                    cx,
                    async move { core.create_webhook(channel_id, name, avatar_url).await },
                    move |root, result, _, cx| {
                        let editing = root
                            .community
                            .open
                            .as_ref()
                            .and_then(|open| open.edit_channel.as_deref())
                            == Some(for_channel.as_str());
                        if !root.community.holds(&ticket) || !editing {
                            return;
                        }
                        // Shown once: the app keeps no copy.
                        match result {
                            Ok(created) => {
                                tab.update(cx, |tab, cx| tab.set_created_webhook(created, cx))
                                    .ok();
                            }
                            Err(error) => log::info!("creating a webhook: {error}"),
                        }
                    },
                );
            }
            ChannelsEvent::DeleteWebhook {
                channel_id,
                webhook_id,
            } => self.admin_fire("deleting a webhook", async move {
                core.delete_webhook(channel_id, webhook_id).await
            }),
            ChannelsEvent::RetryWebhooks | ChannelsEvent::Retry => core.retry_failed(),
        }
    }

    /// The Edit Channel dialog closed (or its channel went): its overrides go with it.
    fn close_edit_channel(&mut self, cx: &mut Context<Self>) {
        let Some(open) = self.community.open.as_mut() else {
            return;
        };
        if open.edit_channel.take().is_none() {
            return;
        }
        self.close_channel_permissions(cx);
        if let Some(screen) = self.community.screen.clone() {
            let channels = screen.read(cx).channels();
            channels.update(cx, |tab, cx| tab.set_permissions_slot(None, cx));
        }
    }

    fn on_private_channels(
        &mut self,
        tab: &Entity<PrivateChannelsTab>,
        event: &PrivateChannelsEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            PrivateChannelsEvent::Select { channel_id } => {
                if let Some(open) = self.community.open.as_mut() {
                    open.private_channel = Some(channel_id.clone());
                }
                let view = core.private_members(channel_id);
                tab.update(cx, |tab, cx| tab.set_view(view, cx));
            }
            PrivateChannelsEvent::Add {
                channel_id,
                user_id,
            } => self.admin_fire("adding a private channel member", async move {
                core.add_private_member(channel_id, user_id).await
            }),
            PrivateChannelsEvent::Remove {
                channel_id,
                user_id,
            } => self.admin_fire("removing a private channel member", async move {
                core.remove_private_member(channel_id, user_id).await
            }),
            PrivateChannelsEvent::Retry => core.retry_failed(),
        }
    }

    fn on_mention_groups(
        &mut self,
        tab: &Entity<MentionGroupsTab>,
        event: &MentionGroupsEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id)) = (self.core(), self.community.community_id()) else {
            return;
        };
        match event.clone() {
            MentionGroupsEvent::Open { group_id } => {
                if let Some(open) = self.community.open.as_mut() {
                    open.group = Some(group_id.clone());
                }
                let view = core.alias_group(group_id);
                tab.update(cx, |tab, cx| tab.set_group(view, window, cx));
            }
            MentionGroupsEvent::Create { name, member_ids } => {
                self.admin_fire("creating a mention group", async move {
                    core.create_alias_group(community_id, name, member_ids)
                        .await
                })
            }
            // A rename first, then the members, which every save sends (the tab closes its
            // editor once they're saved).
            MentionGroupsEvent::Save {
                group_id,
                name,
                member_ids,
            } => self.admin_fire("saving a mention group", async move {
                if let Some(name) = name {
                    core.rename_alias_group(group_id.clone(), name).await?;
                }
                core.set_alias_group_members(group_id, member_ids).await
            }),
            MentionGroupsEvent::Delete { group_id } => self
                .admin_fire("deleting a mention group", async move {
                    core.delete_alias_group(group_id).await
                }),
            MentionGroupsEvent::Retry => core.retry_failed(),
        }
    }

    fn on_emoji(
        &mut self,
        tab: &Entity<EmojiTab>,
        event: &EmojiEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id)) = (self.core(), self.community.community_id()) else {
            return;
        };
        match event.clone() {
            EmojiEvent::PickImage => {
                let tab = tab.downgrade();
                self.pick_for_screen(read_emoji, window, cx, move |file, _, cx| {
                    tab.update(cx, |tab, cx| match file {
                        Ok(file) => tab.set_picked(file, cx),
                        Err(message) => tab.set_pick_error(message, cx),
                    })
                    .ok();
                });
            }
            EmojiEvent::Add { name, file } => self.admin_fire("adding an emoji", async move {
                core.add_custom_emoji(community_id, name, file).await
            }),
            EmojiEvent::Delete { emoji_id } => self.admin_fire("deleting an emoji", async move {
                core.delete_custom_emoji(community_id, emoji_id).await
            }),
            EmojiEvent::Retry => core.retry_failed(),
        }
    }

    fn on_soundboard(
        &mut self,
        tab: &Entity<SoundboardTab>,
        event: &SoundboardEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id)) = (self.core(), self.community.community_id()) else {
            return;
        };
        match event.clone() {
            SoundboardEvent::PickAudio => {
                let tab = tab.downgrade();
                self.pick_for_screen(read_audio, window, cx, move |file, window, cx| {
                    tab.update(cx, |tab, cx| match file {
                        // With no name typed, the file's fills it.
                        Ok(file) => tab.set_picked(file, window, cx),
                        Err(message) => tab.set_pick_error(message, cx),
                    })
                    .ok();
                });
            }
            SoundboardEvent::Add(draft) => self.admin_fire("adding a sound", async move {
                core.add_sound(community_id, draft).await
            }),
            SoundboardEvent::Delete { sound_id } => self
                .admin_fire("deleting a sound", async move {
                    core.delete_sound(community_id, sound_id).await
                }),
            SoundboardEvent::Preview { file_id } => self.preview_sound(file_id, window, cx),
            SoundboardEvent::Retry => core.retry_failed(),
        }
    }

    fn on_invites(
        &mut self,
        _: &Entity<InvitesTab>,
        event: &InvitesEvent,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id)) = (self.core(), self.community.community_id()) else {
            return;
        };
        match event.clone() {
            InvitesEvent::Create(draft) => self.admin_fire("creating an invite", async move {
                core.create_invite(community_id, draft).await
            }),
            InvitesEvent::Delete { code } => self.admin_fire("deleting an invite", async move {
                core.delete_invite(code).await
            }),
            InvitesEvent::Retry => core.retry_failed(),
        }
    }

    // ---- Picks and the preview. ----

    /// The picker the config chose (the rig's queue in rigs), then `read` off the UI thread, then
    /// `apply` if the screen it was for is still on show.
    fn pick_for_screen(
        &mut self,
        read: fn(&Path) -> Result<DraftFile, String>,
        window: &mut Window,
        cx: &mut Context<Self>,
        apply: impl FnOnce(Result<DraftFile, String>, &mut Window, &mut App) + 'static,
    ) {
        let Some(ticket) = self.community.ticket() else {
            return;
        };
        let picked = crate::pick_files(
            crate::PickRequest {
                multiple: false,
                prompt: "Choose",
            },
            cx,
        );
        cx.spawn_in(window, async move |this, cx| {
            let Some(path) = picked.await.and_then(|paths| paths.into_iter().next()) else {
                return;
            };
            let read = cx.background_spawn(async move { read(&path) }).await;
            this.update_in(cx, |root, window, cx| {
                if root.community.holds(&ticket) {
                    apply(read, window, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    /// The soundboard's play button: fetch, decode, play, replacing any preview playing.
    fn preview_sound(&mut self, file_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(core), Some(exec), Some(ticket)) = (
            self.core(),
            self.services.as_ref().map(|s| s.exec.clone()),
            self.community.ticket(),
        ) else {
            return;
        };
        self.stop_sound_preview();
        let number = self.community.preview;
        exec.run(
            window,
            cx,
            async move {
                let bytes = core
                    .file(file_id, false)
                    .await
                    .map_err(|error| message("This sound couldn't be fetched", &error))?;
                tokio::task::spawn_blocking(move || decode_preview(&bytes))
                    .await
                    .map_err(|error| format!("decoding stopped: {error}"))?
            },
            move |root, decoded, _, _| {
                if !root.community.holds(&ticket) || root.community.preview != number {
                    return;
                }
                match decoded {
                    Ok((rate, samples)) => {
                        let device = root.settings.get().voice.output_device.clone();
                        if let Some(sounds) = root.inbox.sounds() {
                            sounds.play_pcm(rate, &samples, device);
                        }
                    }
                    Err(error) => log::info!("previewing a sound: {error}"),
                }
            },
        );
    }

    /// Stops the preview playing, and any on its way.
    fn stop_sound_preview(&mut self) {
        self.community.preview += 1;
        if let Some(sounds) = self.inbox.sounds()
            && sounds.previewing()
        {
            sounds.stop_preview();
        }
    }
}

/// One feed: read core, push to the tab.
fn apply_feed(
    core: &Core,
    screen: &Entity<CommunitySettingsScreen>,
    community_id: &str,
    feed: Feed,
    clock: PanelClock,
    window: &mut Window,
    cx: &mut App,
) {
    let id = community_id.to_owned();
    let channel_rows = || {
        let state = core.load_state(ViewKey::Channels {
            community_id: id.clone(),
        });
        (state, core.channels(id.clone()))
    };
    match feed {
        Feed::Permissions => {
            let view = core.community_permissions(id);
            screen.update(cx, |screen, cx| screen.set_permissions(view, cx));
        }
        Feed::Settings => {
            let view = core.community_settings(id);
            screen.update(cx, |screen, cx| screen.set_settings(view, window, cx));
        }
        Feed::Channels => {
            let tab = screen.read(cx).channels();
            let (state, rows) = channel_rows();
            tab.update(cx, |tab, cx| tab.set_channels(state, rows, cx));
        }
        Feed::PrivateChannels => {
            let tab = screen.read(cx).private_channels();
            let (state, rows) = channel_rows();
            tab.update(cx, |tab, cx| tab.set_channels(state, rows, cx));
        }
        Feed::Members => {
            let tab = screen.read(cx).members();
            let members = core.members(id);
            tab.update(cx, |tab, cx| tab.set_members(members, cx));
        }
        Feed::PrivateCandidates => {
            let tab = screen.read(cx).private_channels();
            let members = core.members(id);
            tab.update(cx, |tab, cx| tab.set_members(members, cx));
        }
        Feed::GroupCandidates => {
            let tab = screen.read(cx).mention_groups();
            let members = core.members(id);
            tab.update(cx, |tab, cx| tab.set_members(members, cx));
        }
        Feed::PrivateMembers(channel_id) => {
            let tab = screen.read(cx).private_channels();
            let view = core.private_members(channel_id);
            tab.update(cx, |tab, cx| tab.set_view(view, cx));
        }
        Feed::AliasGroups => {
            let tab = screen.read(cx).mention_groups();
            let view = core.alias_groups(id);
            tab.update(cx, |tab, cx| tab.set_groups(view, cx));
        }
        Feed::AliasGroup(group_id) => {
            let tab = screen.read(cx).mention_groups();
            let view = core.alias_group(group_id);
            tab.update(cx, |tab, cx| tab.set_group(view, window, cx));
        }
        Feed::Emoji => {
            let tab = screen.read(cx).emoji();
            let view = core.custom_emoji(id);
            tab.update(cx, |tab, cx| tab.set_view(view, window, cx));
        }
        Feed::Soundboard => {
            let tab = screen.read(cx).soundboard();
            let view = core.soundboard(id);
            tab.update(cx, |tab, cx| tab.set_view(view, cx));
        }
        Feed::Webhooks(channel_id) => {
            let tab = screen.read(cx).channels();
            let view = core.webhooks(channel_id);
            tab.update(cx, |tab, cx| tab.set_webhooks(view, window, cx));
        }
        Feed::Invites => {
            let tab = screen.read(cx).invites();
            // Listing invites needs instance READ_INSTANCE_INVITE: a member without the invite
            // permissions has none to list, so it isn't asked (it would only refuse).
            let instance = core.instance_permissions();
            let barred = instance.state == semaphore_core::model::LoadState::Ready
                && !instance.can_create_invite
                && !instance.can_delete_invite;
            let view = if barred {
                semaphore_core::model::InvitesView {
                    state: semaphore_core::model::LoadState::Ready,
                    community_id: id,
                    ..Default::default()
                }
            } else {
                core.community_invites(id)
            };
            tab.update(cx, |tab, cx| {
                tab.set_clock(clock, cx);
                tab.set_view(view, cx);
            });
        }
    }
}

// ---- Uploads. ----

/// What an upload is for, and so which files it takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upload {
    /// The soundboard's (`SoundboardManagement.tsx`): MP3, WAV, OGG, WebM or AAC, at most 1 MiB.
    Sound,
    /// Custom emoji (`CustomEmojiManagement.tsx`): PNG, GIF or WebP, at most 256 KB.
    Emoji,
}

impl Upload {
    /// The largest file taken, in bytes: the web's and the server's caps.
    pub fn max_bytes(self) -> u64 {
        match self {
            Upload::Sound => 1024 * 1024,
            Upload::Emoji => 256 * 1024,
        }
    }

    /// The type a file name's extension (any case) stands for, if this upload takes it: the
    /// MIME types the web's file inputs accept.
    pub fn mime_for(self, name: &str) -> Option<&'static str> {
        let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
        let mime = match (self, extension.as_str()) {
            (Upload::Sound, "mp3") => "audio/mpeg",
            (Upload::Sound, "wav") => "audio/wav",
            (Upload::Sound, "ogg" | "oga") => "audio/ogg",
            (Upload::Sound, "webm") => "audio/webm",
            (Upload::Sound, "aac") => "audio/aac",
            (Upload::Emoji, "png") => "image/png",
            (Upload::Emoji, "gif") => "image/gif",
            (Upload::Emoji, "webp") => "image/webp",
            _ => return None,
        };
        Some(mime)
    }

    fn kinds(self) -> &'static str {
        match self {
            Upload::Sound => "an MP3, WAV, OGG, WebM or AAC file",
            Upload::Emoji => "a PNG, GIF or WebP image",
        }
    }

    fn cap(self) -> &'static str {
        match self {
            Upload::Sound => "1 MB",
            Upload::Emoji => "256 KB",
        }
    }
}

/// Whether `bytes` start as `mime` files do. A file whose content says otherwise than its name is
/// refused here rather than by the server.
fn content_matches(mime: &str, bytes: &[u8]) -> bool {
    let riff = |form: &[u8]| bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(form);
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => riff(b"WEBP"),
        "audio/wav" => riff(b"WAVE"),
        "audio/ogg" => bytes.starts_with(b"OggS"),
        "audio/webm" => bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]),
        // An ID3 tag, or an MPEG audio frame (layers I to III).
        "audio/mpeg" => {
            bytes.starts_with(b"ID3")
                || matches!(bytes, [0xFF, second, ..] if second & 0xE0 == 0xE0 && second & 0x06 != 0)
        }
        // ADTS (layer bits 00), or an ID3 tag before it.
        "audio/aac" => {
            bytes.starts_with(b"ID3")
                || matches!(bytes, [0xFF, second, ..] if second & 0xF0 == 0xF0 && second & 0x06 == 0)
        }
        _ => false,
    }
}

/// A picked file's type (by its name's extension) and size, as the web checks them.
fn check_name_and_size(upload: Upload, name: &str, size: u64) -> Result<&'static str, String> {
    let Some(mime) = upload.mime_for(name) else {
        return Err(format!("Choose {}.", upload.kinds()));
    };
    if size == 0 {
        return Err("That file is empty.".into());
    }
    if size > upload.max_bytes() {
        return Err(format!("The file must be {} or smaller.", upload.cap()));
    }
    Ok(mime)
}

/// A picked file for `upload`, checked as the web checks it (type by name, size), and by its first
/// bytes (`head`: at least the first 12, or all of it), so a file that isn't what its name says is
/// refused here rather than by the server. `size` is its whole length.
pub fn check_upload(
    upload: Upload,
    name: &str,
    size: u64,
    head: &[u8],
) -> Result<&'static str, String> {
    let mime = check_name_and_size(upload, name, size)?;
    if !content_matches(mime, head) {
        return Err(format!("That file isn't {}.", upload.kinds()));
    }
    Ok(mime)
}

/// Reads a picked file for `upload`. Its name and size are checked first, from the metadata, so a
/// huge file isn't read at all.
pub fn read_upload(upload: Upload, path: &Path) -> Result<DraftFile, String> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let unreadable = |error: std::io::Error| format!("Couldn't read that file: {error}");
    let size = std::fs::metadata(path).map_err(unreadable)?.len();
    check_name_and_size(upload, &name, size)?;
    let bytes = std::fs::read(path).map_err(unreadable)?;
    let mime = check_upload(upload, &name, bytes.len() as u64, &bytes)?;
    Ok(DraftFile {
        name,
        mime_type: mime.to_owned(),
        bytes,
    })
}

/// `EmojiEvent::PickImage`'s file.
fn read_emoji(path: &Path) -> Result<DraftFile, String> {
    read_upload(Upload::Emoji, path)
}

/// `SoundboardEvent::PickAudio`'s file.
fn read_audio(path: &Path) -> Result<DraftFile, String> {
    read_upload(Upload::Sound, path)
}

// ---- Preview decoding. ----

/// A sound file as mono 16-bit samples and their rate, decoded as the engine's soundboard does
/// (`soundboard::decode`: WAV, Ogg Opus and WebM Opus built in), with the player's decoder for the
/// rest when the app is built with it (`player::sound_decoder`).
pub fn decode_preview(bytes: &[u8]) -> Result<(u32, Vec<i16>), String> {
    let extra = crate::player::sound_decoder();
    let samples = semaphore_media_livekit::soundboard::decode(bytes, extra.as_deref())?;
    Ok((
        semaphore_media_livekit::audio::SAMPLE_RATE,
        samples.to_vec(),
    ))
}

#[cfg(test)]
mod tests {
    // Not `super::*`: gpui_kit's glob brings its own `test` attribute.
    use super::{
        CommunityTab, Feed, OpenState, Ticket, Upload, ViewKey, check_upload, decode_preview,
        feeds, read_upload, tab_feeds, tab_keys,
    };
    use gpui_kit::AppContext as _;

    fn all_tabs() -> [CommunityTab; 10] {
        CommunityTab::ALL
    }

    /// Every W5 view key, for community `c1` (and channel `ch1`, group `g1`), plus the same of
    /// another community and stale ids.
    fn keys() -> Vec<(&'static str, ViewKey)> {
        let c = |id: &str| id.to_owned();
        vec![
            (
                "permissions",
                ViewKey::CommunityPermissions {
                    community_id: c("c1"),
                },
            ),
            (
                "settings",
                ViewKey::CommunitySettings {
                    community_id: c("c1"),
                },
            ),
            (
                "channels",
                ViewKey::Channels {
                    community_id: c("c1"),
                },
            ),
            (
                "members",
                ViewKey::Members {
                    community_id: c("c1"),
                },
            ),
            (
                "private",
                ViewKey::PrivateMembers {
                    channel_id: c("ch1"),
                },
            ),
            (
                "groups",
                ViewKey::AliasGroups {
                    community_id: c("c1"),
                },
            ),
            ("group", ViewKey::AliasGroup { group_id: c("g1") }),
            (
                "emoji",
                ViewKey::CustomEmoji {
                    community_id: c("c1"),
                },
            ),
            (
                "sounds",
                ViewKey::Soundboard {
                    community_id: c("c1"),
                },
            ),
            (
                "webhooks",
                ViewKey::Webhooks {
                    channel_id: c("ch1"),
                },
            ),
            ("invites", ViewKey::Invites),
            // Another community's.
            (
                "other permissions",
                ViewKey::CommunityPermissions {
                    community_id: c("c2"),
                },
            ),
            (
                "other settings",
                ViewKey::CommunitySettings {
                    community_id: c("c2"),
                },
            ),
            (
                "other channels",
                ViewKey::Channels {
                    community_id: c("c2"),
                },
            ),
            (
                "other members",
                ViewKey::Members {
                    community_id: c("c2"),
                },
            ),
            (
                "other groups",
                ViewKey::AliasGroups {
                    community_id: c("c2"),
                },
            ),
            (
                "other emoji",
                ViewKey::CustomEmoji {
                    community_id: c("c2"),
                },
            ),
            (
                "other sounds",
                ViewKey::Soundboard {
                    community_id: c("c2"),
                },
            ),
            // Stale: a channel or group that isn't the one open.
            (
                "stale private",
                ViewKey::PrivateMembers {
                    channel_id: c("ch-old"),
                },
            ),
            (
                "stale group",
                ViewKey::AliasGroup {
                    group_id: c("g-old"),
                },
            ),
            (
                "stale webhooks",
                ViewKey::Webhooks {
                    channel_id: c("ch-old"),
                },
            ),
            // Not W5-A's at all.
            (
                "roles",
                ViewKey::Roles {
                    community_id: c("c1"),
                },
            ),
            ("voice", ViewKey::Voice),
        ]
    }

    /// What each key feeds on each tab, with `ch1` edited and picked and `g1` open.
    fn expected(key: &str, tab: CommunityTab) -> Vec<Feed> {
        use CommunityTab as T;
        match (key, tab) {
            ("permissions", _) => vec![Feed::Permissions],
            ("settings", _) => vec![Feed::Settings],
            ("channels", T::Channels) => vec![Feed::Channels],
            ("channels", T::PrivateChannels) => vec![Feed::PrivateChannels],
            ("members", T::Members) => vec![Feed::Members],
            ("members", T::PrivateChannels) => vec![Feed::PrivateCandidates],
            ("members", T::MentionGroups) => vec![Feed::GroupCandidates],
            ("private", T::PrivateChannels) => vec![Feed::PrivateMembers("ch1".into())],
            ("groups", T::MentionGroups) => vec![Feed::AliasGroups],
            ("group", T::MentionGroups) => vec![Feed::AliasGroup("g1".into())],
            ("emoji", T::Emoji) => vec![Feed::Emoji],
            ("sounds", T::Soundboard) => vec![Feed::Soundboard],
            ("webhooks", T::Channels) => vec![Feed::Webhooks("ch1".into())],
            ("invites", T::Invites) => vec![Feed::Invites],
            _ => Vec::new(),
        }
    }

    #[test]
    fn each_view_feeds_only_the_open_tab_of_the_open_community() {
        for tab in all_tabs() {
            let open = OpenState {
                edit_channel: Some("ch1".into()),
                private_channel: Some("ch1".into()),
                group: Some("g1".into()),
                ..OpenState::new("c1", tab)
            };
            for (name, key) in keys() {
                assert_eq!(feeds(&key, &open), expected(name, tab), "{name} on {tab:?}");
            }
        }
    }

    #[test]
    fn nothing_picked_feeds_nothing_picked() {
        // No edit dialog, private channel or group open: their views feed nothing on any tab.
        for tab in all_tabs() {
            let open = OpenState::new("c1", tab);
            for key in [
                ViewKey::PrivateMembers {
                    channel_id: "ch1".into(),
                },
                ViewKey::AliasGroup {
                    group_id: "g1".into(),
                },
                ViewKey::Webhooks {
                    channel_id: "ch1".into(),
                },
            ] {
                assert!(feeds(&key, &open).is_empty(), "{key:?} on {tab:?}");
            }
        }
    }

    #[test]
    fn a_tab_reads_its_views_and_each_feeds_it() {
        for tab in all_tabs() {
            for picked in [false, true] {
                let mut open = OpenState::new("c1", tab);
                if picked {
                    open.edit_channel = Some("ch1".into());
                    open.private_channel = Some("ch2".into());
                    open.group = Some("g1".into());
                }
                for always in [false, true] {
                    let keys = tab_keys(&open, always);
                    // Each key the tab reads feeds something there: no read is wasted.
                    for key in &keys {
                        assert_eq!(feeds(key, &open).len(), 1, "{key:?} on {tab:?}");
                    }
                    let feeds = tab_feeds(&open, always);
                    assert_eq!(feeds.len(), keys.len());
                    assert_eq!(
                        feeds.contains(&Feed::Permissions),
                        always,
                        "{tab:?} {always}"
                    );
                }
            }
        }
        let open = OpenState {
            edit_channel: Some("ch1".into()),
            ..OpenState::new("c1", CommunityTab::Channels)
        };
        assert_eq!(
            tab_feeds(&open, false),
            vec![Feed::Channels, Feed::Webhooks("ch1".into())]
        );
        // The slots' tabs read nothing of this module's.
        for tab in [
            CommunityTab::Roles,
            CommunityTab::Moderation,
            CommunityTab::Overview,
        ] {
            assert!(tab_feeds(&OpenState::new("c1", tab), false).is_empty());
        }
    }

    struct Screen;

    #[gpui_kit::test]
    fn a_dropped_or_replaced_screen_swallows_what_lands_later(cx: &mut gpui_kit::TestAppContext) {
        let first = cx.new(|_| Screen);
        let second = cx.new(|_| Screen);
        let ticket = Ticket::new(&first, "c1");
        assert!(ticket.holds(Some(&first), Some("c1")));
        // Replaced by another screen, or the same entity now said to be another community's.
        assert!(!ticket.holds(Some(&second), Some("c1")));
        assert!(!ticket.holds(Some(&first), Some("c2")));
        // Closed.
        assert!(!ticket.holds(None, None));
        assert!(!ticket.holds(None, Some("c1")));
        // Dropped: even a handle to an entity with the same id can't be gone and still held.
        let kept = ticket.clone();
        drop(first);
        cx.run_until_parked();
        assert!(kept.screen.upgrade().is_none());
        assert!(!kept.holds(None, Some("c1")));
        let other = Ticket::new(&second, "c1");
        assert!(other.holds(Some(&second), Some("c1")));
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const GIF: &[u8] = b"GIF89a\x01\0\x01\0";
    const WEBP: &[u8] = b"RIFF\x10\0\0\0WEBPVP8 ";
    const WAV: &[u8] = b"RIFF\x24\0\0\0WAVEfmt ";
    const OGG: &[u8] = b"OggS\0\x02\0\0\0\0\0\0";
    const WEBM: &[u8] = &[0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 1, 0, 0, 0];
    const MP3_ID3: &[u8] = b"ID3\x04\0\0\0\0\0\x0f\0\0";
    const MP3_FRAME: &[u8] = &[0xFF, 0xFB, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0];
    const AAC: &[u8] = &[0xFF, 0xF1, 0x50, 0x80, 0, 0x1F, 0xFC, 0, 0, 0, 0, 0];

    #[test]
    fn uploads_take_what_the_web_takes() {
        const MIB: u64 = 1024 * 1024;
        const EMOJI: u64 = 256 * 1024;
        type Case = (
            &'static str,
            Upload,
            &'static str,
            u64,
            &'static [u8],
            Result<&'static str, &'static str>,
        );
        let cases: &[Case] = &[
            // Sounds: each type, by its extension in any case.
            (
                "mp3",
                Upload::Sound,
                "horn.mp3",
                10,
                MP3_ID3,
                Ok("audio/mpeg"),
            ),
            (
                "mp3 frame",
                Upload::Sound,
                "horn.mp3",
                10,
                MP3_FRAME,
                Ok("audio/mpeg"),
            ),
            (
                "upper-case",
                Upload::Sound,
                "HORN.MP3",
                10,
                MP3_ID3,
                Ok("audio/mpeg"),
            ),
            ("wav", Upload::Sound, "a.Wav", 10, WAV, Ok("audio/wav")),
            ("ogg", Upload::Sound, "a.ogg", 10, OGG, Ok("audio/ogg")),
            ("webm", Upload::Sound, "a.webm", 10, WEBM, Ok("audio/webm")),
            ("aac", Upload::Sound, "a.aac", 10, AAC, Ok("audio/aac")),
            (
                "at the cap",
                Upload::Sound,
                "a.wav",
                MIB,
                WAV,
                Ok("audio/wav"),
            ),
            (
                "one over",
                Upload::Sound,
                "a.wav",
                MIB + 1,
                WAV,
                Err("1 MB or smaller"),
            ),
            ("empty", Upload::Sound, "a.wav", 0, b"", Err("empty")),
            (
                "wrong extension",
                Upload::Sound,
                "a.m4a",
                10,
                MP3_ID3,
                Err("Choose an MP3"),
            ),
            (
                "no extension",
                Upload::Sound,
                "horn",
                10,
                MP3_ID3,
                Err("Choose an MP3"),
            ),
            (
                "an image as a sound",
                Upload::Sound,
                "a.wav",
                10,
                PNG,
                Err("isn't an MP3"),
            ),
            (
                "mismatched: wav named mp3",
                Upload::Sound,
                "a.mp3",
                10,
                WAV,
                Err("isn't an MP3"),
            ),
            (
                "mismatched: aac named mp3",
                Upload::Sound,
                "a.mp3",
                10,
                AAC,
                Err("isn't an MP3"),
            ),
            (
                "mismatched: mp3 named aac",
                Upload::Sound,
                "a.aac",
                10,
                MP3_FRAME,
                Err("isn't an MP3"),
            ),
            (
                "mismatched: webp named wav",
                Upload::Sound,
                "a.wav",
                10,
                WEBP,
                Err("isn't an MP3"),
            ),
            // Emoji.
            ("png", Upload::Emoji, "e.png", 10, PNG, Ok("image/png")),
            ("gif", Upload::Emoji, "e.GIF", 10, GIF, Ok("image/gif")),
            ("webp", Upload::Emoji, "e.webp", 10, WEBP, Ok("image/webp")),
            (
                "emoji at the cap",
                Upload::Emoji,
                "e.png",
                EMOJI,
                PNG,
                Ok("image/png"),
            ),
            (
                "emoji one over",
                Upload::Emoji,
                "e.png",
                EMOJI + 1,
                PNG,
                Err("256 KB or smaller"),
            ),
            ("emoji empty", Upload::Emoji, "e.png", 0, b"", Err("empty")),
            (
                "jpeg isn't an emoji",
                Upload::Emoji,
                "e.jpg",
                10,
                b"\xFF\xD8\xFF\xE0",
                Err("Choose a PNG"),
            ),
            (
                "mismatched: gif named png",
                Upload::Emoji,
                "e.png",
                10,
                GIF,
                Err("isn't a PNG"),
            ),
            (
                "mismatched: wav named webp",
                Upload::Emoji,
                "e.webp",
                10,
                WAV,
                Err("isn't a PNG"),
            ),
            (
                "a sound as an emoji",
                Upload::Emoji,
                "e.mp3",
                10,
                MP3_ID3,
                Err("Choose a PNG"),
            ),
        ];
        for (name, upload, file, size, head, want) in cases {
            let got = check_upload(*upload, file, *size, head);
            match (want, &got) {
                (Ok(mime), Ok(got)) => assert_eq!(got, mime, "{name}"),
                (Err(part), Err(got)) => assert!(got.contains(part), "{name}: {got}"),
                _ => panic!("{name}: {got:?}, wanted {want:?}"),
            }
        }
    }

    /// A file of its own in the temp dir, removed when dropped.
    struct TempFile(std::path::PathBuf);

    impl TempFile {
        fn new(name: &str, bytes: &[u8]) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "semaphore-app-upload-{}-{}",
                std::process::id(),
                name.replace('.', "-")
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(name);
            std::fs::write(&path, bytes).unwrap();
            Self(path)
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            if let Some(dir) = self.0.parent() {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }

    #[test]
    fn reading_a_pick_checks_it_from_disk() {
        let mut wav = WAV.to_vec();
        wav.resize(1024 * 1024, 0);
        let at_cap = TempFile::new("cap.WAV", &wav);
        let file = read_upload(Upload::Sound, &at_cap.0).expect("exactly 1 MiB");
        assert_eq!(
            (file.name.as_str(), file.mime_type.as_str()),
            ("cap.WAV", "audio/wav")
        );
        assert_eq!(file.bytes.len(), 1024 * 1024);
        wav.push(0);
        let over = TempFile::new("over.wav", &wav);
        assert!(
            read_upload(Upload::Sound, &over.0)
                .unwrap_err()
                .contains("1 MB")
        );
        let empty = TempFile::new("empty.png", b"");
        assert!(
            read_upload(Upload::Emoji, &empty.0)
                .unwrap_err()
                .contains("empty")
        );
        let lying = TempFile::new("lying.gif", PNG);
        assert!(
            read_upload(Upload::Emoji, &lying.0)
                .unwrap_err()
                .contains("isn't")
        );
        let emoji = TempFile::new("party.webp", WEBP);
        assert_eq!(
            read_upload(Upload::Emoji, &emoji.0).unwrap().mime_type,
            "image/webp"
        );
        let missing = std::env::temp_dir().join("semaphore-app-no-such-file.wav");
        assert!(
            read_upload(Upload::Sound, &missing)
                .unwrap_err()
                .contains("Couldn't read")
        );
    }

    fn wav_file(rate: u32, samples: &[i16]) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn previews_decode_wav_and_opus_and_refuse_what_cant_play() {
        // WAV, resampled to the engine's 48 kHz mono.
        let (rate, samples) = decode_preview(&wav_file(8_000, &[1_000; 800])).unwrap();
        assert_eq!(rate, 48_000);
        assert_eq!(samples.len(), 4_800);
        // Ogg Opus, built in: no player feature needed.
        let ogg = include_bytes!("../../../../rigs/slice/fixtures/opus.ogg");
        let (rate, samples) = decode_preview(ogg).unwrap();
        assert_eq!(rate, 48_000);
        assert!(!samples.is_empty());
        // WebM Opus likewise.
        let webm = include_bytes!("../../../../rigs/slice/fixtures/vp9-opus.webm");
        let decoded = decode_preview(webm);
        assert!(
            decoded.is_ok() || decoded.as_ref().unwrap_err().contains("longer than"),
            "{decoded:?}"
        );
        // Refused, with a sentence: no audio, too long, broken, not a sound.
        let cases: [(Vec<u8>, &str); 4] = [
            (wav_file(8_000, &[]), "can't be played"),
            (
                wav_file(8_000, &vec![1i16; 8_000 * 31]),
                "longer than 30 seconds",
            ),
            (
                {
                    let mut broken = wav_file(8_000, &[1, 2]);
                    broken.truncate(20);
                    broken
                },
                "can't be played",
            ),
            (b"<html>not a sound</html>".to_vec(), "can't be played"),
        ];
        for (bytes, want) in cases {
            let refused = decode_preview(&bytes).unwrap_err();
            assert!(refused.contains(want), "{refused} should say {want}");
        }
    }
}
