//! Instance administration, wave 6: the W6 hub.
//!
//! Five lanes, one file each: `instance.rs` (W6-A: dashboard and settings), `users.rs` (W6-B),
//! `storage.rs` (W6-C), `content.rs` (W6-D: communities and instance invites) and `roles.rs`
//! (W6-E: instance roles). The shared files (`cache.rs`, `commands/mod.rs`, `queries.rs`,
//! `events.rs`, `resync.rs`, `client.rs`) call only this hub, and this hub only calls each
//! lane's functions, so no lane edits a file another lane edits. This file is the freeze's; lanes
//! don't change it.
//!
//! What this user may do is `instance_admin_caps` (from my instance roles; an owner may do
//! everything) and, for a lane's own rules, `instance_authority`.

pub mod content;
pub mod instance;
pub mod roles;
pub mod storage;
pub mod users;

use crate::cache::{CacheValue, QueryKey, keys};
use crate::client::{Core, State};
use crate::model::{INSTANCE_ADMIN_ACTIONS, InstanceAdminCaps, ViewKey};
use crate::platform::CoreError;
use semaphore_wire::events::ServerEvent;

/// W6's cached responses, inside `CacheValue::W6`: one variant per lane, holding that lane's
/// own enum.
#[derive(Debug, Clone)]
pub enum W6Value {
    Instance(instance::InstanceValue),
    Users(users::UsersValue),
    Storage(storage::StorageValue),
    Content(content::ContentValue),
    Roles(roles::RolesValue),
}

/// W6's state, one part per lane. Gone at sign-out.
#[derive(Debug, Default)]
#[allow(dead_code)] // each lane reads its own part
pub struct W6State {
    pub(crate) instance: instance::InstanceState,
    pub(crate) users: users::UsersState,
    pub(crate) storage: storage::StorageState,
    pub(crate) content: content::ContentState,
    pub(crate) roles: roles::RolesState,
}

/// What a new connection reads again, per lane.
pub(crate) const RECONNECT: &[&[&str]] = &[
    instance::keys::RECONNECT,
    users::keys::RECONNECT,
    storage::keys::RECONNECT,
    content::keys::RECONNECT,
    roles::keys::RECONNECT,
];

pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    instance::view_for(key)
        .or_else(|| users::view_for(key))
        .or_else(|| storage::view_for(key))
        .or_else(|| content::view_for(key))
        .or_else(|| roles::view_for(key))
}

pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    instance::key_for(view)
        .or_else(|| users::key_for(view))
        .or_else(|| storage::key_for(view))
        .or_else(|| content::key_for(view))
        .or_else(|| roles::key_for(view))
}

/// Who I am on the instance, for the rules that depend on it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Authority {
    pub owner: bool,
    /// The owner, or every action of `INSTANCE_ADMIN_ACTIONS` held.
    pub full: bool,
    /// My instance actions (from all my instance roles), as wire names, sorted, no repeats.
    pub held: Vec<String>,
}

/// The admin caps from an authority. Pure, so lanes and tests can use it.
pub fn caps_from(authority: &Authority) -> InstanceAdminCaps {
    let has = |action: &str| authority.owner || authority.held.iter().any(|held| held == action);
    let mut caps = InstanceAdminCaps {
        show_admin: false,
        dashboard: has("READ_INSTANCE_STATS"),
        settings_read: has("READ_INSTANCE_SETTINGS"),
        settings_write: has("UPDATE_INSTANCE_SETTINGS"),
        users_read: has("READ_USER"),
        users_update: has("UPDATE_USER"),
        users_ban: has("BAN_USER"),
        users_delete: has("DELETE_USER"),
        storage: has("MANAGE_USER_STORAGE"),
        communities_read: has("READ_ALL_COMMUNITIES"),
        communities_delete: has("DELETE_COMMUNITY"),
        invites_read: has("READ_INSTANCE_INVITE"),
        invites_create: has("CREATE_INSTANCE_INVITE"),
        invites_delete: has("DELETE_INSTANCE_INVITE"),
        roles_read: has("READ_INSTANCE_SETTINGS"),
        roles_write: has("UPDATE_INSTANCE_SETTINGS"),
        is_owner: authority.owner,
        full_authority: authority.full,
    };
    caps.show_admin = authority.owner
        || INSTANCE_ADMIN_ACTIONS.iter().any(|action| has(action))
        || caps.communities_read
        || caps.communities_delete;
    caps
}

impl State {
    /// My instance authority: `None` while my instance roles are unknown (and I'm not the
    /// owner). Reading it doesn't fetch; `Core::instance_permissions` does.
    pub(crate) fn instance_authority(&self) -> Option<Authority> {
        if self.is_instance_owner() {
            return Some(Authority {
                owner: true,
                full: true,
                held: INSTANCE_ADMIN_ACTIONS
                    .iter()
                    .map(|action| (*action).to_owned())
                    .collect(),
            });
        }
        let roles = self.cache.instance_roles(&keys::op(keys::INSTANCE_ROLES))?;
        let mut held: Vec<String> = roles
            .roles
            .iter()
            .flat_map(|role| {
                role.actions
                    .iter()
                    .map(|action| action.as_str().into_owned())
            })
            .collect();
        held.sort();
        held.dedup();
        let full = INSTANCE_ADMIN_ACTIONS
            .iter()
            .all(|action| held.iter().any(|held| held == action));
        Some(Authority {
            owner: false,
            full,
            held,
        })
    }

    /// What the admin area may show and do; all false while unknown.
    pub(crate) fn instance_admin_caps(&self) -> InstanceAdminCaps {
        self.instance_authority()
            .map(|authority| caps_from(&authority))
            .unwrap_or_default()
    }

    pub(crate) fn w6_query_changed(&mut self, key: &QueryKey) -> bool {
        self.w6_instance_query_changed(key)
            || self.w6_users_query_changed(key)
            || self.w6_storage_query_changed(key)
            || self.w6_content_query_changed(key)
            || self.w6_roles_query_changed(key)
    }

    pub(crate) fn w6_event(&mut self, event: &ServerEvent, now: u64) {
        self.w6_instance_event(event, now);
        self.w6_users_event(event, now);
        self.w6_storage_event(event, now);
        self.w6_content_event(event, now);
        self.w6_roles_event(event, now);
    }
}

impl Core {
    pub(crate) async fn w6_fetch(&self, key: &QueryKey) -> Option<Result<CacheValue, CoreError>> {
        if let Some(value) = self.w6_instance_fetch(key).await {
            return Some(value);
        }
        if let Some(value) = self.w6_users_fetch(key).await {
            return Some(value);
        }
        if let Some(value) = self.w6_storage_fetch(key).await {
            return Some(value);
        }
        if let Some(value) = self.w6_content_fetch(key).await {
            return Some(value);
        }
        self.w6_roles_fetch(key).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held(actions: &[&str]) -> Authority {
        let mut held: Vec<String> = actions.iter().map(|a| (*a).to_owned()).collect();
        held.sort();
        let full = INSTANCE_ADMIN_ACTIONS
            .iter()
            .all(|action| held.iter().any(|h| h == action));
        Authority {
            owner: false,
            full,
            held,
        }
    }

    #[test]
    fn nobody_sees_nothing() {
        assert_eq!(caps_from(&held(&[])), InstanceAdminCaps::default());
    }

    #[test]
    fn an_owner_sees_and_may_do_everything() {
        let caps = caps_from(&Authority {
            owner: true,
            full: true,
            held: Vec::new(),
        });
        assert!(caps.show_admin && caps.is_owner && caps.full_authority);
        assert!(caps.communities_read && caps.communities_delete && caps.users_delete);
    }

    #[test]
    fn any_one_admin_action_shows_the_admin_entry_and_only_its_page() {
        for action in INSTANCE_ADMIN_ACTIONS {
            let caps = caps_from(&held(&[action]));
            assert!(caps.show_admin, "{action} shows Admin");
            assert!(!caps.full_authority, "{action} alone isn't full authority");
        }
        let caps = caps_from(&held(&["READ_INSTANCE_INVITE"]));
        assert!(caps.invites_read && !caps.invites_create && !caps.users_read);
    }

    #[test]
    fn community_actions_alone_do_not_show_admin() {
        let caps = caps_from(&held(&["CREATE_COMMUNITY", "READ_COMMUNITY"]));
        assert!(!caps.show_admin);
    }

    #[test]
    fn every_instance_admin_action_is_full_authority_without_communities() {
        let caps = caps_from(&held(&INSTANCE_ADMIN_ACTIONS));
        assert!(caps.full_authority && !caps.is_owner);
        assert!(
            !caps.communities_read,
            "no role grants READ_ALL_COMMUNITIES (#706)"
        );
    }

    #[test]
    fn the_action_groups_cover_the_admin_actions_once() {
        let mut grouped: Vec<String> = crate::model::instance_action_groups()
            .into_iter()
            .flat_map(|group| group.actions)
            .collect();
        grouped.sort();
        let mut all: Vec<String> = INSTANCE_ADMIN_ACTIONS.iter().map(|a| (*a).into()).collect();
        all.sort();
        assert_eq!(grouped, all);
    }
}
