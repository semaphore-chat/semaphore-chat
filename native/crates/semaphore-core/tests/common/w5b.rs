//! [`FakeBackend`] for W5-B: roles, overrides and the W5 moderation calls, scripted through
//! `FakeBackend::w5b`. An answer is looked up by the whole call (`my_roles comm`,
//! `user_roles comm bob`), then by the operation alone; every call is recorded with its body.
//! The W5 moderation methods live in `actions.rs`'s `ModerationBackend` and call `w5b` too.

use super::FakeBackend;
use semaphore_core::backend::{BackendError, BackendResult, RolesBackend};
use semaphore_wire::enums::ErrorCode;
use semaphore_wire::types as wire;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct W5bFakes {
    pub answers: Mutex<HashMap<String, Value>>,
    /// The next call matching this (whole call, then op) fails with this.
    pub errors: Mutex<HashMap<String, BackendError>>,
    pub calls: Mutex<Vec<String>>,
    /// The next call matching this (whole call, then op) waits for the sender.
    pub gates: Mutex<HashMap<String, tokio::sync::oneshot::Receiver<()>>>,
}

impl W5bFakes {
    pub fn answer(&self, call: &str, value: Value) {
        self.answers.lock().unwrap().insert(call.to_owned(), value);
    }

    pub fn fail_next(&self, call: &str, error: BackendError) {
        self.errors.lock().unwrap().insert(call.to_owned(), error);
    }

    pub fn hold(&self, call: &str) -> tokio::sync::oneshot::Sender<()> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.gates.lock().unwrap().insert(call.to_owned(), receiver);
        sender
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
        op: &str,
        args: &[&str],
        body: Option<Value>,
    ) -> BackendResult<T> {
        let call = std::iter::once(op)
            .chain(args.iter().copied())
            .collect::<Vec<_>>()
            .join(" ");
        let recorded = match &body {
            Some(body) => format!("{call} {body}"),
            None => call.clone(),
        };
        self.calls.lock().unwrap().push(recorded);
        let gate = {
            let mut gates = self.gates.lock().unwrap();
            gates.remove(&call).or_else(|| gates.remove(op))
        };
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        let error = {
            let mut errors = self.errors.lock().unwrap();
            errors.remove(&call).or_else(|| errors.remove(op))
        };
        if let Some(error) = error {
            return Err(error);
        }
        let answer = {
            let answers = self.answers.lock().unwrap();
            answers.get(&call).or_else(|| answers.get(op)).cloned()
        };
        let value = match answer {
            Some(value) => value,
            None => match op {
                // The unit answers and acknowledgements need no script.
                "delete_role" | "assign" | "unassign" => Value::Null,
                "ban" | "unban" | "timeout" | "remove_timeout" => {
                    json!({ "success": true, "message": "ok" })
                }
                _ => {
                    return Err(BackendError {
                        status: 404,
                        code: ErrorCode::Unknown("NOT_FOUND".into()),
                        message: format!("not scripted: {call}"),
                        retryable: false,
                        retry_after_ms: None,
                    });
                }
            },
        };
        Ok(serde_json::from_value(value).expect("fake response matches the wire type"))
    }
}

pub fn refusal(status: u16, message: &str) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown("FORBIDDEN".into()),
        message: message.to_owned(),
        retryable: false,
        retry_after_ms: None,
    }
}

pub fn role_json(id: &str, position: i64, actions: &[&str]) -> Value {
    json!({
        "id": id, "name": format!("{id} name"), "position": position,
        "isDefault": id == "member", "createdAt": "2026-09-22T18:00:00Z", "actions": actions,
    })
}

pub fn user_roles_json(user: &str, community: &str, roles: &[Value]) -> Value {
    json!({ "userId": user, "resourceId": community, "resourceType": "COMMUNITY", "roles": roles })
}

fn body(value: &impl serde::Serialize) -> Option<Value> {
    Some(serde_json::to_value(value).unwrap())
}

#[async_trait::async_trait]
impl RolesBackend for FakeBackend {
    async fn roles_controller_get_my_roles_for_community(
        &self,
        community_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        self.w5b.run("my_roles", &[&community_id], None).await
    }
    async fn roles_controller_get_community_roles(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityRolesResponseDto> {
        self.w5b.run("roles", &[&community_id], None).await
    }
    async fn roles_controller_create_community_role(
        &self,
        community_id: String,
        body_: wire::CreateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        self.w5b
            .run("create_role", &[&community_id], body(&body_))
            .await
    }
    async fn roles_controller_update_role(
        &self,
        community_id: String,
        role_id: String,
        body_: wire::UpdateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        self.w5b
            .run("update_role", &[&community_id, &role_id], body(&body_))
            .await
    }
    async fn roles_controller_delete_role(
        &self,
        community_id: String,
        role_id: String,
    ) -> BackendResult<()> {
        self.w5b
            .run("delete_role", &[&community_id, &role_id], None)
            .await
    }
    async fn roles_controller_reorder_roles(
        &self,
        community_id: String,
        body_: wire::ReorderRolesDto,
    ) -> BackendResult<Vec<wire::RoleDto>> {
        self.w5b
            .run("reorder", &[&community_id], body(&body_))
            .await
    }
    async fn roles_controller_reset_default_community_roles(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityRolesResponseDto> {
        self.w5b.run("reset", &[&community_id], None).await
    }
    async fn roles_controller_assign_role_to_user(
        &self,
        community_id: String,
        body_: wire::AssignRoleDto,
    ) -> BackendResult<()> {
        self.w5b.run("assign", &[&community_id], body(&body_)).await
    }
    async fn roles_controller_remove_role_from_user(
        &self,
        community_id: String,
        user_id: String,
        role_id: String,
    ) -> BackendResult<()> {
        self.w5b
            .run("unassign", &[&community_id, &user_id, &role_id], None)
            .await
    }
    async fn roles_controller_get_users_for_role(
        &self,
        community_id: String,
        role_id: String,
    ) -> BackendResult<Vec<wire::RoleUserDto>> {
        self.w5b
            .run("role_users", &[&community_id, &role_id], None)
            .await
    }
    async fn roles_controller_get_user_roles_for_community(
        &self,
        user_id: String,
        community_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        self.w5b
            .run("user_roles", &[&community_id, &user_id], None)
            .await
    }
    async fn channel_permissions_controller_get_overwrites(
        &self,
        id: String,
    ) -> BackendResult<wire::ChannelOverwritesDto> {
        self.w5b.run("overwrites", &[&id], None).await
    }
    async fn channel_permissions_controller_replace_overwrites(
        &self,
        id: String,
        body_: wire::ReplaceChannelOverwritesDto,
    ) -> BackendResult<wire::ChannelOverwritesDto> {
        self.w5b
            .run("replace_overwrites", &[&id], body(&body_))
            .await
    }
}

/// The W5 moderation calls, for `actions.rs`'s `ModerationBackend` impl.
impl FakeBackend {
    pub async fn w5b_ban(
        &self,
        community_id: String,
        user_id: String,
        body_: wire::ModerationBanUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        self.w5b
            .run("ban", &[&community_id, &user_id], body(&body_))
            .await
    }
    pub async fn w5b_unban(
        &self,
        community_id: String,
        user_id: String,
        body_: wire::UnbanUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        self.w5b
            .run("unban", &[&community_id, &user_id], body(&body_))
            .await
    }
    pub async fn w5b_timeout(
        &self,
        community_id: String,
        user_id: String,
        body_: wire::TimeoutUserDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        self.w5b
            .run("timeout", &[&community_id, &user_id], body(&body_))
            .await
    }
    pub async fn w5b_remove_timeout(
        &self,
        community_id: String,
        user_id: String,
        body_: wire::RemoveTimeoutDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        self.w5b
            .run("remove_timeout", &[&community_id, &user_id], body(&body_))
            .await
    }
}
