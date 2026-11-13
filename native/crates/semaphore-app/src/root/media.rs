//! WM: third-party pictures in the app: the "Load images from other sites" switch reaching core,
//! the settings store and `PreviewFetcher`; GIF and link-preview image fetches only while it is
//! on; the frame and pixel budget for animated images. (The conversation pane's half is
//! `conversation/media.rs`.)
//!
//! Hub file from the UI freeze: `root.rs` calls the functions below once each (core events,
//! navigation, the route's content, overlays), and nothing else in the app does; WM
//! fills them. Copy the shape of `root/community.rs` (W5-app): one state struct here, feeds that
//! read core when they run, continuations that hold a ticket.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_ui::nav::Route;

/// WM's state: what it has on screen. Gone with the session.
#[derive(Default)]
pub struct MediaArea {}

impl AppRoot {
    /// The one third-party media switch ("Load images from other sites"), from the settings tab
    /// or a message list's Load card: the settings store, the preview fetcher, core (whose views
    /// say whether GIFs may load) and the conversation pane's lists all follow it.
    ///
    /// UM wired only this. WM still owns the rest of this file: GIF fetching (the app's
    /// `MediaSource::gif`, the GIF picker's previews), and the frame and pixel budget for
    /// animated images.
    pub(super) fn media_set_third_party(&mut self, on: bool, cx: &mut Context<Self>) {
        self.update_settings(|settings| settings.third_party_media = on);
        if let Some(media) = &self.media {
            media.previews.set_allowed(on);
        }
        if let Some(core) = self.core() {
            core.set_third_party_media(on);
        }
        if let Some(pane) = self.pane.clone() {
            pane.update(cx, |pane, cx| pane.media_third_party(on, cx));
        }
        self.refresh_desktop_tab(cx);
        cx.refresh_windows();
    }

    pub(super) fn media_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    pub(super) fn media_navigated(
        &mut self,
        _route: &Route,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }

    pub(super) fn media_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }
}
