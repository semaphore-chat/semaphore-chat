//! W6-E's state: what instance roles and their users has changed in the fake world, seeded from the scenario's
//! `instanceRoles` key (`Scenario::extra`). Empty in the W6/W7 freeze. Its own lock (`Inner::w6_roles`):
//! never held with `data`, `admin` or `rbac`.

use crate::Inner;
use axum::response::Response;
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[derive(Debug, Default)]
pub(crate) struct Roles {}

/// A W6-E control (`POST /__control/{name}`), or `None` when the name isn't W6-E's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}

/// Whether `user_id` holds the instance action `action` (a wire name): the owner always (the
/// guard lets them past), else the union of their instance roles' actions. In the freeze, only
/// the owner: W6-E adds assigned roles. The other W6 lanes' handlers ask `crate::w6::allows`.
pub(crate) fn holds(inner: &Inner, user_id: &str, action: &str) -> bool {
    crate::rbac::is_owner(inner, user_id) || held(inner, user_id).contains(action)
}

/// `user_id`'s instance actions from their instance roles (the owner's bypass not included).
/// Empty in the freeze, apart from `CREATE_COMMUNITY`, which the default role gives everyone.
pub(crate) fn held(_inner: &Inner, _user_id: &str) -> BTreeSet<String> {
    BTreeSet::from(["CREATE_COMMUNITY".to_owned()])
}

/// `UserRolesResponseDto` for `user_id`'s instance roles (`GET /roles/my/instance`, and W6-B's
/// `GET /roles/user/{userId}/instance`). In the freeze, the default role every user has, which
/// may create communities.
pub(crate) fn instance_roles_json(inner: &Inner, user_id: &str) -> Value {
    json!({
        "userId": user_id,
        "resourceId": null,
        "resourceType": "INSTANCE",
        "roles": [{
            "id": "role-instance-member",
            "name": "Member",
            "position": 0,
            "isDefault": true,
            "createdAt": inner.scenario.epoch,
            "actions": ["CREATE_COMMUNITY"],
        }],
    })
}
