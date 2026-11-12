//! W6-B's state: what the admin users list, owner role, ban, password, delete and instance role assignment has changed in the fake world, seeded from the scenario's
//! `adminUsers` key (`Scenario::extra`). Empty in the W6/W7 freeze. Its own lock (`Inner::w6_users`):
//! never held with `data`, `admin` or `rbac`.

use crate::Inner;
use axum::response::Response;
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Users {}

/// A W6-B control (`POST /__control/{name}`), or `None` when the name isn't W6-B's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
