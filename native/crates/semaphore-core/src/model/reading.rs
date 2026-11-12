//! Finding and following messages: threads, search, the unread divider and message links.

use super::{Conversation, LoadState, MessageRow, UserView};

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

/// The first page of a search, and everything read since. `more` says the server has another
/// page; `Core::load_more_search` reads it, and `loading_more` is set while it's on its way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchResultsView {
    pub state: LoadState,
    pub scope: SearchScope,
    /// Trimmed: what the server was asked.
    pub query: String,
    pub hits: Vec<SearchHit>,
    pub more: bool,
    pub loading_more: bool,
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

/// One peer's watermark in a DM and who they are.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PeerReadView {
    pub user: UserView,
    /// When they last read, for comparing with a message's sent time.
    pub last_read_at_ms: i64,
}

/// `Core::dm_peer_reads`: the other members of a DM and how far each has read, from
/// `GET /read-receipts/dm-peer-reads/{id}`. `ViewKey::DmPeerReads { dm_group_id }` says when to read
/// again; a peer's read arrives directly over `readReceiptUpdated`. A DM's own read mark is not in
/// this list: the server leaves this user out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DmPeerReadsView {
    pub state: LoadState,
    pub dm_group_id: String,
    /// As the server orders them (one row per peer that has read at all).
    pub peers: Vec<PeerReadView>,
}

/// `Core::seen_by`: who has read one message.
///
/// In a DM the server sends watermarks only, so the peers are those whose last read is at or after
/// the message's sent time; a message not loaded here has no sent time to compare, so nobody is
/// named. In a channel the server answers the readers of that message directly (`readAt`), which
/// excludes this user. Threads have no readers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SeenByView {
    /// The read behind it: `Ready` with nobody for a message that isn't loaded, a thread, or
    /// nobody having read it.
    pub state: LoadState,
    /// The first `SEEN_BY_NAMES` (15, as the web's tooltip lists), in the server's order (DM
    /// peers by their read time).
    pub readers: Vec<UserView>,
    /// Everyone who read it, named or not.
    pub count: u32,
    /// `count` less the names shown: "and 4 more".
    pub more: u32,
}
