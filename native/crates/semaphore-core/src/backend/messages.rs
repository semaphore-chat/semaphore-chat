//! Message pages, sends, reactions and read receipts.

use async_trait::async_trait;
use semaphore_wire::enums::MessagePageDirection;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend).
#[async_trait]
pub trait MessagesBackend: Send + Sync {
    // Messages. Pages come newest first, except thread replies, which come oldest first.
    async fn messages_controller_find_all_for_channel(
        &self,
        channel_id: String,
        continuation_token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto>;
    async fn messages_controller_find_around_for_channel(
        &self,
        channel_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto>;
    async fn messages_controller_find_around_for_group(
        &self,
        group_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto>;
    async fn messages_controller_find_all_for_group(
        &self,
        group_id: String,
        continuation_token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto>;
    async fn threads_controller_get_replies(
        &self,
        parent_message_id: String,
        continuation_token: Option<String>,
        limit: Option<i64>,
    ) -> BackendResult<wire::ThreadRepliesResponseDto>;
    async fn messages_controller_create(
        &self,
        body: wire::CreateMessageDto,
    ) -> BackendResult<wire::MessageDto>;
    async fn messages_controller_create_direct_message(
        &self,
        body: wire::CreateMessageDto,
    ) -> BackendResult<wire::MessageDto>;
    async fn messages_controller_add_reaction(
        &self,
        body: wire::AddReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto>;
    async fn messages_controller_remove_reaction(
        &self,
        body: wire::RemoveReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto>;
    async fn read_receipts_controller_mark_as_read(
        &self,
        body: wire::MarkAsReadDto,
    ) -> BackendResult<wire::ReadReceiptDto>;

    // Edit and delete (W1). Defaults until a backend has them.
    /// `PATCH /api/messages/{id}`. No `attachments` leaves them; a list, even empty, keeps those.
    async fn messages_controller_update(
        &self,
        _id: String,
        _body: wire::UpdateMessageDto,
    ) -> BackendResult<wire::MessageDto> {
        Err(unsupported("editing messages"))
    }
    /// `DELETE /api/messages/{id}`: a hard delete, by the author or, in a channel, a moderator.
    async fn messages_controller_remove(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("deleting messages"))
    }
    /// `GET /api/messages/{id}`, as the server shows it to this reader.
    async fn messages_controller_find_one(&self, _id: String) -> BackendResult<wire::MessageDto> {
        Err(unsupported("reading a message"))
    }
}
