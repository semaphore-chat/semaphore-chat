//! Direct messages and groups: the list, and one group for a conversation header. The messages
//! themselves are `Conversation::DirectMessage` with the message commands. Unit W2-core.

use super::{LoadState, UserView};

/// The newest message of a DM, for its list row.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DmPreview {
    pub author_id: String,
    /// Plain text of its spans, as a row shows it.
    pub text: String,
    pub sent_at_ms: i64,
}

/// One direct message or group.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DmRow {
    pub id: String,
    /// A group's name, if it was given one. Otherwise the UI names it after `members`.
    pub name: Option<String>,
    pub is_group: bool,
    /// Everyone in it but this user, in the order the server lists them.
    pub members: Vec<UserView>,
    pub last_message: Option<DmPreview>,
    pub unread: u32,
    pub mentions: u32,
    /// A one-to-one DM whose other member is online now. Always false for a group.
    pub online: bool,
}

/// This user's DMs and groups, the most recently active first. `ViewKey::DirectMessages` says when
/// to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DmList {
    pub state: LoadState,
    pub rows: Vec<DmRow>,
}
