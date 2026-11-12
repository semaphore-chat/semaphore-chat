//! W6-A's state: what instance settings, stats, instance storage and LiveKit health has changed in
//! the fake world, seeded from the scenario's `instanceName` and, when it has them, its
//! `instanceStorage` key (`Scenario::extra`). Its own lock (`Inner::w6_instance`): never held with
//! `data`, `admin` or `rbac`.
//!
//! Stats are counted from the scenario on every read; settings, storage and the LiveKit flag are
//! the fake's mutable copy, from the seed or from a control.

use crate::{Inner, lock};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use semaphore_wire::enums::RegistrationMode;
use semaphore_wire::types::InstanceStorageStatsDto;
use serde_json::{Value, json};

/// The instance's one settings row (`InstanceSettings`), as the backend returns it.
#[derive(Debug, Clone)]
pub(crate) struct Settings {
    pub name: String,
    pub description: Option<String>,
    pub registration_mode: RegistrationMode,
    pub default_storage_quota_bytes: i64,
    pub max_file_size_bytes: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            name: "Semaphore Chat".into(),
            description: None,
            registration_mode: RegistrationMode::InviteOnly,
            default_storage_quota_bytes: 53_687_091_200,
            max_file_size_bytes: 524_288_000,
            created_at: DateTime::<Utc>::UNIX_EPOCH,
            updated_at: DateTime::<Utc>::UNIX_EPOCH,
        }
    }
}

#[derive(Debug)]
pub(crate) struct Instance {
    seeded: bool,
    pub(crate) settings: Settings,
    /// The instance storage stats, as the last control set them.
    pub(crate) storage: Value,
    pub(crate) livekit_configured: bool,
}

impl Default for Instance {
    fn default() -> Self {
        Self {
            seeded: false,
            settings: Settings::default(),
            storage: default_storage(),
            livekit_configured: true,
        }
    }
}

impl Instance {
    /// The scenario's seed, once: its instance name, and the storage stats when it has them.
    pub(crate) fn seed(&mut self, inner: &Inner) {
        if std::mem::replace(&mut self.seeded, true) {
            return;
        }
        let at = inner.scenario.epoch;
        let name = inner
            .scenario
            .extra
            .get("instanceName")
            .and_then(Value::as_str)
            .unwrap_or("Semaphore Chat")
            .to_owned();
        self.settings = Settings {
            name,
            created_at: at,
            updated_at: at,
            ..Settings::default()
        };
        if let Some(seeded) = inner
            .scenario
            .extra
            .get("instanceStorage")
            .and_then(|value| serde_json::from_value::<InstanceStorageStatsDto>(value.clone()).ok())
        {
            self.storage = serde_json::to_value(seeded).expect("a DTO serializes");
        }
    }

    /// Applies the fields a validated `PATCH /api/instance/settings` names.
    pub(crate) fn update(&mut self, changes: &Value, now: DateTime<Utc>) {
        let Some(changes) = changes.as_object() else {
            return;
        };
        if let Some(name) = changes.get("name").and_then(Value::as_str) {
            self.settings.name = name.to_owned();
        }
        if let Some(description) = changes.get("description").and_then(Value::as_str) {
            self.settings.description = Some(description.to_owned());
        }
        if let Some(mode) = changes.get("registrationMode") {
            self.settings.registration_mode =
                serde_json::from_value(mode.clone()).unwrap_or(RegistrationMode::InviteOnly);
        }
        if let Some(quota) = changes
            .get("defaultStorageQuotaBytes")
            .and_then(Value::as_i64)
        {
            self.settings.default_storage_quota_bytes = quota;
        }
        if let Some(max) = changes.get("maxFileSizeBytes").and_then(Value::as_i64) {
            self.settings.max_file_size_bytes = max;
        }
        self.settings.updated_at = now;
    }

    /// `InstanceSettingsResponseDto`.
    pub(crate) fn settings_json(&self) -> Value {
        let settings = &self.settings;
        json!({
            "id": "instance-settings",
            "name": settings.name,
            "description": settings.description,
            "registrationMode": settings.registration_mode,
            "defaultStorageQuotaBytes": settings.default_storage_quota_bytes,
            "maxFileSizeBytes": settings.max_file_size_bytes,
            "vapidPublicKey": null,
            "vapidSubject": null,
            "createdAt": settings.created_at,
            "updatedAt": settings.updated_at,
        })
    }

    /// `LivekitHealthResponseDto`.
    pub(crate) fn livekit_json(&self) -> Value {
        json!({ "status": "ok", "configured": self.livekit_configured })
    }
}

/// A plausible server: half its disk used, one user over quota.
fn default_storage() -> Value {
    json!({
        "totalStorageUsedBytes": 2_500_000_000i64,
        "totalFileCount": 1234,
        "totalUserCount": 13,
        "averageStoragePerUserBytes": 192_307_692,
        "userStorageDistribution": {
            "under25Percent": 8,
            "under50Percent": 2,
            "under75Percent": 1,
            "under90Percent": 1,
            "over90Percent": 1,
        },
        "storageByType": [
            { "type": "MESSAGE_ATTACHMENT", "bytes": 2_000_000_000i64, "count": 1000 },
            { "type": "USER_AVATAR", "bytes": 400_000_000i64, "count": 200 },
            { "type": "COMMUNITY_BANNER", "bytes": 100_000_000i64, "count": 34 },
        ],
        "defaultQuotaBytes": 53_687_091_200i64,
        "maxFileSizeBytes": 524_288_000i64,
        "usersApproachingQuota": 2,
        "usersOverQuota": 1,
        "server": {
            "memoryTotalBytes": 34_359_738_368i64,
            "memoryUsedBytes": 12_884_901_888i64,
            "memoryFreeBytes": 21_474_836_480i64,
            "memoryUsedPercent": 37.5,
            "cpuCores": 8,
            "cpuModel": "AMD EPYC 7B13",
            "loadAverage": [0.42, 0.51, 0.47],
            "diskTotalBytes": 1_000_000_000_000i64,
            "diskUsedBytes": 500_000_000_000i64,
            "diskFreeBytes": 500_000_000_000i64,
            "diskUsedPercent": 50.0,
            "platform": "linux",
            "hostname": "semaphore-chat",
            "uptime": 86_400.0,
        },
    })
}

/// `InstanceStatsResponseDto`, counted from the scenario: every user, community, channel and
/// message it holds.
pub(crate) fn stats_json(inner: &Inner) -> Value {
    let scenario = &inner.scenario;
    let messages: usize = scenario
        .channel_messages
        .values()
        .chain(scenario.dm_messages.values())
        .chain(scenario.threads.values())
        .map(Vec::len)
        .sum();
    let channels: usize = scenario
        .communities
        .iter()
        .map(|community| community.channels.len())
        .sum();
    // Every account: `me` plus the others (`me` is one of them in some scenarios).
    let users = scenario
        .users
        .iter()
        .filter(|user| user.id != scenario.me.id)
        .count()
        + 1;
    json!({
        "totalUsers": users,
        "totalCommunities": scenario.communities.len(),
        "totalChannels": channels,
        "totalMessages": messages,
        "activeInvites": 1,
        "bannedUsers": 0,
    })
}

/// A W6-A control (`POST /__control/{name}`), or `None` when the name isn't W6-A's.
pub(crate) fn control(inner: &Inner, name: &str, request: &Value) -> Option<Response> {
    match name {
        "instance_storage" => {
            // The fields the body names, over what the fake has now: a full DTO replaces it all.
            let storage = {
                let mut instance = lock(&inner.w6_instance);
                instance.seed(inner);
                let mut storage = instance.storage.clone();
                merge(&mut storage, request);
                storage
            };
            let Ok(storage) = serde_json::from_value::<InstanceStorageStatsDto>(storage) else {
                return Some(inner.error(
                    400,
                    "VALIDATION_FAILED",
                    "the body must be instance storage stats",
                    false,
                ));
            };
            let mut instance = lock(&inner.w6_instance);
            instance.storage = serde_json::to_value(storage).expect("a DTO serializes");
        }
        "livekit_configured" => {
            let Some(configured) = request.get("configured").and_then(Value::as_bool) else {
                return Some(inner.error(
                    400,
                    "VALIDATION_FAILED",
                    "configured is required",
                    false,
                ));
            };
            let mut instance = lock(&inner.w6_instance);
            instance.seed(inner);
            instance.livekit_configured = configured;
        }
        _ => return None,
    }
    Some(json_response(json!({ "ok": true })))
}

/// `patch`'s fields over `base`'s: a nested object is merged, anything else replaces.
fn merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(base), Value::Object(patch)) => {
            for (key, value) in patch {
                match base.get_mut(key) {
                    Some(existing) => merge(existing, value),
                    None => {
                        base.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (base, patch) => *base = patch.clone(),
    }
}

/// `200` with a JSON body, as the fake's routes answer.
fn json_response(body: Value) -> Response {
    (axum::http::StatusCode::OK, axum::Json(body)).into_response()
}
