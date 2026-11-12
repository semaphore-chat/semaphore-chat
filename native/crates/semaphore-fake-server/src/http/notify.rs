//! Notifications (W2): the list, read, read-all and dismiss, the settings, and per-channel
//! overrides. As `backend/src/notifications`: the list is newest first and includes dismissed
//! rows; only reading one notification sends an event (`notificationRead`, to the user's
//! sockets); read-all, dismiss and override changes send nothing.

use super::dms::bad_id;
use super::{invalid, json_response, typed};
use crate::social::{self, notification_json, valid_id};
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use semaphore_wire::enums::{NotificationLevel, NotificationSoundType};
use semaphore_wire::types::{
    ChannelNotificationOverrideDto, UpdateChannelOverrideDto, UpdateNotificationSettingsDto,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/notifications", get(list))
        .route("/api/notifications/read-all", post(read_all))
        .route("/api/notifications/{id}/read", post(read))
        .route("/api/notifications/{id}/dismiss", post(dismiss))
        .route(
            "/api/notifications/settings",
            get(settings).put(update_settings),
        )
        .route(
            "/api/notifications/channels/{channelId}/override",
            get(get_override).put(set_override).delete(delete_override),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/notifications") => "NotificationsController_getNotifications",
        ("POST", "/api/notifications/read-all") => "NotificationsController_markAllAsRead",
        ("POST", "/api/notifications/{id}/read") => "NotificationsController_markAsRead",
        ("POST", "/api/notifications/{id}/dismiss") => {
            "NotificationsController_dismissNotification"
        }
        ("GET", "/api/notifications/settings") => "NotificationsController_getSettings",
        ("PUT", "/api/notifications/settings") => "NotificationsController_updateSettings",
        ("GET", "/api/notifications/channels/{channelId}/override") => {
            "NotificationsController_getChannelOverride"
        }
        ("PUT", "/api/notifications/channels/{channelId}/override") => {
            "NotificationsController_setChannelOverride"
        }
        ("DELETE", "/api/notifications/channels/{channelId}/override") => {
            "NotificationsController_deleteChannelOverride"
        }
        _ => return None,
    })
}

/// `NotificationQueryDto`: `limit` 1 to 100 (default 50), `offset` 0 or more, `unreadOnly`, which
/// the backend reads with `@Type(() => Boolean)`: any non-empty text is true, `"false"` included;
/// and `includeDismissed`, which only takes `true` or `false` (anything else is a 400) and
/// defaults to true.
fn query_params(query: &HashMap<String, String>) -> Result<(usize, usize, bool, bool), Response> {
    let number = |name: &str, min: i64, max: i64, default: i64| -> Result<usize, Response> {
        match query.get(name) {
            None => Ok(default as usize),
            Some(raw) => match raw.parse::<i64>() {
                Ok(value) if (min..=max).contains(&value) => Ok(value as usize),
                _ => Err(invalid(&format!(
                    "{name} must be a number from {min} to {max}"
                ))),
            },
        }
    };
    let limit = number("limit", 1, 100, 50)?;
    let offset = number("offset", 0, i64::MAX, 0)?;
    let unread_only = query.get("unreadOnly").is_some_and(|raw| !raw.is_empty());
    let include_dismissed = match query.get("includeDismissed").map(String::as_str) {
        None | Some("true") => true,
        Some("false") => false,
        Some(_) => return Err(invalid("includeDismissed must be true or false")),
    };
    Ok((limit, offset, unread_only, include_dismissed))
}

/// Newest first; `total` is the size of the page (the backend's `notifications.length`), and
/// `unreadCount` counts every unread row of the user, dismissed ones too.
async fn list(
    State(inner): State<Arc<Inner>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (limit, offset, unread_only, include_dismissed) = match query_params(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let me = &inner.scenario.me.id;
    let data = lock(&inner.data);
    let mut rows: Vec<_> = data
        .social
        .notifications
        .iter()
        .rev()
        .filter(|row| &row.user_id == me && (include_dismissed || !row.dismissed))
        .filter(|row| !unread_only || !row.read)
        .collect();
    rows.sort_by_key(|row| std::cmp::Reverse(row.created_at));
    let page: Vec<Value> = rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|row| notification_json(&inner, row, true))
        .collect();
    json_response(
        StatusCode::OK,
        json!({
            "total": page.len(),
            "unreadCount": social::unread_count(&data, me),
            "notifications": page,
        }),
    )
}

/// The owner's notification `id`, checked as the backend's `findFirst({ id, userId })` does.
fn find_mine(inner: &Inner, data: &crate::Data, id: &str) -> Option<usize> {
    data.social
        .notifications
        .iter()
        .position(|row| row.id == id && row.user_id == inner.scenario.me.id)
}

fn notification_known(inner: &Inner, id: &str) -> bool {
    find_mine(inner, &lock(&inner.data), id).is_some()
}

async fn read(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    if !valid_id(&id, notification_known(&inner, &id)) {
        return bad_id(&inner, "a UUID");
    }
    let mut data = lock(&inner.data);
    let Some(index) = find_mine(&inner, &data, &id) else {
        drop(data);
        return inner.error(404, "NOT_FOUND", "Notification not found", false);
    };
    data.social.notifications[index].read = true;
    let body = notification_json(&inner, &data.social.notifications[index], false);
    drop(data);
    inner.emit_to_user(
        &inner.scenario.me.id,
        "notificationRead",
        json!({ "notificationId": id }),
    );
    json_response(StatusCode::OK, body)
}

/// `markAllAsRead`: `count` is how many it changed.
async fn read_all(State(inner): State<Arc<Inner>>) -> Response {
    let me = &inner.scenario.me.id;
    let mut data = lock(&inner.data);
    let mut count = 0;
    for row in &mut data.social.notifications {
        if &row.user_id == me && !row.read {
            row.read = true;
            count += 1;
        }
    }
    json_response(StatusCode::OK, json!({ "count": count }))
}

/// Dismissing sets only `dismissed`; the row stays in the list, read or not.
async fn dismiss(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    if !valid_id(&id, notification_known(&inner, &id)) {
        return bad_id(&inner, "a UUID");
    }
    let mut data = lock(&inner.data);
    let Some(index) = find_mine(&inner, &data, &id) else {
        drop(data);
        return inner.error(404, "NOT_FOUND", "Notification not found", false);
    };
    data.social.notifications[index].dismissed = true;
    json_response(
        StatusCode::OK,
        notification_json(&inner, &data.social.notifications[index], false),
    )
}

async fn settings(State(inner): State<Arc<Inner>>) -> Response {
    let now = inner.now();
    let mut data = lock(&inner.data);
    let row = data.social.settings_for(&inner.scenario.me.id, now).clone();
    json_response(
        StatusCode::OK,
        serde_json::to_value(row).expect("settings serialize"),
    )
}

/// `updateUserSettings`: only the fields the body names change.
async fn update_settings(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<UpdateNotificationSettingsDto>(&body) else {
        return invalid("The settings do not match the contract");
    };
    // The enums keep any text they are sent; the backend's `@IsIn` refuses an unknown one.
    if dto
        .default_channel_level
        .as_ref()
        .is_some_and(|level| matches!(level, NotificationLevel::Unknown(_)))
        || dto
            .sound_type
            .as_ref()
            .is_some_and(|sound| matches!(sound, NotificationSoundType::Unknown(_)))
    {
        return invalid("defaultChannelLevel or soundType is not one of the allowed values");
    }
    // An explicit `null` clears a nullable field: `@IsOptional` lets it through and Prisma writes it.
    let raw: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let cleared = |name: &str| raw.get(name).is_some_and(Value::is_null);
    let now = inner.now();
    let mut data = lock(&inner.data);
    let row = data.social.settings_for(&inner.scenario.me.id, now);
    for (name, field) in [
        ("dndStartTime", &mut row.dnd_start_time),
        ("dndEndTime", &mut row.dnd_end_time),
        ("dndTimezone", &mut row.dnd_timezone),
    ] {
        if cleared(name) {
            *field = None;
        }
    }
    if let Some(level) = dto.default_channel_level {
        row.default_channel_level = level.as_str().into_owned();
    }
    if let Some(value) = dto.desktop_enabled {
        row.desktop_enabled = value;
    }
    if let Some(value) = dto.dm_notifications {
        row.dm_notifications = value;
    }
    if let Some(value) = dto.dnd_end_time {
        row.dnd_end_time = Some(value.into());
    }
    if let Some(value) = dto.dnd_start_time {
        row.dnd_start_time = Some(value.into());
    }
    if let Some(value) = dto.dnd_timezone {
        row.dnd_timezone = Some(value.into());
    }
    if let Some(value) = dto.do_not_disturb {
        row.do_not_disturb = value;
    }
    if let Some(value) = dto.play_sound {
        row.play_sound = value;
    }
    if let Some(sound) = dto.sound_type {
        row.sound_type = sound.as_str().into_owned();
    }
    row.updated_at = now;
    json_response(
        StatusCode::OK,
        serde_json::to_value(&*row).expect("settings serialize"),
    )
}

fn channel_known(inner: &Inner, id: &str) -> bool {
    inner.scenario.channel(id).is_some()
}

/// The override, or `200` with an empty body when there is none (the backend returns `null`).
async fn get_override(State(inner): State<Arc<Inner>>, Path(channel_id): Path<String>) -> Response {
    if !valid_id(&channel_id, channel_known(&inner, &channel_id)) {
        return bad_id(&inner, "a UUID");
    }
    let me = &inner.scenario.me.id;
    let data = lock(&inner.data);
    match data
        .social
        .overrides
        .iter()
        .find(|row| &row.user_id == me && row.channel_id == channel_id)
    {
        Some(row) => json_response(
            StatusCode::OK,
            serde_json::to_value(row).expect("an override serializes"),
        ),
        None => StatusCode::OK.into_response(),
    }
}

/// An upsert. A channel the scenario doesn't have is `404` (the backend's foreign key fails).
async fn set_override(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
    body: Bytes,
) -> Response {
    if !valid_id(&channel_id, channel_known(&inner, &channel_id)) {
        return bad_id(&inner, "a UUID");
    }
    let Ok(dto) = typed::<UpdateChannelOverrideDto>(&body) else {
        return invalid("level must be one of all, mentions, none");
    };
    if matches!(dto.level, NotificationLevel::Unknown(_)) {
        return invalid("level must be one of all, mentions, none");
    }
    if !channel_known(&inner, &channel_id) {
        return inner.error(404, "NOT_FOUND", "Channel not found", false);
    }
    let me = inner.scenario.me.id.clone();
    let now = inner.now();
    let level = dto.level.as_str().into_owned();
    let mut data = lock(&inner.data);
    let existing = data
        .social
        .overrides
        .iter()
        .position(|row| row.user_id == me && row.channel_id == channel_id);
    let row = match existing {
        Some(index) => {
            let row = &mut data.social.overrides[index];
            row.level = level;
            row.updated_at = now;
            row.clone()
        }
        None => {
            let row = ChannelNotificationOverrideDto {
                channel_id,
                created_at: now,
                id: data.social.new_id("override"),
                level,
                updated_at: now,
                user_id: me,
            };
            data.social.overrides.push(row.clone());
            row
        }
    };
    json_response(
        StatusCode::OK,
        serde_json::to_value(row).expect("an override serializes"),
    )
}

async fn delete_override(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
) -> Response {
    if !valid_id(&channel_id, channel_known(&inner, &channel_id)) {
        return bad_id(&inner, "a UUID");
    }
    let me = &inner.scenario.me.id;
    lock(&inner.data)
        .social
        .overrides
        .retain(|row| !(&row.user_id == me && row.channel_id == channel_id));
    StatusCode::NO_CONTENT.into_response()
}
