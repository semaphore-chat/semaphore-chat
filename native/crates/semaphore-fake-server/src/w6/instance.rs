//! W6-A's state: what instance settings, stats, instance storage and LiveKit health has changed in the fake world, seeded from the scenario's
//! `instanceSettings` key (`Scenario::extra`). Empty in the W6/W7 freeze. Its own lock (`Inner::w6_instance`):
//! never held with `data`, `admin` or `rbac`.

use crate::Inner;
use axum::response::Response;
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Instance {}

/// A W6-A control (`POST /__control/{name}`), or `None` when the name isn't W6-A's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
