//! WM's half of the conversation pane: GIFs and third-party pictures in a conversation (the
//! composer's GIF button and picker, sending a pick, the message list's "Load" cards' Enable).
//! Hub file from the UI freeze: `actions.rs` sends these events here and nothing else; WM fills
//! the bodies.

use super::{ConversationPane, PaneEvent, Which};
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

    /// `MessageListEvent::EnableThirdPartyMedia` from the `which` list: the root turns the switch
    /// on everywhere (`AppRoot::media_set_third_party`), which comes back to `media_third_party`.
    pub(super) fn media_enable(&mut self, _which: Which, cx: &mut Context<Self>) {
        cx.emit(PaneEvent::EnableThirdPartyMedia);
    }

    /// The third-party media switch changed: every list on screen draws its pictures or its Load
    /// cards. New lists read it when made (`new_list`). UM wired this and `media_enable`; the GIF
    /// button and picker above stay WM's.
    pub(crate) fn media_third_party(&mut self, on: bool, cx: &mut Context<Self>) {
        let lists = [Which::Main, Which::Thread, Which::Parent]
            .into_iter()
            .filter_map(|which| self.list_of(which));
        for list in lists {
            list.update(cx, |list, cx| list.set_third_party_media(on, cx));
        }
    }
}
