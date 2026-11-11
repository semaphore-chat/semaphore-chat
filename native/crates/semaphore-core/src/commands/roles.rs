//! Community roles: the list and editor, assigning them, and a channel's permission overrides.
//! Unit W5-B.
//!
//! The rank rules are the server's (`CommunityRolesService`): a user manages roles strictly below
//! their best one (holders of the top position, and the instance owner, any); grants only actions
//! they hold, and an edit sends the role's whole list, so a role holding something they lack can't
//! be saved by them (`RoleRow::editable` is false then; see Backend asks W5); never places a role above their own
//! rank; changes the roles of members they outrank, or their own. Core sets `RoleRow`'s flags and
//! `RolesView::grantable` from them. A saved role keeps the actions this build doesn't know: they
//! are sent back as the server named them.

use super::community_admin::OpKey;
use super::moderation::{W5bValue, key2, keys};
use super::permissions::{Standing, action_names};
use crate::cache::keys as shared;
use crate::client::Core;
use crate::model::{
    AdminActionKind, BuiltPreset, ChannelOverwritesView, ChannelPreset, DetectedPreset,
    MemberRolesView, NotAllowed, OverwriteRoleOption, OverwriteRow, OverwriteTarget,
    OverwritesDraft, PermissionGroup, PresetAccess, RoleBlock, RoleDraft, RoleMembersView,
    RolePatch, RoleRow, RolesView, UserView, ViewKey,
};
use crate::platform::CoreError;
use semaphore_wire::enums::{self as wire_enums, OverwriteTarget as WireTarget};
use semaphore_wire::types as wire;

/// The web's role editor groups (`frontend/src/constants/rbacActions.ts`, `PERMISSION_GROUPS`),
/// with `CAPTURE_REPLAY`, which the web leaves out of every group, under voice.
const CATALOG: &[(&str, &[&str])] = &[
    (
        "messages",
        &["CREATE_MESSAGE", "DELETE_MESSAGE", "READ_MESSAGE"],
    ),
    (
        "channels",
        &[
            "CREATE_CHANNEL",
            "UPDATE_CHANNEL",
            "DELETE_CHANNEL",
            "READ_CHANNEL",
            "JOIN_CHANNEL",
            "MANAGE_CHANNEL_PERMISSIONS",
            "MANAGE_WEBHOOKS",
        ],
    ),
    (
        "voice",
        &["SPEAK", "VIDEO", "SCREEN_SHARE", "CAPTURE_REPLAY"],
    ),
    (
        "community",
        &[
            "UPDATE_COMMUNITY",
            "DELETE_COMMUNITY",
            "READ_COMMUNITY",
            "READ_ALL_COMMUNITIES",
        ],
    ),
    (
        "members",
        &[
            "CREATE_MEMBER",
            "UPDATE_MEMBER",
            "DELETE_MEMBER",
            "READ_MEMBER",
        ],
    ),
    (
        "roles",
        &["CREATE_ROLE", "UPDATE_ROLE", "DELETE_ROLE", "READ_ROLE"],
    ),
    ("users", &["UPDATE_USER", "DELETE_USER", "READ_USER"]),
    (
        "invites",
        &[
            "CREATE_INVITE",
            "DELETE_INVITE",
            "CREATE_INSTANCE_INVITE",
            "DELETE_INSTANCE_INVITE",
            "READ_INSTANCE_INVITE",
            "UPDATE_INSTANCE_INVITE",
        ],
    ),
    (
        "content",
        &[
            "CREATE_REACTION",
            "DELETE_REACTION",
            "ATTACH_FILES",
            "CREATE_ATTACHMENT",
            "DELETE_ATTACHMENT",
            "MANAGE_EMOJIS",
        ],
    ),
    (
        "alias_groups",
        &[
            "CREATE_ALIAS_GROUP",
            "UPDATE_ALIAS_GROUP",
            "DELETE_ALIAS_GROUP",
            "READ_ALIAS_GROUP",
            "CREATE_ALIAS_GROUP_MEMBER",
            "DELETE_ALIAS_GROUP_MEMBER",
            "READ_ALIAS_GROUP_MEMBER",
            "UPDATE_ALIAS_GROUP_MEMBER",
        ],
    ),
    (
        "moderation",
        &[
            "BAN_USER",
            "UNBAN_USER",
            "KICK_USER",
            "TIMEOUT_USER",
            "PIN_MESSAGE",
            "UNPIN_MESSAGE",
            "DELETE_ANY_MESSAGE",
            "VIEW_BAN_LIST",
            "VIEW_MODERATION_LOGS",
            "MUTE_PARTICIPANT",
        ],
    ),
    (
        "soundboard",
        &[
            "READ_SOUNDBOARD_SOUND",
            "CREATE_SOUNDBOARD_SOUND",
            "DELETE_SOUNDBOARD_SOUND",
        ],
    ),
];

/// The actions this build knows, from the catalog.
fn known_actions() -> impl Iterator<Item = &'static str> {
    CATALOG
        .iter()
        .flat_map(|(_, actions)| actions.iter().copied())
}

fn wire_action(name: &str) -> wire_enums::RbacAction {
    serde_json::from_value(serde_json::Value::String(name.to_owned()))
        .unwrap_or_else(|_| wire_enums::RbacAction::Unknown(name.to_owned()))
}

fn wire_preset(preset: ChannelPreset) -> wire_enums::ChannelPreset {
    match preset {
        ChannelPreset::Normal => wire_enums::ChannelPreset::Normal,
        ChannelPreset::ReadOnly => wire_enums::ChannelPreset::ReadOnly,
        ChannelPreset::Announcement => wire_enums::ChannelPreset::Announcement,
        ChannelPreset::ModsOnly => wire_enums::ChannelPreset::ModsOnly,
        ChannelPreset::Custom | ChannelPreset::Unknown => wire_enums::ChannelPreset::Custom,
    }
}

fn uuid(id: &str, what: &str) -> Result<uuid::Uuid, CoreError> {
    uuid::Uuid::parse_str(id).map_err(|_| CoreError::Failed {
        message: format!("{what} isn't a valid id"),
    })
}

/// The Member role: default, named so, always last (`DEFAULT_MEMBER_ROLE`).
pub(crate) fn is_fixed(role: &wire::RoleDto) -> bool {
    role.is_default && role.name == "Member"
}

/// `reorderRolesAsActor`: whether the server takes this order (highest first) from this user.
pub(crate) fn reorder_allowed(me: &Standing, roles: &[wire::RoleDto], order: &[String]) -> bool {
    if me.owner {
        return true;
    }
    let mut reorderable: Vec<&wire::RoleDto> =
        roles.iter().filter(|role| !is_fixed(role)).collect();
    reorderable.sort_by_key(|role| role.position);
    let incoming: Vec<&String> = order
        .iter()
        .filter(|id| reorderable.iter().any(|role| role.id == **id))
        .collect();
    if me.top {
        return incoming.first().is_none_or(|id| me.role_ids.contains(*id));
    }
    let above: Vec<&String> = reorderable
        .iter()
        .filter(|role| role.position <= me.best)
        .map(|role| &role.id)
        .collect();
    above
        .iter()
        .enumerate()
        .all(|(i, id)| incoming.get(i) == Some(id))
        && !reorderable
            .iter()
            .any(|role| role.position == me.best && !me.role_ids.contains(&role.id))
}

/// Why this user can't edit (or assign) a role, `None` when they can.
fn edit_block(
    me: &Standing,
    has: bool,
    role: &wire::RoleDto,
    actions: &[String],
) -> Option<RoleBlock> {
    if !has {
        Some(RoleBlock::Missing)
    } else if !me.manages(role.position) {
        Some(RoleBlock::Rank)
    } else if !me.holds(actions.iter().map(String::as_str)) {
        Some(RoleBlock::HoldsUngrantable)
    } else {
        None
    }
}

/// Every row, highest first, with what this user may do to each (the server's rules).
fn role_rows(roles: &[wire::RoleDto], me: &Standing) -> Vec<RoleRow> {
    let (assign, update, delete) = (
        me.has("UPDATE_MEMBER"),
        me.has("UPDATE_ROLE"),
        me.has("DELETE_ROLE"),
    );
    let mut ordered: Vec<wire::RoleDto> = roles.to_vec();
    ordered.sort_by_key(|role| role.position);
    let movable: Vec<String> = ordered
        .iter()
        .filter(|role| !is_fixed(role))
        .map(|role| role.id.clone())
        .collect();
    let swapped = |index: usize, with: usize| {
        let mut order = movable.clone();
        order.swap(index, with);
        reorder_allowed(me, &ordered, &order)
    };
    ordered
        .iter()
        .map(|role| {
            let actions: Vec<String> = action_names(&role.actions).collect();
            let edit_blocked = edit_block(me, update, role, &actions);
            let assign_blocked = edit_block(me, assign, role, &actions);
            let delete_blocked = if !delete {
                Some(RoleBlock::Missing)
            } else if !me.manages(role.position) {
                Some(RoleBlock::Rank)
            } else if role.is_default {
                Some(RoleBlock::DefaultRole)
            } else {
                None
            };
            let index = movable.iter().position(|id| *id == role.id);
            let (can_move_up, can_move_down) = match index {
                Some(index) if update => (
                    index > 0 && swapped(index - 1, index),
                    index + 1 < movable.len() && swapped(index, index + 1),
                ),
                _ => (false, false),
            };
            RoleRow {
                id: role.id.clone(),
                name: role.name.clone(),
                position: role.position as i32,
                is_default: role.is_default,
                editable: edit_blocked.is_none(),
                deletable: delete_blocked.is_none(),
                assignable: assign_blocked.is_none(),
                fixed: is_fixed(role),
                can_move_up,
                can_move_down,
                created_at_ms: Some(role.created_at.timestamp_millis()),
                edit_blocked,
                delete_blocked,
                assign_blocked,
                actions,
            }
        })
        .collect()
}

/// A role's name as the server takes it: trimmed, 1 to 50 characters (the wire type counts
/// characters, and checks only the upper bound).
pub(crate) fn role_name(name: &str) -> Result<String, CoreError> {
    let name = name.trim();
    let count = name.chars().count();
    if (1..=50).contains(&count) {
        Ok(name.to_owned())
    } else {
        Err(CoreError::Failed {
            message: "A role needs a name of 1 to 50 characters".into(),
        })
    }
}

/// `@ArrayMinSize(1)`: a role holds at least one action.
fn role_actions(actions: &[String]) -> Result<Vec<wire_enums::RbacAction>, CoreError> {
    if actions.is_empty() {
        return Err(CoreError::Failed {
            message: "A role needs at least one permission".into(),
        });
    }
    Ok(actions.iter().map(|name| wire_action(name)).collect())
}

impl Core {
    /// `ViewKey::Roles`: the community's roles, highest first, with what this user may do to each.
    pub fn roles(&self, community_id: String) -> RolesView {
        self.write(|state, _| {
            let view = ViewKey::Roles {
                community_id: community_id.clone(),
            };
            state.w5b_watch(&community_id, view.clone());
            let me_id = state.me_id().to_owned();
            let me = state.w5b_standing(&community_id, &me_id);
            let roles = state.w5b_community_roles(&community_id).unwrap_or_default();
            let (update, create) = (me.has("UPDATE_ROLE"), me.has("CREATE_ROLE"));
            let grantable: Vec<String> = if me.owner {
                known_actions().map(str::to_owned).collect()
            } else {
                me.actions.iter().cloned().collect()
            };
            RolesView {
                state: state.load_of(&shared::scoped(keys::ROLES, &community_id)),
                roles: role_rows(&roles, &me),
                grantable,
                can_create: create,
                can_reorder: update,
                can_reset_defaults: update,
                can_read: me.has("READ_ROLE"),
                op: state.w5a_op(&view),
                community_id,
            }
        })
    }

    /// The permission matrix's groups, in the web's order.
    pub fn permission_catalog(&self) -> Vec<PermissionGroup> {
        CATALOG
            .iter()
            .map(|(id, actions)| PermissionGroup {
                id: (*id).to_owned(),
                actions: actions.iter().map(|action| (*action).to_owned()).collect(),
            })
            .collect()
    }

    fn roles_op(community_id: &str, kind: AdminActionKind, target: Option<String>) -> OpKey {
        OpKey::new(
            ViewKey::Roles {
                community_id: community_id.to_owned(),
            },
            kind,
            target,
        )
    }

    fn roles_refresh(community_id: &str) -> Vec<crate::cache::QueryKey> {
        vec![
            shared::scoped(keys::ROLES, community_id),
            shared::scoped(keys::MY_ROLES, community_id),
            shared::scoped(keys::USER_ROLES, community_id),
            shared::scoped(keys::ROLE_USERS, community_id),
        ]
    }

    /// A change shown on each of `ops` (its own action there: busy, then its error), the queries
    /// to read again after it. `checked` refuses it before anything is sent.
    pub(crate) async fn w5b_change<T>(
        &self,
        ops: &[OpKey],
        what: &str,
        checked: Result<(), CoreError>,
        run: impl AsyncFnOnce(&crate::client::Services) -> Result<T, crate::backend::BackendError>,
        refresh: &[crate::cache::QueryKey],
    ) -> Result<T, CoreError> {
        if let Err(error) = checked {
            self.write(|state, _| {
                for op in ops {
                    state.w5a_op_refused(op, &error);
                }
            });
            return Err(error);
        }
        let (services, epoch) = self.begin(what)?;
        let changes: Vec<u64> =
            self.write(|state, _| ops.iter().map(|op| state.w5a_op_begin(op)).collect());
        let result = run(&services).await;
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            // The server's own message, as a UI shows it.
            let error = result.as_ref().err().map(|error| error.view());
            for (op, change) in ops.iter().zip(&changes) {
                state.w5a_op_end(op, *change, error.clone());
            }
            for key in refresh {
                state.invalidate(key);
            }
        });
        result.map_err(|error| self.backend_failed(error))
    }

    /// Makes a role (placed by the server just below this user's own); returns its id. The name
    /// is trimmed and 1 to 50 characters, with at least one action, or nothing is sent.
    pub async fn create_role(
        &self,
        community_id: String,
        draft: RoleDraft,
    ) -> Result<String, CoreError> {
        let op = Self::roles_op(&community_id, AdminActionKind::CreateRole, None);
        let body = role_name(&draft.name).and_then(|name| {
            Ok(wire::CreateRoleDto {
                actions: role_actions(&draft.actions)?,
                name: name.parse().map_err(|_| CoreError::Failed {
                    message: "A role needs a name of 1 to 50 characters".into(),
                })?,
                position: None,
            })
        });
        let (checked, body) = match body {
            Ok(body) => (Ok(()), Some(body)),
            Err(error) => (Err(error), None),
        };
        let id = community_id.clone();
        self.w5b_change(
            &[op],
            "creating a role",
            checked,
            async move |services| {
                services
                    .backend
                    .roles_controller_create_community_role(id, body.expect("checked"))
                    .await
            },
            &Self::roles_refresh(&community_id),
        )
        .await
        .map(|role| role.id)
    }

    /// Changes what `patch` names: an unchanged field isn't sent, and a default role's name never
    /// is (the server refuses renaming one). `actions` replaces the whole list, actions this build
    /// doesn't know included.
    pub async fn update_role(
        &self,
        community_id: String,
        role_id: String,
        patch: RolePatch,
    ) -> Result<(), CoreError> {
        let op = Self::roles_op(
            &community_id,
            AdminActionKind::UpdateRole,
            Some(role_id.clone()),
        );
        let current = self.write(|state, _| {
            state
                .w5b_community_roles(&community_id)
                .and_then(|roles| roles.into_iter().find(|role| role.id == role_id))
        });
        let body = (|| -> Result<wire::UpdateRoleDto, CoreError> {
            let name = match &patch.name {
                Some(name) => {
                    let name = role_name(name)?;
                    let unchanged = current.as_ref().is_some_and(|role| role.name == name);
                    let default = current.as_ref().is_some_and(|role| role.is_default);
                    if unchanged || default {
                        None
                    } else {
                        Some(name.parse().map_err(|_| CoreError::Failed {
                            message: "A role needs a name of 1 to 50 characters".into(),
                        })?)
                    }
                }
                None => None,
            };
            let actions = match &patch.actions {
                Some(actions) => {
                    let unchanged = current.as_ref().is_some_and(|role| {
                        action_names(&role.actions).collect::<Vec<_>>() == *actions
                    });
                    if unchanged {
                        Vec::new()
                    } else {
                        role_actions(actions)?
                    }
                }
                None => Vec::new(),
            };
            Ok(wire::UpdateRoleDto {
                actions,
                name,
                position: None,
            })
        })();
        let (checked, body) = match body {
            Ok(body) => (Ok(()), Some(body)),
            Err(error) => (Err(error), None),
        };
        let id = community_id.clone();
        self.w5b_change(
            &[op],
            "updating a role",
            checked,
            async move |services| {
                services
                    .backend
                    .roles_controller_update_role(id, role_id, body.expect("checked"))
                    .await
            },
            &Self::roles_refresh(&community_id),
        )
        .await
        .map(|_| ())
    }

    pub async fn delete_role(
        &self,
        community_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        let op = Self::roles_op(
            &community_id,
            AdminActionKind::DeleteRole,
            Some(role_id.clone()),
        );
        let id = community_id.clone();
        self.w5b_change(
            &[op],
            "deleting a role",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .roles_controller_delete_role(id, role_id)
                    .await
            },
            &Self::roles_refresh(&community_id),
        )
        .await
    }

    /// The roles in their new order, highest first. "Member" stays last whatever is sent, and the
    /// server wants every other role in the list.
    pub async fn reorder_roles(
        &self,
        community_id: String,
        role_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        let op = Self::roles_op(&community_id, AdminActionKind::ReorderRoles, None);
        let id = community_id.clone();
        self.w5b_change(
            &[op],
            "reordering roles",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .roles_controller_reorder_roles(id, wire::ReorderRolesDto { role_ids })
                    .await
            },
            &Self::roles_refresh(&community_id),
        )
        .await
        .map(|_| ())
    }

    pub async fn reset_default_roles(&self, community_id: String) -> Result<(), CoreError> {
        let op = Self::roles_op(&community_id, AdminActionKind::ResetDefaults, None);
        let id = community_id.clone();
        self.w5b_change(
            &[op],
            "resetting the default roles",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .roles_controller_reset_default_community_roles(id)
                    .await
            },
            &Self::roles_refresh(&community_id),
        )
        .await
        .map(|_| ())
    }

    /// Who holds a role (`ViewKey::RoleMembers`).
    pub fn role_members(&self, community_id: String, role_id: String) -> RoleMembersView {
        self.write(|state, _| {
            let key = key2(keys::ROLE_USERS, &community_id, &role_id);
            state.w5b_watch(
                &community_id,
                ViewKey::RoleMembers {
                    community_id: community_id.clone(),
                    role_id: role_id.clone(),
                },
            );
            state.ensure_query(key.clone());
            let users = match state.w5b_value(&key) {
                Some(W5bValue::RoleUsers(users)) => users
                    .iter()
                    .map(|user| UserView {
                        id: user.user_id.clone(),
                        username: user.username.clone(),
                        display_name: user.display_name.clone(),
                        avatar_file_id: None,
                    })
                    .collect(),
                _ => Vec::new(),
            };
            RoleMembersView {
                state: state.load_of(&key),
                role_id,
                users,
            }
        })
    }

    /// One member's roles, for the assignment dialog (`ViewKey::MemberRoles`).
    pub fn member_roles(&self, community_id: String, user_id: String) -> MemberRolesView {
        self.write(|state, _| {
            let view = ViewKey::MemberRoles {
                community_id: community_id.clone(),
                user_id: user_id.clone(),
            };
            state.w5b_watch(&community_id, view.clone());
            let me_id = state.me_id().to_owned();
            let me = state.w5b_standing(&community_id, &me_id);
            let them = state.w5b_standing(&community_id, &user_id);
            let roles = state.w5b_community_roles(&community_id).unwrap_or_default();
            let key = if user_id == me_id {
                shared::scoped(keys::MY_ROLES, &community_id)
            } else {
                key2(keys::USER_ROLES, &community_id, &user_id)
            };
            let outranks = me.owner
                || me.top
                || user_id == me_id
                || (me.best != i64::MAX && me.best < them.best);
            let not_allowed = if !me.has("UPDATE_MEMBER") {
                Some(NotAllowed::Missing)
            } else if !outranks {
                Some(NotAllowed::Rank)
            } else {
                None
            };
            let may_change = not_allowed.is_none();
            let changeable = if may_change {
                roles
                    .iter()
                    .filter(|role| {
                        me.manages(role.position)
                            && me.holds(
                                action_names(&role.actions)
                                    .collect::<Vec<_>>()
                                    .iter()
                                    .map(String::as_str),
                            )
                    })
                    .map(|role| role.id.clone())
                    .collect()
            } else {
                Vec::new()
            };
            MemberRolesView {
                state: state.load_of(&key),
                held: them.role_ids.iter().cloned().collect(),
                changeable,
                not_allowed,
                op: state.w5a_op(&view),
                user_id,
            }
        })
    }

    async fn member_roles_change(
        &self,
        community_id: String,
        user_id: String,
        op: (AdminActionKind, String),
        what: &str,
        checked: Result<(), CoreError>,
        run: impl AsyncFnOnce(&crate::client::Services) -> Result<(), crate::backend::BackendError>,
    ) -> Result<(), CoreError> {
        let op = OpKey::new(
            ViewKey::MemberRoles {
                community_id: community_id.clone(),
                user_id: user_id.clone(),
            },
            op.0,
            Some(op.1),
        );
        self.w5b_change(
            &[op],
            what,
            checked,
            run,
            &[
                key2(keys::USER_ROLES, &community_id, &user_id),
                shared::scoped(keys::MY_ROLES, &community_id),
                shared::scoped(keys::ROLE_USERS, &community_id),
                shared::scoped(shared::MEMBERS, &community_id),
            ],
        )
        .await
    }

    pub async fn assign_role(
        &self,
        community_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        let body = uuid(&role_id, "The role").and_then(|role| {
            Ok(wire::AssignRoleDto {
                role_id: role,
                user_id: uuid(&user_id, "The member")?,
            })
        });
        let (checked, body) = match body {
            Ok(body) => (Ok(()), Some(body)),
            Err(error) => (Err(error), None),
        };
        let id = community_id.clone();
        self.member_roles_change(
            community_id,
            user_id,
            (AdminActionKind::AssignRole, role_id),
            "assigning a role",
            checked,
            async move |services| {
                services
                    .backend
                    .roles_controller_assign_role_to_user(id, body.expect("checked"))
                    .await
            },
        )
        .await
    }

    pub async fn unassign_role(
        &self,
        community_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        let (id, user, role) = (community_id.clone(), user_id.clone(), role_id.clone());
        self.member_roles_change(
            community_id,
            user_id,
            (AdminActionKind::UnassignRole, role_id),
            "removing a role",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .roles_controller_remove_role_from_user(id, user, role)
                    .await
            },
        )
        .await
    }

    /// A channel's overrides (`ViewKey::ChannelOverwrites`), roles named from the community's,
    /// with the preset they are and what this user may apply.
    pub fn channel_overwrites(&self, channel_id: String) -> ChannelOverwritesView {
        self.write(|state, _| {
            let key = shared::scoped(keys::OVERWRITES, &channel_id);
            let community_id = state.community_of_channel(&channel_id);
            let me_id = state.me_id().to_owned();
            let (me, roles) = match &community_id {
                Some(community_id) => {
                    state.w5b_watch(
                        community_id,
                        ViewKey::ChannelOverwrites {
                            channel_id: channel_id.clone(),
                        },
                    );
                    let me = state.w5b_standing(community_id, &me_id);
                    let roles = state.w5b_community_roles(community_id).unwrap_or_default();
                    (me, roles)
                }
                None => (Standing::default(), Vec::new()),
            };
            state.ensure_query(key.clone());
            let stored: Vec<wire::ChannelOverwriteDto> = match state.w5b_value(&key) {
                Some(W5bValue::Overwrites(found)) => found.overwrites.clone(),
                _ => Vec::new(),
            };
            let preset = match state.w5b_value(&key) {
                Some(W5bValue::Overwrites(found)) => {
                    super::communities::channel_preset(&found.preset)
                }
                _ => ChannelPreset::Normal,
            };
            // Per-member rows (data model only) and a role row without a role aren't editable here:
            // they make the set custom.
            let odd = stored.iter().any(|row| match row.target_type {
                WireTarget::Everyone => false,
                WireTarget::Role => row.role_id.is_none(),
                _ => true,
            });
            let overwrites: Vec<OverwriteRow> = stored
                .iter()
                .filter(|row| {
                    matches!(row.target_type, WireTarget::Everyone)
                        || (matches!(row.target_type, WireTarget::Role) && row.role_id.is_some())
                })
                .map(|row| {
                    let known = row
                        .role_id
                        .as_ref()
                        .and_then(|id| roles.iter().find(|role| role.id == *id));
                    OverwriteRow {
                        target: match (&row.target_type, &row.role_id) {
                            (WireTarget::Role, Some(role_id)) => OverwriteTarget::Role {
                                role_id: role_id.clone(),
                                name: known
                                    .map_or_else(|| role_id.clone(), |role| role.name.clone()),
                            },
                            _ => OverwriteTarget::Everyone,
                        },
                        allow: action_names(&row.allow).collect(),
                        deny: action_names(&row.deny).collect(),
                        role_missing: matches!(row.target_type, WireTarget::Role)
                            && known.is_none(),
                    }
                })
                .collect();
            let below = |role: &wire::RoleDto| me.owner || role.position > me.best;
            let preset_access = [
                ChannelPreset::Normal,
                ChannelPreset::ReadOnly,
                ChannelPreset::Announcement,
            ]
            .into_iter()
            .map(|preset| PresetAccess {
                preset,
                missing: if me.owner {
                    Vec::new()
                } else {
                    presets::denies(preset, false)
                        .into_iter()
                        .filter(|action| !me.actions.contains(*action))
                        .map(str::to_owned)
                        .collect()
                },
            })
            .collect();
            ChannelOverwritesView {
                state: state.load_of(&key),
                op: state.w5a_op(&ViewKey::ChannelOverwrites {
                    channel_id: channel_id.clone(),
                }),
                detected: if odd {
                    DetectedPreset {
                        preset: ChannelPreset::Custom,
                        post_role_ids: Vec::new(),
                        members_can_attach: true,
                    }
                } else {
                    presets::detect(&overwrites)
                },
                default_post_role_ids: roles
                    .iter()
                    .filter(|role| {
                        below(role)
                            && role
                                .actions
                                .iter()
                                .any(|action| action.as_str() == "MANAGE_CHANNEL_PERMISSIONS")
                    })
                    .map(|role| role.id.clone())
                    .collect(),
                roles: roles
                    .iter()
                    .map(|role| OverwriteRoleOption {
                        id: role.id.clone(),
                        name: role.name.clone(),
                        position: role.position as i32,
                        below_me: below(role),
                    })
                    .collect(),
                preset_access,
                editable: me.has("MANAGE_CHANNEL_PERMISSIONS"),
                channel_id,
                preset,
                overwrites,
            }
        })
    }

    /// The overrides a preset is for this channel (`buildPresetOverwrites`): the community's roles
    /// and this user's rank decide the automatic allows. Only Normal, ReadOnly and Announcement
    /// build; any other preset gives no overrides.
    pub fn build_preset(
        &self,
        channel_id: String,
        preset: ChannelPreset,
        post_role_ids: Vec<String>,
        members_can_attach: bool,
    ) -> BuiltPreset {
        self.write(|state, _| {
            let Some(community_id) = state.community_of_channel(&channel_id) else {
                return presets::build(preset, &post_role_ids, members_can_attach, &[], None);
            };
            let me_id = state.me_id().to_owned();
            let me = state.w5b_standing(&community_id, &me_id);
            let roles: Vec<presets::Role> = state
                .w5b_community_roles(&community_id)
                .unwrap_or_default()
                .iter()
                .map(|role| presets::Role {
                    id: role.id.clone(),
                    name: role.name.clone(),
                    position: role.position,
                    actions: action_names(&role.actions).collect(),
                })
                .collect();
            let actor = if me.owner { None } else { Some(me.best) };
            presets::build(preset, &post_role_ids, members_can_attach, &roles, actor)
        })
    }

    /// Replaces the channel's preset and overrides with these. Only actions a channel can
    /// override are accepted by the server; `OverwriteTarget::Everyone` once at most.
    pub async fn replace_channel_overwrites(
        &self,
        channel_id: String,
        draft: OverwritesDraft,
    ) -> Result<(), CoreError> {
        let op = OpKey::new(
            ViewKey::ChannelOverwrites {
                channel_id: channel_id.clone(),
            },
            AdminActionKind::ReplaceOverwrites,
            Some(channel_id.clone()),
        );
        let mut rows = Vec::new();
        let mut checked = Ok(());
        for row in &draft.overwrites {
            let (target_type, role_id) = match &row.target {
                OverwriteTarget::Everyone => (WireTarget::Everyone, None),
                OverwriteTarget::Role { role_id, .. } => match uuid(role_id, "The role") {
                    Ok(id) => (WireTarget::Role, Some(id)),
                    Err(error) => {
                        checked = Err(error);
                        break;
                    }
                },
            };
            rows.push(wire::ReplaceOverwriteInputDto {
                allow: row.allow.iter().map(|name| wire_action(name)).collect(),
                deny: row.deny.iter().map(|name| wire_action(name)).collect(),
                role_id,
                target_type,
            });
        }
        let body = wire::ReplaceChannelOverwritesDto {
            overwrites: rows,
            preset: wire_preset(draft.preset),
        };
        let id = channel_id.clone();
        let community = self.read(|state| state.community_of_channel(&channel_id));
        let mut refresh = vec![shared::scoped(keys::OVERWRITES, &channel_id)];
        if let Some(community_id) = community {
            refresh.push(shared::scoped(shared::CAPABILITIES, &community_id));
        }
        self.w5b_change(
            &[op],
            "changing channel permissions",
            checked,
            async move |services| {
                services
                    .backend
                    .channel_permissions_controller_replace_overwrites(id, body)
                    .await
            },
            &refresh,
        )
        .await
        .map(|_| ())
    }
}

/// `shared/src/permissions/channel-presets.ts`, ported exactly: the overrides each preset is, and
/// the reverse. Positions as the backend has them: lower ranks higher.
pub mod presets {
    use crate::model::{BuiltPreset, ChannelPreset, DetectedPreset, OverwriteRow, OverwriteTarget};
    use std::collections::{BTreeSet, HashMap};

    /// A community role, as `PresetRole`.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Role {
        pub id: String,
        pub name: String,
        pub position: i64,
        pub actions: Vec<String>,
    }

    /// `PRESET_DENIES`: what a preset takes from @everyone (and gives back to its post roles).
    pub fn full_denies(preset: ChannelPreset) -> &'static [&'static str] {
        match preset {
            ChannelPreset::ReadOnly => &["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"],
            ChannelPreset::Announcement => &["CREATE_MESSAGE", "ATTACH_FILES"],
            _ => &[],
        }
    }

    /// `presetDenies`.
    pub fn denies(preset: ChannelPreset, members_can_attach: bool) -> Vec<&'static str> {
        match preset {
            ChannelPreset::Normal if !members_can_attach => vec!["ATTACH_FILES"],
            ChannelPreset::ReadOnly | ChannelPreset::Announcement => full_denies(preset).to_vec(),
            _ => Vec::new(),
        }
    }

    fn row(target: OverwriteTarget, allow: Vec<String>, deny: Vec<String>) -> OverwriteRow {
        OverwriteRow {
            target,
            allow,
            deny,
            role_missing: false,
        }
    }

    /// `buildPresetOverwrites`. `actor_best`: the actor's best position, `None` for the instance
    /// owner (no automatic allows).
    pub fn build(
        preset: ChannelPreset,
        post_role_ids: &[String],
        members_can_attach: bool,
        roles: &[Role],
        actor_best: Option<i64>,
    ) -> BuiltPreset {
        let deny = denies(preset, members_can_attach);
        if deny.is_empty() {
            return BuiltPreset {
                preset,
                overwrites: Vec::new(),
                auto_allowed_role_ids: Vec::new(),
            };
        }
        let mut allows: Vec<(String, BTreeSet<&'static str>)> = Vec::new();
        let add = |allows: &mut Vec<(String, BTreeSet<&'static str>)>,
                   id: &str,
                   actions: &[&'static str]| {
            match allows.iter_mut().find(|(known, _)| known == id) {
                Some((_, set)) => set.extend(actions.iter().copied()),
                None => allows.push((id.to_owned(), actions.iter().copied().collect())),
            }
        };
        if preset != ChannelPreset::Normal {
            for id in post_role_ids {
                add(&mut allows, id, &deny);
            }
        }
        let mut auto_allowed_role_ids = Vec::new();
        if let Some(best) = actor_best {
            for role in roles {
                if role.position > best {
                    continue;
                }
                let kept: Vec<&'static str> = deny
                    .iter()
                    .copied()
                    .filter(|action| role.actions.iter().any(|held| held == action))
                    .collect();
                if kept.is_empty() {
                    continue;
                }
                let already = allows.iter().find(|(id, _)| *id == role.id);
                if already.is_none_or(|(_, set)| kept.iter().any(|action| !set.contains(action))) {
                    auto_allowed_role_ids.push(role.id.clone());
                }
                add(&mut allows, &role.id, &kept);
            }
        }
        let rank: HashMap<&str, i64> = roles
            .iter()
            .map(|role| (role.id.as_str(), role.position))
            .collect();
        let mut ids: Vec<&(String, BTreeSet<&'static str>)> = allows.iter().collect();
        ids.sort_by(|a, b| {
            let (ra, rb) = (
                rank.get(a.0.as_str()).copied().unwrap_or(0),
                rank.get(b.0.as_str()).copied().unwrap_or(0),
            );
            ra.cmp(&rb).then_with(|| a.0.cmp(&b.0))
        });
        let mut overwrites = vec![row(
            OverwriteTarget::Everyone,
            Vec::new(),
            deny.iter().map(|a| (*a).to_owned()).collect(),
        )];
        for (id, set) in ids {
            let name = roles
                .iter()
                .find(|role| role.id == *id)
                .map_or_else(String::new, |role| role.name.clone());
            overwrites.push(row(
                OverwriteTarget::Role {
                    role_id: id.clone(),
                    name,
                },
                deny.iter()
                    .filter(|action| set.contains(*action))
                    .map(|a| (*a).to_owned())
                    .collect(),
                Vec::new(),
            ));
        }
        BuiltPreset {
            preset,
            overwrites,
            auto_allowed_role_ids,
        }
    }

    fn same_set(a: &[String], b: &[&str]) -> bool {
        a.len() == b.len() && a.iter().all(|x| b.contains(&x.as_str()))
    }

    /// `detectPreset`. Role allows that are a strict subset of the preset's denies are the
    /// automatic allows, not post roles.
    pub fn detect(overwrites: &[OverwriteRow]) -> DetectedPreset {
        let custom = DetectedPreset {
            preset: ChannelPreset::Custom,
            post_role_ids: Vec::new(),
            members_can_attach: true,
        };
        if overwrites.is_empty() {
            return DetectedPreset {
                preset: ChannelPreset::Normal,
                post_role_ids: Vec::new(),
                members_can_attach: true,
            };
        }
        let everyone: Vec<&OverwriteRow> = overwrites
            .iter()
            .filter(|row| matches!(row.target, OverwriteTarget::Everyone))
            .collect();
        let roles: Vec<(&String, &OverwriteRow)> = overwrites
            .iter()
            .filter_map(|row| match &row.target {
                OverwriteTarget::Role { role_id, .. } => Some((role_id, row)),
                OverwriteTarget::Everyone => None,
            })
            .collect();
        if everyone.len() != 1 || !everyone[0].allow.is_empty() {
            return custom;
        }
        if roles.iter().any(|(_, row)| !row.deny.is_empty()) {
            return custom;
        }
        let deny = &everyone[0].deny;
        if same_set(deny, &["ATTACH_FILES"]) {
            return if roles
                .iter()
                .all(|(_, row)| row.allow.iter().all(|a| a == "ATTACH_FILES"))
            {
                DetectedPreset {
                    preset: ChannelPreset::Normal,
                    post_role_ids: Vec::new(),
                    members_can_attach: false,
                }
            } else {
                custom
            };
        }
        for preset in [ChannelPreset::ReadOnly, ChannelPreset::Announcement] {
            let full = full_denies(preset);
            if !same_set(deny, full) {
                continue;
            }
            if !roles.iter().all(|(_, row)| {
                !row.allow.is_empty() && row.allow.iter().all(|a| full.contains(&a.as_str()))
            }) {
                return custom;
            }
            return DetectedPreset {
                preset,
                post_role_ids: roles
                    .iter()
                    .filter(|(_, row)| same_set(&row.allow, full))
                    .map(|(id, _)| (*id).clone())
                    .collect(),
                members_can_attach: false,
            };
        }
        custom
    }
}
