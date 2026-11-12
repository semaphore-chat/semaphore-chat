//! W6-C: per-user storage: the usage list, quotas and recalculation.
//!
//! This file is W6-C's own: its state, its cached values (`StorageValue`, inside
//! `CacheValue::W6(W6Value::Storage(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`). Both changes sit on the
//! `min_percent: 0` view, so a dialog finds them whatever filter the list shows.
//!
//! No socket event covers this lane's data: a list is read when shown, again when shown and older
//! than thirty seconds, and on a new connection (`keys::RECONNECT`).

use std::collections::HashSet;

use crate::cache::{CacheValue, QueryKey, keys as cache_keys};
use crate::client::{Core, State};
use crate::commands::community_admin::OpKey;
use crate::model::{AdminActionKind, AdminStorageView, StorageRow, ViewKey};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

use super::W6Value;

/// W6-C's query ids: the web's `operationId`s.
pub mod keys {
    pub const STORAGE_USERS: &str = "storageQuotaControllerGetUsersStorageList";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[STORAGE_USERS];
}

/// How many users a page of the list asks for.
pub(crate) const STORAGE_PAGE: i64 = 50;

/// W6-C's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct StorageState {
    /// The storage lists with a next page on its way, by key.
    loading: HashSet<QueryKey>,
}

/// W6-C's cached responses.
#[derive(Debug, Clone)]
pub enum StorageValue {
    /// One page of the users list, as read.
    Users {
        rows: Vec<wire::UserStorageStatsDto>,
        total: i64,
    },
}

/// The view a W6-C query feeds.
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    if key.op() != keys::STORAGE_USERS {
        return None;
    }
    let min_percent = key.segments.get(1)?.parse().ok()?;
    Some(ViewKey::AdminStorage { min_percent })
}

/// The query a W6-C view reads.
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    Some(match view {
        ViewKey::AdminStorage { min_percent } => {
            cache_keys::scoped(keys::STORAGE_USERS, &min_percent.to_string())
        }
        _ => return None,
    })
}

fn key_of(min_percent: u32) -> QueryKey {
    cache_keys::scoped(keys::STORAGE_USERS, &min_percent.to_string())
}

fn view_of(min_percent: u32) -> ViewKey {
    ViewKey::AdminStorage { min_percent }
}

/// The filter a list sends: `None` when everyone is wanted.
fn wire_min_percent(min_percent: u32) -> Option<i64> {
    (min_percent > 0).then_some(i64::from(min_percent))
}

/// A wire count as a `u64`: a negative one (nothing the server should send) reads as 0.
fn count(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn row(row: &wire::UserStorageStatsDto) -> StorageRow {
    StorageRow {
        user_id: row.user_id.clone(),
        username: row.username.clone(),
        used_bytes: count(row.used_bytes),
        quota_bytes: count(row.quota_bytes),
        percent_used: row.percent_used.max(0.0),
        file_count: count(row.file_count),
    }
}

impl State {
    /// The cached W6-C value under `key`, when there is one.
    fn storage_value(&self, key: &QueryKey) -> Option<&StorageValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W6(W6Value::Storage(value))) => Some(value),
            _ => None,
        }
    }

    fn storage_loading(&self, key: &QueryKey) -> bool {
        self.w6.storage.loading.contains(key)
    }

    fn storage_set_loading(&mut self, key: &QueryKey, loading: bool) {
        if loading {
            self.w6.storage.loading.insert(key.clone());
        } else {
            self.w6.storage.loading.remove(key);
        }
    }

    /// Changes a cached storage list in place, as a direct update: `None` when it isn't cached.
    fn storage_edit<R>(
        &mut self,
        key: &QueryKey,
        change: impl FnOnce(&mut StorageValue) -> R,
    ) -> Option<R> {
        let entry = self.cache.get(key)?.clone();
        let CacheValue::W6(W6Value::Storage(mut value)) = entry.value else {
            return None;
        };
        let result = change(&mut value);
        self.cache.set(
            key.clone(),
            CacheValue::W6(W6Value::Storage(value)),
            entry.fetched_at_ms,
        );
        if entry.stale {
            self.cache.invalidate_prefix(key);
        }
        self.note_direct_update(key);
        if let Some(view) = view_for(key) {
            self.view_changed(view);
        }
        Some(result)
    }

    /// Puts the server's answer in place of that user's row in every cached storage list.
    fn replace_storage_row(&mut self, row: &wire::UserStorageStatsDto) {
        for key in self.cache.keys_with_op(keys::STORAGE_USERS) {
            self.storage_edit(&key, |value| {
                if let StorageValue::Users { rows, .. } = value
                    && let Some(known) = rows.iter_mut().find(|known| known.user_id == row.user_id)
                {
                    *known = row.clone();
                }
            });
        }
    }

    /// A W6-C query's data changed: say which views to read again. False when it isn't
    /// W6-C's.
    pub(crate) fn w6_storage_query_changed(&mut self, key: &QueryKey) -> bool {
        let Some(view) = view_for(key) else {
            return false;
        };
        self.view_changed(view);
        true
    }

    /// One socket event, before the shared rules. No socket event covers W6-C's data.
    pub(crate) fn w6_storage_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-C query; `None` when it isn't one.
    pub(crate) async fn w6_storage_fetch(
        &self,
        key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        let ViewKey::AdminStorage { min_percent } = view_for(key)? else {
            return None;
        };
        let result = async {
            let backend = &self
                .services()
                .ok_or_else(|| unavailable("the backend"))?
                .backend;
            let failed = |error| self.backend_failed(error);
            let answer = backend
                .storage_quota_controller_get_users_storage_list(
                    wire_min_percent(min_percent),
                    Some(0),
                    Some(STORAGE_PAGE),
                )
                .await
                .map_err(failed)?;
            Ok(CacheValue::W6(W6Value::Storage(StorageValue::Users {
                rows: answer.users,
                total: answer.total,
            })))
        }
        .await;
        Some(result)
    }

    /// Users using at least `min_percent` of their quota (0: everyone), the first page.
    pub fn admin_storage(&self, min_percent: u32) -> AdminStorageView {
        self.write(|state, now| {
            let key = key_of(min_percent);
            state.w5a_ensure(&key, now, true);
            let (rows, total) = match state.storage_value(&key) {
                Some(StorageValue::Users { rows, total }) => (rows.clone(), *total),
                _ => (Vec::new(), 0),
            };
            let total = count(total);
            AdminStorageView {
                state: state.query_load_state(&key),
                min_percent,
                more: (rows.len() as u64) < total,
                loading_more: state.storage_loading(&key),
                rows: rows.iter().map(row).collect(),
                total,
                op: state.w5a_op(&view_of(min_percent)),
            }
        })
    }

    /// Reads the list's next page. Nothing to do when it isn't cached, all is read, or a page is
    /// on its way.
    pub async fn load_more_storage(&self, min_percent: u32) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("the storage list")?;
        let key = key_of(min_percent);
        let start = self.write(|state, _| {
            if state.storage_loading(&key) {
                return None;
            }
            let Some(StorageValue::Users { rows, total }) = state.storage_value(&key) else {
                return None;
            };
            if rows.len() as i64 >= *total {
                return None;
            }
            let offset = rows.len() as i64;
            state.storage_set_loading(&key, true);
            state.view_changed(view_of(min_percent));
            Some(offset)
        });
        let Some(offset) = start else {
            return Ok(());
        };
        let page = services
            .backend
            .storage_quota_controller_get_users_storage_list(
                wire_min_percent(min_percent),
                Some(offset),
                Some(STORAGE_PAGE),
            )
            .await;
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            state.storage_set_loading(&key, false);
            state.view_changed(view_of(min_percent));
            if let (
                Ok(page),
                Some(CacheValue::W6(W6Value::Storage(StorageValue::Users { rows, total }))),
            ) = (
                &page,
                state.cache.get_mut(&key).map(|entry| &mut entry.value),
            ) {
                // A page that overlaps what is shown (the row changed meanwhile) adds what's new.
                for row in &page.users {
                    if !rows.iter().any(|known| known.user_id == row.user_id) {
                        rows.push(row.clone());
                    }
                }
                *total = page.total;
            }
        });
        page.map(|_| ()).map_err(|error| self.backend_failed(error))
    }

    /// `PATCH /storage/users/{userId}/quota`, op `SetUserQuota` on `min_percent: 0`'s view (so a
    /// dialog finds it whatever filter the list shows). The answer replaces that user's row in
    /// every cached list. Refused before sending when the quota isn't a `i64`.
    pub async fn set_user_quota(&self, user_id: String, quota_bytes: u64) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminStorage { min_percent: 0 },
            AdminActionKind::SetUserQuota,
            Some(user_id.clone()),
        );
        let Ok(quota_bytes) = i64::try_from(quota_bytes) else {
            return self.w5a_refuse(
                &view,
                CoreError::Failed {
                    message: "the quota is too large".into(),
                },
            );
        };
        let (services, epoch, change) = self.w5a_begin(&view, "changing a storage quota")?;
        let result = services
            .backend
            .storage_quota_controller_update_user_quota(
                user_id,
                wire::UpdateUserQuotaDto { quota_bytes },
            )
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, stats| state.replace_storage_row(stats),
            |_| {},
        )
        .map(|_| ())
    }

    /// `POST /storage/users/{userId}/recalculate`, op `RecalculateStorage` on `min_percent: 0`'s
    /// view (for the same reason). The answer replaces that user's row in every cached list.
    pub async fn recalculate_storage(&self, user_id: String) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminStorage { min_percent: 0 },
            AdminActionKind::RecalculateStorage,
            Some(user_id.clone()),
        );
        let (services, epoch, change) = self.w5a_begin(&view, "recalculating storage")?;
        let result = services
            .backend
            .storage_quota_controller_recalculate_user_storage(user_id)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, stats| state.replace_storage_row(stats),
            |_| {},
        )
        .map(|_| ())
    }
}
