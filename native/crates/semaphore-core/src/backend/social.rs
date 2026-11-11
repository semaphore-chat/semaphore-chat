//! Friends and friend requests. The `id` of accept, decline, cancel and remove is the friendship's.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait SocialBackend: Send + Sync {
    async fn friends_controller_get_friends(&self) -> BackendResult<Vec<wire::FriendListItemDto>> {
        Err(unsupported("listing friends"))
    }
    async fn friends_controller_get_pending_requests(
        &self,
    ) -> BackendResult<wire::PendingRequestsDto> {
        Err(unsupported("listing friend requests"))
    }
    async fn friends_controller_get_friendship_status(
        &self,
        _user_id: String,
    ) -> BackendResult<wire::FriendshipStatusDto> {
        Err(unsupported("reading a friendship"))
    }
    async fn friends_controller_send_friend_request(
        &self,
        _user_id: String,
    ) -> BackendResult<wire::FriendshipDto> {
        Err(unsupported("sending friend requests"))
    }
    async fn friends_controller_accept_friend_request(
        &self,
        _id: String,
    ) -> BackendResult<wire::FriendshipDto> {
        Err(unsupported("accepting friend requests"))
    }
    async fn friends_controller_decline_friend_request(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("declining friend requests"))
    }
    async fn friends_controller_cancel_friend_request(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("cancelling friend requests"))
    }
    async fn friends_controller_remove_friend(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("removing friends"))
    }
}
