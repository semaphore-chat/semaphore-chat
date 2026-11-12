//! [`FakeBackend`] for W2: direct messages, friends and notifications, scripted through
//! `FakeBackend::w2`. Each call is answered with the JSON set for its operation (decoded into the
//! wire type, so a fake that doesn't match the contract fails loudly), or the error set for it,
//! after the gate set for it fires.

use super::{FakeBackend, decoded, not_found};
use semaphore_core::backend::{
    BackendError, BackendResult, DmsBackend, NotifyBackend, SocialBackend,
};
use semaphore_wire::types as wire;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct W2Fakes {
    /// What each operation answers, by operation name (`dms`, `create_dm`, ...).
    pub answers: Mutex<HashMap<&'static str, Value>>,
    /// The next call of an operation fails with this.
    pub errors: Mutex<HashMap<&'static str, BackendError>>,
    /// The next call of an operation waits for this.
    pub gates: Mutex<HashMap<&'static str, oneshot::Receiver<()>>>,
    /// Every call, as `operation argument...`.
    pub calls: Mutex<Vec<String>>,
}

impl W2Fakes {
    pub fn answer(&self, op: &'static str, value: Value) {
        self.answers.lock().unwrap().insert(op, value);
    }

    pub fn fail_next(&self, op: &'static str, error: BackendError) {
        self.errors.lock().unwrap().insert(op, error);
    }

    /// Holds the next call of `op` until the sender fires.
    pub fn hold(&self, op: &'static str) -> oneshot::Sender<()> {
        let (send, receive) = oneshot::channel();
        self.gates.lock().unwrap().insert(op, receive);
        send
    }

    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    pub fn count(&self, op: &str) -> usize {
        self.calls()
            .iter()
            .filter(|call| call.split(' ').next() == Some(op))
            .count()
    }

    pub async fn run<T: serde::de::DeserializeOwned>(
        &self,
        op: &'static str,
        args: &[&str],
    ) -> BackendResult<T> {
        let mut call = op.to_owned();
        for arg in args {
            call.push(' ');
            call.push_str(arg);
        }
        self.calls.lock().unwrap().push(call);
        let gate = self.gates.lock().unwrap().remove(op);
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        if let Some(error) = self.errors.lock().unwrap().remove(op) {
            return Err(error);
        }
        let answer = self.answers.lock().unwrap().get(op).cloned();
        match answer {
            Some(value) => decoded(value),
            None => Err(not_found()),
        }
    }
}

#[async_trait::async_trait]
impl DmsBackend for FakeBackend {
    async fn direct_messages_controller_find_user_dm_groups(
        &self,
    ) -> BackendResult<Vec<wire::DmGroupResponseDto>> {
        self.w2.run("dms", &[]).await
    }
    async fn direct_messages_controller_create_dm_group(
        &self,
        body: wire::CreateDmGroupDto,
    ) -> BackendResult<wire::DmGroupResponseDto> {
        let ids: Vec<String> = body.user_ids.iter().map(ToString::to_string).collect();
        let name = body.name.unwrap_or_default();
        self.w2.run("create_dm", &[&ids.join(","), &name]).await
    }
    async fn direct_messages_controller_add_members(
        &self,
        id: String,
        body: wire::AddMembersDto,
    ) -> BackendResult<wire::DmGroupResponseDto> {
        let ids: Vec<String> = body.user_ids.iter().map(ToString::to_string).collect();
        self.w2.run("add_members", &[&id, &ids.join(",")]).await
    }
    async fn direct_messages_controller_leave_dm_group(&self, id: String) -> BackendResult<()> {
        self.w2.run::<Value>("leave_dm", &[&id]).await.map(|_| ())
    }
    async fn user_controller_search_users(
        &self,
        _community_id: Option<String>,
        _limit: Option<i64>,
        q: String,
    ) -> BackendResult<Vec<wire::UserEntity>> {
        self.w2.run("search_users", &[&q]).await
    }
}

#[async_trait::async_trait]
impl SocialBackend for FakeBackend {
    async fn friends_controller_get_friends(&self) -> BackendResult<Vec<wire::FriendListItemDto>> {
        self.w2.run("friends", &[]).await
    }
    async fn friends_controller_get_pending_requests(
        &self,
    ) -> BackendResult<wire::PendingRequestsDto> {
        self.w2.run("requests", &[]).await
    }
    async fn friends_controller_get_friendship_status(
        &self,
        user_id: String,
    ) -> BackendResult<wire::FriendshipStatusDto> {
        self.w2.run("friendship_status", &[&user_id]).await
    }
    async fn friends_controller_send_friend_request(
        &self,
        user_id: String,
    ) -> BackendResult<wire::FriendshipDto> {
        self.w2.run("send_request", &[&user_id]).await
    }
    async fn friends_controller_accept_friend_request(
        &self,
        id: String,
    ) -> BackendResult<wire::FriendshipDto> {
        self.w2.run("accept", &[&id]).await
    }
    async fn friends_controller_decline_friend_request(&self, id: String) -> BackendResult<()> {
        self.w2.run::<Value>("decline", &[&id]).await.map(|_| ())
    }
    async fn friends_controller_cancel_friend_request(&self, id: String) -> BackendResult<()> {
        self.w2.run::<Value>("cancel", &[&id]).await.map(|_| ())
    }
    async fn friends_controller_remove_friend(&self, id: String) -> BackendResult<()> {
        self.w2
            .run::<Value>("remove_friend", &[&id])
            .await
            .map(|_| ())
    }
}

#[async_trait::async_trait]
impl NotifyBackend for FakeBackend {
    async fn notifications_controller_get_notifications(
        &self,
        limit: Option<u64>,
        offset: Option<u64>,
        _unread_only: Option<bool>,
    ) -> BackendResult<wire::NotificationListResponseDto> {
        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);
        let page: Value = self
            .w2
            .run("notifications", &[&limit.to_string(), &offset.to_string()])
            .await?;
        // The scripted answer is every row; serve the page the server would: dismissed rows
        // left out (core asks for `includeDismissed=false`), then the offset and limit.
        let rows: Vec<Value> = page["notifications"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|row| row["dismissed"] != Value::Bool(true))
            .collect();
        let total = rows.len();
        let slice: Vec<Value> = rows
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect();
        decoded(json!({
            "notifications": slice,
            "total": page.get("total").cloned().unwrap_or(json!(total)),
            "unreadCount": page.get("unreadCount").cloned().unwrap_or(json!(0)),
        }))
    }
    async fn notifications_controller_mark_as_read(
        &self,
        id: String,
    ) -> BackendResult<wire::NotificationDto> {
        self.w2.run("mark_read", &[&id]).await
    }
    async fn notifications_controller_mark_all_as_read(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto> {
        self.w2.run("mark_all_read", &[]).await
    }
    async fn notifications_controller_dismiss_notification(
        &self,
        id: String,
    ) -> BackendResult<wire::NotificationDto> {
        self.w2.run("dismiss", &[&id]).await
    }
    async fn notifications_controller_get_settings(
        &self,
    ) -> BackendResult<wire::UserNotificationSettingsDto> {
        self.w2.run("settings", &[]).await
    }
    async fn notifications_controller_update_settings(
        &self,
        body: Value,
    ) -> BackendResult<wire::UserNotificationSettingsDto> {
        self.w2.run("update_settings", &[&body.to_string()]).await
    }
    async fn notifications_controller_get_channel_override(
        &self,
        channel_id: String,
    ) -> BackendResult<Option<wire::ChannelNotificationOverrideDto>> {
        self.w2.run("channel_level", &[&channel_id]).await
    }
    async fn notifications_controller_set_channel_override(
        &self,
        channel_id: String,
        body: wire::UpdateChannelOverrideDto,
    ) -> BackendResult<wire::ChannelNotificationOverrideDto> {
        self.w2
            .run("set_channel_level", &[&channel_id, &body.level.as_str()])
            .await
    }
    async fn notifications_controller_delete_channel_override(
        &self,
        channel_id: String,
    ) -> BackendResult<()> {
        self.w2
            .run::<Value>("clear_channel_level", &[&channel_id])
            .await
            .map(|_| ())
    }
}
