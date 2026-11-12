//! Edit, delete and read one message; pins, a moderator's removal and channel roles (W1 part A).
//! W4: kicking a member (the voice menu's "Kick").

use super::{json_response, typed};
use crate::Inner;
use crate::actions::{self, EditBody, ReasonBody, Refusal};
use crate::rbac;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post};
use serde_json::{Value, json};
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route(
            "/api/messages/{id}",
            get(find_one).patch(edit).delete(delete_message),
        )
        .route("/api/moderation/pin/{messageId}", post(pin).delete(unpin))
        .route("/api/moderation/pins/{channelId}", get(pins))
        .route("/api/moderation/message/{messageId}", delete(remove_as_mod))
        .route("/api/roles/my/channel/{channelId}", get(my_channel_roles))
        .route("/api/roles/my/instance", get(my_instance_roles))
        .route(
            "/api/moderation/kick/{communityId}/{userId}",
            post(kick_user),
        )
        .merge(w5_routes())
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/messages/{id}") => "MessagesController_findOne",
        ("PATCH", "/api/messages/{id}") => "MessagesController_update",
        ("DELETE", "/api/messages/{id}") => "MessagesController_remove",
        ("POST", "/api/moderation/pin/{messageId}") => "ModerationController_pinMessage",
        ("DELETE", "/api/moderation/pin/{messageId}") => "ModerationController_unpinMessage",
        ("GET", "/api/moderation/pins/{channelId}") => "ModerationController_getPinnedMessages",
        ("DELETE", "/api/moderation/message/{messageId}") => {
            "ModerationController_deleteMessageAsMod"
        }
        ("GET", "/api/roles/my/channel/{channelId}") => "RolesController_getMyRolesForChannel",
        ("GET", "/api/roles/my/instance") => "RolesController_getMyInstanceRoles",
        ("POST", "/api/moderation/kick/{communityId}/{userId}") => "ModerationController_kickUser",
        _ => return w5_operation_id(method, route),
    })
}

fn refused(inner: &Inner, (status, code, message): Refusal) -> Response {
    inner.error(status, code, message, false)
}

/// A body that may be absent: the moderation routes' `{ reason }` is optional.
fn reason(body: &Bytes) -> Result<ReasonBody, Response> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(ReasonBody::default());
    }
    typed(body)
}

fn success(message: &str) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::json!({ "success": true, "message": message }),
    )
}

async fn find_one(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    match actions::find_one(&inner, &id) {
        Ok(message) => json_response(
            StatusCode::OK,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn edit(State(inner): State<Arc<Inner>>, Path(id): Path<String>, body: Bytes) -> Response {
    let body: EditBody = match typed(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    match actions::edit(&inner, &id, body) {
        Ok(message) => json_response(
            StatusCode::OK,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn delete_message(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    match actions::delete(&inner, &id) {
        Ok(()) => axum::response::IntoResponse::into_response(StatusCode::NO_CONTENT),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn pin(State(inner): State<Arc<Inner>>, Path(id): Path<String>, body: Bytes) -> Response {
    if let Err(response) = reason(&body) {
        return response;
    }
    match actions::set_pinned(&inner, &id, true) {
        Ok(()) => success("Message pinned successfully"),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn unpin(State(inner): State<Arc<Inner>>, Path(id): Path<String>, body: Bytes) -> Response {
    if let Err(response) = reason(&body) {
        return response;
    }
    match actions::set_pinned(&inner, &id, false) {
        Ok(()) => success("Message unpinned successfully"),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn pins(State(inner): State<Arc<Inner>>, Path(channel_id): Path<String>) -> Response {
    json_response(StatusCode::OK, actions::pins(&inner, &channel_id))
}

async fn remove_as_mod(
    State(inner): State<Arc<Inner>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let body = match reason(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    match actions::remove_as_mod(&inner, &id, body.reason) {
        Ok(()) => success("Message deleted successfully"),
        Err(refusal) => refused(&inner, refusal),
    }
}

/// W3: what decides "Create community". The fake's user holds the instance's default role, which
/// may create communities.
async fn my_instance_roles(State(inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::OK, actions::my_instance_roles(&inner))
}

async fn my_channel_roles(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
) -> Response {
    let me = inner.user_of(super::bearer_token(&headers));
    json_response(
        StatusCode::OK,
        actions::my_channel_roles(&inner, &me, &channel_id),
    )
}

/// `POST /moderation/kick/{communityId}/{userId}`: both ids through `ParseUUIDPipe` (a
/// scenario's own readable ids pass), an optional `{ reason }`, then `200`.
async fn kick_user(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, user_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let community_known = inner.scenario.community(&community_id).is_some();
    let user_known = inner.scenario.user(&user_id).is_some();
    if !crate::social::valid_id(&community_id, community_known)
        || !crate::social::valid_id(&user_id, user_known)
    {
        return super::dms::bad_id(&inner, "uuid");
    }
    let body = match reason(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let actor = inner.user_of(super::bearer_token(&headers));
    if let Err(refusal) = crate::rbac::guard(&inner, &actor, &community_id, &["KICK_USER"]) {
        return crate::rbac::respond(&inner, refusal);
    }
    match crate::calls::kick(&inner, &actor, &community_id, &user_id, body.reason) {
        Ok(()) => success("User kicked successfully"),
        Err((status, code, message)) => inner.error(status, code, message, false),
    }
}

// ----- W5: bans, timeouts and the moderation log ------------------------------------------------
//
// `moderation/moderation.service.ts`: moderating someone needs a role that strictly outranks
// theirs, with no way past that for the instance owner (#679); lifting needs it not to be your own
// and not set by a higher rank, which the owner skips.

fn w5_routes() -> Router<Arc<Inner>> {
    Router::new()
        .route(
            "/api/moderation/ban/{communityId}/{userId}",
            post(ban).delete(unban),
        )
        .route("/api/moderation/bans/{communityId}", get(bans))
        .route(
            "/api/moderation/timeout/{communityId}/{userId}",
            post(timeout).delete(remove_timeout),
        )
        .route("/api/moderation/timeouts/{communityId}", get(timeouts))
        .route(
            "/api/moderation/timeout-status/{communityId}/{userId}",
            get(timeout_status),
        )
        .route("/api/moderation/logs/{communityId}", get(logs))
}

fn w5_operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/moderation/ban/{communityId}/{userId}") => "ModerationController_banUser",
        ("DELETE", "/api/moderation/ban/{communityId}/{userId}") => {
            "ModerationController_unbanUser"
        }
        ("GET", "/api/moderation/bans/{communityId}") => "ModerationController_getBanList",
        ("POST", "/api/moderation/timeout/{communityId}/{userId}") => {
            "ModerationController_timeoutUser"
        }
        ("DELETE", "/api/moderation/timeout/{communityId}/{userId}") => {
            "ModerationController_removeTimeout"
        }
        ("GET", "/api/moderation/timeouts/{communityId}") => "ModerationController_getTimeoutList",
        ("GET", "/api/moderation/timeout-status/{communityId}/{userId}") => {
            "ModerationController_getTimeoutStatus"
        }
        ("GET", "/api/moderation/logs/{communityId}") => "ModerationController_getModerationLogs",
        _ => return None,
    })
}

type W5Refusal = rbac::Refusal;

fn w5_reply(inner: &Inner, result: Result<Response, W5Refusal>) -> Response {
    result.unwrap_or_else(|refusal| rbac::respond(inner, refusal))
}

fn optional_body(body: &Bytes) -> Result<Value, Response> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Null);
    }
    super::parse(body)
}

fn text(body: &Value, key: &str) -> Option<String> {
    body.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// `ModerationUserDto`: who moderated or was moderated.
fn moderation_user(inner: &Inner, id: &str) -> Value {
    match inner.user_entity(id) {
        Some(user) => json!({
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
            "avatarUrl": user.avatar_url,
            "bannerUrl": user.banner_url,
            "bio": user.bio,
            "status": user.status,
            "lastSeen": user.last_seen,
            "role": user.role,
        }),
        None => Value::Null,
    }
}

/// `canModerate`, then membership: the order the backend checks them.
fn may_moderate(
    inner: &Inner,
    actor: &str,
    community_id: &str,
    user_id: &str,
    verb: &str,
) -> Result<(), W5Refusal> {
    let outranks = rbac::community(inner, community_id, |state, _| {
        state.outranks(actor, user_id)
    })
    .unwrap_or(false);
    if !outranks {
        return Err(rbac::refuse(
            403,
            "FORBIDDEN",
            format!("Cannot {verb} a user with equal or higher role"),
        ));
    }
    if !rbac::is_member(inner, community_id, user_id) {
        return Err(rbac::refuse(
            404,
            "NOT_FOUND",
            "User is not a member of this community",
        ));
    }
    Ok(())
}

/// Lifting a ban or timeout: not your own, and not one set by a higher rank (the owner skips both).
fn may_lift(
    inner: &Inner,
    actor: &str,
    community_id: &str,
    user_id: &str,
    set_by: &str,
    what: &str,
) -> Result<(), W5Refusal> {
    if rbac::is_owner(inner, actor) {
        return Ok(());
    }
    if user_id == actor {
        return Err(rbac::refuse(
            403,
            "FORBIDDEN",
            format!("You cannot lift your own {what}"),
        ));
    }
    let higher = rbac::community(inner, community_id, |state, _| {
        set_by != actor && state.best(set_by) < state.best(actor)
    })
    .unwrap_or(false);
    if higher {
        return Err(rbac::refuse(
            403,
            "FORBIDDEN",
            format!("Cannot lift a {what} set by a higher role"),
        ));
    }
    Ok(())
}

async fn ban(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, user_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let body = match optional_body(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = rbac::guard(&inner, &actor, &community_id, &["BAN_USER"]).and_then(|()| {
        may_moderate(&inner, &actor, &community_id, &user_id, "ban")?;
        let reason = text(&body, "reason");
        let expires_at = match text(&body, "expiresAt") {
            Some(at) => Some(
                chrono::DateTime::parse_from_rfc3339(&at)
                    .map_err(|_| {
                        rbac::refuse(
                            400,
                            "BAD_REQUEST",
                            "expiresAt must be a valid ISO 8601 date string",
                        )
                    })?
                    .with_timezone(&chrono::Utc),
            ),
            None => None,
        };
        let now = inner.now();
        let already = rbac::community(&inner, &community_id, |state, _| {
            state.active_ban(&user_id, now).is_some()
        })
        .unwrap_or(false);
        if already {
            return Err(rbac::refuse(409, "CONFLICT", "User is already banned"));
        }
        rbac::community(&inner, &community_id, |state, _| {
            state.bans.insert(
                user_id.clone(),
                rbac::Ban {
                    moderator_id: actor.clone(),
                    reason: reason.clone(),
                    created_at: now,
                    expires_at,
                },
            );
        });
        rbac::log(
            &inner,
            &community_id,
            &actor,
            "BAN_USER",
            Some(&user_id),
            reason.clone(),
            json!({ "expiresAt": expires_at }),
        );
        let mut payload = rbac::moderation_payload(&community_id, &user_id, &actor, &reason);
        if let Some(at) = expires_at {
            payload["expiresAt"] = json!(at);
        }
        // Theirs first, from their own room, then the removal, then the community's.
        inner.emit_to_user(&user_id, "userBanned", payload.clone());
        crate::calls::remove_from_community(&inner, &community_id, &user_id);
        inner.emit_to_others(&user_id, "userBanned", payload);
        Ok(success("User banned successfully"))
    });
    w5_reply(&inner, result)
}

async fn unban(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, user_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let body = match optional_body(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = rbac::guard(&inner, &actor, &community_id, &["UNBAN_USER"]).and_then(|()| {
        let now = inner.now();
        let ban = rbac::community(&inner, &community_id, |state, _| {
            state.active_ban(&user_id, now).cloned()
        })
        .flatten();
        let Some(ban) = ban else {
            return Err(rbac::refuse(404, "NOT_FOUND", "User is not banned"));
        };
        may_lift(
            &inner,
            &actor,
            &community_id,
            &user_id,
            &ban.moderator_id,
            "ban",
        )?;
        rbac::community(&inner, &community_id, |state, _| {
            state.bans.remove(&user_id);
        });
        rbac::log(
            &inner,
            &community_id,
            &actor,
            "UNBAN_USER",
            Some(&user_id),
            text(&body, "reason"),
            Value::Null,
        );
        Ok(success("User unbanned successfully"))
    });
    w5_reply(&inner, result)
}

async fn bans(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let result = rbac::guard(&inner, &actor, &community_id, &["VIEW_BAN_LIST"]).map(|()| {
        let now = inner.now();
        let mut rows: Vec<(String, rbac::Ban)> =
            rbac::community(&inner, &community_id, |state, _| {
                state
                    .bans
                    .iter()
                    .filter(|(user, _)| state.active_ban(user, now).is_some())
                    .map(|(user, ban)| (user.clone(), ban.clone()))
                    .collect()
            })
            .unwrap_or_default();
        rows.sort_by_key(|row| std::cmp::Reverse(row.1.created_at));
        let rows: Vec<Value> = rows
            .iter()
            .map(|(user, ban)| {
                json!({
                    "id": format!("ban-{community_id}-{user}"),
                    "communityId": community_id,
                    "userId": user,
                    "moderatorId": ban.moderator_id,
                    "reason": ban.reason,
                    "createdAt": ban.created_at,
                    "expiresAt": ban.expires_at,
                    "active": true,
                    "user": moderation_user(&inner, user),
                    "moderator": moderation_user(&inner, &ban.moderator_id),
                })
            })
            .collect();
        json_response(StatusCode::OK, Value::Array(rows))
    });
    w5_reply(&inner, result)
}

async fn timeout(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, user_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let body = match super::parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(seconds) = body.get("durationSeconds").and_then(Value::as_i64) else {
        return inner.error(
            400,
            "BAD_REQUEST",
            "durationSeconds must be an integer",
            false,
        );
    };
    if !(60..=2_419_200).contains(&seconds) {
        return inner.error(
            400,
            "BAD_REQUEST",
            if seconds < 60 {
                "durationSeconds must not be less than 60"
            } else {
                "durationSeconds must not be greater than 2419200"
            },
            false,
        );
    }
    let result = rbac::guard(&inner, &actor, &community_id, &["TIMEOUT_USER"]).and_then(|()| {
        may_moderate(&inner, &actor, &community_id, &user_id, "timeout")?;
        let reason = text(&body, "reason");
        let now = inner.now();
        let expires_at = now + chrono::Duration::seconds(seconds);
        rbac::community(&inner, &community_id, |state, _| {
            state.timeouts.insert(
                user_id.clone(),
                rbac::Timeout {
                    moderator_id: actor.clone(),
                    reason: reason.clone(),
                    created_at: now,
                    expires_at,
                },
            );
        });
        rbac::log(
            &inner,
            &community_id,
            &actor,
            "TIMEOUT_USER",
            Some(&user_id),
            reason.clone(),
            json!({ "durationSeconds": seconds, "expiresAt": expires_at }),
        );
        let mut payload = rbac::moderation_payload(&community_id, &user_id, &actor, &reason);
        payload["durationSeconds"] = json!(seconds);
        payload["expiresAt"] = json!(expires_at);
        let room = rbac::members(&inner, &community_id);
        inner.emit_to_users(&room, "userTimedOut", payload);
        Ok(success("User timed out successfully"))
    });
    w5_reply(&inner, result)
}

async fn remove_timeout(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, user_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let body = match optional_body(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = rbac::guard(&inner, &actor, &community_id, &["TIMEOUT_USER"]).and_then(|()| {
        let existing = rbac::community(&inner, &community_id, |state, _| {
            state.timeouts.get(&user_id).cloned()
        })
        .flatten();
        let Some(existing) = existing else {
            return Err(rbac::refuse(404, "NOT_FOUND", "User is not timed out"));
        };
        may_lift(
            &inner,
            &actor,
            &community_id,
            &user_id,
            &existing.moderator_id,
            "timeout",
        )?;
        rbac::community(&inner, &community_id, |state, _| {
            state.timeouts.remove(&user_id);
        });
        let reason = text(&body, "reason");
        rbac::log(
            &inner,
            &community_id,
            &actor,
            "REMOVE_TIMEOUT",
            Some(&user_id),
            reason.clone(),
            Value::Null,
        );
        let room = rbac::members(&inner, &community_id);
        inner.emit_to_users(
            &room,
            "timeoutRemoved",
            rbac::moderation_payload(&community_id, &user_id, &actor, &reason),
        );
        Ok(success("Timeout removed successfully"))
    });
    w5_reply(&inner, result)
}

async fn timeouts(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let result = rbac::guard(&inner, &actor, &community_id, &["VIEW_BAN_LIST"]).map(|()| {
        let now = inner.now();
        let mut rows: Vec<(String, rbac::Timeout)> =
            rbac::community(&inner, &community_id, |state, _| {
                state
                    .timeouts
                    .iter()
                    .filter(|(_, timeout)| timeout.expires_at > now)
                    .map(|(user, timeout)| (user.clone(), timeout.clone()))
                    .collect()
            })
            .unwrap_or_default();
        rows.sort_by_key(|row| std::cmp::Reverse(row.1.created_at));
        let rows: Vec<Value> = rows
            .iter()
            .map(|(user, timeout)| {
                json!({
                    "id": format!("timeout-{community_id}-{user}"),
                    "communityId": community_id,
                    "userId": user,
                    "moderatorId": timeout.moderator_id,
                    "reason": timeout.reason,
                    "createdAt": timeout.created_at,
                    "expiresAt": timeout.expires_at,
                    "user": moderation_user(&inner, user),
                    "moderator": moderation_user(&inner, &timeout.moderator_id),
                })
            })
            .collect();
        json_response(StatusCode::OK, Value::Array(rows))
    });
    w5_reply(&inner, result)
}

async fn timeout_status(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, user_id)): Path<(String, String)>,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let result = rbac::guard(&inner, &actor, &community_id, &["READ_MEMBER"]).map(|()| {
        match rbac::timed_out_until(&inner, &community_id, &user_id) {
            Some(at) => json_response(
                StatusCode::OK,
                json!({ "isTimedOut": true, "expiresAt": at }),
            ),
            None => json_response(StatusCode::OK, json!({ "isTimedOut": false })),
        }
    });
    w5_reply(&inner, result)
}

async fn logs(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let actor = inner.user_of(super::bearer_token(&headers));
    let number = |key: &str, default: i64| -> Result<i64, Response> {
        match query.get(key) {
            None => Ok(default),
            Some(value) => value.parse().map_err(|_| {
                inner.error(
                    400,
                    "BAD_REQUEST",
                    "Validation failed (numeric string is expected)",
                    false,
                )
            }),
        }
    };
    let (limit, offset) = match (number("limit", 50), number("offset", 0)) {
        (Ok(limit), Ok(offset)) => (limit.clamp(1, 100) as usize, offset.max(0) as usize),
        (Err(response), _) | (_, Err(response)) => return response,
    };
    let action = query.get("action").cloned();
    let result = rbac::guard(&inner, &actor, &community_id, &["VIEW_MODERATION_LOGS"]).map(|()| {
        let entries: Vec<rbac::LogEntry> = {
            let rbac = crate::lock(&inner.rbac);
            rbac.logs
                .iter()
                .rev()
                .filter(|entry| entry.community_id == community_id)
                .filter(|entry| action.as_deref().is_none_or(|a| entry.action == a))
                .cloned()
                .collect()
        };
        let total = entries.len();
        let logs: Vec<Value> = entries
            .iter()
            .skip(offset)
            .take(limit)
            .map(|entry| {
                json!({
                    "id": entry.id,
                    "communityId": entry.community_id,
                    "moderatorId": entry.moderator_id,
                    "action": entry.action,
                    "targetUserId": entry.target_user_id,
                    "reason": entry.reason,
                    "metadata": entry.metadata,
                    "createdAt": entry.created_at,
                    "moderator": moderation_user(&inner, &entry.moderator_id),
                    "targetUser": entry
                        .target_user_id
                        .as_deref()
                        .map_or(Value::Null, |id| moderation_user(&inner, id)),
                })
            })
            .collect();
        json_response(StatusCode::OK, json!({ "logs": logs, "total": total }))
    });
    w5_reply(&inner, result)
}
