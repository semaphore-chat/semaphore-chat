//! [`HttpBackend`] for [`NotifyBackend`]: the notification centre, settings and channel levels.
//!
//! Two calls bypass the generated client. Saving settings sends JSON core built, because clearing
//! a DND time needs an explicit `null`, which the generated body type can't send. Reading a
//! channel's level answers 200 with an empty body when the channel has none (Nest's `null`), which
//! the generated decoder refuses.

use async_trait::async_trait;
use reqwest::Method;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use semaphore_api::{Client, ClientInfo, ResponseValue};
use semaphore_core::backend::{BackendResult, NotifyBackend};
use semaphore_wire::types as wire;
use serde_json::Value;

use super::*;

/// A request the generated client can't make, sent as it would send one: same reqwest client
/// (so the same authorization and deadlines), same `api-version`. Its error is the generated
/// client's, as the calls it stands in for return.
#[allow(clippy::result_large_err)]
pub(super) async fn raw(
    client: &Client,
    method: Method,
    path: &str,
    body: Option<&Value>,
) -> Result<reqwest::Response, Error<()>> {
    let mut request = client
        .client()
        .request(method, format!("{}{path}", client.baseurl()))
        .header(ACCEPT, "application/json")
        .header("api-version", Client::api_version());
    if let Some(body) = body {
        request = request
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }
    let response = request.send().await.map_err(Error::CommunicationError)?;
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(Error::UnexpectedResponse(response))
    }
}

#[async_trait]
impl NotifyBackend for HttpBackend {
    async fn notifications_controller_get_notifications(
        &self,
        limit: Option<u64>,
        offset: Option<u64>,
        unread_only: Option<bool>,
    ) -> BackendResult<wire::NotificationListResponseDto> {
        let limit = limit.and_then(std::num::NonZeroU64::new);
        // The centre never shows a dismissed row, so the server leaves them out of its pages:
        // the count of rows loaded then matches what `load_more` continues after.
        let include_dismissed = Some(false);
        rpc!(self, c => c.notifications_controller_get_notifications(include_dismissed, limit, offset, unread_only))
    }

    async fn notifications_controller_mark_as_read(
        &self,
        id: String,
    ) -> BackendResult<wire::NotificationDto> {
        let id = id.as_str();
        rpc!(self, c => c.notifications_controller_mark_as_read(id))
    }

    async fn notifications_controller_mark_all_as_read(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto> {
        rpc!(self, c => c.notifications_controller_mark_all_as_read())
    }

    async fn notifications_controller_dismiss_notification(
        &self,
        id: String,
    ) -> BackendResult<wire::NotificationDto> {
        let id = id.as_str();
        rpc!(self, c => c.notifications_controller_dismiss_notification(id))
    }

    async fn notifications_controller_get_settings(
        &self,
    ) -> BackendResult<wire::UserNotificationSettingsDto> {
        rpc!(self, c => c.notifications_controller_get_settings())
    }

    async fn notifications_controller_update_settings(
        &self,
        body: Value,
    ) -> BackendResult<wire::UserNotificationSettingsDto> {
        let body = &body;
        rpc!(self, c => async move {
            let response = raw(&c, Method::PUT, "/api/notifications/settings", Some(body)).await?;
            ResponseValue::from_response(response).await
        })
    }

    async fn notifications_controller_get_channel_override(
        &self,
        channel_id: String,
    ) -> BackendResult<Option<wire::ChannelNotificationOverrideDto>> {
        let path = format!("/api/notifications/channels/{channel_id}/override");
        let path = path.as_str();
        rpc!(self, c => async move {
            let response = raw(&c, Method::GET, path, None).await?;
            let (status, headers) = (response.status(), response.headers().clone());
            let bytes = response.bytes().await.map_err(Error::ResponseBodyError)?;
            let text = std::str::from_utf8(&bytes).unwrap_or("").trim();
            let level = if text.is_empty() || text == "null" {
                None
            } else {
                Some(serde_json::from_slice(&bytes).map_err(|error| {
                    Error::InvalidResponsePayload(bytes.clone(), error)
                })?)
            };
            Ok(ResponseValue::new(level, status, headers))
        })
    }

    async fn notifications_controller_set_channel_override(
        &self,
        channel_id: String,
        body: wire::UpdateChannelOverrideDto,
    ) -> BackendResult<wire::ChannelNotificationOverrideDto> {
        let (channel_id, body) = (channel_id.as_str(), &body);
        rpc!(self, c => c.notifications_controller_set_channel_override(channel_id, body))
    }

    async fn notifications_controller_delete_channel_override(
        &self,
        channel_id: String,
    ) -> BackendResult<()> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.notifications_controller_delete_channel_override(channel_id))
    }
}
