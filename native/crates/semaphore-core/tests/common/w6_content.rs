//! [`FakeBackend`] for W6-D: every community with stats and force delete, scripted through
//! `FakeBackend::w4` as the other lanes are (answers decoded into the wire type, errors, gates,
//! the calls made). The instance invites calls are W5-A's (`common/w5a.rs`, ops `invites`,
//! `create_invite` and `delete_invite`), since that trait holds them.

use super::{FakeBackend, ME};
use semaphore_core::backend::{AdminContentBackend, BackendResult};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

pub const COMMUNITY: &str = "00000000-0000-4000-8000-0000000000d1";
pub const COMMUNITY_B: &str = "00000000-0000-4000-8000-0000000000d2";
pub const COMMUNITY_C: &str = "00000000-0000-4000-8000-0000000000d3";

/// `CommunityStatsDto`.
pub fn community_stats_json(id: &str, name: &str, members: i64, channels: i64) -> Value {
    json!({
        "id": id, "name": name, "description": format!("About {name}"), "avatar": format!("{id}-avatar"),
        "banner": null, "createdAt": "2026-09-22T18:00:00.000Z",
        "memberCount": members, "channelCount": channels,
    })
}

/// `CommunityStatsDetailDto`.
pub fn community_detail_json(
    id: &str,
    name: &str,
    members: i64,
    channels: i64,
    messages: i64,
) -> Value {
    let mut detail = community_stats_json(id, name, members, channels);
    detail["messageCount"] = json!(messages);
    detail
}

/// `CommunityStatsListResponseDto`: `next` is the cursor, absent when there's no more.
pub fn communities_page(rows: Vec<Value>, next: Option<&str>) -> Value {
    match next {
        Some(next) => json!({ "communities": rows, "continuationToken": next }),
        None => json!({ "communities": rows }),
    }
}

/// `InviteResponseDto` for an instance invite, made by `me`.
pub fn instance_invite_json(code: &str, communities: &[&str]) -> Value {
    json!({
        "id": format!("{code}-id"), "code": code,
        "createdAt": "2026-09-22T18:00:00.000Z",
        "createdById": ME,
        "createdBy": { "id": ME, "username": "me", "displayName": "Me" },
        "defaultCommunities": communities.iter().map(|community| json!({
            "id": format!("{code}-{community}"), "communityId": community,
        })).collect::<Vec<_>>(),
        "disabled": false, "maxUses": 5, "usages": [], "uses": 2,
        "validUntil": "2026-12-31T00:00:00.000Z",
    })
}

/// A call that answers nothing (`()`) succeeds unless it's scripted to fail.
async fn unit(backend: &FakeBackend, op: &'static str, args: &[&str]) -> BackendResult<()> {
    backend
        .w4
        .answers
        .lock()
        .unwrap()
        .entry(op)
        .or_insert(Value::Null);
    backend.w4.run(op, args).await
}

fn optional(value: Option<&str>) -> &str {
    value.unwrap_or_default()
}

#[async_trait::async_trait]
impl AdminContentBackend for FakeBackend {
    async fn community_controller_find_all_with_stats(
        &self,
        continuation_token: Option<String>,
        limit: Option<i64>,
        search: Option<String>,
    ) -> BackendResult<wire::CommunityStatsListResponseDto> {
        let limit = limit.map(|limit| limit.to_string()).unwrap_or_default();
        let token = optional(continuation_token.as_deref()).to_owned();
        let search = optional(search.as_deref()).to_owned();
        self.w4.run("w6d_list", &[&token, &limit, &search]).await
    }

    async fn community_controller_find_one_with_stats(
        &self,
        id: String,
    ) -> BackendResult<wire::CommunityStatsDetailDto> {
        self.w4.run("w6d_community", &[&id]).await
    }

    async fn community_controller_force_remove(&self, id: String) -> BackendResult<()> {
        unit(self, "w6d_delete", &[&id]).await
    }
}
