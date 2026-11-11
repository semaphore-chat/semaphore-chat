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
