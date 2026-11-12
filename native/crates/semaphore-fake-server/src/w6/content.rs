//! W6-D's state: what every community with stats and force delete (instance invites stay W5-A's routes) has changed in the fake world, seeded from the scenario's
//! `adminCommunities` key (`Scenario::extra`). Empty in the W6/W7 freeze. Its own lock (`Inner::w6_content`):
//! never held with `data`, `admin` or `rbac`.

use crate::Inner;
use axum::response::Response;
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Content {}

/// A W6-D control (`POST /__control/{name}`), or `None` when the name isn't W6-D's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
