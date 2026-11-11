//! W2's friends and idle presence.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    FriendRequestRow, FriendRow, FriendsView, FriendshipState, LoadState, UserView,
};

#[uniffi::remote(Record)]
pub struct FriendRow {
    pub friendship_id: String,
    pub user: UserView,
    pub online: bool,
    pub busy: bool,
}

#[uniffi::remote(Record)]
pub struct FriendRequestRow {
    pub friendship_id: String,
    pub user: UserView,
    pub sent_at_ms: i64,
    pub busy: bool,
}

#[uniffi::remote(Record)]
pub struct FriendsView {
    pub state: LoadState,
    pub friends: Vec<FriendRow>,
    pub incoming: Vec<FriendRequestRow>,
    pub outgoing: Vec<FriendRequestRow>,
}

#[uniffi::remote(Enum)]
pub enum FriendshipState {
    None,
    Friends { friendship_id: String },
    RequestSent { friendship_id: String },
    RequestReceived { friendship_id: String },
}

/// `semaphore_core::commands::social::IDLE_AFTER_MS`: how long without input makes the user idle.
#[uniffi::export]
pub fn idle_after_ms() -> u64 {
    semaphore_core::commands::social::IDLE_AFTER_MS
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn friends(&self) -> FriendsView {
        self.core.friends()
    }

    pub async fn friendship_status(&self, user_id: String) -> Result<FriendshipState, CoreError> {
        self.core.friendship_status(user_id).await
    }

    pub async fn send_friend_request(&self, user_id: String) -> Result<(), CoreError> {
        self.core.send_friend_request(user_id).await
    }

    pub async fn accept_friend_request(&self, friendship_id: String) -> Result<(), CoreError> {
        self.core.accept_friend_request(friendship_id).await
    }

    pub async fn decline_friend_request(&self, friendship_id: String) -> Result<(), CoreError> {
        self.core.decline_friend_request(friendship_id).await
    }

    pub async fn cancel_friend_request(&self, friendship_id: String) -> Result<(), CoreError> {
        self.core.cancel_friend_request(friendship_id).await
    }

    pub async fn remove_friend(&self, friendship_id: String) -> Result<(), CoreError> {
        self.core.remove_friend(friendship_id).await
    }

    pub fn set_idle(&self, idle: bool) {
        self.core.set_idle(idle);
    }
}
