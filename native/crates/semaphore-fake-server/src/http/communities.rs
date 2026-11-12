//! Communities, channels, permissions, members, presence, counters and custom emoji.

use super::{bearer_token, invalid, json_response};
use crate::messages;
use crate::{Inner, lock};
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::get;
use semaphore_wire::enums::ChannelType;
use semaphore_wire::types::{
    ChannelCapabilitiesDto, CommunityChannelCapabilitiesDto, CommunityResponseDto,
    PaginatedMembershipsResponseDto,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/community/mine", get(communities_mine))
        .route(
            "/api/channels/community/{communityId}",
            get(channels_for_community),
        )
        .route(
            "/api/channels/community/{communityId}/mentionable",
            get(mentionable_channels),
        )
        .route(
            "/api/channels/community/{communityId}/permissions/me",
            get(channel_permissions),
        )
        .route("/api/read-receipts/unread-counts", get(unread_counts))
        .route(
            "/api/membership/community/{communityId}",
            get(members_of_community),
        )
        .route("/api/presence/users/bulk", get(bulk_presence))
        .route("/api/notifications/unread-count", get(notification_count))
        .route(
            "/api/membership/community/{communityId}/search",
            get(search_members),
        )
        .route(
            "/api/custom-emoji/community/{communityId}",
            get(list_emojis).post(super::community_admin::create_emoji),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/community/mine") => "CommunityController_findAllMine",
        ("GET", "/api/channels/community/{communityId}") => {
            "ChannelsController_findAllForCommunity"
        }
        ("GET", "/api/channels/community/{communityId}/mentionable") => {
            "ChannelsController_getMentionableChannels"
        }
        ("GET", "/api/channels/community/{communityId}/permissions/me") => {
            "ChannelPermissionsController_getMyCommunityChannelPermissions"
        }
        ("GET", "/api/read-receipts/unread-counts") => "ReadReceiptsController_getUnreadCounts",
        ("GET", "/api/membership/community/{communityId}") => {
            "MembershipController_findAllForCommunity"
        }
        ("GET", "/api/presence/users/bulk") => "PresenceController_getBulkPresence",
        ("GET", "/api/notifications/unread-count") => "NotificationsController_getUnreadCount",
        ("GET", "/api/membership/community/{communityId}/search") => {
            "MembershipController_searchCommunityMembers"
        }
        ("GET", "/api/custom-emoji/community/{communityId}") => {
            "CustomEmojiController_listCommunityEmojis"
        }
        _ => return None,
    })
}

async fn communities_mine(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user = inner.user_of(bearer_token(&headers));
    // A registered account has none of the scenario's: only what it made.
    let scenario: &[crate::scenario::Community] = if inner.is_registered(&user) {
        &[]
    } else {
        &inner.scenario.communities
    };
    let communities: Vec<Value> = scenario
        .iter()
        .cloned()
        .chain(inner.created_communities_of(&user))
        // W5: not one they were kicked or banned from since.
        .filter(|community| !crate::calls::is_kicked(&inner, &community.id, &user))
        // W5-A: as changed or deleted since.
        .filter_map(|community| crate::admin::changed(&inner, community))
        .map(|community| {
            serde_json::to_value(CommunityResponseDto {
                avatar: community.avatar,
                banner: community.banner,
                created_at: community.created_at,
                description: community.description,
                id: community.id,
                name: community.name,
            })
            .expect("a community serializes")
        })
        .collect();
    json_response(StatusCode::OK, Value::Array(communities))
}

async fn channels_for_community(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let Some(community) = crate::admin::community(&inner, &community_id) else {
        return inner.error(404, "NOT_FOUND", "Community not found", false);
    };
    let user = inner.user_of(bearer_token(&headers));
    // W5-A: a private channel only for its members (or, with no list, everyone).
    let channels: Vec<Value> = community
        .channels
        .iter()
        .filter(|channel| crate::admin::sees(&inner, channel, &user))
        .map(|channel| serde_json::to_value(channel).expect("a channel serializes"))
        .collect();
    json_response(StatusCode::OK, Value::Array(channels))
}

async fn mentionable_channels(
    State(inner): State<Arc<Inner>>,
    Path(community_id): Path<String>,
) -> Response {
    let Some(community) = crate::admin::community(&inner, &community_id) else {
        return inner.error(404, "NOT_FOUND", "Community not found", false);
    };
    let channels: Vec<Value> = community
        .channels
        .iter()
        .filter(|channel| channel.type_ == ChannelType::Text)
        .map(|channel| serde_json::to_value(channel).expect("a channel serializes"))
        .collect();
    json_response(StatusCode::OK, Value::Array(channels))
}

async fn channel_permissions(
    State(inner): State<Arc<Inner>>,
    headers: axum::http::HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let Some(community) = crate::admin::community(&inner, &community_id) else {
        return inner.error(404, "NOT_FOUND", "Community not found", false);
    };
    // W5: the caller's active timeout, as `getMyCommunityChannelPermissions` reports it.
    let user = inner.user_of(super::bearer_token(&headers));
    let timed_out_until = crate::rbac::timed_out_until(&inner, &community_id, &user);
    let channels: Vec<ChannelCapabilitiesDto> = community
        .channels
        .iter()
        .map(|channel| ChannelCapabilitiesDto {
            attach: true,
            channel_id: channel.id.clone(),
            connect: true,
            manage_permissions: true,
            post: true,
            posting_role_names: Vec::new(),
            react: true,
            share: true,
            speak: true,
            thread_reply: true,
            timed_out_until,
            video: true,
            view: true,
        })
        .collect();
    json_response(
        StatusCode::OK,
        serde_json::to_value(CommunityChannelCapabilitiesDto {
            channels,
            community_id,
        })
        .expect("capabilities serialize"),
    )
}

async fn unread_counts(State(inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::OK, messages::unread_counts(&inner))
}

/// As the backend pages them: the token is the last row's id, sent only after a full page.
async fn members_of_community(
    State(inner): State<Arc<Inner>>,
    Path(community_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let limit = match query.get("limit") {
        Some(raw) => match raw.parse::<usize>() {
            Ok(limit) => limit.clamp(1, 500),
            Err(_) => return invalid("limit must be an integer"),
        },
        None => 100,
    };
    // W5-A: with the members added since.
    let all = crate::admin::members(&inner, &community_id);
    let all = all.as_slice();
    let start = match query.get("continuationToken") {
        Some(token) => match all.iter().position(|member| member.id == *token) {
            Some(index) => index + 1,
            None => return invalid("unknown continuationToken"),
        },
        None => 0,
    };
    // W4: a kicked member is no longer listed.
    let members: Vec<_> = all
        .iter()
        .skip(start)
        .filter(|member| !crate::calls::is_kicked(&inner, &community_id, &member.user_id))
        .take(limit)
        .cloned()
        .collect();
    let continuation_token = (members.len() == limit)
        .then(|| members.last().map(|member| member.id.clone()))
        .flatten();
    json_response(
        StatusCode::OK,
        serde_json::to_value(PaginatedMembershipsResponseDto {
            continuation_token,
            members,
        })
        .expect("a members page serializes"),
    )
}

/// The sandbox's rule: `me`, and anyone with a status, is online. Only the online are listed.
async fn bulk_presence(State(inner): State<Arc<Inner>>) -> Response {
    let scenario = &inner.scenario;
    let online: HashMap<&str, bool> = std::iter::once(&scenario.me)
        .chain(scenario.users.iter().filter(|user| user.status.is_some()))
        .map(|user| (user.id.as_str(), true))
        .collect();
    json_response(StatusCode::OK, json!({ "presence": online }))
}

async fn notification_count(State(inner): State<Arc<Inner>>) -> Response {
    json_response(
        StatusCode::OK,
        json!({ "count": crate::social::unread_count(&lock(&inner.data), &inner.scenario.me.id) }),
    )
}

async fn search_members(
    State(inner): State<Arc<Inner>>,
    Path(community_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(search) = query.get("query") else {
        return invalid("query is required");
    };
    let limit = match query.get("limit") {
        Some(raw) => match raw.parse::<usize>() {
            Ok(limit) => limit.min(100),
            Err(_) => return invalid("limit must be an integer"),
        },
        None => 20,
    };
    let needle = search.to_lowercase();
    let members: Vec<Value> = inner
        .scenario
        .memberships
        .get(&community_id)
        .into_iter()
        .flatten()
        .filter(|membership| {
            let Some(user) = membership.user.as_ref() else {
                return false;
            };
            user.username.to_lowercase().contains(&needle)
                || user
                    .display_name
                    .as_deref()
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(&needle)
        })
        .take(limit)
        .map(|membership| serde_json::to_value(membership).expect("a membership serializes"))
        .collect();
    json_response(StatusCode::OK, Value::Array(members))
}

/// The custom emoji any message in the community uses, so a scenario needs no list of its own.
/// Each one's image is its id's generated file.
async fn list_emojis(
    State(inner): State<Arc<Inner>>,
    Path(community_id): Path<String>,
) -> Response {
    let emojis = messages::emojis_in_use(&inner, &community_id);
    // W5-A: with those added and without those deleted since.
    let emojis = crate::admin::emojis(&inner, &community_id, emojis);
    json_response(StatusCode::OK, Value::Array(emojis))
}
