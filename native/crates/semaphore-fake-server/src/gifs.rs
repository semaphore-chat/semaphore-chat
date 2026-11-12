//! W7-A's state: the fixture GIFs, seeded from the scenario's `gifs` key (`Scenario::extra`), with
//! URLs on the fake server's own `/__fixtures/` so nothing leaves the machine. Empty in the
//! W6/W7 freeze. Its own lock (`Inner::gifs`).

use crate::Inner;
use axum::response::Response;
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Gifs {}

/// A W7-A control, or `None` when the name isn't W7-A's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
