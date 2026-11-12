//! What this user may do in a community, and to one member. Unit W5-B.
//!
//! Worked out the way the server decides, so a UI never re-derives RBAC:
//!
//! - The instance owner skips RBAC (`RbacGuard`), except the rank rule of ban, kick and timeout,
//!   which the server applies to them too today (`ModerationService::canModerate`, #679); those
//!   show refused with `NotAllowed::Rank` until the server changes.
//! - Community actions are the union of the user's community roles (`roles/my/community`). The
//!   channel-scoped resources of W5 (channel update and delete, webhooks, private members) check
//!   actions a channel's overrides can't change (`CHANNEL_SCOPED_ACTIONS` leaves them out), so the
//!   community roles decide them exactly.
//! - Moderating a member needs a role strictly outranking theirs (lower position ranks higher; no
//!   role ranks below everyone). The member's roles come from `roles/user/{id}/community/{id}`,
//!   one read per member asked about. The server doesn't expose this (#663).
//! - Creating an invite needs community CREATE_INVITE and instance CREATE_INSTANCE_INVITE;
//!   deleting one, instance DELETE_INSTANCE_INVITE (the server checks nothing else). Those flags
//!   also change with `ViewKey::InstancePermissions`.

use std::collections::BTreeSet;

use super::moderation::{W5bValue, key2, keys};
use crate::cache::keys as shared;
use crate::client::{Core, State};
use crate::model::{
    CommunityCaps, CommunityPermissionsView, LoadState, ModerationTargetView, NotAllowed, ViewKey,
};
use semaphore_wire::enums::RbacAction;
use semaphore_wire::types as wire;

/// A user's rank and actions in a community, as the server works them out.
#[derive(Debug, Clone, Default)]
pub(crate) struct Standing {
    pub owner: bool,
    /// Their roles here have arrived.
    pub known: bool,
    pub actions: BTreeSet<String>,
    /// Best (lowest) position; `i64::MAX` with no role.
    pub best: i64,
    /// They hold the community's top-ranked position (needs the community's roles).
    pub top: bool,
    pub role_ids: BTreeSet<String>,
}

impl Standing {
    pub fn has(&self, action: &str) -> bool {
        self.owner || self.actions.contains(action)
    }

    /// `assertRoleBelowActor`.
    pub fn manages(&self, position: i64) -> bool {
        self.owner || self.top || position > self.best
    }

    /// `assertHolds`.
    pub fn holds<'a>(&self, actions: impl IntoIterator<Item = &'a str>) -> bool {
        self.owner
            || actions
                .into_iter()
                .all(|action| self.actions.contains(action))
    }
}

pub(crate) fn best_of(roles: &[wire::RoleDto]) -> i64 {
    roles
        .iter()
        .map(|role| role.position)
        .min()
        .unwrap_or(i64::MAX)
}

pub(crate) fn action_names(actions: &[RbacAction]) -> impl Iterator<Item = String> + '_ {
    actions.iter().map(|action| action.as_str().into_owned())
}

impl State {
    /// A member's roles here, when they've arrived: this user's own (`roles/my/community`) or
    /// anyone's (`roles/user/../community/..`). Asks for them.
    pub(crate) fn w5b_roles_of(
        &mut self,
        community_id: &str,
        user_id: &str,
    ) -> Option<Vec<wire::RoleDto>> {
        let key = if user_id == self.me_id() {
            shared::scoped(keys::MY_ROLES, community_id)
        } else {
            key2(keys::USER_ROLES, community_id, user_id)
        };
        self.ensure_query(key.clone());
        match self.w5b_value(&key) {
            Some(W5bValue::UserRoles(roles)) => Some(roles.roles.clone()),
            _ => None,
        }
    }

    /// The community's roles, when this user may read them and they've arrived.
    pub(crate) fn w5b_community_roles(&mut self, community_id: &str) -> Option<Vec<wire::RoleDto>> {
        let key = shared::scoped(keys::ROLES, community_id);
        self.ensure_query(key.clone());
        match self.w5b_value(&key) {
            Some(W5bValue::Roles(roles)) => {
                let mut roles = roles.roles.clone();
                roles.sort_by_key(|role| role.position);
                Some(roles)
            }
            _ => None,
        }
    }

    /// `user_id`'s standing here. This user's own also reads the community's roles, for `top`,
    /// when they may (`READ_ROLE`).
    pub(crate) fn w5b_standing(&mut self, community_id: &str, user_id: &str) -> Standing {
        let owner = user_id == self.me_id() && self.is_instance_owner();
        let Some(roles) = self.w5b_roles_of(community_id, user_id) else {
            return Standing {
                owner,
                best: i64::MAX,
                ..Standing::default()
            };
        };
        let actions: BTreeSet<String> = roles
            .iter()
            .flat_map(|role| action_names(&role.actions))
            .collect();
        let best = best_of(&roles);
        let top = if best != i64::MAX && (owner || actions.contains("READ_ROLE")) {
            self.w5b_community_roles(community_id)
                .and_then(|all| all.first().map(|role| best <= role.position))
                .unwrap_or(false)
        } else {
            false
        };
        Standing {
            owner,
            known: true,
            actions,
            best,
            top,
            role_ids: roles.iter().map(|role| role.id.clone()).collect(),
        }
    }

    fn w5b_instance_has(&mut self, action: RbacAction) -> bool {
        if self.is_instance_owner() {
            return true;
        }
        let key = shared::op(shared::INSTANCE_ROLES);
        self.ensure_query(key.clone());
        self.cache.instance_roles(&key).is_some_and(|roles| {
            roles
                .roles
                .iter()
                .any(|role| role.actions.contains(&action))
        })
    }

    pub(crate) fn w5b_caps(&mut self, me: &Standing) -> CommunityCaps {
        let has = |action: &str| me.has(action);
        CommunityCaps {
            update_community: has("UPDATE_COMMUNITY"),
            delete_community: has("DELETE_COMMUNITY"),
            create_channel: has("CREATE_CHANNEL"),
            update_channel: has("UPDATE_CHANNEL"),
            delete_channel: has("DELETE_CHANNEL"),
            manage_private_members: has("CREATE_MEMBER") && has("DELETE_MEMBER"),
            manage_channel_permissions: has("MANAGE_CHANNEL_PERMISSIONS"),
            read_roles: has("READ_ROLE"),
            create_role: has("CREATE_ROLE"),
            update_role: has("UPDATE_ROLE"),
            delete_role: has("DELETE_ROLE"),
            assign_roles: has("UPDATE_MEMBER"),
            read_members: has("READ_MEMBER"),
            add_members: has("CREATE_MEMBER"),
            read_alias_groups: has("READ_ALIAS_GROUP"),
            create_alias_group: has("CREATE_ALIAS_GROUP"),
            update_alias_group: has("UPDATE_ALIAS_GROUP"),
            delete_alias_group: has("DELETE_ALIAS_GROUP"),
            manage_alias_members: has("UPDATE_ALIAS_GROUP_MEMBER"),
            manage_emoji: has("MANAGE_EMOJIS"),
            read_sounds: has("READ_SOUNDBOARD_SOUND"),
            create_sound: has("CREATE_SOUNDBOARD_SOUND"),
            delete_sound: has("DELETE_SOUNDBOARD_SOUND"),
            manage_webhooks: has("MANAGE_WEBHOOKS"),
            create_invite: has("CREATE_INVITE")
                && self.w5b_instance_has(RbacAction::CreateInstanceInvite),
            delete_invite: self.w5b_instance_has(RbacAction::DeleteInstanceInvite),
            ban: has("BAN_USER"),
            unban: has("UNBAN_USER"),
            kick: has("KICK_USER"),
            timeout: has("TIMEOUT_USER"),
            view_bans: has("VIEW_BAN_LIST"),
            view_moderation_log: has("VIEW_MODERATION_LOGS"),
        }
    }

    /// Whether this user may lift a ban or timeout someone set: the action, not their own, and
    /// not set by a higher rank (the instance owner skips the last two).
    pub(crate) fn w5b_may_lift(
        &mut self,
        community_id: &str,
        user_id: &str,
        set_by: Option<&str>,
        action: &str,
    ) -> bool {
        let me_id = self.me_id().to_owned();
        let me = self.w5b_standing(community_id, &me_id);
        if !me.has(action) {
            return false;
        }
        if me.owner {
            return true;
        }
        if user_id == me_id {
            return false;
        }
        match set_by {
            Some(setter) if setter != me_id => {
                let setter = self.w5b_standing(community_id, setter);
                setter.known && setter.best >= me.best
            }
            _ => true,
        }
    }
}

impl Core {
    /// `ViewKey::CommunityPermissions`. Every flag false until `state` is `Ready`; for the
    /// instance owner they're known at once (the guard lets them through), and `best_position`
    /// follows when their roles arrive.
    pub fn community_permissions(&self, community_id: String) -> CommunityPermissionsView {
        self.write(|state, _| {
            let me_id = state.me_id().to_owned();
            let me = state.w5b_standing(&community_id, &me_id);
            let key = shared::scoped(keys::MY_ROLES, &community_id);
            let load = if me.owner {
                LoadState::Ready
            } else {
                state.load_of(&key)
            };
            let caps = if load == LoadState::Ready {
                state.w5b_caps(&me)
            } else {
                CommunityCaps::default()
            };
            CommunityPermissionsView {
                state: load,
                community_id,
                caps,
                is_instance_owner: me.owner,
                best_position: (me.known && me.best != i64::MAX).then_some(me.best as i32),
                is_top: me.top,
            }
        })
    }

    /// What this user may do to one member (`ViewKey::ModerationTarget`).
    pub fn moderation_target(&self, community_id: String, user_id: String) -> ModerationTargetView {
        self.write(|state, _| {
            let view = ViewKey::ModerationTarget {
                community_id: community_id.clone(),
                user_id: user_id.clone(),
            };
            state.w5b_watch(&community_id, view.clone());
            let op = state.w5a_op(&view);
            let me_id = state.me_id().to_owned();
            let me = state.w5b_standing(&community_id, &me_id);
            let my_key = shared::scoped(keys::MY_ROLES, &community_id);
            let their_key = key2(keys::USER_ROLES, &community_id, &user_id);
            if user_id == me_id {
                let it = Some(NotAllowed::SelfTarget);
                return ModerationTargetView {
                    state: state.load_of(&my_key),
                    user_id,
                    not_allowed: it,
                    ban_not_allowed: it,
                    kick_not_allowed: it,
                    timeout_not_allowed: it,
                    roles_not_allowed: it,
                    op,
                    ..Default::default()
                };
            }
            let them = state.w5b_standing(&community_id, &user_id);
            let status_key = key2(keys::TIMEOUT_STATUS, &community_id, &user_id);
            let timed_out_until_ms = if me.has("READ_MEMBER") {
                state.ensure_query(status_key.clone());
                match state.w5b_value(&status_key) {
                    Some(W5bValue::TimeoutStatus(status)) if status.is_timed_out => {
                        status.expires_at.map(|at| at.timestamp_millis())
                    }
                    _ => None,
                }
            } else {
                None
            };
            let load = match (state.load_of(&my_key), state.load_of(&their_key)) {
                (LoadState::Failed { error }, _) | (_, LoadState::Failed { error }) => {
                    LoadState::Failed { error }
                }
                (LoadState::Ready, LoadState::Ready) => LoadState::Ready,
                _ if me.owner && them.known => LoadState::Ready,
                _ => LoadState::Loading,
            };
            if load != LoadState::Ready {
                return ModerationTargetView {
                    state: load,
                    user_id,
                    timed_out_until_ms,
                    op,
                    ..Default::default()
                };
            }
            // `canModerate`: a role, strictly better than theirs; the owner gets no way past it.
            let outranks = me.best != i64::MAX && me.best < them.best;
            let (ban, kick, timeout) = (
                me.has("BAN_USER"),
                me.has("KICK_USER"),
                me.has("TIMEOUT_USER"),
            );
            let not_allowed = if !(ban || kick || timeout) {
                Some(NotAllowed::Missing)
            } else if !outranks {
                Some(NotAllowed::Rank)
            } else {
                None
            };
            let reason = |has: bool, ranks: bool| {
                if !has {
                    Some(NotAllowed::Missing)
                } else if !ranks {
                    Some(NotAllowed::Rank)
                } else {
                    None
                }
            };
            // `assertCanChangeRolesOf`: top holders and the owner (who stands as top) may.
            let roles_not_allowed = reason(me.has("UPDATE_MEMBER"), me.owner || me.top || outranks);
            ModerationTargetView {
                state: LoadState::Ready,
                can_ban: ban && outranks,
                can_kick: kick && outranks,
                can_timeout: timeout && outranks,
                can_remove_timeout: timed_out_until_ms.is_some() && timeout,
                can_change_roles: roles_not_allowed.is_none(),
                not_allowed,
                ban_not_allowed: reason(ban, outranks),
                kick_not_allowed: reason(kick, outranks),
                timeout_not_allowed: reason(timeout, outranks),
                roles_not_allowed,
                op,
                timed_out_until_ms,
                user_id,
            }
        })
    }
}
