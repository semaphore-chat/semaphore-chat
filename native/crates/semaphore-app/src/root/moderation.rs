//! W5: moderation in the app (agent B). `ModerationMenu` (from `MembersEvent::Moderate`, the
//! members panel's `ShellEvent::MemberMenu` and the voice participant menu), one
//! `ModerationDialog` fed the op its action lives on, `ModerationTab` for the settings' Moderation
//! slot, `RemovedNotice` on `CoreEvent::CommunityRemoved` (once, over Home), and the timeout
//! timers: core has none, so this arms one per community at
//! `ChannelPermissions::timed_out_until_ms` (by core's clock) and calls `Core::timeout_elapsed`.
//!
//! Signing out drops everything here (`drop_moderation`), queued notices and timers included.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;

/// This session's moderation views and timers.
#[derive(Default)]
pub struct Moderation {}

impl AppRoot {
    /// Signed out: no menu, dialog, notice or timer of the last session stays.
    pub(super) fn drop_moderation(&mut self) {
        self.moderation = Moderation::default();
    }

    pub(super) fn moderation_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    /// The menu, the dialog and the removal notice over the shell.
    pub(super) fn moderation_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// The view for `CommunitySettingsScreen::set_moderation_slot`, built for this community.
    #[expect(dead_code, reason = "W5-app skeleton: the community module calls it")]
    pub(super) fn moderation_slot(
        &mut self,
        _community_id: &str,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<AnyView> {
        None
    }

    /// The moderation menu for a member, at `position` (window coordinates; `None`: where the
    /// pointer last was).
    pub(super) fn open_member_menu(
        &mut self,
        _community_id: String,
        _user_id: String,
        _position: Option<Point<Pixels>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }
}
