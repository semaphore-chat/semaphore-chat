//! [`HttpBackend`] for [`SocialBackend`]: friends and friend requests.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, SocialBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl SocialBackend for HttpBackend {
    async fn friends_controller_get_friends(&self) -> BackendResult<Vec<wire::FriendListItemDto>> {
        rpc!(self, c => c.friends_controller_get_friends())
    }

    async fn friends_controller_get_pending_requests(
        &self,
    ) -> BackendResult<wire::PendingRequestsDto> {
        rpc!(self, c => c.friends_controller_get_pending_requests())
    }

    async fn friends_controller_get_friendship_status(
        &self,
        user_id: String,
    ) -> BackendResult<wire::FriendshipStatusDto> {
        let user_id = user_id.as_str();
        rpc!(self, c => c.friends_controller_get_friendship_status(user_id))
    }

    async fn friends_controller_send_friend_request(
        &self,
        user_id: String,
    ) -> BackendResult<wire::FriendshipDto> {
        let user_id = user_id.as_str();
        rpc!(self, c => c.friends_controller_send_friend_request(user_id))
    }

    async fn friends_controller_accept_friend_request(
        &self,
        id: String,
    ) -> BackendResult<wire::FriendshipDto> {
        let id = id.as_str();
        rpc!(self, c => c.friends_controller_accept_friend_request(id))
    }

    async fn friends_controller_decline_friend_request(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.friends_controller_decline_friend_request(id)).map(|_| ())
    }

    async fn friends_controller_cancel_friend_request(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.friends_controller_cancel_friend_request(id)).map(|_| ())
    }

    async fn friends_controller_remove_friend(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.friends_controller_remove_friend(id)).map(|_| ())
    }
}
