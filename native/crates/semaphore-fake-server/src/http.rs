//! The REST surface: axum routes, the bearer gate, fault injection and recording.

// Axum error responses are themselves `Response`s; boxing them for every small
// parse helper would only make the handlers harder to read.
#![allow(clippy::result_large_err)]

use crate::messages::{self, SendBody, SendFailure, SendTarget};
use crate::{Inner, error_body, lock, png};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{MatchedPath, Path, Query, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use semaphore_wire::enums::ChannelType;
use semaphore_wire::types::{
    AnchoredMessagesResponseDto, ChannelCapabilitiesDto, CommunityChannelCapabilitiesDto,
    CommunityResponseDto, ConnectionInfoResponseDto, CreateTokenDto, LoginRequestDto,
    PaginatedMessagesResponseDto, RefreshRequestDto, TokenResponseDto,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

pub(crate) fn router(inner: Arc<Inner>) -> Router {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/logout", post(logout))
        .route("/api/users/profile", get(profile))
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
        .route("/api/read-receipts/mark-read", post(mark_read))
        .route("/api/messages", post(create_message))
        .route("/api/messages/dm", post(create_direct_message))
        .route(
            "/api/messages/channel/{channelId}",
            get(messages_for_channel),
        )
        .route(
            "/api/messages/channel/{channelId}/around/{messageId}",
            get(messages_around),
        )
        .route("/api/messages/group/{groupId}", get(messages_for_group))
        .route(
            "/api/messages/reactions",
            post(add_reaction).delete(remove_reaction),
        )
        .route(
            "/api/membership/community/{communityId}/search",
            get(search_members),
        )
        .route(
            "/api/custom-emoji/community/{communityId}",
            get(list_emojis),
        )
        .route("/api/livekit/connection-info", get(connection_info))
        .route("/api/livekit/token", post(generate_token))
        .route(
            "/api/channels/{channelId}/voice-presence",
            get(voice_presence),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/join",
            post(voice_join),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/refresh",
            post(voice_refresh),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/leave",
            post(voice_leave),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/deafen",
            post(voice_deafen),
        )
        .route("/api/file/{id}", get(get_file))
        .route("/api/file/{id}/thumbnail", get(get_file_thumbnail))
        .route("/socket.io/", any(crate::socket::socket_io))
        .route("/__control/{name}", post(control))
        .fallback(not_implemented)
        .layer(middleware::from_fn_with_state(inner.clone(), gate))
        .with_state(inner)
}

fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/auth/login") => "AuthController_login",
        ("POST", "/api/auth/refresh") => "AuthController_refresh",
        ("POST", "/api/auth/logout") => "AuthController_logout",
        ("GET", "/api/users/profile") => "UserController_getProfile",
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
        ("POST", "/api/read-receipts/mark-read") => "ReadReceiptsController_markAsRead",
        ("GET", "/api/messages/channel/{channelId}") => "MessagesController_findAllForChannel",
        ("GET", "/api/messages/channel/{channelId}/around/{messageId}") => {
            "MessagesController_findAroundForChannel"
        }
        ("GET", "/api/messages/group/{groupId}") => "MessagesController_findAllForGroup",
        ("POST", "/api/messages") => "MessagesController_create",
        ("POST", "/api/messages/dm") => "MessagesController_createDirectMessage",
        ("POST", "/api/messages/reactions") => "MessagesController_addReaction",
        ("DELETE", "/api/messages/reactions") => "MessagesController_removeReaction",
        ("GET", "/api/membership/community/{communityId}/search") => {
            "MembershipController_searchCommunityMembers"
        }
        ("GET", "/api/custom-emoji/community/{communityId}") => {
            "CustomEmojiController_listCommunityEmojis"
        }
        ("GET", "/api/livekit/connection-info") => "LivekitController_getConnectionInfo",
        ("POST", "/api/livekit/token") => "LivekitController_generateToken",
        ("GET", "/api/channels/{channelId}/voice-presence") => {
            "VoicePresenceController_getChannelPresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/join") => {
            "VoicePresenceController_joinPresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/refresh") => {
            "VoicePresenceController_refreshPresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/leave") => {
            "VoicePresenceController_leavePresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/deafen") => {
            "VoicePresenceController_updateDeafenState"
        }
        ("GET", "/api/file/{id}") => "FileController_getFile",
        ("GET", "/api/file/{id}/thumbnail") => "FileController_getFileThumbnail",
        _ => return None,
    })
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

    if operation.is_some()
        && operation != Some("AuthController_login")
        && operation != Some("AuthController_refresh")
        && !has_bearer(request.headers())
    {
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
        && operation != Some("AuthController_login")
        && operation != Some("AuthController_refresh")
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
    messages::page_params(query).map_err(|failure| failure_response(&failure))
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

async fn login(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<LoginRequestDto>(&body) else {
        return invalid("username and password are required");
    };
    if dto.password == "wrong" {
        return inner.error(
            401,
            "UNAUTHENTICATED",
            "Invalid username or password",
            false,
        );
    }
    json_response(
        StatusCode::OK,
        json!({
            "accessToken": inner.current_access_token(),
            "refreshToken": "fake-refresh-token",
        }),
    )
}

async fn refresh(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    if !body.is_empty() && typed::<RefreshRequestDto>(&body).is_err() {
        return invalid("The request body does not match the contract");
    }
    json_response(
        StatusCode::OK,
        json!({
            "accessToken": inner.current_access_token(),
            "refreshToken": "fake-refresh-token",
        }),
    )
}

async fn logout(State(_inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::CREATED, json!({ "message": "Logged out" }))
}

async fn profile(State(inner): State<Arc<Inner>>) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(&inner.scenario.me).expect("a user serializes"),
    )
}

async fn communities_mine(State(inner): State<Arc<Inner>>) -> Response {
    let communities: Vec<Value> = inner
        .scenario
        .communities
        .iter()
        .map(|community| {
            serde_json::to_value(CommunityResponseDto {
                avatar: community.avatar.clone(),
                banner: community.banner.clone(),
                created_at: community.created_at,
                description: community.description.clone(),
                id: community.id.clone(),
                name: community.name.clone(),
            })
            .expect("a community serializes")
        })
        .collect();
    json_response(StatusCode::OK, Value::Array(communities))
}

async fn channels_for_community(
    State(inner): State<Arc<Inner>>,
    Path(community_id): Path<String>,
) -> Response {
    let Some(community) = inner.scenario.community(&community_id) else {
        return inner.error(404, "NOT_FOUND", "Community not found", false);
    };
    let channels: Vec<Value> = community
        .channels
        .iter()
        .map(|channel| serde_json::to_value(channel).expect("a channel serializes"))
        .collect();
    json_response(StatusCode::OK, Value::Array(channels))
}

async fn mentionable_channels(
    State(inner): State<Arc<Inner>>,
    Path(community_id): Path<String>,
) -> Response {
    let Some(community) = inner.scenario.community(&community_id) else {
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
    Path(community_id): Path<String>,
) -> Response {
    let Some(community) = inner.scenario.community(&community_id) else {
        return inner.error(404, "NOT_FOUND", "Community not found", false);
    };
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
            timed_out_until: None,
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

async fn messages_for_channel(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (limit, token, direction) = match page_query(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let source = data
        .channel_messages
        .get(&channel_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let (messages, next) = messages::page(source, limit, token.as_deref(), &direction);
    let body = PaginatedMessagesResponseDto {
        continuation_token: next,
        messages,
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(body).expect("a page serializes"),
    )
}

async fn messages_for_group(
    State(inner): State<Arc<Inner>>,
    Path(group_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (limit, token, direction) = match page_query(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let source = data
        .dm_messages
        .get(&group_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let (messages, next) = messages::page(source, limit, token.as_deref(), &direction);
    let body = PaginatedMessagesResponseDto {
        continuation_token: next,
        messages,
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(body).expect("a page serializes"),
    )
}

async fn messages_around(
    State(inner): State<Arc<Inner>>,
    Path((channel_id, message_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let limit = match limit_query(&query) {
        Ok(limit) => limit,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let source = data
        .channel_messages
        .get(&channel_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let Some((messages, older, newer)) = messages::around(source, &message_id, limit) else {
        return inner.error(404, "NOT_FOUND", "Message not found", false);
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(AnchoredMessagesResponseDto {
            messages,
            newer_continuation_token: newer,
            older_continuation_token: older,
        })
        .expect("an anchored page serializes"),
    )
}

async fn create_message(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(send) = typed::<SendBody>(&body) else {
        return invalid("The request body does not match the contract");
    };
    let Some(channel_id) = send.channel_id.clone() else {
        return inner.error(
            400,
            "MESSAGE_TARGET_INVALID",
            "channelId is required for channel messages",
            false,
        );
    };
    let fault = inner.take_send_fault();
    match messages::send(&inner, SendTarget::Channel(channel_id), &send, fault) {
        Ok(message) => json_response(
            StatusCode::CREATED,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(failure) => failure_response(&failure),
    }
}

async fn create_direct_message(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(send) = typed::<SendBody>(&body) else {
        return invalid("The request body does not match the contract");
    };
    let Some(group_id) = send.direct_message_group_id.clone() else {
        return inner.error(
            400,
            "MESSAGE_TARGET_INVALID",
            "directMessageGroupId is required for direct messages",
            false,
        );
    };
    let fault = inner.take_send_fault();
    match messages::send(&inner, SendTarget::DirectMessage(group_id), &send, fault) {
        Ok(message) => json_response(
            StatusCode::CREATED,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(failure) => failure_response(&failure),
    }
}

fn reaction_body(body: &Bytes) -> Result<(String, String), Response> {
    let value = parse(body)?;
    let id = value
        .get("messageId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("messageId is required"))?;
    let emoji = value
        .get("emoji")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("emoji is required"))?;
    Ok((id.to_owned(), emoji.to_owned()))
}

async fn add_reaction(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let (id, emoji) = match reaction_body(&body) {
        Ok(parts) => parts,
        Err(response) => return response,
    };
    match messages::add_reaction(&inner, &id, &emoji) {
        Some(dto) => json_response(
            StatusCode::CREATED,
            serde_json::to_value(dto).expect("reactions serialize"),
        ),
        None => inner.error(404, "NOT_FOUND", "Message not found", false),
    }
}

async fn remove_reaction(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let (id, emoji) = match reaction_body(&body) {
        Ok(parts) => parts,
        Err(response) => return response,
    };
    match messages::remove_reaction(&inner, &id, &emoji) {
        Some(dto) => json_response(
            StatusCode::OK,
            serde_json::to_value(dto).expect("reactions serialize"),
        ),
        None => inner.error(404, "NOT_FOUND", "Message not found", false),
    }
}

async fn mark_read(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(value) = parse(&body) else {
        return invalid("The request body is not valid JSON");
    };
    let Some(last_read) = value.get("lastReadMessageId").and_then(Value::as_str) else {
        return invalid("lastReadMessageId is required");
    };
    let channel = value.get("channelId").and_then(Value::as_str);
    let group = value.get("directMessageGroupId").and_then(Value::as_str);
    json_response(
        StatusCode::OK,
        messages::mark_read(&inner, channel, group, last_read),
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

async fn list_emojis(State(_inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::OK, Value::Array(Vec::new()))
}

async fn connection_info(State(_inner): State<Arc<Inner>>) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(ConnectionInfoResponseDto {
            url: Some("wss://fake-livekit.invalid".to_owned()),
        })
        .expect("connection info serializes"),
    )
}

async fn generate_token(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<CreateTokenDto>(&body) else {
        return invalid("identity and roomId are required");
    };
    let ttl = dto.ttl.map(|ttl| ttl.get()).unwrap_or(3600).min(3600);
    let expires_at = inner.now() + chrono::Duration::seconds(ttl as i64);
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(TokenResponseDto {
            expires_at: Some(expires_at),
            identity: dto.identity,
            room_id: dto.room_id,
            token: "fake-livekit-token".to_owned(),
            url: Some("wss://fake-livekit.invalid".to_owned()),
        })
        .expect("a token serializes"),
    )
}

async fn voice_presence(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
) -> Response {
    json_response(
        StatusCode::OK,
        messages::voice_presence(&inner, &channel_id),
    )
}

async fn voice_join(State(inner): State<Arc<Inner>>, Path(channel_id): Path<String>) -> Response {
    json_response(
        StatusCode::CREATED,
        messages::voice_join(&inner, &channel_id),
    )
}

async fn voice_refresh(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
) -> Response {
    json_response(
        StatusCode::CREATED,
        messages::voice_refresh(&inner, &channel_id),
    )
}

async fn voice_leave(State(inner): State<Arc<Inner>>, Path(channel_id): Path<String>) -> Response {
    json_response(
        StatusCode::CREATED,
        messages::voice_leave(&inner, &channel_id),
    )
}

async fn voice_deafen(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(dto) = typed::<semaphore_wire::types::UpdateDeafenStateDto>(&body) else {
        return invalid("isDeafened is required");
    };
    json_response(
        StatusCode::CREATED,
        messages::voice_deafen(&inner, &channel_id, dto.is_deafened),
    )
}

fn image_response(id: &str, variant: &str) -> Response {
    let bytes = png::png_for(&format!("{variant}:{id}"));
    let mut response = Response::new(axum::body::Body::from(bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    response
}

async fn get_file(State(_inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    image_response(&id, "file")
}

async fn get_file_thumbnail(State(_inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    image_response(&id, "thumbnail")
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
            inner.broadcast(event, payload);
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
        "idle" => inner.idle().await,
        "requests" => {
            return json_response(StatusCode::OK, json!({ "requests": inner.requests() }));
        }
        _ => return invalid(&format!("Unknown control {name}")),
    }
    json_response(StatusCode::OK, json!({ "ok": true }))
}
