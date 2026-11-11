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
}
