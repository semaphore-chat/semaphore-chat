//! W5-B: the fake's permission model, with the backend's rules (`backend/src/auth/rbac.guard.ts`,
//! `roles/permissions.service.ts`, `roles/community-roles.service.ts`,
//! `moderation/moderation.service.ts`, `channel-permissions/channel-permissions.service.ts`).
//!
//! - Roles per community, with positions (lower ranks higher) and actions, seeded from the
//!   scenario's `rolesByCommunity`; who holds them from `membershipsByCommunity` (or, for a
//!   community made over the API, its members' roles).
//! - [`allows`]: the instance owner may do anything (`RbacGuard`); anyone else what the union of
//!   their community roles holds.
//! - Rank: a user's best (lowest) position; no role ranks below everyone. Moderation needs a strict
//!   outrank, and the backend gives the instance owner no way past that (#679): neither does this.
//! - Bans, timeouts, channel overrides and the moderation log live here too.
//!
//! Lock order: `accounts` before `rbac`; `rbac` is never held with `data`, `admin` or `calls`.

use crate::{Inner, lock};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use semaphore_wire::enums::{ChannelPreset, InstanceRole, RbacAction};
use semaphore_wire::types::{ChannelOverwriteDto, RoleDto};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// A refusal as the backend sends it: status, `ErrorCode`, message.
pub(crate) type Refusal = (u16, &'static str, String);

pub(crate) fn refuse(status: u16, code: &'static str, message: impl Into<String>) -> Refusal {
    (status, code, message.into())
}

/// What `RbacGuard` answers when the actions aren't held.
pub(crate) fn guard_refusal() -> Refusal {
    refuse(403, "FORBIDDEN", "Forbidden resource")
}

pub(crate) fn respond(inner: &Inner, (status, code, message): Refusal) -> Response {
    inner.error(status, code, message, false)
}

#[derive(Debug, Clone)]
pub(crate) struct Ban {
    pub moderator_id: String,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub(crate) struct Timeout {
    pub moderator_id: String,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub(crate) struct LogEntry {
    pub id: String,
    pub community_id: String,
    pub moderator_id: String,
    /// A `ModerationAction` wire name.
    pub action: &'static str,
    pub target_user_id: Option<String>,
    pub reason: Option<String>,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
}

/// One community's roles, holders, bans and timeouts.
#[derive(Debug, Default, Clone)]
pub(crate) struct CommunityRbac {
    pub roles: Vec<RoleDto>,
    /// The default roles as seeded, for `reset-defaults`.
    pub defaults: Vec<RoleDto>,
    /// Member user id to the role ids they hold. A member always has an entry.
    pub holders: BTreeMap<String, BTreeSet<String>>,
    pub bans: BTreeMap<String, Ban>,
    pub timeouts: BTreeMap<String, Timeout>,
}

impl CommunityRbac {
    pub fn is_member(&self, user_id: &str) -> bool {
        self.holders.contains_key(user_id)
    }

    /// The user's roles, highest first.
    pub fn roles_of(&self, user_id: &str) -> Vec<RoleDto> {
        let held = self.holders.get(user_id).cloned().unwrap_or_default();
        let mut roles: Vec<RoleDto> = self
            .roles
            .iter()
            .filter(|role| held.contains(&role.id))
            .cloned()
            .collect();
        roles.sort_by_key(|role| role.position);
        roles
    }

    pub fn actions_of(&self, user_id: &str) -> BTreeSet<String> {
        self.roles_of(user_id)
            .iter()
            .flat_map(|role| {
                role.actions
                    .iter()
                    .map(|action| action.as_str().into_owned())
            })
            .collect()
    }

    /// `PermissionsService.getRank`: the best position, `i64::MAX` with no role.
    pub fn best(&self, user_id: &str) -> i64 {
        self.roles_of(user_id)
            .first()
            .map_or(i64::MAX, |role| role.position)
    }

    pub fn top(&self) -> Option<i64> {
        self.roles.iter().map(|role| role.position).min()
    }

    pub fn is_top(&self, user_id: &str) -> bool {
        let best = self.best(user_id);
        best != i64::MAX && self.top().is_some_and(|top| best <= top)
    }

    /// `PermissionsService.outranks` / `ModerationService.canModerate`: holds a role, and
    /// strictly better than the target's best.
    pub fn outranks(&self, actor: &str, target: &str) -> bool {
        let actor = self.best(actor);
        actor != i64::MAX && actor < self.best(target)
    }

    pub fn member_role(&self) -> Option<&RoleDto> {
        self.roles
            .iter()
            .filter(|role| role.is_default)
            .max_by_key(|role| role.position)
    }

    pub fn active_ban(&self, user_id: &str, now: DateTime<Utc>) -> Option<&Ban> {
        self.bans
            .get(user_id)
            .filter(|ban| ban.expires_at.is_none_or(|at| at > now))
    }

    pub fn active_timeout(&self, user_id: &str, now: DateTime<Utc>) -> Option<&Timeout> {
        self.timeouts
            .get(user_id)
            .filter(|timeout| timeout.expires_at > now)
    }
}

/// A channel's overrides as the API stores them.
#[derive(Debug, Clone)]
pub(crate) struct Overwrites {
    pub preset: ChannelPreset,
    pub rows: Vec<ChannelOverwriteDto>,
}

#[derive(Debug, Default)]
pub(crate) struct Rbac {
    communities: BTreeMap<String, CommunityRbac>,
    pub overwrites: BTreeMap<String, Overwrites>,
    pub logs: Vec<LogEntry>,
    /// Lowercase username to the scenario user it signs in as (`sign_in_as`).
    logins: HashMap<String, String>,
    next: u64,
}

impl Rbac {
    pub fn new_id(&mut self, kind: &str) -> String {
        self.next += 1;
        format!("{kind}-{}", self.next)
    }
}

/// The UUID a scenario's readable role id (`role-mods-c-couch`) is served as, in a scenario
/// whose ids are UUIDs. A UUID already is one.
pub fn role_uuid(readable: &str) -> String {
    if uuid::Uuid::parse_str(readable).is_ok() {
        readable.to_owned()
    } else {
        crate::scenario::entity_uuid(readable)
    }
}

/// The action's wire value.
pub(crate) fn action(name: &str) -> RbacAction {
    serde_json::from_value(Value::String(name.to_owned()))
        .unwrap_or_else(|_| RbacAction::Unknown(name.to_owned()))
}

/// The community's state as first seen: the scenario's roles and members, or a community made
/// over the API. `None` for a community the fake doesn't know.
fn seed(inner: &Inner, community_id: &str) -> Option<CommunityRbac> {
    let members = inner
        .created_members(community_id)
        .or_else(|| inner.scenario.memberships.get(community_id).cloned());
    let listed: Option<Vec<RoleDto>> = inner
        .scenario
        .extra
        .get("rolesByCommunity")
        .and_then(|by| by.get(community_id))
        .and_then(|roles| serde_json::from_value(roles.clone()).ok());
    if members.is_none() && listed.is_none() {
        return None;
    }
    let mut members = members.unwrap_or_default();
    let mut roles = listed.unwrap_or_default();
    // The backend's role ids are UUIDs, and the contract types them as one in request bodies
    // (`AssignRoleDto`, overrides): a scenario served with UUIDs gets them for roles too.
    if inner.scenario.uuid_message_ids {
        for role in roles.iter_mut().chain(
            members
                .iter_mut()
                .flat_map(|member| member.roles.iter_mut()),
        ) {
            role.id = role_uuid(&role.id);
        }
    }
    for member in &members {
        for role in &member.roles {
            if !roles.iter().any(|known| known.id == role.id) {
                roles.push(role.clone());
            }
        }
    }
    roles.sort_by_key(|role| role.position);
    let holders = members
        .iter()
        .map(|member| {
            (
                member.user_id.clone(),
                member.roles.iter().map(|role| role.id.clone()).collect(),
            )
        })
        .collect();
    Some(CommunityRbac {
        defaults: roles
            .iter()
            .filter(|role| role.is_default)
            .cloned()
            .collect(),
        roles,
        holders,
        ..Default::default()
    })
}

/// Runs `f` on the community's state, seeding it on first use. `None` if the community is unknown.
pub(crate) fn community<T>(
    inner: &Inner,
    community_id: &str,
    f: impl FnOnce(&mut CommunityRbac, &mut Rbac) -> T,
) -> Option<T> {
    let seeded = lock(&inner.rbac).communities.contains_key(community_id);
    let fresh = if seeded {
        None
    } else {
        Some(seed(inner, community_id)?)
    };
    let mut rbac = lock(&inner.rbac);
    let mut state = match rbac.communities.remove(community_id) {
        Some(state) => state,
        None => fresh?,
    };
    let result = f(&mut state, &mut rbac);
    rbac.communities.insert(community_id.to_owned(), state);
    Some(result)
}

/// The community a channel belongs to: the scenario's, or one made over the API.
pub(crate) fn community_of_channel(inner: &Inner, channel_id: &str) -> Option<String> {
    // W5-A's view of the channels: the scenario's, created communities', and those made, moved
    // or deleted over the API. Takes `admin` and `accounts`: never call it holding `rbac`.
    crate::admin::channel_of(inner, channel_id).map(|(community, _)| community.id)
}

/// The instance owner, whom `RbacGuard` lets past every community check.
pub(crate) fn is_owner(inner: &Inner, user_id: &str) -> bool {
    inner
        .user_entity(user_id)
        .is_some_and(|user| user.role == InstanceRole::Owner)
}

/// Whether `user_id` may do `action` (an `RbacAction` wire name) in the community: `RbacGuard`'s
/// owner bypass, else the union of their community roles' actions. W5-A's handlers ask this.
pub(crate) fn allows(inner: &Inner, user_id: &str, community_id: &str, action: &str) -> bool {
    is_owner(inner, user_id)
        || community(inner, community_id, |state, _| {
            state.actions_of(user_id).contains(action)
        })
        .unwrap_or(false)
}

/// `allows`, as the guard's refusal.
pub(crate) fn guard(
    inner: &Inner,
    user_id: &str,
    community_id: &str,
    actions: &[&str],
) -> Result<(), Refusal> {
    if actions
        .iter()
        .all(|action| allows(inner, user_id, community_id, action))
    {
        Ok(())
    } else {
        Err(guard_refusal())
    }
}

/// A member's roles (W5-A's member lists can show them as they are now).
#[allow(dead_code)]
pub(crate) fn roles_of(inner: &Inner, community_id: &str, user_id: &str) -> Vec<RoleDto> {
    community(inner, community_id, |state, _| state.roles_of(user_id)).unwrap_or_default()
}

/// Whether the user is a member now: kicks and bans remove them, W5-A's `add_member` adds them.
pub(crate) fn is_member(inner: &Inner, community_id: &str, user_id: &str) -> bool {
    community(inner, community_id, |state, _| state.is_member(user_id)).unwrap_or(false)
}

/// W5-A: a new member gets the community's default Member role.
#[allow(dead_code)]
pub(crate) fn add_member(inner: &Inner, community_id: &str, user_id: &str) {
    lock(&inner.calls)
        .kicked
        .remove(&(community_id.to_owned(), user_id.to_owned()));
    community(inner, community_id, |state, _| {
        let member = state.member_role().map(|role| role.id.clone());
        state
            .holders
            .entry(user_id.to_owned())
            .or_default()
            .extend(member);
    });
}

/// The community's members now: who hears what is sent to its room.
pub(crate) fn members(inner: &Inner, community_id: &str) -> Vec<String> {
    community(inner, community_id, |state, _| {
        state.holders.keys().cloned().collect()
    })
    .unwrap_or_default()
}

/// Off the community, with their roles (kick, ban, leave).
pub(crate) fn remove_member(inner: &Inner, community_id: &str, user_id: &str) {
    community(inner, community_id, |state, _| {
        state.holders.remove(user_id);
    });
}

/// Whether the user is banned from the community now (W5-A's joins and adds refuse them).
#[allow(dead_code)]
pub(crate) fn is_banned(inner: &Inner, community_id: &str, user_id: &str) -> bool {
    let now = inner.now();
    community(inner, community_id, |state, _| {
        state.active_ban(user_id, now).is_some()
    })
    .unwrap_or(false)
}

/// The end of the user's active timeout, for the capabilities (`timedOutUntil`).
pub(crate) fn timed_out_until(
    inner: &Inner,
    community_id: &str,
    user_id: &str,
) -> Option<DateTime<Utc>> {
    let now = inner.now();
    community(inner, community_id, |state, _| {
        state.active_timeout(user_id, now).map(|t| t.expires_at)
    })
    .flatten()
}

/// The scenario user a login with this username becomes, after `sign_in_as`.
pub(crate) fn login_as(inner: &Inner, username: &str) -> Option<String> {
    lock(&inner.rbac)
        .logins
        .get(&username.to_lowercase())
        .cloned()
}

/// `sign_in_as`: logging in as `username` (any password) is the scenario user `user_id`.
pub(crate) fn allow_sign_in_as(inner: &Inner, username: &str, user_id: &str) {
    lock(&inner.rbac)
        .logins
        .insert(username.to_lowercase(), user_id.to_owned());
}

/// `act_as`: the user (the scenario's `me` when not named) holds exactly these roles in the
/// community, a member from now on.
pub(crate) fn set_roles(
    inner: &Inner,
    community_id: &str,
    user_id: &str,
    role_ids: &[String],
) -> Result<(), String> {
    let role_ids: Vec<String> = role_ids
        .iter()
        .map(|id| {
            if inner.scenario.uuid_message_ids {
                role_uuid(id)
            } else {
                id.clone()
            }
        })
        .collect();
    community(inner, community_id, |state, _| {
        if let Some(unknown) = role_ids
            .iter()
            .find(|id| !state.roles.iter().any(|role| role.id == **id))
        {
            return Err(format!("{unknown} is not a role of {community_id}"));
        }
        state
            .holders
            .insert(user_id.to_owned(), role_ids.iter().cloned().collect());
        Ok(())
    })
    .unwrap_or_else(|| Err(format!("{community_id} is not a community of the scenario")))
}

/// W5-B's controls (`POST /__control/{name}`), or `None` when the name isn't W5-B's.
///
/// - `act_as { communityId, roleIds: [..], userId? }`: the user (default `me`) holds exactly
///   these roles there.
/// - `sign_in_as { username, userId }`: a login as `username` becomes that scenario user, so a
///   second session can act as another member.
pub(crate) fn control(inner: &Inner, name: &str, request: &Value) -> Option<Response> {
    let field = |key: &str| request.get(key).and_then(Value::as_str);
    let invalid = |message: &str| Some(inner.error(400, "VALIDATION_FAILED", message, false));
    match name {
        "act_as" => {
            let Some(community_id) = field("communityId") else {
                return invalid("communityId is required");
            };
            let Some(role_ids) = request.get("roleIds").and_then(Value::as_array) else {
                return invalid("roleIds is required");
            };
            let role_ids: Vec<String> = role_ids
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            let user_id = field("userId").unwrap_or(&inner.scenario.me.id).to_owned();
            if let Err(message) = set_roles(inner, community_id, &user_id, &role_ids) {
                return invalid(&message);
            }
        }
        "sign_in_as" => {
            let (Some(username), Some(user_id)) = (field("username"), field("userId")) else {
                return invalid("username and userId are required");
            };
            if inner.scenario.user(user_id).is_none() {
                return invalid("userId is not a user of the scenario");
            }
            allow_sign_in_as(inner, username, user_id);
        }
        _ => return None,
    }
    Some(
        (
            axum::http::StatusCode::OK,
            axum::Json(json!({ "ok": true })),
        )
            .into_response(),
    )
}

/// A log entry, as `ModerationService.createModerationLog` writes it.
pub(crate) fn log(
    inner: &Inner,
    community_id: &str,
    moderator_id: &str,
    action: &'static str,
    target_user_id: Option<&str>,
    reason: Option<String>,
    metadata: Value,
) {
    let now = inner.now();
    let mut rbac = lock(&inner.rbac);
    let id = rbac.new_id("modlog");
    rbac.logs.push(LogEntry {
        id,
        community_id: community_id.to_owned(),
        moderator_id: moderator_id.to_owned(),
        action,
        target_user_id: target_user_id.map(str::to_owned),
        reason,
        metadata,
        created_at: now,
    });
}

/// The payload of the moderation events: an absent reason is no field (`undefined`).
pub(crate) fn moderation_payload(
    community_id: &str,
    user_id: &str,
    moderator_id: &str,
    reason: &Option<String>,
) -> Value {
    let mut payload = json!({
        "communityId": community_id,
        "userId": user_id,
        "moderatorId": moderator_id,
    });
    if let Some(reason) = reason {
        payload["reason"] = Value::from(reason.clone());
    }
    payload
}
