//! W6-C's state: what per-user storage, quotas and recalculation has changed in the fake world, seeded from the scenario's
//! `storage` key (`Scenario::extra`). Empty in the W6/W7 freeze. Its own lock (`Inner::w6_storage`):
//! never held with `data`, `admin` or `rbac`.

use crate::Inner;
use axum::response::Response;
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Storage {}

/// A W6-C control (`POST /__control/{name}`), or `None` when the name isn't W6-C's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
