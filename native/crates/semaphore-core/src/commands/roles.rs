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

use super::moderation::{W5bValue, key2, keys};
use super::permissions::{Standing, action_names};
use crate::cache::keys as shared;
use crate::client::Core;
use crate::model::{
    ChannelOverwritesView, ChannelPreset, MemberRolesView, OverwriteRow, OverwriteTarget,
    OverwritesDraft, PermissionGroup, RoleDraft, RoleMembersView, RoleRow, RolesView, UserView,
    ViewKey,
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

fn role_row(
    role: &wire::RoleDto,
    me: &Standing,
    assign: bool,
    update: bool,
    delete: bool,
) -> RoleRow {
    let actions: Vec<String> = action_names(&role.actions).collect();
    let below = me.manages(role.position);
    let holds = me.holds(actions.iter().map(String::as_str));
    RoleRow {
        id: role.id.clone(),
        name: role.name.clone(),
        position: role.position as i32,
        is_default: role.is_default,
        editable: update && below && holds,
        deletable: delete && below && !role.is_default,
        assignable: assign && below && holds,
        actions,
    }
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
            let (assign, update, delete, create) = (
                me.has("UPDATE_MEMBER"),
                me.has("UPDATE_ROLE"),
                me.has("DELETE_ROLE"),
                me.has("CREATE_ROLE"),
            );
            let grantable: Vec<String> = if me.owner {
                known_actions().map(str::to_owned).collect()
            } else {
                me.actions.iter().cloned().collect()
            };
            RolesView {
                state: state.load_of(&shared::scoped(keys::ROLES, &community_id)),
                roles: roles
                    .iter()
                    .map(|role| role_row(role, &me, assign, update, delete))
                    .collect(),
                grantable,
                can_create: create,
                can_reorder: update,
                can_reset_defaults: update,
                op: state.w5b_op(&view),
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

    /// Runs a change of the Roles view: busy while it runs, its error kept until the next one.
    async fn roles_change<T>(
        &self,
        community_id: &str,
        what: &str,
        run: impl AsyncFnOnce(&crate::client::Services) -> Result<T, crate::backend::BackendError>,
    ) -> Result<T, CoreError> {
        let view = ViewKey::Roles {
            community_id: community_id.to_owned(),
        };
        self.change(
            view,
            what,
            run,
            &[
                shared::scoped(keys::ROLES, community_id),
                shared::scoped(keys::MY_ROLES, community_id),
                shared::scoped(keys::USER_ROLES, community_id),
                shared::scoped(keys::ROLE_USERS, community_id),
            ],
        )
        .await
    }

    /// A change shown on `view`, and the queries to read again after it.
    pub(crate) async fn change<T>(
        &self,
        view: ViewKey,
        what: &str,
        run: impl AsyncFnOnce(&crate::client::Services) -> Result<T, crate::backend::BackendError>,
        refresh: &[crate::cache::QueryKey],
    ) -> Result<T, CoreError> {
        let (services, epoch) = self.begin(what)?;
        self.write(|state, _| state.w5b_set_op(view.clone(), true, None));
        let result = run(&services)
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            let error = result.as_ref().err().map(super::core_error_view);
            state.w5b_set_op(view.clone(), false, error);
            for key in refresh {
                state.invalidate(key);
            }
        });
        result
    }

    /// Makes a role (placed by the server just below this user's own); returns its id.
    pub async fn create_role(
        &self,
        community_id: String,
        draft: RoleDraft,
    ) -> Result<String, CoreError> {
        let body = wire::CreateRoleDto {
            actions: draft.actions.iter().map(|name| wire_action(name)).collect(),
            name: draft
                .name
                .trim()
                .to_owned()
                .try_into()
                .map_err(|_| CoreError::Failed {
                    message: "A role needs a name of 1 to 50 characters".into(),
                })?,
            position: None,
        };
        let id = community_id.clone();
        self.roles_change(&community_id, "creating a role", async move |services| {
            services
                .backend
                .roles_controller_create_community_role(id, body)
                .await
        })
        .await
        .map(|role| role.id)
    }

    /// Renames a role (not a default one) and sets its actions: `draft.actions` replaces them all.
    pub async fn update_role(
        &self,
        community_id: String,
        role_id: String,
        draft: RoleDraft,
    ) -> Result<(), CoreError> {
        let body =
            wire::UpdateRoleDto {
                actions: draft.actions.iter().map(|name| wire_action(name)).collect(),
                name: Some(draft.name.trim().to_owned().try_into().map_err(|_| {
                    CoreError::Failed {
                        message: "A role needs a name of 1 to 50 characters".into(),
                    }
                })?),
                position: None,
            };
        let id = community_id.clone();
        self.roles_change(&community_id, "updating a role", async move |services| {
            services
                .backend
                .roles_controller_update_role(id, role_id, body)
                .await
        })
        .await
        .map(|_| ())
    }

    pub async fn delete_role(
        &self,
        community_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        let id = community_id.clone();
        self.roles_change(&community_id, "deleting a role", async move |services| {
            services
                .backend
                .roles_controller_delete_role(id, role_id)
                .await
        })
        .await
    }

    /// The roles in their new order, highest first. "Member" stays last whatever is sent, and the
    /// server wants every other role in the list.
    pub async fn reorder_roles(
        &self,
        community_id: String,
        role_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        let id = community_id.clone();
        self.roles_change(&community_id, "reordering roles", async move |services| {
            services
                .backend
                .roles_controller_reorder_roles(id, wire::ReorderRolesDto { role_ids })
                .await
        })
        .await
        .map(|_| ())
    }

    pub async fn reset_default_roles(&self, community_id: String) -> Result<(), CoreError> {
        let id = community_id.clone();
        self.roles_change(
            &community_id,
            "resetting the default roles",
            async move |services| {
                services
                    .backend
                    .roles_controller_reset_default_community_roles(id)
                    .await
            },
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
            let may_change = me.has("UPDATE_MEMBER")
                && (me.owner
                    || me.top
                    || user_id == me_id
                    || (me.best != i64::MAX && me.best < them.best));
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
                op: state.w5b_op(&view),
                user_id,
            }
        })
    }

    async fn member_roles_change(
        &self,
        community_id: String,
        user_id: String,
        what: &str,
        run: impl AsyncFnOnce(&crate::client::Services) -> Result<(), crate::backend::BackendError>,
    ) -> Result<(), CoreError> {
        let view = ViewKey::MemberRoles {
            community_id: community_id.clone(),
            user_id: user_id.clone(),
        };
        self.change(
            view,
            what,
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
        let body = wire::AssignRoleDto {
            role_id: uuid(&role_id, "The role")?,
            user_id: uuid(&user_id, "The member")?,
        };
        let id = community_id.clone();
        self.member_roles_change(
            community_id,
            user_id,
            "assigning a role",
            async move |services| {
                services
                    .backend
                    .roles_controller_assign_role_to_user(id, body)
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
        let (id, user) = (community_id.clone(), user_id.clone());
        self.member_roles_change(
            community_id,
            user_id,
            "removing a role",
            async move |services| {
                services
                    .backend
                    .roles_controller_remove_role_from_user(id, user, role_id)
                    .await
            },
        )
        .await
    }

    /// A channel's overrides (`ViewKey::ChannelOverwrites`), roles named from the community's.
    pub fn channel_overwrites(&self, channel_id: String) -> ChannelOverwritesView {
        self.write(|state, _| {
            let key = shared::scoped(keys::OVERWRITES, &channel_id);
            let community_id = state.community_of_channel(&channel_id);
            let me_id = state.me_id().to_owned();
            let (editable, roles) = match &community_id {
                Some(community_id) => {
                    state.w5b_watch(
                        community_id,
                        ViewKey::ChannelOverwrites {
                            channel_id: channel_id.clone(),
                        },
                    );
                    let me = state.w5b_standing(community_id, &me_id);
                    (
                        me.has("MANAGE_CHANNEL_PERMISSIONS"),
                        state.w5b_community_roles(community_id).unwrap_or_default(),
                    )
                }
                None => (false, Vec::new()),
            };
            state.ensure_query(key.clone());
            let (preset, overwrites) = match state.w5b_value(&key) {
                Some(W5bValue::Overwrites(found)) => (
                    super::communities::channel_preset(&found.preset),
                    found
                        .overwrites
                        .iter()
                        .map(|row| OverwriteRow {
                            target: match (&row.target_type, &row.role_id) {
                                (WireTarget::Role, Some(role_id)) => OverwriteTarget::Role {
                                    role_id: role_id.clone(),
                                    name: roles
                                        .iter()
                                        .find(|role| role.id == *role_id)
                                        .map_or_else(|| role_id.clone(), |role| role.name.clone()),
                                },
                                _ => OverwriteTarget::Everyone,
                            },
                            allow: action_names(&row.allow).collect(),
                            deny: action_names(&row.deny).collect(),
                        })
                        .collect(),
                ),
                _ => (ChannelPreset::Normal, Vec::new()),
            };
            ChannelOverwritesView {
                state: state.load_of(&key),
                op: state.w5b_op(&ViewKey::ChannelOverwrites {
                    channel_id: channel_id.clone(),
                }),
                channel_id,
                preset,
                overwrites,
                editable,
            }
        })
    }

    /// Replaces the channel's preset and overrides with these. Only actions a channel can
    /// override are accepted by the server; `OverwriteTarget::Everyone` once at most.
    pub async fn replace_channel_overwrites(
        &self,
        channel_id: String,
        draft: OverwritesDraft,
    ) -> Result<(), CoreError> {
        let mut rows = Vec::new();
        for row in &draft.overwrites {
            let (target_type, role_id) = match &row.target {
                OverwriteTarget::Everyone => (WireTarget::Everyone, None),
                OverwriteTarget::Role { role_id, .. } => {
                    (WireTarget::Role, Some(uuid(role_id, "The role")?))
                }
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
        let view = ViewKey::ChannelOverwrites {
            channel_id: channel_id.clone(),
        };
        let id = channel_id.clone();
        let community = self.read(|state| state.community_of_channel(&channel_id));
        let mut refresh = vec![shared::scoped(keys::OVERWRITES, &channel_id)];
        if let Some(community_id) = community {
            refresh.push(shared::scoped(shared::CAPABILITIES, &community_id));
        }
        self.change(
            view,
            "changing channel permissions",
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
