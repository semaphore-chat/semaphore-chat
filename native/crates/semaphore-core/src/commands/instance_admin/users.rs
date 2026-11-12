//! W6-B: the users list and one user: owner role, ban, password, delete and a user's instance roles.
//!
//! This file is W6-B's own: its state, its cached values (`UsersValue`, inside
//! `CacheValue::W6(W6Value::Users(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file. The W6/W7 freeze left them as
//! stubs: reads answer default views and changes `CoreError::Unavailable`.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`).

use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
#[allow(unused_imports)]
use crate::model::{
    AdminNotAllowed, AdminUserActions, AdminUserQuery, AdminUserRolesView, AdminUserView,
    AdminUsersView, InstanceAdminCaps, ViewKey,
};
use crate::platform::CoreError;
#[allow(unused_imports)]
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W6-B's query ids: the web's `operationId`s.
pub mod keys {
    pub const USERS: &str = "userControllerFindAllUsersAdmin";
    pub const USER: &str = "userControllerGetUserByIdAdmin";
    pub const USER_ROLES: &str = "rolesControllerGetUserInstanceRoles";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[USERS, USER, USER_ROLES];
}

/// W6-B's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct UsersState {}

/// W6-B's cached responses.
#[derive(Debug, Clone)]
pub enum UsersValue {}

/// The view a W6-B query feeds.
pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

/// The query a W6-B view reads.
pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

/// What `user_actions` knows about the signed-in user.
#[derive(Debug, Clone, Default)]
pub struct Actor {
    pub id: String,
    pub caps: InstanceAdminCaps,
    /// My instance actions, as wire names.
    pub held: Vec<String>,
}

/// What `user_actions` knows about the user on the row.
#[derive(Debug, Clone, Default)]
pub struct Target {
    pub id: String,
    pub is_owner: bool,
    pub banned: bool,
    /// Their instance actions, once `admin_user_roles` has read them.
    pub actions: Option<Vec<String>>,
}

/// Per action, whether it's offered and why not. W6-B fills it.
pub fn user_actions(_actor: &Actor, _target: &Target) -> AdminUserActions {
    let no = Some(AdminNotAllowed::NoPermission);
    AdminUserActions {
        ban: no,
        unban: no,
        delete: no,
        reset_password: no,
        set_owner: no,
        edit_roles: no,
        set_quota: no,
    }
}

impl State {
    /// A W6-B query's data changed: say which views to read again. False when it isn't
    /// W6-B's.
    pub(crate) fn w6_users_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    /// One socket event, before the shared rules.
    pub(crate) fn w6_users_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-B query; `None` when it isn't one.
    pub(crate) async fn w6_users_fetch(
        &self,
        _key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    pub fn admin_users(&self, _query: AdminUserQuery) -> AdminUsersView {
        AdminUsersView::default()
    }

    /// The next page of `admin_users(query)`, when `more`.
    pub async fn load_more_admin_users(&self, _query: AdminUserQuery) -> Result<(), CoreError> {
        Err(unavailable("the users list"))
    }

    pub fn admin_user(&self, _user_id: String) -> AdminUserView {
        AdminUserView::default()
    }

    pub fn admin_user_roles(&self, _user_id: String) -> AdminUserRolesView {
        AdminUserRolesView::default()
    }

    /// Grant (`true`) or take the owner role.
    pub async fn set_user_owner(&self, _user_id: String, _owner: bool) -> Result<(), CoreError> {
        Err(unavailable("user administration"))
    }

    pub async fn ban_user(&self, _user_id: String) -> Result<(), CoreError> {
        Err(unavailable("user administration"))
    }

    pub async fn unban_user(&self, _user_id: String) -> Result<(), CoreError> {
        Err(unavailable("user administration"))
    }

    /// Ends the user's sessions too (the server does).
    pub async fn reset_user_password(
        &self,
        _user_id: String,
        _password: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("user administration"))
    }

    pub async fn delete_user(&self, _user_id: String) -> Result<(), CoreError> {
        Err(unavailable("user administration"))
    }

    pub async fn assign_instance_role(
        &self,
        _user_id: String,
        _role_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("instance roles"))
    }

    pub async fn unassign_instance_role(
        &self,
        _user_id: String,
        _role_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("instance roles"))
    }
}
