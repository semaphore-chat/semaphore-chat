//! W5-A's routes: community update and delete, channel CRUD and moves, private channel members,
//! adding members, mention groups, custom emoji and sound management, webhooks and invites. Empty in
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
