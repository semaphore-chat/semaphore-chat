//! W6-D's state: every community the fake knows, with its counts, and force deleting one.
//!
//! Nothing is kept here: a community's changes live in W5-A's `crate::admin` and the ones created
//! over the API in W3's `crate::accounts`, so both reads compute their answer from those and the
//! scenario every time. Its own lock (`Inner::w6_content`) is never held with `data`, `admin` or
//! `rbac`; `control` answers no name.

use crate::scenario::Community;
use crate::{Inner, lock};
use axum::response::Response;
use semaphore_wire::types::{CommunityStatsDetailDto, CommunityStatsDto};
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Content {}

/// Every community the fake knows that isn't deleted: the scenario's and the ones created over
/// the API.
fn communities(inner: &Inner) -> Vec<Community> {
    let mut ids: Vec<String> = inner
        .scenario
        .communities
        .iter()
        .map(|community| community.id.clone())
        .collect();
    ids.extend(
        lock(&inner.accounts)
            .communities
            .iter()
            .map(|created| created.community.id.clone()),
    );
    ids.into_iter()
        .filter_map(|id| crate::admin::community(inner, &id))
        .collect()
}

/// `GET /community/admin/list`'s order: newest first, then by id, as the backend's
/// `orderBy: { createdAt: 'desc' }` over a stable cursor.
pub(crate) fn list(inner: &Inner) -> Vec<CommunityStatsDto> {
    let mut rows: Vec<CommunityStatsDto> = communities(inner)
        .iter()
        .map(|community| stats(inner, community))
        .collect();
    rows.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    rows
}

/// `GET /community/admin/{id}`: the list's row and the count of its channels' messages.
pub(crate) fn detail(inner: &Inner, community: &Community) -> CommunityStatsDetailDto {
    let row = stats(inner, community);
    CommunityStatsDetailDto {
        avatar: row.avatar,
        banner: row.banner,
        channel_count: row.channel_count,
        created_at: row.created_at,
        description: row.description,
        id: row.id,
        member_count: row.member_count,
        message_count: message_count(inner, community),
        name: row.name,
    }
}

fn stats(inner: &Inner, community: &Community) -> CommunityStatsDto {
    CommunityStatsDto {
        avatar: community.avatar.clone(),
        banner: community.banner.clone(),
        channel_count: community.channels.len() as i64,
        created_at: community.created_at,
        description: community.description.clone(),
        id: community.id.clone(),
        member_count: crate::admin::members(inner, &community.id).len() as i64,
        name: community.name.clone(),
    }
}

/// The messages in its channels, as the backend counts them (none of the fake's are deleted).
fn message_count(inner: &Inner, community: &Community) -> i64 {
    let data = lock(&inner.data);
    community
        .channels
        .iter()
        .map(|channel| {
            data.channel_messages
                .get(&channel.id)
                .map_or(0, |messages| messages.len() as i64)
        })
        .sum()
}

/// A W6-D control (`POST /__control/{name}`), or `None` when the name isn't W6-D's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
