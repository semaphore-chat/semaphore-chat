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
