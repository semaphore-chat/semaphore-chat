//! W6-B's routes: the admin users list, owner role, ban, password, delete and instance role assignment. Empty in the W6/W7 freeze. State lives in `crate::w6::users`.

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
