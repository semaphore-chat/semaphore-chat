//! The REST surface: axum routes, the bearer gate, fault injection and recording.
//!
//! Each area has its own file with its routes and their `operationId`s; they are merged here.

// Axum error responses are themselves `Response`s; boxing them for every small
// parse helper would only make the handlers harder to read.
#![allow(clippy::result_large_err)]

mod account;
mod admin_content;
mod admin_storage;
mod admin_users;
mod communities;
mod community_admin;
mod dms;
mod files;
mod gifs;
mod instance_admin;
mod instance_roles;
mod messages;
mod moderation;
mod notify;
mod onboarding;
mod receipts;
mod replay;
mod roles;
mod search;
mod session;
mod social;
mod soundboard;
mod threads;
mod voice;

use crate::messages::SendFailure;
use crate::{Inner, error_body, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{MatchedPath, Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, post};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

pub(crate) use soundboard::{seed_files as seed_sound_files, sound_ids};

pub(crate) fn router(inner: Arc<Inner>) -> Router {
    Router::new()
        .merge(session::routes())
        .merge(communities::routes())
        .merge(messages::routes())
        .merge(voice::routes())
        .merge(files::routes())
        .merge(moderation::routes())
        .merge(threads::routes())
        .merge(search::routes())
        .merge(dms::routes())
        .merge(social::routes())
        .merge(notify::routes())
        .merge(account::routes())
        .merge(onboarding::routes())
        .merge(receipts::routes())
        .merge(replay::routes())
        .merge(soundboard::routes())
        .merge(community_admin::routes())
        .merge(roles::routes())
        // W6 and W7.
        .merge(instance_admin::routes())
        .merge(admin_users::routes())
        .merge(admin_storage::routes())
        .merge(admin_content::routes())
        .merge(instance_roles::routes())
        .merge(gifs::routes())
        .route("/socket.io/", any(crate::socket::socket_io))
        .route("/__control/{name}", post(control))
        .fallback(not_implemented)
        .layer(middleware::from_fn_with_state(inner.clone(), gate))
        .with_state(inner)
}

fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    session::operation_id(method, route)
        .or_else(|| communities::operation_id(method, route))
        .or_else(|| messages::operation_id(method, route))
        .or_else(|| voice::operation_id(method, route))
        .or_else(|| files::operation_id(method, route))
        .or_else(|| moderation::operation_id(method, route))
        .or_else(|| threads::operation_id(method, route))
        .or_else(|| search::operation_id(method, route))
        .or_else(|| dms::operation_id(method, route))
        .or_else(|| social::operation_id(method, route))
        .or_else(|| notify::operation_id(method, route))
        .or_else(|| account::operation_id(method, route))
        .or_else(|| onboarding::operation_id(method, route))
        .or_else(|| receipts::operation_id(method, route))
        .or_else(|| replay::operation_id(method, route))
        .or_else(|| soundboard::operation_id(method, route))
        .or_else(|| community_admin::operation_id(method, route))
        .or_else(|| roles::operation_id(method, route))
        .or_else(|| instance_admin::operation_id(method, route))
        .or_else(|| admin_users::operation_id(method, route))
        .or_else(|| admin_storage::operation_id(method, route))
        .or_else(|| admin_content::operation_id(method, route))
        .or_else(|| instance_roles::operation_id(method, route))
        .or_else(|| gifs::operation_id(method, route))
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
}

fn has_bearer(headers: &HeaderMap) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| !token.trim().is_empty())
        .unwrap_or(false)
}

/// Routes that answer without a session.
fn is_public(operation: Option<&str>) -> bool {
    matches!(
        operation,
        Some(
            "AuthController_login"
                | "AuthController_refresh"
                | "AuthController_redeemDesktopLogin"
                | "AuthController_forgotPassword"
                | "AuthController_resetPassword"
                | "UserController_register"
                | "InviteController_getPublicInvite"
                | "OnboardingController_getStatus"
                | "InstanceController_getPublicSettings"
                | "Fixture_image"
        )
    )
}

async fn gate(State(inner): State<Arc<Inner>>, request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let matched = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned());
    let operation = matched
        .as_deref()
        .and_then(|route| operation_id(&method, route));

    if let Some(fault) = inner.take_route_fault(operation) {
        let response = inner.error(
            fault.status,
            &fault.code,
            format!(
                "Injected {} for {}",
                fault.code,
                operation.unwrap_or(path.as_str())
            ),
            false,
        );
        inner.record_http(
            method.as_str(),
            &path,
            operation,
            response.status().as_u16(),
        );
        return response;
    }

    if operation.is_some() && !is_public(operation) && !has_bearer(request.headers()) {
        let response = inner.error(401, "UNAUTHENTICATED", "Missing bearer token", false);
        inner.record_http(
            method.as_str(),
            &path,
            operation,
            response.status().as_u16(),
        );
        return response;
    }

    if operation.is_some()
        && !is_public(operation)
        && let Some(required) = inner.required_access_token()
        && bearer_token(request.headers()) != Some(required.as_str())
    {
        let response = inner.error(401, "UNAUTHENTICATED", "Access token expired", false);
        inner.record_http(
            method.as_str(),
            &path,
            operation,
            response.status().as_u16(),
        );
        return response;
    }

    // A session that was revoked: its tokens fail, as the backend's blacklist makes them.
    if operation.is_some()
        && !is_public(operation)
        && let Some(token) = bearer_token(request.headers())
        && inner.token_revoked(token)
    {
        let response = inner.error(401, "UNAUTHENTICATED", "Session revoked", false);
        inner.record_http(
            method.as_str(),
            &path,
            operation,
            response.status().as_u16(),
        );
        return response;
    }

    // A route held to make a loading state observable, before the handler runs and so before the
    // request is recorded as answered.
    if let Some(delay) = inner.route_delay(operation) {
        tokio::time::sleep(delay).await;
    }

    // The idle control waits for every request to finish; the control request
    // itself must not count, or it would wait for itself.
    let tracked = !path.starts_with("/__control/");
    if tracked {
        inner.begin();
    }
    let response = next.run(request).await;
    if tracked {
        inner.end();
    }
    inner.record_http(
        method.as_str(),
        &path,
        operation,
        response.status().as_u16(),
    );
    response
}

async fn not_implemented(method: Method, uri: Uri) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        axum::Json(error_body(
            501,
            "UNKNOWN",
            format!("No fake route for {} {}", method, uri.path()),
            false,
            None,
        )),
    )
        .into_response()
}

fn invalid(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        axum::Json(error_body(
            400,
            "VALIDATION_FAILED",
            message.to_owned(),
            false,
            None,
        )),
    )
        .into_response()
}

fn parse(bytes: &Bytes) -> Result<Value, Response> {
    serde_json::from_slice(bytes).map_err(|_| invalid("The request body is not valid JSON"))
}

fn typed<T: DeserializeOwned>(bytes: &Bytes) -> Result<T, Response> {
    serde_json::from_slice(bytes)
        .map_err(|_| invalid("The request body does not match the contract"))
}

fn json_response(status: StatusCode, body: Value) -> Response {
    (status, axum::Json(body)).into_response()
}

fn page_query(
    query: &HashMap<String, String>,
) -> Result<(usize, Option<String>, String), Response> {
    crate::messages::page_params(query).map_err(|failure| failure_response(&failure))
}

fn limit_query(query: &HashMap<String, String>) -> Result<usize, Response> {
    let limit = match query.get("limit") {
        Some(raw) => raw
            .parse::<usize>()
            .map_err(|_| invalid("limit must be an integer"))?,
        None => 50,
    };
    Ok(limit.min(100))
}

fn failure_response(failure: &SendFailure) -> Response {
    (
        StatusCode::from_u16(failure.status).unwrap_or(StatusCode::BAD_REQUEST),
        axum::Json(error_body(
            failure.status,
            &failure.code,
            failure.message.clone(),
            failure.retryable,
            failure.retry_after_ms,
        )),
    )
        .into_response()
}

async fn control(
    State(inner): State<Arc<Inner>>,
    Path(name): Path<String>,
    body: Bytes,
) -> Response {
    let request: Value = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(_) => return invalid("The control body is not valid JSON"),
        }
    };
    match name.as_str() {
        "emit" => {
            let Some(event) = request.get("event").and_then(Value::as_str) else {
                return invalid("event is required");
            };
            let payload = request.get("payload").cloned().unwrap_or(Value::Null);
            // With a `userId`, only that user's sockets hear it; otherwise every socket.
            match request.get("userId").and_then(Value::as_str) {
                Some(user) => inner.emit_to_user(user, event, payload),
                None => inner.broadcast(event, payload),
            }
        }
        "post_as" | "post_dm_as" => {
            let field = |name: &str| request.get(name).and_then(Value::as_str);
            let target_field = if name == "post_as" {
                "channelId"
            } else {
                "dmGroupId"
            };
            let (Some(target), Some(author), Some(text)) =
                (field(target_field), field("authorId"), field("text"))
            else {
                return invalid(&format!("{target_field}, authorId and text are required"));
            };
            if inner.scenario.user(author).is_none() {
                return invalid("authorId is not a user of the scenario");
            }
            let target = if name == "post_as" {
                crate::messages::PostTarget::Channel(target)
            } else {
                if crate::social::dm_member_ids(&lock(&inner.data), target).is_none() {
                    return invalid("dmGroupId is not a DM of the scenario");
                }
                crate::messages::PostTarget::DirectMessage(target)
            };
            let broadcast = request
                .get("broadcast")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let mention = match field("mentionUserId") {
                Some(user_id) => match inner.scenario.user(user_id) {
                    Some(user) => Some((user.id.clone(), user.username.clone())),
                    None => return invalid("mentionUserId is not a user of the scenario"),
                },
                None => None,
            };
            let extras = crate::messages::PostExtras {
                emoji: request
                    .get("emoji")
                    .and_then(|emoji| {
                        Some((emoji.get("id")?.as_str()?, emoji.get("name")?.as_str()?))
                    })
                    .map(|(id, name)| (id.to_owned(), name.to_owned())),
                link_preview: request.get("linkPreview").cloned(),
                mention,
                ..Default::default()
            };
            let message = crate::messages::post_as(&inner, target, author, text, broadcast, extras);
            return json_response(StatusCode::OK, json!({ "id": message.id }));
        }
        // W9: another user joins or leaves a voice channel's presence, as their own client's
        // join and leave would (the same presence row, event and audience).
        "voice_join_as" | "voice_leave_as" => {
            let field = |key: &str| request.get(key).and_then(Value::as_str);
            let (Some(channel), Some(user_id)) = (field("channelId"), field("userId")) else {
                return invalid("channelId and userId are required");
            };
            let Some(user) = inner.user_entity(user_id) else {
                return invalid("userId is not a user");
            };
            let result = if name == "voice_join_as" {
                crate::messages::voice_join_as(&inner, channel, &user)
            } else {
                crate::messages::voice_leave_as(&inner, channel, &user.id)
            };
            return json_response(StatusCode::OK, result);
        }
        "friend_request_as" => {
            let Some(from) = request.get("fromId").and_then(Value::as_str) else {
                return invalid("fromId is required");
            };
            let id = request.get("id").and_then(Value::as_str);
            return match crate::social::friend_request_as(&inner, from, id) {
                Ok(id) => json_response(StatusCode::OK, json!({ "id": id })),
                Err(message) => invalid(message),
            };
        }
        // W3's account hooks, as `Server::approve_desktop` and the rest do them for tests.
        "approve_desktop" => {
            let Some(challenge) = request.get("challenge").and_then(Value::as_str) else {
                return invalid("challenge is required");
            };
            let me = inner.scenario.me.id.clone();
            let code = lock(&inner.accounts).approve(challenge, &me, inner.now(), false);
            return json_response(StatusCode::OK, json!({ "code": code }));
        }
        "emit_desktop_sign_in" => {
            let me = inner.scenario.me.id.clone();
            let ip = request.get("ipAddress").and_then(Value::as_str);
            inner.emit_to_user(
                &me,
                "desktopSignIn",
                json!({ "ipAddress": ip, "signedInAt": inner.now() }),
            );
        }
        "seed_invite" => {
            let Some(code) = request.get("code").and_then(Value::as_str) else {
                return invalid("code is required");
            };
            let mut invite = crate::InviteSeed::new(code);
            if let Some(max) = request.get("maxUses").and_then(Value::as_i64) {
                invite.max_uses = Some(max);
            }
            invite.community_ids = request
                .get("communityIds")
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            lock(&inner.accounts).invites.push(crate::accounts::Invite {
                code: invite.code,
                uses: invite.uses,
                max_uses: invite.max_uses,
                valid_until: invite.valid_until,
                disabled: invite.disabled,
                created_by: invite.created_by,
                community_ids: invite.community_ids,
            });
        }
        // W3: a reset token for an account, as the mailer's link would carry. `email` picks a
        // registered account; without one, the scenario's own user. `expiresInSeconds` (negative
        // for an expired one) defaults to the backend's hour.
        "reset_token" => {
            use crate::accounts::PasswordReset;
            let token = request
                .get("token")
                .and_then(Value::as_str)
                .unwrap_or("fixture-reset-token");
            let email = request.get("email").and_then(Value::as_str);
            let seconds = request
                .get("expiresInSeconds")
                .and_then(Value::as_i64)
                .unwrap_or(3600);
            let user_id = {
                let accounts = lock(&inner.accounts);
                email
                    .and_then(|email| {
                        accounts
                            .credentials
                            .values()
                            .find(|credential| credential.email.as_deref() == Some(email))
                    })
                    .map(|credential| credential.user_id.clone())
                    .unwrap_or_else(|| inner.scenario.me.id.clone())
            };
            let expires_at = inner.now() + chrono::Duration::seconds(seconds);
            let mut accounts = lock(&inner.accounts);
            accounts
                .password_resets
                .retain(|reset| reset.token != token);
            accounts.password_resets.push(PasswordReset {
                token: token.to_owned(),
                user_id,
                expires_at,
                used: false,
            });
        }
        "add_session" => {
            let device = request
                .get("deviceName")
                .and_then(Value::as_str)
                .unwrap_or("Another device");
            let ip = request.get("ipAddress").and_then(Value::as_str);
            let me = inner.scenario.me.id.clone();
            let now = inner.now();
            let mut accounts = lock(&inner.accounts);
            let index = accounts.start_session(&me, Some(device), ip, now, None, false);
            // A script names the session it'll click on.
            if let Some(id) = request.get("id").and_then(Value::as_str) {
                accounts.sessions[index].id = id.to_owned();
            }
            let id = accounts.sessions[index].id.clone();
            return json_response(StatusCode::OK, json!({ "id": id }));
        }
        // W9: a read receipt a test plants for another user (or for me on another device). A DM's
        // is announced to the group, as `markReadAndAnnounce` does; a channel's stays private.
        "read_receipt" => {
            let field = |name: &str| request.get(name).and_then(Value::as_str);
            let Some(user) = field("userId") else {
                return invalid("userId is required");
            };
            let Some(context) = field("dmGroupId").or_else(|| field("channelId")) else {
                return invalid("dmGroupId or channelId is required");
            };
            let at = field("at")
                .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
                .map(|at| at.with_timezone(&chrono::Utc))
                .unwrap_or_else(|| inner.now());
            lock(&inner.data)
                .receipts
                .insert((context.to_owned(), user.to_owned()), at);
            if let Some(dm) = field("dmGroupId") {
                let members =
                    crate::social::dm_member_ids(&lock(&inner.data), dm).unwrap_or_default();
                inner.emit_to_users(
                    &members,
                    "readReceiptUpdated",
                    json!({
                        "channelId": null,
                        "directMessageGroupId": dm,
                        "userId": user,
                        "lastReadMessageId": field("messageId").unwrap_or_default(),
                        "lastReadAt": at,
                    }),
                );
            }
        }
        "onboarding" => {
            lock(&inner.accounts).needs_setup = request
                .get("needsSetup")
                .and_then(Value::as_bool)
                .unwrap_or(true);
        }
        "public_settings" => {
            let Some(fields) = request.as_object() else {
                return invalid("an object of public settings is required");
            };
            lock(&inner.accounts).public_settings.extend(
                fields
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone())),
            );
        }
        // W4: another user in a DM call, the replay buffer's egress, the clip library and
        // server mutes, as `FakeServer::dm_call_join` and the rest do them for tests.
        "dm_call_join" | "dm_call_leave" => {
            let field = |name: &str| request.get(name).and_then(Value::as_str);
            let (Some(group), Some(user)) = (field("dmGroupId"), field("userId")) else {
                return invalid("dmGroupId and userId are required");
            };
            let members = match crate::calls::dm_members_for(&inner, group, user) {
                Ok(members) => members,
                Err(_) => return invalid("userId is not a member of dmGroupId"),
            };
            if name == "dm_call_join" {
                crate::calls::dm_join(&inner, group, user, &members);
            } else {
                crate::calls::dm_leave(&inner, group, user, &members);
            }
        }
        "server_mute" => {
            let field = |name: &str| request.get(name).and_then(Value::as_str);
            let (Some(channel), Some(user)) = (field("channelId"), field("userId")) else {
                return invalid("channelId and userId are required");
            };
            let mute = request.get("mute").and_then(Value::as_bool).unwrap_or(true);
            crate::calls::set_server_muted(&inner, channel, user, mute);
        }
        "emit_segments_ready" => {
            let segments = request.get("segments").and_then(Value::as_u64).unwrap_or(6) as usize;
            if !crate::calls::segments_ready(&inner, segments) {
                return invalid("no replay buffer is running");
            }
        }
        "emit_replay_failed" | "emit_replay_stopped" => {
            let error = (name == "emit_replay_failed").then(|| {
                request
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Egress failed")
                    .to_owned()
            });
            if !crate::calls::end_replay(&inner, error) {
                return invalid("no replay buffer is running");
            }
        }
        "seed_clip" => {
            let clip = match crate::calls::seed_clip_from(&inner, &request) {
                Ok(clip) => clip,
                Err(message) => return invalid(message),
            };
            return json_response(StatusCode::OK, crate::calls::clip_json(&clip));
        }
        "join_failures" => {
            let reports = lock(&inner.calls).join_failures.clone();
            return json_response(StatusCode::OK, json!({ "reports": reports }));
        }
        "drop_connections" => {
            inner.close_connections();
        }
        "refuse_connections" => {
            lock(&inner.faults).refuse_connections = request
                .get("refuse")
                .and_then(Value::as_bool)
                .unwrap_or(true);
        }
        "delay_acks" => {
            let delay = request
                .get("ms")
                .and_then(Value::as_u64)
                .map(std::time::Duration::from_millis);
            lock(&inner.faults).delay_acks = delay;
        }
        "drop_acks" => {
            lock(&inner.faults).drop_acks =
                request.get("drop").and_then(Value::as_bool).unwrap_or(true);
        }
        "fail_next_send" => {
            let code = request
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("RATE_LIMITED");
            lock(&inner.faults).fail_next_send = Some(crate::SendFault {
                code: code.to_owned(),
                retryable: request
                    .get("retryable")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                retry_after_ms: request.get("retryAfterMs").and_then(Value::as_u64),
            });
        }
        "fail_route" => {
            let Some(operation) = request.get("operationId").and_then(Value::as_str) else {
                return invalid("operationId is required");
            };
            let status = request
                .get("status")
                .and_then(Value::as_u64)
                .unwrap_or(500)
                .min(599) as u16;
            let code = request
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("INTERNAL");
            inner.fail_route(operation, status, code);
        }
        "advance_clock" => {
            let millis = request.get("ms").and_then(Value::as_u64).unwrap_or(0);
            inner.advance_clock(std::time::Duration::from_millis(millis));
        }
        "delay_route" => {
            let Some(operation) = request.get("operationId").and_then(Value::as_str) else {
                return invalid("operationId is required");
            };
            let millis = request.get("ms").and_then(Value::as_u64).unwrap_or(0);
            if millis == 0 {
                lock(&inner.faults).delay_routes.remove(operation);
            } else {
                inner.delay_route(operation, std::time::Duration::from_millis(millis));
            }
        }
        "idle" => inner.idle().await,
        "requests" => {
            return json_response(StatusCode::OK, json!({ "requests": inner.requests() }));
        }
        // W5: each lane's own controls (W5-B's `act_as`, which changes the signed-in user's roles
        // for a test).
        other => {
            if let Some(response) = crate::admin::control(&inner, other, &request)
                .or_else(|| crate::rbac::control(&inner, other, &request))
                .or_else(|| moderation::control(&inner, other, &request))
                // W6 and W7: each lane's own controls.
                .or_else(|| crate::w6::instance::control(&inner, other, &request))
                .or_else(|| crate::w6::users::control(&inner, other, &request))
                .or_else(|| crate::w6::storage::control(&inner, other, &request))
                .or_else(|| crate::w6::content::control(&inner, other, &request))
                .or_else(|| crate::w6::roles::control(&inner, other, &request))
                .or_else(|| crate::gifs::control(&inner, other, &request))
            {
                return response;
            }
            return invalid(&format!("Unknown control {name}"));
        }
    }
    json_response(StatusCode::OK, json!({ "ok": true }))
}
