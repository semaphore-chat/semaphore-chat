//! [`FakeBackend`] for W6-A: the admin dashboard and instance settings, scripted through
//! `FakeBackend::w4` as the other lanes are (answers decoded into the wire type, errors, gates,
//! the calls made). Every operation answers a DTO, so each one answers the JSON set for it.

use super::FakeBackend;
use semaphore_core::backend::{BackendResult, InstanceAdminBackend};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

pub const SETTINGS_ID: &str = "instance-settings";

/// `InstanceSettingsResponseDto`.
pub fn settings_json(name: &str) -> Value {
    json!({
        "id": SETTINGS_ID,
        "name": name,
        "description": null,
        "registrationMode": "INVITE_ONLY",
        "defaultStorageQuotaBytes": 53_687_091_200i64,
        "maxFileSizeBytes": 524_288_000i64,
        "vapidPublicKey": null,
        "vapidSubject": null,
        "createdAt": "2026-09-22T18:00:00.000Z",
        "updatedAt": "2026-09-22T18:00:00.000Z",
    })
}

/// `InstanceStatsResponseDto`.
pub fn stats_json() -> Value {
    json!({
        "totalUsers": 13,
        "totalCommunities": 4,
        "totalChannels": 20,
        "totalMessages": 79,
        "activeInvites": 1,
        "bannedUsers": 2,
    })
}

/// `InstanceStorageStatsDto`, with a value for every field.
pub fn storage_json() -> Value {
    json!({
        "totalStorageUsedBytes": 12_345_678_901i64,
        "totalFileCount": 4321,
        "totalUserCount": 13,
        "averageStoragePerUserBytes": 949_667_608,
        "userStorageDistribution": {
            "under25Percent": 5,
            "under50Percent": 3,
            "under75Percent": 2,
            "under90Percent": 1,
            "over90Percent": 2,
        },
        "storageByType": [
            { "type": "MESSAGE_ATTACHMENT", "bytes": 10_000_000_000i64, "count": 4000 },
            { "type": "USER_AVATAR", "bytes": 2_000_000_000i64, "count": 300 },
            { "type": "REPLAY_CLIP", "bytes": 345_678_901i64, "count": 21 },
        ],
        "defaultQuotaBytes": 53_687_091_200i64,
        "maxFileSizeBytes": 524_288_000i64,
        "usersApproachingQuota": 3,
        "usersOverQuota": 2,
        "server": {
            "memoryTotalBytes": 34_359_738_368i64,
            "memoryUsedBytes": 14_602_223_206i64,
            "memoryFreeBytes": 19_757_515_162i64,
            "memoryUsedPercent": 42.5,
            "cpuCores": 8,
            "cpuModel": "AMD EPYC 7B13",
            "loadAverage": [0.5, 0.4, 0.3],
            "diskTotalBytes": 1_000_000_000_000i64,
            "diskUsedBytes": 500_000_000_000i64,
            "diskFreeBytes": 500_000_000_000i64,
            "diskUsedPercent": 50.0,
            "platform": "linux",
            "hostname": "fake-1",
            "uptime": 86_400.9,
        },
    })
}

/// `LivekitHealthResponseDto`.
pub fn livekit_json(configured: bool) -> Value {
    json!({ "status": "ok", "configured": configured })
}

fn body(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).unwrap()
}

#[async_trait::async_trait]
impl InstanceAdminBackend for FakeBackend {
    async fn instance_controller_get_settings(
        &self,
    ) -> BackendResult<wire::InstanceSettingsResponseDto> {
        self.w4.run("w6a_settings", &[]).await
    }

    async fn instance_controller_update_settings(
        &self,
        update: wire::UpdateInstanceSettingsDto,
    ) -> BackendResult<wire::InstanceSettingsResponseDto> {
        self.w4.run("w6a_update_settings", &[&body(&update)]).await
    }

    async fn instance_controller_get_stats(&self) -> BackendResult<wire::InstanceStatsResponseDto> {
        self.w4.run("w6a_stats", &[]).await
    }

    async fn storage_quota_controller_get_instance_storage_stats(
        &self,
    ) -> BackendResult<wire::InstanceStorageStatsDto> {
        self.w4.run("w6a_storage", &[]).await
    }

    async fn livekit_controller_validate_configuration(
        &self,
    ) -> BackendResult<wire::LivekitHealthResponseDto> {
        self.w4.run("w6a_livekit", &[]).await
    }
}
