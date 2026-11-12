//! W6-C's state: the per-user storage the management page lists, and the quotas changed over the
//! API. Seeded from the scenario's `storageUsage` key (`Scenario::extra`), an object of user id to
//! used bytes. Its own lock (`Inner::w6_storage`): never held with `data`, `admin` or `rbac`.
//!
//! Usage is 0 for a user the scenario doesn't mention; the quota is the backend's default
//! (50 GiB) until `PATCH /storage/users/{userId}/quota` changes it. Recalculating changes nothing
//! here: the fake's usage already is what its files say.

use crate::{Inner, lock};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The backend's default per-user quota: 50 GiB.
pub(crate) const DEFAULT_QUOTA_BYTES: i64 = 53_687_091_200;

#[derive(Debug, Default)]
pub(crate) struct Storage {
    seeded: bool,
    /// Used bytes per user id, from the scenario's `storageUsage` or a control.
    usage: BTreeMap<String, i64>,
    /// Quotas changed over the API, per user id.
    quotas: BTreeMap<String, i64>,
}

impl Storage {
    /// The scenario's seed, once: its `storageUsage` object, when it has one.
    pub(crate) fn seed(&mut self, inner: &Inner) {
        if std::mem::replace(&mut self.seeded, true) {
            return;
        }
        let Some(usage) = inner
            .scenario
            .extra
            .get("storageUsage")
            .and_then(Value::as_object)
        else {
            return;
        };
        for (user_id, bytes) in usage {
            if let Some(bytes) = bytes.as_i64() {
                self.usage.insert(user_id.clone(), bytes.max(0));
            }
        }
    }

    pub(crate) fn set_quota(&mut self, user_id: &str, quota_bytes: i64) {
        self.quotas.insert(user_id.to_owned(), quota_bytes.max(0));
    }

    fn used(&self, user_id: &str) -> i64 {
        self.usage.get(user_id).copied().unwrap_or(0)
    }

    fn quota(&self, user_id: &str) -> i64 {
        self.quotas
            .get(user_id)
            .copied()
            .unwrap_or(DEFAULT_QUOTA_BYTES)
    }

    /// `UserStorageStatsDto` for one user, or `None` when the scenario has no such user.
    pub(crate) fn row(&self, inner: &Inner, user_id: &str) -> Option<Value> {
        let user = inner.scenario.user(user_id)?;
        let used = self.used(user_id);
        let quota = self.quota(user_id);
        let percent = if quota > 0 {
            (used as f64 / quota as f64 * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };
        Some(json!({
            "userId": user.id.clone(),
            "username": user.username.clone(),
            "usedBytes": used,
            "quotaBytes": quota,
            "percentUsed": percent,
            "fileCount": 0,
        }))
    }

    /// `UserStorageListResponseDto`: the users whose use is at least `min_percent_used` (0: all),
    /// most used first (ties by id), then the page `skip`..`skip + take`.
    pub(crate) fn list(&self, inner: &Inner, skip: i64, take: i64, min_percent_used: i64) -> Value {
        let mut rows: Vec<(f64, Value)> = std::iter::once(&inner.scenario.me)
            .chain(
                inner
                    .scenario
                    .users
                    .iter()
                    .filter(|user| user.id != inner.scenario.me.id),
            )
            .filter_map(|user| {
                let row = self.row(inner, &user.id)?;
                let percent = row["percentUsed"].as_f64().unwrap_or(0.0);
                (percent >= min_percent_used as f64).then_some((percent, row))
            })
            .collect();
        rows.sort_by(|(a_percent, a), (b_percent, b)| {
            b_percent
                .partial_cmp(a_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    a["userId"]
                        .as_str()
                        .unwrap_or_default()
                        .cmp(b["userId"].as_str().unwrap_or_default())
                })
        });
        let total = rows.len();
        let start = usize::try_from(skip.max(0))
            .unwrap_or(usize::MAX)
            .min(total);
        let end = start
            .saturating_add(usize::try_from(take.max(0)).unwrap_or(usize::MAX))
            .min(total);
        let users: Vec<Value> = rows
            .into_iter()
            .skip(start)
            .take(end - start)
            .map(|(_, row)| row)
            .collect();
        json!({ "users": users, "total": total as i64 })
    }
}

/// A W6-C control (`POST /__control/{name}`), or `None` when the name isn't W6-C's.
pub(crate) fn control(inner: &Inner, name: &str, request: &Value) -> Option<Response> {
    match name {
        "storage_usage" => {
            let Some(usage) = request.as_object() else {
                return Some(inner.error(
                    400,
                    "VALIDATION_FAILED",
                    "the body must map user ids to used bytes",
                    false,
                ));
            };
            let mut parsed = Vec::with_capacity(usage.len());
            for (user_id, bytes) in usage {
                let Some(bytes) = bytes.as_i64().filter(|bytes| *bytes >= 0) else {
                    return Some(inner.error(
                        400,
                        "VALIDATION_FAILED",
                        "used bytes must be a number of at least 0",
                        false,
                    ));
                };
                parsed.push((user_id.clone(), bytes));
            }
            let mut storage = lock(&inner.w6_storage);
            storage.seed(inner);
            for (user_id, bytes) in parsed {
                storage.usage.insert(user_id, bytes);
            }
        }
        _ => return None,
    }
    Some(json_response(json!({ "ok": true })))
}

/// `200` with a JSON body, as the fake's routes answer.
fn json_response(body: Value) -> Response {
    (axum::http::StatusCode::OK, axum::Json(body)).into_response()
}
