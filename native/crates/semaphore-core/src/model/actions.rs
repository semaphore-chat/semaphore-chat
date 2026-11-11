//! Acting on a message: pins and who reacted. Edit, delete and react use `MessageRow` and
//! `MessageDraft`.

use super::{LoadState, MessageRow, UserView};

/// Who reacted with one emoji, as many as a tooltip lists.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReactionUsers {
    pub users: Vec<UserView>,
    /// How many more reacted than `users` lists.
    pub more: u32,
}

/// A pinned message. A thread reply carries its parent, which is what a jump opens.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PinnedRow {
    pub row: MessageRow,
    pub parent_message_id: Option<String>,
}

/// A channel's pins, oldest pin first, as the server orders them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PinnedList {
    pub state: LoadState,
    pub rows: Vec<PinnedRow>,
}

/// What this user may do to other people's messages in a channel. The author's own edit and
/// delete need nothing here.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ChannelModeration {
    pub pin: bool,
    pub unpin: bool,
    /// Remove someone else's message. Those who may also still see what was removed.
    pub remove_any: bool,
}

/// What this user may do to others' messages in a channel, and whether that's known yet.
/// `allowed` is all false until `state` is `Ready`: show no moderator actions meanwhile. `Failed`
/// means the roles couldn't be read: `Core::retry_failed`, or a new connection, reads them again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelModerationView {
    pub state: LoadState,
    pub allowed: ChannelModeration,
}
