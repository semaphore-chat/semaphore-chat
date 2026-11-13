//! WM's half of the conversation pane: GIFs and third-party pictures in a conversation (the
//! composer's GIF button and picker, sending a pick, the message list's "Load" cards' Enable).
//! Hub file from the UI freeze: `actions.rs` sends these events here and nothing else; WM fills
//! the bodies.

use super::{ConversationPane, Which};
use gpui_kit::*;
use semaphore_ui::composer::Composer;

impl ConversationPane {
    /// `ComposerEvent::OpenGifs` from `composer`.
    pub(super) fn media_open_gifs(
        &mut self,
        _composer: &Entity<Composer>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }

    /// `MessageListEvent::EnableThirdPartyMedia` from the `which` list.
    pub(super) fn media_enable(&mut self, _which: Which, _cx: &mut Context<Self>) {}
}
