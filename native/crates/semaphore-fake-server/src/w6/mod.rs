//! Wave 6's fake state, one module (and one lock on `Inner`) per lane.

pub(crate) mod content;
pub(crate) mod instance;
pub(crate) mod roles;
pub(crate) mod storage;
pub(crate) mod users;

use crate::Inner;

/// Whether `user_id` may do the instance action `action` (a wire name): `RbacGuard`'s owner
/// bypass, else their instance roles (W6-E's `roles::holds`). Every W6 handler guards with this.
#[allow(dead_code)]
pub(crate) fn allows(inner: &Inner, user_id: &str, action: &str) -> bool {
    roles::holds(inner, user_id, action)
}
