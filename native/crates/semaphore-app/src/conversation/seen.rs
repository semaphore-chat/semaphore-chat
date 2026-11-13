//! WP's half of the conversation pane: "Seen by" (the hovered message's readers, a DM's read
//! watermarks). Hub file from the UI freeze: `actions.rs` sends `SeenByHovered` here; WP fills
//! the body and the feeds.

use super::{ConversationPane, Which};
use gpui_kit::*;

impl ConversationPane {
    /// `MessageListEvent::SeenByHovered` from the `which` list: feed `MessageList::set_seen_by`
    /// from `Core::seen_by` while `message_id` is `Some`.
    pub(super) fn seen_by_hovered(
        &mut self,
        _which: Which,
        _message_id: Option<String>,
        _cx: &mut Context<Self>,
    ) {
    }
}
