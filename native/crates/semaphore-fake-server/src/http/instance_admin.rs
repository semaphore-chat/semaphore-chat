//! W6-A's routes: instance settings, stats, instance storage and LiveKit health. Empty in the W6/W7 freeze. State lives in `crate::w6::instance`.

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
