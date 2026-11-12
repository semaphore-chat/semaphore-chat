//! W7-A's routes: `GET /api/gifs/featured` and `GET /api/gifs/search`. State lives in
//! `crate::gifs`.
//!
//! Both are behind the bearer gate the middleware applies to every non-public operation
//! (`JwtAuthGuard` on the backend's `GifsController`). `limit` is the query DTO's: 1 to 50,
//! default 20, else `400 VALIDATION_FAILED`; `pos` is an opaque offset. With the
//! `gifs_unavailable` control on, both answer the provider's 503.

use super::json_response;
use crate::{Inner, lock};
use axum::Router;
use axum::extract::{Query, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::get;
use std::collections::HashMap;
use std::sync::Arc;

/// The backend's `DEFAULT_GIF_LIMIT`.
const DEFAULT_LIMIT: usize = 20;
/// The backend's `MAX_GIF_LIMIT`.
const MAX_LIMIT: i64 = 50;
/// The provider's message when no API key is configured (`giphy.provider.ts`).
const NOT_CONFIGURED: &str =
    "GIF search is not configured on this instance. Set GIPHY_API_KEY in .env";

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/gifs/featured", get(featured))
        .route("/api/gifs/search", get(search))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/gifs/featured") => "GifsController_featured",
        ("GET", "/api/gifs/search") => "GifsController_search",
        _ => return None,
    })
}

async fn featured(
    State(inner): State<Arc<Inner>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    answer(&inner, None, &query)
}

async fn search(
    State(inner): State<Arc<Inner>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    answer(
        &inner,
        Some(query.get("q").map(String::as_str).unwrap_or_default()),
        &query,
    )
}

/// `limit`, as the query DTO validates it.
fn limit_of(inner: &Inner, query: &HashMap<String, String>) -> Result<usize, Response> {
    match query.get("limit") {
        None => Ok(DEFAULT_LIMIT),
        Some(raw) => match raw.parse::<i64>() {
            Ok(limit) if limit < 1 => Err(inner.error(
                400,
                "VALIDATION_FAILED",
                "limit must not be less than 1",
                false,
            )),
            Ok(limit) if limit > MAX_LIMIT => Err(inner.error(
                400,
                "VALIDATION_FAILED",
                "limit must not be greater than 50",
                false,
            )),
            Ok(limit) => Ok(limit as usize),
            Err(_) => Err(inner.error(
                400,
                "VALIDATION_FAILED",
                "limit must be an integer number",
                false,
            )),
        },
    }
}

fn answer(inner: &Inner, q: Option<&str>, query: &HashMap<String, String>) -> Response {
    let limit = match limit_of(inner, query) {
        Ok(limit) => limit,
        Err(response) => return response,
    };
    let mut gifs = lock(&inner.gifs);
    gifs.seed(inner);
    if gifs.unavailable {
        return inner.error(503, "UNAVAILABLE", NOT_CONFIGURED, false);
    }
    let page = gifs.page(inner, q, limit, query.get("pos").map(String::as_str));
    json_response(
        StatusCode::OK,
        serde_json::to_value(page).expect("a response serializes"),
    )
}
