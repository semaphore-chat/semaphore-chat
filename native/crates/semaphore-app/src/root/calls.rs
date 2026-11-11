//! W4: calls in the app: the incoming call banner and its ring timer, DM call controls and the DM
//! stage, the participant menu (volume, server mute, kick), the soundboard, the float card and the
//! voice debug panel (Ctrl+Shift+D).

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;

/// This session's call UI. Rebuilt empty on sign-out (`drop_calls`).
#[derive(Default)]
pub(super) struct Calls {}

impl AppRoot {
    pub(super) fn calls_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    /// Signed out: no ring timer, menu, card or panel of this session stays.
    pub(super) fn drop_calls(&mut self) {
        self.calls = Calls::default();
    }

    /// The banner, menu and panel over the shell.
    pub(super) fn calls_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }
}
