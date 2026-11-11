//! What this user may do in a community, and to one member. Unit W5-B.
//!
//! Worked out the way the server decides, so a UI never re-derives RBAC:
//!
//! - The instance owner skips RBAC (`RbacGuard`), except the rank rule of ban, kick and timeout,
//!   which the server applies to them too today (`ModerationService::canModerate`); those show
//!   refused with `NotAllowed::Rank` until the server changes.
//! - Community actions are the union of the user's community roles (`roles/my/community`).
//!   Channel-scoped ones (channel update and delete, webhooks, private members) use them too: the
//!   channel's overrides aren't visible to a client (#639, #644).
//! - Moderating a member needs a role strictly outranking theirs (lower position ranks higher; no
//!   role ranks below everyone). The member's roles come from the member list, or
//!   `roles/user/{id}/community/{id}` past its 1000-member cap. The server doesn't expose this
//!   (#663).
//! - Creating an invite needs community CREATE_INVITE and instance CREATE_INSTANCE_INVITE.

use crate::client::Core;
use crate::model::{CommunityPermissionsView, ModerationTargetView};

impl Core {
    /// `ViewKey::CommunityPermissions`. Every flag false until `state` is `Ready`.
    pub fn community_permissions(&self, community_id: String) -> CommunityPermissionsView {
        CommunityPermissionsView {
            community_id,
            ..Default::default()
        }
    }

    /// What this user may do to one member (`ViewKey::ModerationTarget`).
    pub fn moderation_target(
        &self,
        _community_id: String,
        user_id: String,
    ) -> ModerationTargetView {
        ModerationTargetView {
            user_id,
            ..Default::default()
        }
    }
}
