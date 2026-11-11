//! W5-B's state and the fake's permission model: roles with positions and actions, who holds
//! them, channel overrides, bans, timeouts and the moderation log, seeded from the scenario's
//! `rolesByCommunity` and `membershipsByCommunity`. Empty in the W5 freeze, where everything is
//! allowed (as W1's fake has it: the signed-in user moderates every channel).

use crate::Inner;
use axum::response::Response;
use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct Rbac {}

/// Whether `user_id` may do `action` (an `RbacAction` wire name) in the community: the backend's
/// `RbacGuard` and `PermissionsService`. W5-A's handlers ask this too.
#[allow(dead_code)]
pub(crate) fn allows(_inner: &Inner, _user_id: &str, _community_id: &str, _action: &str) -> bool {
    true
}

/// A W5-B control (`act_as`: give the signed-in user these roles, for a test), or `None` when the
/// name isn't W5-B's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
