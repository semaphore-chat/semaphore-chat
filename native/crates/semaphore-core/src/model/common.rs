//! Shared by every area: conversations, users, errors, and what a UI re-reads and waits on.

/// Where messages live. A thread is keyed by its parent message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Conversation {
    Channel { id: String },
    DirectMessage { id: String },
    Thread { parent_message_id: String },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserView {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_file_id: Option<String>,
}

/// A failure a UI can show. `code` is the server's `ErrorCode` as sent, including ones this
/// build has never heard of; decide by `retryable`, not by matching every code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorView {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

/// A part of the UI to re-read from core after `CoreEvent::ViewChanged`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ViewKey {
    Session,
    Communities,
    Channels { community_id: String },
    Mentionables { community_id: String },
    Members { community_id: String },
    Rail,
    Voice,
    Typing { conversation: Conversation },
}

/// Whether a list a UI reads from core has arrived. `ViewChanged` for the same `ViewKey` says when to
/// ask again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum LoadState {
    #[default]
    Loading,
    Ready,
    /// The last fetch failed. Core won't try again until `Core::retry_failed`, or a new connection.
    Failed {
        error: ErrorView,
    },
}
