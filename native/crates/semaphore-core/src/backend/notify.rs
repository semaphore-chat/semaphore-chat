//! The notification centre, notification settings and per-channel levels. The unread count is in
//! [`CommunitiesBackend`](super::CommunitiesBackend), where the rail first needed it.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait NotifyBackend: Send + Sync {
    async fn notifications_controller_get_notifications(
        &self,
        _limit: Option<u64>,
        _offset: Option<u64>,
        _unread_only: Option<bool>,
    ) -> BackendResult<wire::NotificationListResponseDto> {
        Err(unsupported("listing notifications"))
    }
    async fn notifications_controller_mark_as_read(
        &self,
        _id: String,
    ) -> BackendResult<wire::NotificationDto> {
        Err(unsupported("marking notifications read"))
    }
    async fn notifications_controller_mark_all_as_read(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto> {
        Err(unsupported("marking notifications read"))
    }
    async fn notifications_controller_dismiss_notification(
        &self,
        _id: String,
    ) -> BackendResult<wire::NotificationDto> {
        Err(unsupported("dismissing notifications"))
    }
    async fn notifications_controller_get_settings(
        &self,
    ) -> BackendResult<wire::UserNotificationSettingsDto> {
        Err(unsupported("reading notification settings"))
    }
    /// `body` is an `UpdateNotificationSettingsDto` as JSON, because clearing a DND time needs an
    /// explicit `null`, which the generated type can't send.
    async fn notifications_controller_update_settings(
        &self,
        _body: serde_json::Value,
    ) -> BackendResult<wire::UserNotificationSettingsDto> {
        Err(unsupported("saving notification settings"))
    }
    /// `None`: the channel has no level of its own. The server answers that with an empty body.
    async fn notifications_controller_get_channel_override(
        &self,
        _channel_id: String,
    ) -> BackendResult<Option<wire::ChannelNotificationOverrideDto>> {
        Err(unsupported("reading channel notification levels"))
    }
    async fn notifications_controller_set_channel_override(
        &self,
        _channel_id: String,
        _body: wire::UpdateChannelOverrideDto,
    ) -> BackendResult<wire::ChannelNotificationOverrideDto> {
        Err(unsupported("setting channel notification levels"))
    }
    async fn notifications_controller_delete_channel_override(
        &self,
        _channel_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("clearing channel notification levels"))
    }
}
