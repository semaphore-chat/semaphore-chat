//! W6-C: per-user storage: the usage list, quotas and recalculation.
//!
//! This file is W6-C's own: its state, its cached values (`StorageValue`, inside
//! `CacheValue::W6(W6Value::Storage(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file. The W6/W7 freeze left them as
//! stubs: reads answer default views and changes `CoreError::Unavailable`.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`).

use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
#[allow(unused_imports)]
use crate::model::{AdminStorageView, ViewKey};
use crate::platform::CoreError;
#[allow(unused_imports)]
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W6-C's query ids: the web's `operationId`s.
pub mod keys {
    pub const STORAGE_USERS: &str = "storageQuotaControllerGetUsersStorageList";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[STORAGE_USERS];
}

/// W6-C's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct StorageState {}

/// W6-C's cached responses.
#[derive(Debug, Clone)]
pub enum StorageValue {}

/// The view a W6-C query feeds.
pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

/// The query a W6-C view reads.
pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

impl State {
    /// A W6-C query's data changed: say which views to read again. False when it isn't
    /// W6-C's.
    pub(crate) fn w6_storage_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    /// One socket event, before the shared rules.
    pub(crate) fn w6_storage_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-C query; `None` when it isn't one.
    pub(crate) async fn w6_storage_fetch(
        &self,
        _key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    /// Users using at least `min_percent` of their quota (0: everyone).
    pub fn admin_storage(&self, _min_percent: u32) -> AdminStorageView {
        AdminStorageView::default()
    }

    pub async fn load_more_storage(&self, _min_percent: u32) -> Result<(), CoreError> {
        Err(unavailable("storage"))
    }

    pub async fn set_user_quota(
        &self,
        _user_id: String,
        _quota_bytes: u64,
    ) -> Result<(), CoreError> {
        Err(unavailable("storage"))
    }

    pub async fn recalculate_storage(&self, _user_id: String) -> Result<(), CoreError> {
        Err(unavailable("storage"))
    }
}
