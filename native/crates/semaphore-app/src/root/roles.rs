//! W5: roles in the app (agent B). `RolesPanel` for the settings' Roles slot, the
//! `RoleAssignmentDialog` (from `MembersEvent::ManageRoles` and the moderation menu's
//! `ChangeRoles`; saving runs each assign, then each unassign, one at a time), and
//! `ChannelOverrides` for the Edit Channel permissions slot (`Core::build_preset` when it opens,
//! on `Preview`, and before `replace_channel_overwrites` on `Save`).
//!
//! Signing out drops everything here (`drop_roles`); `CoreEvent::CommunityRemoved` closes what's
//! open for that community, `CoreEvent::ChannelRemoved` the overrides for that channel.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;

/// This session's roles views: the panel, the assignment dialog and the channel overrides on
/// show, each with the community (and channel) it's for.
#[derive(Default)]
pub struct Roles {}

impl AppRoot {
    /// Signed out: no roles view of the last session stays.
    pub(super) fn drop_roles(&mut self) {
        self.roles = Roles::default();
    }

    pub(super) fn roles_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    /// The assignment dialog over the shell, while it's open.
    pub(super) fn roles_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// The view for `CommunitySettingsScreen::set_roles_slot`, built for this community.
    #[expect(dead_code, reason = "W5-app skeleton: the community module calls it")]
    pub(super) fn roles_slot(
        &mut self,
        _community_id: &str,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<AnyView> {
        None
    }

    /// The view for `ChannelsTab::set_permissions_slot` while the Edit Channel dialog is open on
    /// `channel_id` (`ChannelsEvent::OpenEdit`); `close_channel_permissions` on `CloseEdit`.
    #[expect(dead_code, reason = "W5-app skeleton: the community module calls it")]
    pub(super) fn channel_permissions_slot(
        &mut self,
        _community_id: &str,
        _channel_id: &str,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<AnyView> {
        None
    }

    #[expect(dead_code, reason = "W5-app skeleton: the community module calls it")]
    pub(super) fn close_channel_permissions(&mut self, _cx: &mut Context<Self>) {}

    /// One member's roles (`MembersEvent::ManageRoles`, `ModerationMenuEvent::ChangeRoles`).
    #[expect(dead_code, reason = "W5-app skeleton: the community module calls it")]
    pub(super) fn open_role_assignment(
        &mut self,
        _community_id: String,
        _user_id: String,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }
}
