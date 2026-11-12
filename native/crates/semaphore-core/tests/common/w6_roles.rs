//! [`FakeBackend`] for W6-E: instance roles, scripted through `FakeBackend::w4` as W5-A's areas
//! are (answers decoded into the wire type, errors, gates, the calls made). A call answering
//! nothing (`()`) succeeds unless it's failed. Every op name is prefixed `w6e_` so it can't clash.

use super::{FakeBackend, ME};
use semaphore_core::backend::{BackendResult, InstanceRolesBackend};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

pub const ADMIN_ROLE: &str = "00000000-0000-4000-8000-0000000000e1";
pub const CUSTOM_ROLE: &str = "00000000-0000-4000-8000-0000000000e2";
pub const OTHER_ROLE: &str = "00000000-0000-4000-8000-0000000000e3";

/// A `RoleDto` as the server sends one.
pub fn role_json(id: &str, name: &str, position: i64, actions: &[&str]) -> Value {
    json!({
        "id": id, "name": name, "position": position, "isDefault": false,
        "createdAt": "2026-11-01T00:00:00.000Z", "actions": actions,
    })
}

/// The default instance admin role: the 12 actions, and not deletable.
pub fn admin_role_json() -> Value {
    json!({
        "id": ADMIN_ROLE, "name": "Instance Admin", "position": 10, "isDefault": true,
        "createdAt": "2026-11-01T00:00:00.000Z",
        "actions": [
            "READ_INSTANCE_SETTINGS", "UPDATE_INSTANCE_SETTINGS", "READ_INSTANCE_STATS",
            "MANAGE_USER_STORAGE", "READ_USER", "UPDATE_USER", "BAN_USER", "DELETE_USER",
            "READ_INSTANCE_INVITE", "CREATE_INSTANCE_INVITE", "DELETE_INSTANCE_INVITE",
            "UPDATE_INSTANCE_INVITE",
        ],
    })
}

/// A `RoleUserDto` as the server sends one.
pub fn role_user_json(user_id: &str, username: &str) -> Value {
    json!({ "userId": user_id, "username": username, "displayName": null })
}

/// `UserRolesResponseDto`: my instance roles.
pub fn my_roles_json(roles: Vec<Value>) -> Value {
    json!({
        "userId": ME, "resourceId": null, "resourceType": "INSTANCE", "roles": roles,
    })
}

impl FakeBackend {
    /// `op`, answering `null` unless scripted otherwise: for the calls that answer nothing.
    /// (`w5a.rs` already has a `unit` on `FakeBackend`, hence the name.)
    async fn nothing(&self, op: &'static str, args: &[&str]) -> BackendResult<()> {
        self.w4
            .answers
            .lock()
            .unwrap()
            .entry(op)
            .or_insert(Value::Null);
        self.w4.run(op, args).await
    }
}

fn body(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).unwrap()
}

#[async_trait::async_trait]
impl InstanceRolesBackend for FakeBackend {
    async fn roles_controller_get_instance_roles(&self) -> BackendResult<Vec<wire::RoleDto>> {
        self.w4.run("w6e_roles", &[]).await
    }
    async fn roles_controller_create_instance_role(
        &self,
        create: wire::CreateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        self.w4.run("w6e_create_role", &[&body(&create)]).await
    }
    async fn roles_controller_update_instance_role(
        &self,
        role_id: String,
        update: wire::UpdateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        self.w4
            .run("w6e_update_role", &[&role_id, &body(&update)])
            .await
    }
    async fn roles_controller_delete_instance_role(&self, role_id: String) -> BackendResult<()> {
        self.nothing("w6e_delete_role", &[&role_id]).await
    }
    async fn roles_controller_get_instance_role_users(
        &self,
        role_id: String,
    ) -> BackendResult<Vec<wire::RoleUserDto>> {
        self.w4.run("w6e_role_users", &[&role_id]).await
    }
}
