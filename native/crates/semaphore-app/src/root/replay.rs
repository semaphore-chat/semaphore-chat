//! W4: the replay buffer in the app: the capture dialog (from the voice bar's Capture button), the
//! replay audio-wait timer, the clip library on profile pages and the share dialog.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_ui::profile::ProfilePage;

/// This session's replay UI. Rebuilt empty on sign-out (`drop_replay`).
#[derive(Default)]
pub(super) struct Replay {}

impl AppRoot {
    pub(super) fn replay_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    /// Signed out: no dialog, library or timer of this session stays.
    pub(super) fn drop_replay(&mut self) {
        self.replay = Replay::default();
    }

    /// The capture and share dialogs over the shell.
    pub(super) fn replay_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// The voice bar's (or the "more" sheet's) Capture: open the capture dialog.
    pub(super) fn open_capture(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    /// A profile page was made for `user_id` (`own`: mine): give it its clip library.
    pub(super) fn replay_profile_opened(
        &mut self,
        _page: &Entity<ProfilePage>,
        _user_id: &str,
        _own: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }
}
