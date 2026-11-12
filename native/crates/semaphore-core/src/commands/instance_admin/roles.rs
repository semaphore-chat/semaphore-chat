//! W6-E: instance roles: the list, the editor and a role's users.
//!
//! This file is W6-E's own: its state, its cached values (`RolesValue`, inside
//! `CacheValue::W6(W6Value::Roles(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file. The W6/W7 freeze left them as
//! stubs: reads answer default views and changes `CoreError::Unavailable`.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`).

use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
#[allow(unused_imports)]
use crate::model::{InstanceRoleDraft, InstanceRoleUsersView, InstanceRolesView, ViewKey};
use crate::platform::CoreError;
#[allow(unused_imports)]
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W6-E's query ids: the web's `operationId`s.
pub mod keys {
    pub const ROLES: &str = "rolesControllerGetInstanceRoles";
    pub const ROLE_USERS: &str = "rolesControllerGetInstanceRoleUsers";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[ROLES, ROLE_USERS];
}

/// W6-E's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct RolesState {}

/// W6-E's cached responses.
#[derive(Debug, Clone)]
pub enum RolesValue {}

/// The view a W6-E query feeds.
pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

/// The query a W6-E view reads.
pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

/// Whether a role with `role_actions` may be changed by someone with `full_authority` holding
/// `held` (the server's `assertMayHandle`). W6-E fills it.
pub fn role_editable(_full_authority: bool, _held: &[String], _role_actions: &[String]) -> bool {
    false
}

impl State {
    /// A W6-E query's data changed: say which views to read again. False when it isn't
    /// W6-E's.
    pub(crate) fn w6_roles_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    /// One socket event, before the shared rules.
    pub(crate) fn w6_roles_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-E query; `None` when it isn't one.
    pub(crate) async fn w6_roles_fetch(
        &self,
        _key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    pub fn instance_roles(&self) -> InstanceRolesView {
        InstanceRolesView::default()
    }

    /// Returns the new role's id.
    pub async fn create_instance_role(
        &self,
        _draft: InstanceRoleDraft,
    ) -> Result<String, CoreError> {
        Err(unavailable("instance roles"))
    }

    pub async fn update_instance_role(
        &self,
        _role_id: String,
        _draft: InstanceRoleDraft,
    ) -> Result<(), CoreError> {
        Err(unavailable("instance roles"))
    }

    pub async fn delete_instance_role(&self, _role_id: String) -> Result<(), CoreError> {
        Err(unavailable("instance roles"))
    }

    pub fn instance_role_users(&self, _role_id: String) -> InstanceRoleUsersView {
        InstanceRoleUsersView::default()
    }
}
