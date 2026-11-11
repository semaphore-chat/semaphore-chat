//! REST, as core sees it. `semaphore-net` implements this over the generated `semaphore-api`
//! client, so core never depends on reqwest. Single-flight token refresh lives in that
//! implementation, which also keeps the tokens: core sees them only to learn when they expire.
//!
//! Every method is named after its `operationId` in snake case, so a generated trait can replace
//! this one later, and takes the generated client's arguments as owned values. Everything else
//! core calls goes through them.

use async_trait::async_trait;
use semaphore_wire::enums::{ErrorCode, MessagePageDirection};
use semaphore_wire::types as wire;

use crate::model::ErrorView;
use std::sync::Arc;

/// One file for [`Backend::file_upload_controller_upload_file`]. The bytes are shared, so a failed
/// upload can be tried again without a copy, and freed when the last holder lets go.
#[derive(Clone)]
pub struct FileUpload {
    pub filename: String,
    pub mime_type: String,
    pub bytes: Arc<Vec<u8>>,
    pub resource_type: semaphore_wire::enums::ResourceType,
    pub resource_id: Option<String>,
}

/// Told how many bytes of an upload have gone so far.
pub type UploadProgress = Arc<dyn Fn(u64) + Send + Sync>;

/// A failed REST call, whether the server answered or not. `semaphore_api::ApiError` field for
/// field, because core can't name that crate: it pulls in reqwest.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
#[error("{} ({status}): {message}", code.as_str())]
pub struct BackendError {
    /// The HTTP status, or 0 when the request never got a response.
    pub status: u16,
    /// The server's code, kept verbatim even when this build hasn't heard of it.
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

impl BackendError {
    pub fn view(&self) -> ErrorView {
        ErrorView {
            code: self.code.as_str().into_owned(),
            message: self.message.clone(),
            retryable: self.retryable,
            retry_after_ms: self.retry_after_ms,
        }
    }
}

pub type BackendResult<T> = Result<T, BackendError>;

#[async_trait]
pub trait Backend: Send + Sync {
    /// Where the next requests go, from `Core::sign_in`. The client is built per server.
    fn set_server_url(&self, server_url: String);

    /// A session for the server set last survives from an earlier run: a refresh can resume it
    /// without a password. `Core::restore_session` asks before refreshing.
    fn has_stored_session(&self) -> bool {
        false
    }

    // Session
    async fn auth_controller_login(
        &self,
        body: wire::LoginRequestDto,
    ) -> BackendResult<wire::LoginResponseDto>;
    /// An empty `refresh_token` means the one this implementation holds.
    async fn auth_controller_refresh(
        &self,
        body: wire::RefreshRequestDto,
    ) -> BackendResult<wire::LoginResponseDto>;
    async fn auth_controller_logout(
        &self,
        body: wire::LogoutRequestDto,
    ) -> BackendResult<wire::LogoutResponseDto>;
    async fn user_controller_get_profile(&self) -> BackendResult<wire::UserEntity>;
    async fn user_controller_get_user_by_id(&self, id: String) -> BackendResult<wire::UserEntity>;

    // Navigation
    async fn community_controller_find_all_mine(
        &self,
    ) -> BackendResult<Vec<wire::CommunityResponseDto>>;
    async fn channels_controller_find_all_for_community(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>>;
    async fn channel_permissions_controller_get_my_community_channel_permissions(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityChannelCapabilitiesDto>;
    async fn read_receipts_controller_get_unread_counts(
        &self,
    ) -> BackendResult<Vec<wire::UnreadCountDto>>;

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

    // Members and counters
    async fn membership_controller_find_all_for_community(
        &self,
        community_id: String,
        limit: Option<i64>,
        continuation_token: Option<String>,
    ) -> BackendResult<wire::PaginatedMembershipsResponseDto>;
    async fn presence_controller_get_bulk_presence(
        &self,
    ) -> BackendResult<wire::BulkPresenceResponseDto>;
    async fn notifications_controller_get_unread_count(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto>;

    // Composer
    async fn membership_controller_search_community_members(
        &self,
        community_id: String,
        query: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MembershipResponseDto>>;
    async fn channels_controller_get_mentionable_channels(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>>;
    async fn custom_emoji_controller_list_community_emojis(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::CustomEmojiDto>>;

    // Voice
    async fn livekit_controller_get_connection_info(
        &self,
    ) -> BackendResult<wire::ConnectionInfoResponseDto>;
    async fn livekit_controller_generate_token(
        &self,
        body: wire::CreateTokenDto,
    ) -> BackendResult<wire::TokenResponseDto>;
    async fn voice_presence_controller_get_channel_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::ChannelVoicePresenceResponseDto>;
    async fn voice_presence_controller_join_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;
    async fn voice_presence_controller_refresh_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;
    async fn voice_presence_controller_leave_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;
    async fn voice_presence_controller_update_deafen_state(
        &self,
        channel_id: String,
        body: wire::UpdateDeafenStateDto,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;

    // Files
    async fn file_controller_get_file(&self, id: String) -> BackendResult<Vec<u8>>;
    async fn file_controller_get_file_thumbnail(&self, id: String) -> BackendResult<Vec<u8>>;

    /// `POST /api/file-upload`, multipart. `progress` hears the bytes sent so far.
    async fn file_upload_controller_upload_file(
        &self,
        _file: FileUpload,
        _progress: UploadProgress,
    ) -> BackendResult<wire::FileUploadResponseDto> {
        Err(unsupported("uploading files"))
    }

    /// `POST /api/messages/{id}/attachments`: attaches an uploaded file, or with no file releases
    /// one of the message's pending slots.
    async fn messages_controller_add_attachment(
        &self,
        _id: String,
        _body: wire::AddAttachmentDto,
    ) -> BackendResult<wire::MessageDto> {
        Err(unsupported("attaching files"))
    }

    // Instance
    /// Before sign-in, against the server URL set last. A backend that has no such call says so.
    async fn instance_controller_get_public_settings(
        &self,
    ) -> BackendResult<wire::PublicSettingsResponseDto> {
        Err(unsupported("reading a server's public settings"))
    }
}

fn unsupported(what: &str) -> BackendError {
    BackendError {
        status: 0,
        code: ErrorCode::Unknown("UNSUPPORTED".into()),
        message: format!("this backend can't do this: {what}"),
        retryable: false,
        retry_after_ms: None,
    }
}
