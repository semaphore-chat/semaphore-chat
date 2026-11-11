//! Direct-message groups (W2): list, create, add members, leave, and the user search that starts
//! one. As the backend: no socket event for a group change (the real one joins the sockets to a
//! room, which the fake has no use for), and a 1:1 that already exists is returned as it is.

use super::{invalid, json_response, typed};
use crate::social::{self, dm_json, new_member, valid_id};
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use semaphore_wire::types::{AddMembersDto, CreateDmGroupDto, DmGroupResponseDto};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/direct-messages", get(list).post(create))
        .route("/api/direct-messages/{id}/members", post(add_members))
        .route("/api/direct-messages/{id}/members/me", delete(leave))
        .route("/api/users/search", get(search_users))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/direct-messages") => "DirectMessagesController_findUserDmGroups",
        ("POST", "/api/direct-messages") => "DirectMessagesController_createDmGroup",
        ("POST", "/api/direct-messages/{id}/members") => "DirectMessagesController_addMembers",
        ("DELETE", "/api/direct-messages/{id}/members/me") => {
            "DirectMessagesController_leaveDmGroup"
        }
        ("GET", "/api/users/search") => "UserController_searchUsers",
        _ => return None,
    })
}

/// `ParseUUIDPipe`: a path id that is no UUID is `400 BAD_REQUEST`.
pub(super) fn bad_id(inner: &Inner, what: &str) -> Response {
    inner.error(
        400,
        "BAD_REQUEST",
        format!("Validation failed ({what} is expected)"),
        false,
    )
}

fn forbidden(inner: &Inner, message: &str) -> Response {
    inner.error(403, "FORBIDDEN", message, false)
}

async fn list(State(inner): State<Arc<Inner>>) -> Response {
    let data = lock(&inner.data);
    let groups: Vec<Value> = social::dm_groups_for(&data, &inner.scenario.me.id)
        .iter()
        .map(dm_json)
        .collect();
    json_response(StatusCode::OK, Value::Array(groups))
}

/// `createDmGroup`: `isGroup` is the body's, or whether there are more than two members with the
/// creator. A 1:1 of exactly these two is returned, not made again. Created with `201` either way.
async fn create(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<CreateDmGroupDto>(&body) else {
        return invalid("userIds must be an array of UUIDs, name a string, isGroup a boolean");
    };
    let me = inner.scenario.me.id.clone();
    let mut members = vec![me.clone()];
    for id in &dto.user_ids {
        let id = id.to_string();
        if !members.contains(&id) {
            members.push(id);
        }
    }
    let is_group = dto.is_group.unwrap_or(members.len() > 2);
    let now = inner.now();
    let mut data = lock(&inner.data);

    if !is_group && members.len() == 2 {
        let existing = data.social.dm_groups.iter().find(|group| {
            !group.is_group
                && group.members.len() == 2
                && members
                    .iter()
                    .all(|id| group.members.iter().any(|member| &member.user_id == id))
        });
        if let Some(existing) = existing {
            let view = social::dm_view(&data, existing);
            return json_response(StatusCode::CREATED, dm_json(&view));
        }
    }

    let mut users = Vec::new();
    for id in &members {
        match inner.scenario.user(id) {
            Some(user) => users.push(user.clone()),
            None => {
                drop(data);
                return inner.error(404, "NOT_FOUND", "User not found", false);
            }
        }
    }
    let group = DmGroupResponseDto {
        created_at: now,
        id: data.social.new_id("dm"),
        is_group,
        last_message: None,
        members: users
            .iter()
            .map(|user| new_member(&mut data.social, user, now))
            .collect(),
        name: dto.name.clone(),
    };
    data.social.dm_groups.push(group.clone());
    json_response(StatusCode::CREATED, dm_json(&group))
}

/// `addMembers`: only a member of a group chat (never a 1:1) adds people. A user who is already in
/// it, or who doesn't exist, is skipped without an error, as the backend's `catch {}` does.
async fn add_members(
    State(inner): State<Arc<Inner>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let known = lock(&inner.data)
        .social
        .dm_groups
        .iter()
        .any(|group| group.id == id);
    if !valid_id(&id, known) {
        return bad_id(&inner, "a UUID");
    }
    let Ok(dto) = typed::<AddMembersDto>(&body) else {
        return invalid("userIds must be an array of UUIDs");
    };
    let me = inner.scenario.me.id.clone();
    let now = inner.now();
    let mut data = lock(&inner.data);
    let Some(index) = data
        .social
        .dm_groups
        .iter()
        .position(|group| group.id == id && group.members.iter().any(|m| m.user_id == me))
    else {
        drop(data);
        return forbidden(&inner, "You are not a member of this DM group");
    };
    if !data.social.dm_groups[index].is_group {
        drop(data);
        return forbidden(&inner, "Cannot add members to a 1:1 DM");
    }
    for user_id in dto.user_ids.iter().map(|id| id.to_string()) {
        let Some(user) = inner.scenario.user(&user_id) else {
            continue;
        };
        if data.social.dm_groups[index]
            .members
            .iter()
            .any(|member| member.user_id == user_id)
        {
            continue;
        }
        let member = new_member(&mut data.social, user, now);
        data.social.dm_groups[index].members.push(member);
    }
    let view = social::dm_view(&data, &data.social.dm_groups[index]);
    json_response(StatusCode::CREATED, dm_json(&view))
}

/// `leaveDmGroup`: 204. The group stays for the others, and the user's thread subscriptions in
/// it end with the membership.
async fn leave(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    let known = lock(&inner.data)
        .social
        .dm_groups
        .iter()
        .any(|group| group.id == id);
    if !valid_id(&id, known) {
        return bad_id(&inner, "a UUID");
    }
    let me = inner.scenario.me.id.clone();
    let mut data = lock(&inner.data);
    let Some(index) = data
        .social
        .dm_groups
        .iter()
        .position(|group| group.id == id)
    else {
        drop(data);
        return inner.error(404, "NOT_FOUND", "DM group not found", false);
    };
    if !data.social.dm_groups[index]
        .members
        .iter()
        .any(|member| member.user_id == me)
    {
        drop(data);
        return forbidden(&inner, "You are not a member of this DM group");
    }
    data.social.dm_groups[index]
        .members
        .retain(|member| member.user_id != me);
    let parents: Vec<String> = data
        .dm_messages
        .get(&id)
        .into_iter()
        .flatten()
        .map(|message| message.id.clone())
        .collect();
    for parent in parents {
        data.thread_subscriptions.remove(&parent);
    }
    StatusCode::NO_CONTENT.into_response()
}

/// `searchUsers`: `q` is matched in the username and display name, case-insensitively, by
/// username. `limit` is 25 by default and 1 to 50. An owner reads the whole directory; anyone
/// else needs a `q`, finds people who share a community with them or whose username is exactly
/// `q`, and can't search a community they are not in. With a `communityId`, its members are left
/// out. The searcher is not left out.
async fn search_users(
    State(inner): State<Arc<Inner>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    // A missing `q` is empty, as the backend reads it: for a non-owner, no results.
    let q = query.get("q").map_or("", String::as_str);
    search_with(&inner, q, &query)
}

fn search_with(inner: &Inner, q: &str, query: &HashMap<String, String>) -> Response {
    let limit = match query.get("limit") {
        Some(raw) => match raw.parse::<i64>() {
            Ok(limit) => limit,
            Err(_) => {
                return inner.error(
                    400,
                    "BAD_REQUEST",
                    "Validation failed (numeric string is expected)",
                    false,
                );
            }
        },
        None => 25,
    }
    .clamp(1, 50) as usize;
    let community = query.get("communityId").filter(|id| !id.is_empty());
    let q = q.trim().to_lowercase();
    let me = &inner.scenario.me;
    let owner = me.role == semaphore_wire::enums::InstanceRole::Owner;
    let shares_community = |user_id: &str| {
        inner.scenario.memberships.values().any(|members| {
            members.iter().any(|m| m.user_id == user_id)
                && members.iter().any(|m| m.user_id == me.id)
        })
    };
    if !owner {
        if q.is_empty() {
            return json_response(StatusCode::OK, Value::Array(Vec::new()));
        }
        if let Some(community) = community {
            let mine = inner
                .scenario
                .memberships
                .get(community)
                .is_some_and(|members| members.iter().any(|m| m.user_id == me.id));
            if !mine {
                return inner.error(
                    403,
                    "FORBIDDEN",
                    "You can only search within your own communities",
                    false,
                );
            }
        }
    }
    let mut found: Vec<_> = std::iter::once(&inner.scenario.me)
        .chain(inner.scenario.users.iter())
        .filter(|user| {
            let name_matches = user.username.to_lowercase().contains(&q)
                || user
                    .display_name
                    .as_deref()
                    .is_some_and(|name| name.to_lowercase().contains(&q));
            if owner {
                name_matches
            } else {
                (name_matches && shares_community(&user.id)) || user.username.to_lowercase() == q
            }
        })
        .filter(|user| {
            community.is_none_or(|community| {
                !inner
                    .scenario
                    .memberships
                    .get(community)
                    .is_some_and(|members| members.iter().any(|m| m.user_id == user.id))
            })
        })
        .collect();
    found.sort_by(|a, b| a.username.cmp(&b.username));
    found.truncate(limit);
    json_response(
        StatusCode::OK,
        serde_json::to_value(found).expect("users serialize"),
    )
}
