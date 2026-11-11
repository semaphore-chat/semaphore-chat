//! Thread metadata and subscriptions (W1 part B). Empty until that part adds its routes.

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
