//! W1-ui-emoji: the emoji picker, from `EmojiPicker.tsx` and `emojiData.ts`. Search, the
//! community's custom emoji first, then the unicode categories, with keyboard movement across the
//! grid. The composer and reactions both use it; the owner anchors it in a popover and closes it on
//! `Picked` or `Dismissed`.
//!
//! P0 stub: the types and signatures are fixed; the second agent fills in the view.

use crate::messages::MediaSource;
use gpui_kit::*;
use semaphore_core::model::EmojiView;
use std::rc::Rc;

/// `QUICK_REACTIONS`: the first eight of "Frequently Used".
pub const QUICK_REACTIONS: [&str; 8] = [
    "\u{1F44D}",
    "\u{1F44E}",
    "\u{2764}\u{FE0F}",
    "\u{1F602}",
    "\u{1F62E}",
    "\u{1F622}",
    "\u{1F621}",
    "\u{1F44F}",
];

/// What the user picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmojiPick {
    Unicode(String),
    Custom { id: String, name: String },
}

impl EmojiPick {
    /// The `emoji` a reaction carries: the character, or `custom:{id}`.
    pub fn reaction_key(&self) -> String {
        match self {
            Self::Unicode(emoji) => emoji.clone(),
            Self::Custom { id, .. } => format!("custom:{id}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmojiPickerEvent {
    Picked(EmojiPick),
    /// Escape, or the owner's popover lost focus.
    Dismissed,
}

pub struct EmojiPicker {
    #[allow(dead_code)]
    custom: Vec<EmojiView>,
    #[allow(dead_code)]
    media: Rc<dyn MediaSource>,
    focus: FocusHandle,
}

impl EmojiPicker {
    /// `custom` is the community's emoji (`Core::custom_emojis`), empty outside a community.
    /// `media` loads their images (`MediaSource::emoji`).
    pub fn new(
        custom: Vec<EmojiView>,
        media: Rc<dyn MediaSource>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            custom,
            media,
            focus: cx.focus_handle(),
        }
    }

    /// The custom emoji changed (`ViewChanged { Mentionables }`).
    pub fn set_custom(&mut self, custom: Vec<EmojiView>, cx: &mut Context<Self>) {
        self.custom = custom;
        cx.notify();
    }
}

impl EventEmitter<EmojiPickerEvent> for EmojiPicker {}

impl Focusable for EmojiPicker {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for EmojiPicker {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().id("emoji-picker").track_focus(&self.focus)
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
