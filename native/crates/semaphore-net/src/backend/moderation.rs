//! [`HttpBackend`] for [`ModerationBackend`]: pins, moderator removal and channel roles.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, ModerationBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl ModerationBackend for HttpBackend {
    async fn moderation_controller_pin_message(
        &self,
        message_id: String,
        body: wire::PinMessageDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (message_id, body) = (message_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_pin_message(message_id, body))
    }

    async fn moderation_controller_unpin_message(
        &self,
        message_id: String,
        body: wire::UnpinMessageDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (message_id, body) = (message_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_unpin_message(message_id, body))
    }

    async fn moderation_controller_get_pinned_messages(
        &self,
        channel_id: String,
    ) -> BackendResult<Vec<wire::PinnedMessageDto>> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.moderation_controller_get_pinned_messages(channel_id))
    }

    async fn moderation_controller_delete_message_as_mod(
        &self,
        message_id: String,
        body: wire::DeleteMessageAsModDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (message_id, body) = (message_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_delete_message_as_mod(message_id, body))
    }

    async fn roles_controller_get_my_roles_for_channel(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.roles_controller_get_my_roles_for_channel(channel_id))
    }

    async fn moderation_controller_kick_user(
        &self,
        community_id: String,
        user_id: String,
        body: wire::KickUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (community_id, user_id, body) = (community_id.as_str(), user_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_kick_user(community_id, user_id, body))
    }

    // W5-B: bans, timeouts and the moderation log.
    async fn moderation_controller_ban_user(
        &self,
        community_id: String,
        user_id: String,
        body: wire::ModerationBanUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (community_id, user_id, body) = (community_id.as_str(), user_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_ban_user(community_id, user_id, body))
    }

    async fn moderation_controller_unban_user(
        &self,
        community_id: String,
        user_id: String,
        body: wire::UnbanUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (community_id, user_id, body) = (community_id.as_str(), user_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_unban_user(community_id, user_id, body))
    }

    async fn moderation_controller_get_ban_list(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::CommunityBanDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.moderation_controller_get_ban_list(community_id))
    }

    async fn moderation_controller_timeout_user(
        &self,
        community_id: String,
        user_id: String,
        body: wire::TimeoutUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (community_id, user_id, body) = (community_id.as_str(), user_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_timeout_user(community_id, user_id, body))
    }

    async fn moderation_controller_remove_timeout(
        &self,
        community_id: String,
        user_id: String,
        body: wire::RemoveTimeoutDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let (community_id, user_id, body) = (community_id.as_str(), user_id.as_str(), &body);
        rpc!(self, c => c.moderation_controller_remove_timeout(community_id, user_id, body))
    }

    async fn moderation_controller_get_timeout_list(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::CommunityTimeoutDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.moderation_controller_get_timeout_list(community_id))
    }

    async fn moderation_controller_get_timeout_status(
        &self,
        community_id: String,
        user_id: String,
    ) -> BackendResult<wire::TimeoutStatusResponseDto> {
        let (community_id, user_id) = (community_id.as_str(), user_id.as_str());
        rpc!(self, c => c.moderation_controller_get_timeout_status(community_id, user_id))
    }

    async fn moderation_controller_get_moderation_logs(
        &self,
        community_id: String,
        action: Option<String>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> BackendResult<wire::ModerationLogsResponseDto> {
        let (community_id, action) = (community_id.as_str(), action.as_deref());
        rpc!(self, c => c.moderation_controller_get_moderation_logs(community_id, action, limit, offset))
    }
}
