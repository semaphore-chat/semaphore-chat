//! W6-A: the admin dashboard (instance stats, instance storage, LiveKit health, attention items) and instance settings.
//!
//! This file is W6-A's own: its state, its cached values (`InstanceValue`, inside
//! `CacheValue::W6(W6Value::Instance(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`).

use crate::cache::{CacheValue, QueryKey, keys as cache_keys};
use crate::client::{Core, State};
use crate::commands::community_admin::OpKey;
use crate::model::{
    AdminActionKind, AdminDashboardView, AdminPage, AttentionId, AttentionItem, AttentionSeverity,
    AttentionTarget, InstanceSettingsPatch, InstanceSettingsView, InstanceStats, InstanceStorage,
    LoadState, RegistrationMode, ServerHealth, StorageByKind, StorageDistribution, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::enums::RegistrationMode as WireRegistrationMode;
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

use super::W6Value;

/// W6-A's query ids: the web's `operationId`s.
pub mod keys {
    pub const SETTINGS: &str = "instanceControllerGetSettings";
    pub const STATS: &str = "instanceControllerGetStats";
    pub const STORAGE: &str = "storageQuotaControllerGetInstanceStorageStats";
    pub const LIVEKIT: &str = "livekitControllerValidateConfiguration";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[SETTINGS, STATS, STORAGE, LIVEKIT];
}

/// The disk use (percent) at which the dashboard asks for attention: the web's
/// `DISK_WARNING_PERCENT` and `DISK_ERROR_PERCENT`.
const DISK_WARNING_PERCENT: f64 = 80.0;
const DISK_ERROR_PERCENT: f64 = 90.0;

/// Where the "Voice and video are off" item points: `LIVEKIT_SETUP_DOCS_URL`.
const LIVEKIT_SETUP_DOCS_URL: &str =
    "https://docs.semaphorechat.app/installation/docker-compose/#connecting-your-livekit-server";

/// The backend's `MIN_STORAGE_QUOTA_BYTES`, `MIN_FILE_SIZE_BYTES` and `MAX_FILE_SIZE_BYTES`.
const MIN_STORAGE_QUOTA_BYTES: u64 = 1_073_741_824;
const MIN_FILE_SIZE_BYTES: u64 = 1_048_576;
const MAX_FILE_SIZE_BYTES: u64 = 1_073_741_824;

/// W6-A's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct InstanceState {}

/// W6-A's cached responses.
#[derive(Debug, Clone)]
pub enum InstanceValue {
    Settings(wire::InstanceSettingsResponseDto),
    Stats(wire::InstanceStatsResponseDto),
    /// Boxed: it is by far the largest of these, and `W6Value` holds one of them.
    Storage(Box<wire::InstanceStorageStatsDto>),
    Livekit(wire::LivekitHealthResponseDto),
}

/// The view a W6-A query feeds.
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    Some(match key.op() {
        keys::SETTINGS => ViewKey::InstanceSettings,
        keys::STATS | keys::STORAGE | keys::LIVEKIT => ViewKey::AdminDashboard,
        _ => return None,
    })
}

/// The query a W6-A view reads.
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    Some(match view {
        ViewKey::InstanceSettings => cache_keys::op(keys::SETTINGS),
        ViewKey::AdminDashboard => cache_keys::op(keys::STATS),
        _ => return None,
    })
}

/// What on the instance needs an admin's attention, errors first: the web's
/// `pages/admin/adminAttention.ts` (`getAttentionItems`).
pub fn attention_items(
    storage: Option<&InstanceStorage>,
    storage_error: bool,
    livekit_configured: Option<bool>,
) -> Vec<AttentionItem> {
    let mut items = Vec::new();
    if storage_error {
        items.push(AttentionItem {
            id: AttentionId::StorageUnavailable,
            severity: AttentionSeverity::Warning,
            title: "Couldn't load storage and server status".into(),
            detail: Some("Disk and quota checks are unavailable until it loads.".into()),
            target: AttentionTarget::Retry,
            action_label: "Try again".into(),
        });
    }
    if let Some(storage) = storage {
        let percent = storage.server.disk_used_percent;
        // A server that reports no disk can't be judged by its percentage.
        let disk = if storage.server.disk_total_bytes > 0 {
            disk_severity(percent)
        } else {
            None
        };
        if let Some(severity) = disk {
            items.push(AttentionItem {
                id: AttentionId::Disk,
                severity,
                title: format!("Server disk is {}% full", percent.round()),
                detail: Some("Free up space or grow the disk before uploads start failing.".into()),
                target: AttentionTarget::Page {
                    page: AdminPage::Storage,
                    storage_min_percent: None,
                },
                action_label: "Storage".into(),
            });
        }
        let over = storage.users_over_quota;
        if over > 0 {
            let users = if over == 1 { "user is" } else { "users are" };
            items.push(AttentionItem {
                id: AttentionId::OverQuota,
                severity: AttentionSeverity::Warning,
                title: format!("{} {users} over 90% of their storage quota", grouped(over)),
                detail: Some("They'll soon be unable to upload files.".into()),
                target: AttentionTarget::Page {
                    page: AdminPage::Storage,
                    storage_min_percent: Some(90),
                },
                action_label: "Storage".into(),
            });
        }
    }
    if livekit_configured == Some(false) {
        items.push(AttentionItem {
            id: AttentionId::Livekit,
            severity: AttentionSeverity::Warning,
            title: "Voice and video are off: LiveKit isn't configured".into(),
            detail: Some(
                "Text chat works without it. Set up LiveKit to enable voice channels and screen sharing."
                    .into(),
            ),
            target: AttentionTarget::Url {
                url: LIVEKIT_SETUP_DOCS_URL.into(),
            },
            action_label: "Setup guide".into(),
        });
    }
    // Errors first, everything else in the order built (a stable sort).
    items.sort_by_key(|item| match item.severity {
        AttentionSeverity::Error => 0,
        AttentionSeverity::Warning => 1,
    });
    items
}

fn disk_severity(percent: f64) -> Option<AttentionSeverity> {
    if percent >= DISK_ERROR_PERCENT {
        Some(AttentionSeverity::Error)
    } else if percent >= DISK_WARNING_PERCENT {
        Some(AttentionSeverity::Warning)
    } else {
        None
    }
}

/// `n.toLocaleString()` for a count: thousands separated by commas.
fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// A wire count as a `u64`: a negative one (nothing the server should send) reads as 0.
fn count(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn registration_mode(mode: &WireRegistrationMode) -> RegistrationMode {
    match mode {
        WireRegistrationMode::Open => RegistrationMode::Open,
        WireRegistrationMode::Closed => RegistrationMode::Closed,
        // Unknown modes ask for a code, as every mode does today.
        WireRegistrationMode::InviteOnly | WireRegistrationMode::Unknown(_) => {
            RegistrationMode::InviteOnly
        }
    }
}

fn wire_registration(mode: RegistrationMode) -> WireRegistrationMode {
    match mode {
        RegistrationMode::Open => WireRegistrationMode::Open,
        RegistrationMode::InviteOnly => WireRegistrationMode::InviteOnly,
        RegistrationMode::Closed => WireRegistrationMode::Closed,
    }
}

fn stats_from_wire(stats: &wire::InstanceStatsResponseDto) -> InstanceStats {
    InstanceStats {
        total_users: count(stats.total_users),
        total_communities: count(stats.total_communities),
        total_channels: count(stats.total_channels),
        total_messages: count(stats.total_messages),
        active_invites: count(stats.active_invites),
        banned_users: count(stats.banned_users),
    }
}

fn server_health(server: &wire::ServerStatsDto) -> ServerHealth {
    ServerHealth {
        memory_total_bytes: count(server.memory_total_bytes),
        memory_used_bytes: count(server.memory_used_bytes),
        memory_used_percent: server.memory_used_percent,
        cpu_cores: u32::try_from(server.cpu_cores).unwrap_or(0),
        cpu_model: server.cpu_model.clone(),
        load_average: server.load_average.clone(),
        disk_total_bytes: count(server.disk_total_bytes),
        disk_used_bytes: count(server.disk_used_bytes),
        disk_free_bytes: count(server.disk_free_bytes),
        disk_used_percent: server.disk_used_percent,
        platform: server.platform.clone(),
        hostname: server.hostname.clone(),
        uptime_secs: server.uptime.max(0.0) as u64,
    }
}

fn storage_from_wire(storage: &wire::InstanceStorageStatsDto) -> InstanceStorage {
    InstanceStorage {
        total_used_bytes: count(storage.total_storage_used_bytes),
        total_files: count(storage.total_file_count),
        total_users: count(storage.total_user_count),
        average_per_user_bytes: count(storage.average_storage_per_user_bytes),
        distribution: StorageDistribution {
            under_25: count(storage.user_storage_distribution.under25_percent),
            under_50: count(storage.user_storage_distribution.under50_percent),
            under_75: count(storage.user_storage_distribution.under75_percent),
            under_90: count(storage.user_storage_distribution.under90_percent),
            over_90: count(storage.user_storage_distribution.over90_percent),
        },
        by_kind: storage
            .storage_by_type
            .iter()
            .map(|row| StorageByKind {
                kind: row.type_.clone(),
                bytes: count(row.bytes),
                count: count(row.count),
            })
            .collect(),
        default_quota_bytes: count(storage.default_quota_bytes),
        max_file_bytes: count(storage.max_file_size_bytes),
        users_approaching_quota: count(storage.users_approaching_quota),
        users_over_quota: count(storage.users_over_quota),
        server: server_health(&storage.server),
    }
}

/// A `PATCH` refused before it was sent, in the backend's words.
fn invalid_update(message: &str) -> CoreError {
    CoreError::Failed {
        message: message.into(),
    }
}

/// The body a patch sends: only the fields it names, `None` when it names none.
fn update_body(
    patch: &InstanceSettingsPatch,
) -> Result<Option<wire::UpdateInstanceSettingsDto>, CoreError> {
    let mut body = wire::UpdateInstanceSettingsDto::default();
    let mut any = false;
    if let Some(name) = &patch.name {
        if name.chars().count() > 100 {
            return Err(invalid_update(
                "name must be shorter than or equal to 100 characters",
            ));
        }
        body.name = Some(name.parse().expect("100 characters or fewer"));
        any = true;
    }
    if let Some(description) = &patch.description {
        if description.chars().count() > 500 {
            return Err(invalid_update(
                "description must be shorter than or equal to 500 characters",
            ));
        }
        body.description = Some(description.parse().expect("500 characters or fewer"));
        any = true;
    }
    if let Some(bytes) = patch.default_quota_bytes {
        if bytes < MIN_STORAGE_QUOTA_BYTES {
            return Err(invalid_update(
                "defaultStorageQuotaBytes must not be less than 1073741824",
            ));
        }
        body.default_storage_quota_bytes = Some(i64::try_from(bytes).unwrap_or(i64::MAX));
        any = true;
    }
    if let Some(bytes) = patch.max_file_bytes {
        if bytes < MIN_FILE_SIZE_BYTES {
            return Err(invalid_update(
                "maxFileSizeBytes must not be less than 1048576",
            ));
        }
        if bytes > MAX_FILE_SIZE_BYTES {
            return Err(invalid_update(
                "maxFileSizeBytes must not be greater than 1073741824",
            ));
        }
        body.max_file_size_bytes = Some(i64::try_from(bytes).unwrap_or(i64::MAX));
        any = true;
    }
    if let Some(mode) = patch.registration {
        body.registration_mode = Some(wire_registration(mode));
        any = true;
    }
    Ok(any.then_some(body))
}

impl State {
    /// The cached W6-A value under `key`, when there is one.
    fn instance_value(&self, key: &QueryKey) -> Option<&InstanceValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W6(W6Value::Instance(value))) => Some(value),
            _ => None,
        }
    }

    fn instance_settings_cached(&self) -> Option<&wire::InstanceSettingsResponseDto> {
        match self.instance_value(&cache_keys::op(keys::SETTINGS)) {
            Some(InstanceValue::Settings(settings)) => Some(settings),
            _ => None,
        }
    }

    fn instance_stats_cached(&self) -> Option<&wire::InstanceStatsResponseDto> {
        match self.instance_value(&cache_keys::op(keys::STATS)) {
            Some(InstanceValue::Stats(stats)) => Some(stats),
            _ => None,
        }
    }

    fn instance_storage_cached(&self) -> Option<&wire::InstanceStorageStatsDto> {
        match self.instance_value(&cache_keys::op(keys::STORAGE)) {
            Some(InstanceValue::Storage(storage)) => Some(storage.as_ref()),
            _ => None,
        }
    }

    fn instance_livekit_cached(&self) -> Option<&wire::LivekitHealthResponseDto> {
        match self.instance_value(&cache_keys::op(keys::LIVEKIT)) {
            Some(InstanceValue::Livekit(health)) => Some(health),
            _ => None,
        }
    }

    /// A W6-A query's data changed: say which views to read again. False when it isn't
    /// W6-A's.
    pub(crate) fn w6_instance_query_changed(&mut self, key: &QueryKey) -> bool {
        let Some(view) = view_for(key) else {
            return false;
        };
        self.view_changed(view);
        true
    }

    /// One socket event, before the shared rules. No socket event covers W6-A's data.
    pub(crate) fn w6_instance_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-A query; `None` when it isn't one.
    pub(crate) async fn w6_instance_fetch(
        &self,
        key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        view_for(key)?;
        let result = async {
            let backend = &self
                .services()
                .ok_or_else(|| unavailable("the backend"))?
                .backend;
            let failed = |error| self.backend_failed(error);
            let value = match key.op() {
                keys::SETTINGS => InstanceValue::Settings(
                    backend
                        .instance_controller_get_settings()
                        .await
                        .map_err(failed)?,
                ),
                keys::STATS => InstanceValue::Stats(
                    backend
                        .instance_controller_get_stats()
                        .await
                        .map_err(failed)?,
                ),
                keys::STORAGE => InstanceValue::Storage(Box::new(
                    backend
                        .storage_quota_controller_get_instance_storage_stats()
                        .await
                        .map_err(failed)?,
                )),
                keys::LIVEKIT => InstanceValue::Livekit(
                    backend
                        .livekit_controller_validate_configuration()
                        .await
                        .map_err(failed)?,
                ),
                op => {
                    return Err(CoreError::Failed {
                        message: format!("no fetch for {op}"),
                    });
                }
            };
            Ok(CacheValue::W6(W6Value::Instance(value)))
        }
        .await;
        Some(result)
    }

    /// The dashboard: stats, instance storage and LiveKit health, read together.
    pub fn admin_dashboard(&self) -> AdminDashboardView {
        self.write(|state, now| {
            let stats_key = cache_keys::op(keys::STATS);
            let storage_key = cache_keys::op(keys::STORAGE);
            let livekit_key = cache_keys::op(keys::LIVEKIT);
            for key in [&stats_key, &storage_key, &livekit_key] {
                state.w5a_ensure(key, now, true);
            }
            // A storage read that failed shows as an attention item, not a failed dashboard.
            let storage_error = matches!(
                state.query_load_state(&storage_key),
                LoadState::Failed { .. }
            );
            let storage = state.instance_storage_cached().map(storage_from_wire);
            let livekit_configured = state
                .instance_livekit_cached()
                .map(|health| health.configured);
            let attention = attention_items(storage.as_ref(), storage_error, livekit_configured);
            AdminDashboardView {
                state: state.query_load_state(&stats_key),
                stats: state.instance_stats_cached().map(stats_from_wire),
                storage,
                livekit_configured,
                attention,
            }
        })
    }

    /// `GET /instance/settings`.
    pub fn instance_settings(&self) -> InstanceSettingsView {
        self.write(|state, now| {
            let key = cache_keys::op(keys::SETTINGS);
            state.w5a_ensure(&key, now, true);
            let mut view = InstanceSettingsView {
                state: state.query_load_state(&key),
                op: state.w5a_op(&ViewKey::InstanceSettings),
                ..Default::default()
            };
            if let Some(settings) = state.instance_settings_cached() {
                view.name = settings.name.clone();
                view.description = settings
                    .description
                    .clone()
                    .filter(|description| !description.is_empty());
                view.registration = registration_mode(&settings.registration_mode);
                view.default_quota_bytes = count(settings.default_storage_quota_bytes);
                view.max_file_bytes = count(settings.max_file_size_bytes);
            }
            view
        })
    }

    /// `PATCH /instance/settings`; op `UpdateInstanceSettings` on `ViewKey::InstanceSettings`.
    /// Success also re-probes the server, so `ServerInfo` (name, registration, max file size)
    /// follows.
    pub async fn update_instance_settings(
        &self,
        patch: InstanceSettingsPatch,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::InstanceSettings,
            AdminActionKind::UpdateInstanceSettings,
            None,
        );
        let body = match update_body(&patch) {
            Ok(Some(body)) => body,
            Ok(None) => return Ok(()),
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "updating instance settings")?;
        let result = services
            .backend
            .instance_controller_update_settings(body)
            .await;
        let key = cache_keys::op(keys::SETTINGS);
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, now, settings| {
                state.note_direct_update(&key);
                state.cache.set(
                    key.clone(),
                    CacheValue::W6(W6Value::Instance(InstanceValue::Settings(settings.clone()))),
                    now,
                );
                state.view_changed(ViewKey::InstanceSettings);
            },
            |_| {},
        )?;
        // The server's own settings are what `ServerInfo` reads: probe it again so they follow.
        let url = self.read(|state| state.auth.server_info.as_ref().map(|info| info.url.clone()));
        if let Some(url) = url {
            let _ = self.probe_server(url).await;
        }
        Ok(())
    }
}
