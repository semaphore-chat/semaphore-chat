//! W6-E's routes: instance roles and their users. Empty in the W6/W7 freeze. State lives in `crate::w6::roles`.

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
