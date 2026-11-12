//! [`FakeBackend`] for W6-C: the per-user storage list, quotas and recalculation, scripted through
//! `FakeBackend::w4` as the other lanes are (answers decoded into the wire type, errors, gates,
//! the calls made). Every operation answers a DTO, so each one answers the JSON set for it.

use super::FakeBackend;
use semaphore_core::backend::{AdminStorageBackend, BackendResult};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

/// The users the paging tests build rows from.
pub const PRIYA: &str = "00000000-0000-4000-8000-0000000000c1";
pub const MARCUS: &str = "00000000-0000-4000-8000-0000000000c2";

/// `UserStorageStatsDto`.
pub fn stats_json(
    user_id: &str,
    username: &str,
    used_bytes: i64,
    quota_bytes: i64,
    percent_used: f64,
    file_count: i64,
) -> Value {
    json!({
        "userId": user_id,
        "username": username,
        "usedBytes": used_bytes,
        "quotaBytes": quota_bytes,
        "percentUsed": percent_used,
        "fileCount": file_count,
    })
}

/// `UserStorageListResponseDto`.
pub fn list_json(users: Vec<Value>, total: i64) -> Value {
    json!({ "users": users, "total": total })
}

/// A list of `count` users, `user-0`..`user-{count-1}`, each using one percent more than the last.
pub fn rows(count: usize) -> Vec<Value> {
    (0..count)
        .map(|index| {
            stats_json(
                &format!("{PRIYA}-{index:04}"),
                &format!("user{index}"),
                index as i64,
                100,
                index as f64,
                0,
            )
        })
        .collect()
}

fn opt(value: Option<i64>) -> String {
    value.map_or_else(|| "-".to_owned(), |value| value.to_string())
}

fn json_body(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).unwrap()
}

#[async_trait::async_trait]
impl AdminStorageBackend for FakeBackend {
    async fn storage_quota_controller_get_users_storage_list(
        &self,
        min_percent_used: Option<i64>,
        skip: Option<i64>,
        take: Option<i64>,
    ) -> BackendResult<wire::UserStorageListResponseDto> {
        self.w4
            .run(
                "w6c_list",
                &[&opt(min_percent_used), &opt(skip), &opt(take)],
            )
            .await
    }

    async fn storage_quota_controller_get_user_storage_stats(
        &self,
        user_id: String,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        self.w4.run("w6c_user", &[&user_id]).await
    }

    async fn storage_quota_controller_update_user_quota(
        &self,
        user_id: String,
        body: wire::UpdateUserQuotaDto,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        self.w4
            .run("w6c_quota", &[&user_id, &json_body(&body)])
            .await
    }

    async fn storage_quota_controller_recalculate_user_storage(
        &self,
        user_id: String,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        self.w4.run("w6c_recalculate", &[&user_id]).await
    }
}
