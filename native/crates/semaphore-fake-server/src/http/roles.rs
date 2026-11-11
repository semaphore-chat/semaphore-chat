//! W5-B's routes: community roles, assignment, channel overrides, and the W5 moderation calls
//! (ban, unban, timeouts, lists, the log; they go in `moderation.rs` beside W1's and W4's). Empty in
//! the W5 freeze.

use crate::Inner;
use axum::Router;
use axum::http::Method;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
}

pub(super) fn operation_id(_method: &Method, _route: &str) -> Option<&'static str> {
    None
}
