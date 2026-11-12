//! [`FakeBackend`] for W6-B: the users list, one user, a user's instance roles, and the changes,
//! scripted through `FakeBackend::w4` as W4's areas are (answers decoded into the wire type,
//! errors, gates, the calls made). An operation answering nothing (`()`) succeeds unless it's
//! failed. Operation names are prefixed `w6b_` so no lane's clash.

use super::{FakeBackend, ME};
use semaphore_core::backend::{AdminUsersBackend, BackendResult};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

/// Users the tests act on: ids the role-assignment body types as UUIDs.
pub const PRIYA: &str = "00000000-0000-4000-8000-0000000000b1";
pub const MARCUS: &str = "00000000-0000-4000-8000-0000000000b2";
pub const ROLE_ADMIN: &str = "00000000-0000-4000-8000-0000000000r1";
pub const ROLE_MOD: &str = "00000000-0000-4000-8000-0000000000r2";

/// One user as the admin list and the one-user read send them.
pub fn admin_user_json(id: &str, username: &str, role: &str, banned: bool) -> Value {
    json!({
        "id": id,
        "username": username,
        "displayName": format!("{username} display"),
        "avatarUrl": format!("avatar-{id}"),
        "bannerUrl": null,
        "bio": null,
        "email": format!("{username}@example.invalid"),
        "role": role,
        "banned": banned,
        "bannedAt": null,
        "bannedById": null,
        "createdAt": "2026-09-22T18:00:00.000Z",
        "lastSeen": "2026-09-23T01:04:00.000Z",
        "status": null,
        "statusUpdatedAt": null,
        "storageQuotaBytes": 53687091200i64,
        "storageUsedBytes": 0i64,
        "verified": true,
    })
}

/// The admin list's answer: a page, with `continuationToken` when more follow.
pub fn list_json(users: Vec<Value>, next: Option<&str>) -> Value {
    json!({ "users": users, "continuationToken": next })
}

pub fn role_json(id: &str, name: &str, actions: &[&str]) -> Value {
    json!({
        "id": id,
        "name": name,
        "position": 1,
        "isDefault": false,
        "createdAt": "2026-09-01T00:00:00Z",
        "actions": actions,
    })
}

/// `GET /roles/user/{userId}/instance`'s answer.
pub fn user_roles_json(user_id: &str, roles: Vec<Value>) -> Value {
    json!({
        "userId": user_id,
        "resourceId": null,
        "resourceType": "INSTANCE",
        "roles": roles,
    })
}

/// The signed-in user's own instance roles, as W3 reads them at sign-in.
pub fn instance_roles_json(actions: &[&str]) -> Value {
    json!({
        "userId": ME,
        "resourceId": null,
        "resourceType": "INSTANCE",
        "roles": [{
            "id": "role-instance-member",
            "name": "Member",
            "position": 0,
            "isDefault": true,
            "createdAt": "2026-09-22T18:00:00.000Z",
            "actions": actions,
        }],
    })
}

impl FakeBackend {
    /// `op`, answering `null` unless scripted otherwise: for the calls that answer nothing.
    async fn w6b_unit(&self, op: &'static str, args: &[&str]) -> BackendResult<()> {
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
impl AdminUsersBackend for FakeBackend {
    async fn user_controller_find_all_users_admin(
        &self,
        banned: Option<semaphore_wire::enums::BooleanString>,
        continuation_token: Option<String>,
        limit: Option<std::num::NonZeroU64>,
        role: Option<semaphore_wire::enums::InstanceRole>,
        search: Option<String>,
    ) -> BackendResult<wire::AdminUserListResponseDto> {
        let banned = banned.map_or("-".to_owned(), |banned| banned.as_str().into_owned());
        let role = role.map_or("-".to_owned(), |role| role.as_str().into_owned());
        let search = search.unwrap_or_default();
        let limit = limit.map_or(String::new(), |limit| limit.to_string());
        let token = continuation_token.unwrap_or_default();
        self.w4
            .run("w6b_users", &[&banned, &role, &search, &limit, &token])
            .await
    }

    async fn user_controller_get_user_by_id_admin(
        &self,
        id: String,
    ) -> BackendResult<wire::AdminUserEntity> {
        self.w4.run("w6b_user", &[&id]).await
    }

    async fn roles_controller_get_user_instance_roles(
        &self,
        user_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        self.w4.run("w6b_user_roles", &[&user_id]).await
    }

    async fn user_controller_update_user_role(
        &self,
        id: String,
        change: wire::UpdateUserRoleDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        self.w4.run("w6b_set_role", &[&id, &body(&change)]).await
    }

    async fn user_controller_set_ban_status(
        &self,
        id: String,
        change: wire::SetUserBanStatusDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        self.w4.run("w6b_ban", &[&id, &body(&change)]).await
    }

    async fn user_controller_set_user_password(
        &self,
        id: String,
        change: wire::SetUserPasswordDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        self.w4.run("w6b_password", &[&id, &body(&change)]).await
    }

    async fn user_controller_delete_user(
        &self,
        id: String,
    ) -> BackendResult<wire::SuccessResponseDto> {
        self.w4.run("w6b_delete", &[&id]).await
    }

    async fn roles_controller_assign_instance_role(
        &self,
        role_id: String,
        change: wire::AssignInstanceRoleDto,
    ) -> BackendResult<()> {
        self.w6b_unit("w6b_assign", &[&role_id, &change.user_id.to_string()])
            .await
    }

    async fn roles_controller_remove_instance_role(
        &self,
        role_id: String,
        user_id: String,
    ) -> BackendResult<()> {
        self.w6b_unit("w6b_unassign", &[&role_id, &user_id]).await
    }
}
