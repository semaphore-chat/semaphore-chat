//! Pins, moderator removal and channel roles (W1 part A). Empty until that part adds its routes.

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
