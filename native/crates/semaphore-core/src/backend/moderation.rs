//! Pins, a moderator's removal of a message, and the roles that say who may do either.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait ModerationBackend: Send + Sync {
    async fn moderation_controller_pin_message(
        &self,
        _message_id: String,
        _body: wire::PinMessageDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("pinning messages"))
    }
    async fn moderation_controller_unpin_message(
        &self,
        _message_id: String,
        _body: wire::UnpinMessageDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("unpinning messages"))
    }
    /// A channel's pins, oldest pin first.
    async fn moderation_controller_get_pinned_messages(
        &self,
        _channel_id: String,
    ) -> BackendResult<Vec<wire::PinnedMessageDto>> {
        Err(unsupported("listing pins"))
    }
    /// The soft removal: moderators keep seeing the text and the reason.
    async fn moderation_controller_delete_message_as_mod(
        &self,
        _message_id: String,
        _body: wire::DeleteMessageAsModDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("removing messages"))
    }
    /// This user's roles in a channel, whose actions say whether they may pin or remove.
    async fn roles_controller_get_my_roles_for_channel(
        &self,
        _channel_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        Err(unsupported("reading channel roles"))
    }
    /// W4: removes a member from the community, which also ends their call (the voice menu's
    /// "Kick").
    async fn moderation_controller_kick_user(
        &self,
        _community_id: String,
        _user_id: String,
        _body: wire::KickUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("kicking a member"))
    }
    /// W5.
    async fn moderation_controller_ban_user(
        &self,
        _community_id: String,
        _user_id: String,
        _body: wire::ModerationBanUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("banning a member"))
    }
    async fn moderation_controller_unban_user(
        &self,
        _community_id: String,
        _user_id: String,
        _body: wire::UnbanUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("lifting a ban"))
    }
    async fn moderation_controller_get_ban_list(
        &self,
        _community_id: String,
    ) -> BackendResult<Vec<wire::CommunityBanDto>> {
        Err(unsupported("listing bans"))
    }
    async fn moderation_controller_timeout_user(
        &self,
        _community_id: String,
        _user_id: String,
        _body: wire::TimeoutUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("timing out a member"))
    }
    async fn moderation_controller_remove_timeout(
        &self,
        _community_id: String,
        _user_id: String,
        _body: wire::RemoveTimeoutDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        Err(unsupported("lifting a timeout"))
    }
    async fn moderation_controller_get_timeout_list(
        &self,
        _community_id: String,
    ) -> BackendResult<Vec<wire::CommunityTimeoutDto>> {
        Err(unsupported("listing timeouts"))
    }
    async fn moderation_controller_get_timeout_status(
        &self,
        _community_id: String,
        _user_id: String,
    ) -> BackendResult<wire::TimeoutStatusResponseDto> {
        Err(unsupported("reading a timeout"))
    }
    /// Newest first. `action` is a `ModerationAction` wire name.
    async fn moderation_controller_get_moderation_logs(
        &self,
        _community_id: String,
        _action: Option<String>,
        _limit: Option<i64>,
        _offset: Option<i64>,
    ) -> BackendResult<wire::ModerationLogsResponseDto> {
        Err(unsupported("reading the moderation log"))
    }
}
