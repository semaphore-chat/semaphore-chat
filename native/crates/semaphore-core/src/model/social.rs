//! Friends and friend requests. Unit W2-core.

use super::{LoadState, UserView};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FriendRow {
    pub friendship_id: String,
    pub user: UserView,
    pub online: bool,
    /// A removal is on its way: show the row disabled.
    pub busy: bool,
}

/// A pending request, either way.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FriendRequestRow {
    pub friendship_id: String,
    /// The other person: who sent it for an incoming request, who it went to for an outgoing one.
    pub user: UserView,
    pub sent_at_ms: i64,
    /// An accept, decline or cancel is on its way: show the row disabled.
    pub busy: bool,
}

/// Friends and pending requests. The server sends no events for any of it, so core reads it again
/// after each change made here, on reconnect, and when read while more than 30 s old.
/// `ViewKey::Friends` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FriendsView {
    pub state: LoadState,
    pub friends: Vec<FriendRow>,
    /// Sent to this user: accept or decline.
    pub incoming: Vec<FriendRequestRow>,
    /// Sent by this user: cancel.
    pub outgoing: Vec<FriendRequestRow>,
}

/// Where this user stands with another, for an "Add friend" button.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum FriendshipState {
    #[default]
    None,
    Friends {
        friendship_id: String,
    },
    RequestSent {
        friendship_id: String,
    },
    RequestReceived {
        friendship_id: String,
    },
}
