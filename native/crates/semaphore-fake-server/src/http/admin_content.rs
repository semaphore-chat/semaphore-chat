//! W6-D's routes: every community with stats and force delete (instance invites stay W5-A's
//! routes). State lives in `crate::w6::content`.
//!
//! Each handler keeps the backend's order: `ParseUUIDPipe` on the path id (a scenario's ids pass),
//! the RBAC guard (`crate::w6::allows` with the controller's instance action, before any lock),
//! then the service's checks and messages (`backend/src/community/community.controller.ts`,
//! `community.service.ts`).

use super::{bearer_token, json_response};
use crate::w6::content;
use crate::{Inner, lock};
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use semaphore_wire::types as wire;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/community/admin/list", get(list))
        .route(
            "/api/community/admin/{id}",
            get(find_one).delete(force_remove),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/community/admin/list") => "CommunityController_findAllWithStats",
        ("GET", "/api/community/admin/{id}") => "CommunityController_findOneWithStats",
        ("DELETE", "/api/community/admin/{id}") => "CommunityController_forceRemove",
        _ => return None,
    })
}

// ----- shared ---------------------------------------------------------------------------------

fn me(inner: &Inner, headers: &HeaderMap) -> String {
    inner.user_of(bearer_token(headers))
}

/// `RbacGuard`: the instance action, or the answer it gives.
fn allows(inner: &Inner, user: &str, action: &str) -> Result<(), Response> {
    if crate::w6::allows(inner, user, action) {
        Ok(())
    } else {
        Err(inner.error(403, "FORBIDDEN", "Forbidden resource", false))
    }
}

fn not_found(inner: &Inner, message: &str) -> Response {
    inner.error(404, "NOT_FOUND", message, false)
}

/// `ParseUUIDPipe`: a scenario's own ids (`known`) pass as well.
fn check_uuid(inner: &Inner, id: &str, known: bool) -> Result<(), Response> {
    if crate::social::valid_id(id, known) {
        Ok(())
    } else {
        Err(super::dms::bad_id(inner, "uuid"))
    }
}

fn ok(value: impl serde::Serialize) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(value).expect("a response serializes"),
    )
}

// ----- handlers -------------------------------------------------------------------------------

async fn list(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user, "READ_ALL_COMMUNITIES") {
        return response;
    }
    // `DefaultValuePipe(50)` then `clampLimit(limit, 100)`.
    let limit = match query.get("limit") {
        Some(raw) => match raw.parse::<i64>() {
            Ok(limit) => limit,
            Err(_) => {
                return inner.error(
                    400,
                    "VALIDATION_FAILED",
                    "Validation failed (numeric string is expected)",
                    false,
                );
            }
        },
        None => 50,
    }
    .clamp(1, 100) as usize;
    let search = query
        .get("search")
        .filter(|search| !search.is_empty())
        .map(|search| search.to_lowercase());
    let mut rows: Vec<_> = content::list(&inner)
        .into_iter()
        .filter(|row| {
            search
                .as_ref()
                .is_none_or(|search| row.name.to_lowercase().contains(search))
        })
        .collect();
    // `cursor: { id: continuationToken }, skip: 1`: the page after the last id of the previous one.
    let start = query
        .get("continuationToken")
        .and_then(|token| rows.iter().position(|row| row.id == *token))
        .map_or(0, |index| index + 1)
        .min(rows.len());
    let end = start.saturating_add(limit).min(rows.len());
    let more = end < rows.len();
    let page: Vec<_> = rows.drain(start..end).collect();
    let continuation_token = more
        .then(|| page.last().map(|row| row.id.clone()))
        .flatten();
    ok(wire::CommunityStatsListResponseDto {
        communities: page,
        continuation_token,
    })
}

async fn find_one(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    let found = crate::admin::community(&inner, &id);
    if let Err(response) = check_uuid(&inner, &id, found.is_some()) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "READ_ALL_COMMUNITIES") {
        return response;
    }
    let Some(community) = found else {
        return not_found(&inner, "Community not found");
    };
    ok(content::detail(&inner, &community))
}

async fn force_remove(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    let found = crate::admin::community(&inner, &id);
    if let Err(response) = check_uuid(&inner, &id, found.is_some()) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "DELETE_COMMUNITY") {
        return response;
    }
    if found.is_none() {
        return not_found(&inner, "Community not found");
    }
    // Told before it goes, while the room still has them (W5-A's `delete_community`).
    inner.emit_to_users(
        &crate::admin::member_ids(&inner, &id),
        "communityDeleted",
        json!({ "communityId": id }),
    );
    let mut admin = lock(&inner.admin);
    admin.communities.remove(&id);
    admin.deleted.insert(id.clone());
    admin.alias_groups.retain(|group| group.community_id != id);
    admin.invites.iter_mut().for_each(|invite| {
        invite
            .default_communities
            .retain(|community| community.community_id != id)
    });
    StatusCode::NO_CONTENT.into_response()
}
