//! W6-A: the admin dashboard (instance stats, instance storage, LiveKit health, attention items) and instance settings.
//!
//! This file is W6-A's own: its state, its cached values (`InstanceValue`, inside
//! `CacheValue::W6(W6Value::Instance(..))`), which views its queries feed, how they are fetched, and
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
    AdminDashboardView, AttentionItem, InstanceSettingsPatch, InstanceSettingsView,
    InstanceStorage, ViewKey,
};
use crate::platform::CoreError;
#[allow(unused_imports)]
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W6-A's query ids: the web's `operationId`s.
pub mod keys {
    pub const SETTINGS: &str = "instanceControllerGetSettings";
    pub const STATS: &str = "instanceControllerGetStats";
    pub const STORAGE: &str = "storageQuotaControllerGetInstanceStorageStats";
    pub const LIVEKIT: &str = "livekitControllerValidateConfiguration";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[SETTINGS, STATS, STORAGE, LIVEKIT];
}

/// W6-A's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct InstanceState {}

/// W6-A's cached responses.
#[derive(Debug, Clone)]
pub enum InstanceValue {}

/// The view a W6-A query feeds.
pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

/// The query a W6-A view reads.
pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

/// What on the instance needs an admin's attention, errors first: the web's
/// `pages/admin/adminAttention.ts` (`getAttentionItems`). W6-A fills it.
pub fn attention_items(
    _storage: Option<&InstanceStorage>,
    _storage_error: bool,
    _livekit_configured: Option<bool>,
) -> Vec<AttentionItem> {
    Vec::new()
}

impl State {
    /// A W6-A query's data changed: say which views to read again. False when it isn't
    /// W6-A's.
    pub(crate) fn w6_instance_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    /// One socket event, before the shared rules.
    pub(crate) fn w6_instance_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-A query; `None` when it isn't one.
    pub(crate) async fn w6_instance_fetch(
        &self,
        _key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    /// The dashboard: stats, instance storage and LiveKit health, read together.
    pub fn admin_dashboard(&self) -> AdminDashboardView {
        AdminDashboardView::default()
    }

    /// `GET /instance/settings`.
    pub fn instance_settings(&self) -> InstanceSettingsView {
        InstanceSettingsView::default()
    }

    /// `PATCH /instance/settings`; op `UpdateInstanceSettings` on `ViewKey::InstanceSettings`.
    /// Success also re-probes the server, so `ServerInfo` (name, registration, max file size)
    /// follows.
    pub async fn update_instance_settings(
        &self,
        _patch: InstanceSettingsPatch,
    ) -> Result<(), CoreError> {
        Err(unavailable("instance settings"))
    }
}
