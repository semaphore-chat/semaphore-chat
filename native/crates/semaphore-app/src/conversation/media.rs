//! WM's half of the conversation pane: GIFs and third-party pictures in a conversation (the
//! composer's GIF button and picker, sending a pick, the message list's "Load" cards' Enable).
//! Hub file from the UI freeze: `actions.rs` sends these events here and nothing else.
//!
//! The picker opens from any composer (the channel's or DM's, or a thread's) and sends to that
//! composer's conversation. It's a popover at the GIF button on a desktop and a bottom sheet at
//! phone width, drawn by the root's overlays (`AppRoot::media_overlays`). The picker owns its
//! search debounce (300 ms) and asks for the next page itself near the grid's end; the pane only
//! turns its events into core reads and commands. "Allow" goes up to the root's one switch
//! (`PaneEvent::EnableThirdPartyMedia`), which turns every GIF view stale, and the featured list
//! arrives as a `ViewChanged`.

use super::{ConversationPane, PaneEvent, Which};
use gpui_kit::*;
use semaphore_core::model::{Conversation, GifResultsView, MessageDraft, ViewKey};
use semaphore_ui::composer::{Composer, ComposerMode};
use semaphore_ui::gifs::{GifPicker, GifPickerEvent};
use semaphore_ui::theme::SemTheme as _;

/// The open GIF picker: where it is, who opened it and what it shows.
pub(crate) struct GifHost {
    pub picker: Entity<GifPicker>,
    /// The GIF button's click, in window coordinates: the popover's corner on a desktop.
    pub anchor: Point<Pixels>,
    /// Phone width when opened: a bottom sheet instead of a popover.
    pub phone: bool,
    pub composer: WeakEntity<Composer>,
    /// Where a pick is sent.
    pub conversation: Conversation,
    /// What the picker was last given, for the rig and for re-reads.
    pub view: GifResultsView,
    _subscription: Subscription,
}

/// Where a composer's sends go: the conversation's own composer to it, a thread's to the thread.
/// An edit in place sends nothing.
pub(crate) fn target(
    mode: &ComposerMode,
    conversation: Option<&Conversation>,
    thread: Option<&Conversation>,
) -> Option<Conversation> {
    match mode {
        ComposerMode::Send => conversation.cloned(),
        ComposerMode::Thread => thread.cloned(),
        ComposerMode::Edit { .. } => None,
    }
}

/// Whether a `ViewChanged` is the open picker's results.
pub(crate) fn feeds_picker(view: &ViewKey, query: &str) -> bool {
    matches!(view, ViewKey::Gifs { query: changed } if changed == query.trim())
}

/// A pick is the GIF's URL as the whole message, as the web sends it.
pub(crate) fn pick_draft(url: &str) -> MessageDraft {
    MessageDraft {
        text: url.to_owned(),
        ..MessageDraft::default()
    }
}

impl ConversationPane {
    /// `ComposerEvent::OpenGifs` from `composer`.
    pub(super) fn media_open_gifs(
        &mut self,
        composer: &Entity<Composer>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let thread = self.thread.as_ref().map(|thread| &thread.conversation);
        let Some(conversation) =
            target(composer.read(cx).mode(), self.conversation.as_ref(), thread)
        else {
            return;
        };
        self.close_picker(cx);
        self.media_close_gifs(false, window, cx);
        let view = self.core.gifs(String::new());
        let (picker, subscription) = self.media_new_picker(&view, window, cx);
        let phone = f32::from(window.viewport_size().width) < semaphore_ui::shell::PHONE;
        self.gif = Some(GifHost {
            picker,
            // Above the button, as the web's popover, not over it.
            anchor: window.mouse_position() - point(px(0.), px(24.)),
            phone,
            composer: composer.downgrade(),
            conversation,
            view,
            _subscription: subscription,
        });
        cx.notify();
    }

    /// A picker showing `view`. It puts the caret in its search field itself (the web's
    /// `autoFocus`).
    fn media_new_picker(
        &mut self,
        view: &GifResultsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (Entity<GifPicker>, Subscription) {
        let picker = cx.new(|cx| GifPicker::new(window, cx));
        let media: std::rc::Rc<dyn semaphore_ui::messages::MediaSource> = self.media.clone();
        picker.update(cx, |picker, cx| {
            picker.set_media(media, cx);
            picker.set_view(view.clone(), cx);
        });
        let subscription = cx.subscribe_in(&picker, window, Self::media_on_picker);
        (picker, subscription)
    }

    /// Closes the picker; `refocus` hands the keyboard back to the composer that opened it.
    pub(crate) fn media_close_gifs(
        &mut self,
        refocus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(host) = self.gif.take() else {
            return;
        };
        if refocus {
            host.composer
                .update(cx, |composer, cx| composer.focus(window, cx))
                .ok();
        }
        cx.notify();
    }

    fn media_on_picker(
        &mut self,
        _: &Entity<GifPicker>,
        event: &GifPickerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(host) = &self.gif else {
            return;
        };
        let query = host.view.query.clone();
        match event.clone() {
            GifPickerEvent::Query(query) => {
                let view = self.core.gifs(query);
                self.media_show_gifs(view, cx);
            }
            GifPickerEvent::LoadMore => {
                let core = self.core.clone();
                self.exec.fire(async move {
                    if let Err(error) = core.load_more_gifs(query).await {
                        // Core shows the failure on the view.
                        log::warn!("loading more GIFs failed: {error}");
                    }
                });
            }
            GifPickerEvent::Retry => self.core.retry_failed(),
            // The one switch, at the root; the featured list arrives as a ViewChanged.
            GifPickerEvent::Allow => {
                cx.emit(PaneEvent::EnableThirdPartyMedia);
                // The notice and its button go; the picker keeps the keyboard (its root now, the
                // search field once the results follow the switch: `media_third_party`).
                host.picker
                    .update(cx, |picker, cx| picker.focus_search(window, cx));
                cx.notify();
            }
            GifPickerEvent::Pick(gif) => {
                let conversation = host.conversation.clone();
                let core = self.core.clone();
                let draft = pick_draft(&gif.url);
                self.media_close_gifs(true, window, cx);
                self.command("sending the GIF", window, cx, async move {
                    core.send_message(conversation, draft).await.map(|_| ())
                });
            }
            GifPickerEvent::Close => self.media_close_gifs(true, window, cx),
        }
    }

    fn media_show_gifs(&mut self, view: GifResultsView, cx: &mut Context<Self>) {
        let Some(host) = &mut self.gif else {
            return;
        };
        host.view = view.clone();
        host.picker
            .update(cx, |picker, cx| picker.set_view(view, cx));
    }

    /// A core event, from the root: the open picker's results changed.
    pub(crate) fn media_on_core(&mut self, view: &ViewKey, cx: &mut Context<Self>) {
        if let Some(host) = &self.gif
            && feeds_picker(view, &host.view.query)
        {
            let view = self.core.gifs(host.view.query.clone());
            self.media_show_gifs(view, cx);
        }
    }

    /// Whether the server offers GIFs, as the root last said: the composers' button.
    pub(crate) fn media_gifs_enabled(&self) -> bool {
        self.gifs_enabled
    }

    /// The root learnt whether the server offers GIFs: every composer on screen follows, and new
    /// ones read it when made.
    pub(crate) fn media_set_gifs_enabled(&mut self, enabled: bool, cx: &mut Context<Self>) {
        self.gifs_enabled = enabled;
        if !enabled {
            self.gif = None;
        }
        let composers = self
            .composer
            .iter()
            .chain(self.thread.as_ref().map(|thread| &thread.composer))
            .cloned()
            .collect::<Vec<_>>();
        for composer in composers {
            composer.update(cx, |composer, cx| composer.set_gifs_enabled(enabled, cx));
        }
    }

    /// The picker, for the root's overlays: a popover at the button, or a bottom sheet on a phone.
    pub(crate) fn media_gif_overlay(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let host = self.gif.as_ref()?;
        let pane = cx.entity().downgrade();
        let sem = cx.sem();
        // A click on one of the picker's buttons can leave nothing focused, and then Escape
        // reaches nobody: the keyboard goes back to the picker, which closes on Escape.
        let handle = host.picker.read(cx).focus_handle(cx);
        let keep_focus = move |_: &MouseUpEvent, window: &mut Window, cx: &mut App| {
            if !handle.contains_focused(window, cx) {
                window.focus(&handle, cx);
            }
        };
        let close = move |_: &MouseDownEvent, window: &mut Window, cx: &mut App| {
            pane.update(cx, |pane, cx| pane.media_close_gifs(true, window, cx))
                .ok();
        };
        if host.phone {
            return Some(
                deferred(
                    div()
                        .id("gif-picker-sheet-scrim")
                        .absolute()
                        .inset_0()
                        .flex()
                        .flex_col()
                        .justify_end()
                        .bg(hsla(0., 0., 0., 0.5))
                        .on_mouse_down(MouseButton::Left, close)
                        .child(
                            div()
                                .id("gif-picker-sheet")
                                .w_full()
                                .h(relative(0.7))
                                .bg(sem.paper)
                                .rounded_t(px(12.))
                                .overflow_hidden()
                                .occlude()
                                .capture_any_mouse_up(keep_focus)
                                .child(host.picker.clone()),
                        ),
                )
                .with_priority(2)
                .into_any_element(),
            );
        }
        Some(
            deferred(
                anchored()
                    .position(host.anchor)
                    .anchor(Anchor::BottomLeft)
                    .snap_to_window_with_margin(px(8.))
                    .child(
                        div()
                            .id("gif-picker-popover")
                            .bg(sem.paper)
                            .border_1()
                            .border_color(sem.divider)
                            .occlude()
                            .rounded(px(4.))
                            .shadow_lg()
                            .overflow_hidden()
                            .on_mouse_down_out(close)
                            .capture_any_mouse_up(keep_focus)
                            .child(host.picker.clone()),
                    ),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }

    // ---- What the rig reads. ----

    /// The open picker's results, as last given to it.
    pub fn gif_picker_view(&self) -> Option<&GifResultsView> {
        self.gif.as_ref().map(|host| &host.view)
    }

    /// `MessageListEvent::EnableThirdPartyMedia` from the `which` list: the root turns the switch
    /// on everywhere (`AppRoot::media_set_third_party`), which comes back to `media_third_party`.
    pub(super) fn media_enable(&mut self, _which: Which, cx: &mut Context<Self>) {
        cx.emit(PaneEvent::EnableThirdPartyMedia);
    }

    /// The third-party media switch changed: every list on screen draws its pictures or its Load
    /// cards. New lists read it when made (`new_list`).
    pub(crate) fn media_third_party(&mut self, on: bool, cx: &mut Context<Self>) {
        let lists = [Which::Main, Which::Thread, Which::Parent]
            .into_iter()
            .filter_map(|which| self.list_of(which));
        for list in lists {
            list.update(cx, |list, cx| list.set_third_party_media(on, cx));
        }
        if let Some(host) = &self.gif {
            let view = self.core.gifs(host.view.query.clone());
            self.media_show_gifs(view, cx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn a_pick_goes_to_the_composer_s_conversation() {
        let channel = Conversation::Channel { id: "c".into() };
        let thread = Conversation::Thread {
            parent_message_id: "p".into(),
        };
        assert_eq!(
            target(&ComposerMode::Send, Some(&channel), Some(&thread)),
            Some(channel.clone())
        );
        assert_eq!(
            target(&ComposerMode::Thread, Some(&channel), Some(&thread)),
            Some(thread)
        );
        assert_eq!(target(&ComposerMode::Thread, Some(&channel), None), None);
        assert_eq!(target(&ComposerMode::Send, None, None), None);
        let edit = ComposerMode::Edit {
            message_id: "m".into(),
        };
        assert_eq!(target(&edit, Some(&channel), None), None);
    }

    #[test]
    fn only_the_open_query_re_reads() {
        let gifs = |query: &str| ViewKey::Gifs {
            query: query.into(),
        };
        assert!(feeds_picker(&gifs(""), ""));
        assert!(feeds_picker(&gifs("cats"), "cats"));
        assert!(feeds_picker(&gifs("cats"), "  cats "), "the key is trimmed");
        assert!(!feeds_picker(&gifs("cats"), ""));
        assert!(!feeds_picker(&gifs(""), "cats"));
        assert!(!feeds_picker(&ViewKey::Session, ""));
    }

    #[test]
    fn a_pick_sends_the_url_alone() {
        let draft = pick_draft("https://media.giphy.com/media/x/giphy.gif");
        assert_eq!(draft.text, "https://media.giphy.com/media/x/giphy.gif");
        assert!(draft.mentions.is_empty() && draft.files.is_empty());
        assert_eq!(draft.reply_to_message_id, None);
    }
}
