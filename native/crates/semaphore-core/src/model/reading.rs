//! Finding and following messages: threads, search, the unread divider and message links.

use super::{Conversation, LoadState, MessageRow};

/// A thread's state for its pane header.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ThreadInfo {
    pub state: LoadState,
    pub subscribed: bool,
    pub reply_count: u32,
    pub last_reply_at_ms: Option<i64>,
}

/// Where a search looks.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SearchScope {
    Channel { id: String },
    DirectMessage { id: String },
    Community { id: String },
}

/// One search result. A thread reply carries its parent, which is what a jump opens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub row: MessageRow,
    /// Where the message is: its channel or DM, never a thread.
    pub conversation: Conversation,
    pub parent_message_id: Option<String>,
    /// Sent for a community search.
    pub channel_name: Option<String>,
}

/// Where the unread divider goes: after the message last read when the conversation opened.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UnreadMarker {
    pub after_message_id: String,
    /// The row it follows, if loaded. `None`: it's older than the loaded rows, so the divider
    /// goes above the first one.
    pub after_seq: Option<i64>,
    pub unread_count: u32,
    pub mention_count: u32,
}

/// A link to a conversation, and to a message in it, in one of the web's path forms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageLink {
    pub community_id: Option<String>,
    pub conversation: Conversation,
    pub message_id: Option<String>,
}
