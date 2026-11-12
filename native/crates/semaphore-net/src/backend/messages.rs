//! [`HttpBackend`] for [`MessagesBackend`].

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, MessagesBackend};
use semaphore_wire::enums::MessagePageDirection;
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl MessagesBackend for HttpBackend {
    async fn messages_controller_find_all_for_channel(
        &self,
        channel_id: String,
        continuation_token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto> {
        let channel_id = channel_id.as_str();
        let token = continuation_token.as_deref();
        let direction = direction.as_ref();
        rpc!(self, c => c.messages_controller_find_all_for_channel(channel_id, token, direction, limit))
    }

    async fn messages_controller_find_around_for_channel(
        &self,
        channel_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto> {
        let channel_id = channel_id.as_str();
        let message_id = message_id.as_str();
        rpc!(self, c => c.messages_controller_find_around_for_channel(channel_id, message_id, limit))
    }

    async fn messages_controller_find_around_for_group(
        &self,
        group_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto> {
        let group_id = group_id.as_str();
        let message_id = message_id.as_str();
        rpc!(self, c => c.messages_controller_find_around_for_group(group_id, message_id, limit))
    }

    async fn messages_controller_find_all_for_group(
        &self,
        group_id: String,
        continuation_token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto> {
        let group_id = group_id.as_str();
        let token = continuation_token.as_deref();
        let direction = direction.as_ref();
        rpc!(self, c => c.messages_controller_find_all_for_group(group_id, token, direction, limit))
    }

    async fn threads_controller_get_replies(
        &self,
        parent_message_id: String,
        continuation_token: Option<String>,
        limit: Option<i64>,
    ) -> BackendResult<wire::ThreadRepliesResponseDto> {
        let parent_message_id = parent_message_id.as_str();
        let token = continuation_token.as_deref();
        rpc!(self, c => c.threads_controller_get_replies(parent_message_id, token, limit))
    }

    async fn messages_controller_create(
        &self,
        body: wire::CreateMessageDto,
    ) -> BackendResult<wire::MessageDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_create(body))
    }

    async fn messages_controller_create_direct_message(
        &self,
        body: wire::CreateMessageDto,
    ) -> BackendResult<wire::MessageDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_create_direct_message(body))
    }

    async fn messages_controller_add_reaction(
        &self,
        body: wire::AddReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_add_reaction(body))
    }

    async fn messages_controller_remove_reaction(
        &self,
        body: wire::RemoveReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_remove_reaction(body))
    }

    async fn read_receipts_controller_mark_as_read(
        &self,
        body: wire::MarkAsReadDto,
    ) -> BackendResult<wire::ReadReceiptDto> {
        let body = &body;
        rpc!(self, c => c.read_receipts_controller_mark_as_read(body))
    }

    async fn read_receipts_controller_get_dm_peer_reads(
        &self,
        dm_group_id: String,
    ) -> BackendResult<Vec<wire::DmPeerReadDto>> {
        let dm_group_id = &dm_group_id;
        rpc!(self, c => c.read_receipts_controller_get_dm_peer_reads(dm_group_id))
    }

    async fn read_receipts_controller_get_message_readers(
        &self,
        message_id: String,
        channel_id: Option<String>,
        dm_group_id: Option<String>,
    ) -> BackendResult<Vec<wire::MessageReaderDto>> {
        let message_id = &message_id;
        let channel_id = channel_id.as_deref();
        let dm_group_id = dm_group_id.as_deref();
        rpc!(
            self,
            c => c.read_receipts_controller_get_message_readers(message_id, channel_id, dm_group_id)
        )
    }

    async fn messages_controller_update(
        &self,
        id: String,
        body: wire::UpdateMessageDto,
    ) -> BackendResult<wire::MessageDto> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.messages_controller_update(id, body))
    }

    async fn messages_controller_remove(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.messages_controller_remove(id))
    }

    async fn messages_controller_find_one(&self, id: String) -> BackendResult<wire::MessageDto> {
        let id = id.as_str();
        rpc!(self, c => c.messages_controller_find_one(id))
    }
}
