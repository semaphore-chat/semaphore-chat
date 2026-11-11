//! W5-A's state: what community administration has changed in the fake world, seeded from the
//! scenario's `extra` keys W5-A reads. Empty in the W5 freeze.
//!
//! Permission checks go through `crate::rbac::allows`, which W5-B owns.

use crate::Inner;
use axum::response::Response;
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Admin {}

/// A W5-A control (`POST /__control/{name}`), or `None` when the name isn't W5-A's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
