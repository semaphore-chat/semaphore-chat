//! UG: the GIF picker (featured and search, a grid of previews, the one-click "Allow" notice while
//! "Load images from other sites" is off), after `components/Message/GifPicker.tsx`. The
//! composer's GIF button is this lane's too.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `GifPickerEvent`) is what the app
//! wiring lane builds against while UG draws the screen; change it only with the coordinator.
//! Until UG lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{GifResultsView, GifView};

#[derive(Debug, Clone, PartialEq)]
pub enum GifPickerEvent {
    /// The search changed (debounced 300 ms): the owner reads `Core::gifs(query)`.
    Query(String),
    /// `Core::load_more_gifs(query)`.
    LoadMore,
    /// The notice's "Allow": `Core::set_third_party_media(true)` (the app also saves it).
    Allow,
    /// A GIF was picked: the owner sends `gif.url` as the whole message.
    Pick(GifView),
    Close,
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct GifPicker {
    view: GifResultsView,
    media: Option<std::rc::Rc<dyn crate::messages::MediaSource>>,
}

impl EventEmitter<GifPickerEvent> for GifPicker {}

impl GifPicker {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            view: GifResultsView::default(),
            media: None,
        }
    }

    /// Where previews come from (`MediaSource::gif`, keyed by `preview_url`): the app's, which
    /// fetches only while third-party pictures are allowed.
    pub fn set_media(
        &mut self,
        media: std::rc::Rc<dyn crate::messages::MediaSource>,
        cx: &mut Context<Self>,
    ) {
        self.media = Some(media);
        cx.notify();
    }

    /// `Core::gifs(query)`.
    pub fn set_view(&mut self, view: GifResultsView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }
}

impl Render for GifPicker {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("gifpicker-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
