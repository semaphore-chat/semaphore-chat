//! The chat pieces a conversation is built from (`frontend/src/kit/chat/`): MessageText,
//! ReactionChip, MessageQuote, TypingLine, JumpToLatest, LinkCard and AttachmentTile. They hold
//! no chat logic: the screen brings the data. The pure rules (counts, words, boxes, which
//! addresses stay in the app) are `semaphore_design::chat`; the web-link check is
//! `semaphore_core::links::check_link`.

mod attachment;
mod jump;
mod link_card;
mod quote;
mod reaction;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;
mod text;
mod typing;

pub use attachment::{AttachmentKind, AttachmentTile, PlayerSlot};
pub use jump::JumpToLatest;
pub use link_card::{LINK_CARD_BANNER_RATIO, LinkCard};
pub use quote::MessageQuote;
pub use reaction::ReactionChip;
pub use text::{MentionKind, MentionSegment, MessageSegment, MessageText, SegmentStyle};
pub use typing::TypingLine;

use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::TextStyle;
use std::sync::Arc;

/// One line of `style` that gives way with an ellipsis.
pub(crate) fn one_line(style: TextStyle, content: impl Into<SharedString>) -> Div {
    crate::kit::overlays::type_text(style, content)
        .min_w_0()
        .overflow_hidden()
        .whitespace_nowrap()
        .text_ellipsis()
}

/// A child id under a piece's own.
pub(crate) fn child_id(id: &ElementId, name: &'static str) -> ElementId {
    ElementId::NamedChild(Arc::new(id.clone()), name.into())
}
