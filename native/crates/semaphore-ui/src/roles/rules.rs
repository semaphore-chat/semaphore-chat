//! What the roles views check and work out, with no GPUI in them: the action and group labels,
//! the role name rules, the editor's draft and what a save sends, the matrix's group checkbox,
//! moving a role, the assignment dialog's changes, and the channel presets as the web shows them.
//!
//! Permission and rank rules are core's: these read its flags. Where core's view doesn't carry a
//! flag yet, one `*_fallback` function here stands in for it, so the swap is a few lines.

use semaphore_core::model::{
    AdminOp, ChannelPreset, ErrorView, LoadState, OverwriteRow, OverwriteTarget, PermissionGroup,
    RoleRow, RolesView,
};
use std::collections::BTreeSet;

// ---- Labels. ----

/// The web's `ACTION_LABELS` (`frontend/src/constants/rbacActions.ts`); `None` for an action this
/// build doesn't know, which shows by its wire name.
pub fn action_label(action: &str) -> Option<&'static str> {
    Some(match action {
        "CREATE_MESSAGE" => "Send messages",
        "DELETE_MESSAGE" => "Delete messages",
        "READ_MESSAGE" => "Read messages",
        "CREATE_CHANNEL" => "Create channels",
        "UPDATE_CHANNEL" => "Edit channels",
        "DELETE_CHANNEL" => "Delete channels",
        "READ_CHANNEL" => "View channels",
        "JOIN_CHANNEL" => "Join channels",
        "MANAGE_CHANNEL_PERMISSIONS" => "Manage channel permissions",
        "MANAGE_WEBHOOKS" => "Manage webhooks",
        "SPEAK" => "Speak in voice",
        "VIDEO" => "Use video",
        "SCREEN_SHARE" => "Share screen",
        "CREATE_COMMUNITY" => "Create communities",
        "UPDATE_COMMUNITY" => "Edit community",
        "DELETE_COMMUNITY" => "Delete community",
        "READ_COMMUNITY" => "View community",
        "READ_ALL_COMMUNITIES" => "View all communities",
        "CREATE_MEMBER" => "Add members",
        "UPDATE_MEMBER" => "Edit members",
        "DELETE_MEMBER" => "Remove members",
        "READ_MEMBER" => "View members",
        "CREATE_ROLE" => "Create roles",
        "UPDATE_ROLE" => "Edit roles",
        "DELETE_ROLE" => "Delete roles",
        "READ_ROLE" => "View roles",
        "UPDATE_USER" => "Edit users",
        "DELETE_USER" => "Delete users",
        "READ_USER" => "View users",
        "CREATE_INVITE" => "Create invites",
        "DELETE_INVITE" => "Delete invites",
        "CREATE_INSTANCE_INVITE" => "Create instance invites",
        "DELETE_INSTANCE_INVITE" => "Delete instance invites",
        "READ_INSTANCE_INVITE" => "View invites",
        "UPDATE_INSTANCE_INVITE" => "Update invites",
        "CREATE_REACTION" => "Add reactions",
        "DELETE_REACTION" => "Remove reactions",
        "ATTACH_FILES" => "Attach files",
        "CREATE_ATTACHMENT" => "Upload files",
        "DELETE_ATTACHMENT" => "Delete files",
        "MANAGE_EMOJIS" => "Manage custom emojis",
        "CREATE_ALIAS_GROUP" => "Create mention groups",
        "UPDATE_ALIAS_GROUP" => "Edit mention groups",
        "DELETE_ALIAS_GROUP" => "Delete mention groups",
        "READ_ALIAS_GROUP" => "View mention groups",
        "CREATE_ALIAS_GROUP_MEMBER" => "Add to mention groups",
        "DELETE_ALIAS_GROUP_MEMBER" => "Remove from mention groups",
        "READ_ALIAS_GROUP_MEMBER" => "View mention group members",
        "UPDATE_ALIAS_GROUP_MEMBER" => "Edit mention group members",
        "BAN_USER" => "Ban users",
        "UNBAN_USER" => "Unban users",
        "KICK_USER" => "Kick users",
        "TIMEOUT_USER" => "Timeout users",
        "PIN_MESSAGE" => "Pin messages",
        "UNPIN_MESSAGE" => "Unpin messages",
        "DELETE_ANY_MESSAGE" => "Delete any message",
        "VIEW_BAN_LIST" => "View ban list",
        "VIEW_MODERATION_LOGS" => "View moderation logs",
        "MUTE_PARTICIPANT" => "Mute voice participants",
        "CAPTURE_REPLAY" => "Capture voice replays",
        "READ_SOUNDBOARD_SOUND" => "View soundboard sounds",
        "CREATE_SOUNDBOARD_SOUND" => "Add soundboard sounds",
        "DELETE_SOUNDBOARD_SOUND" => "Delete soundboard sounds",
        "READ_INSTANCE_SETTINGS" => "View instance settings",
        "UPDATE_INSTANCE_SETTINGS" => "Edit instance settings",
        "READ_INSTANCE_STATS" => "View instance stats",
        "MANAGE_USER_STORAGE" => "Manage user storage",
        _ => return None,
    })
}

/// An action's label, or its wire name.
pub fn label_of(action: &str) -> String {
    action_label(action).map_or_else(|| action.to_owned(), str::to_owned)
}

/// The web's `PERMISSION_GROUPS` keys, by core's group id.
pub fn group_label(id: &str) -> String {
    match id {
        "messages" => "Messages".into(),
        "channels" => "Channels".into(),
        "voice" => "Voice".into(),
        "community" => "Community".into(),
        "members" => "Members".into(),
        "roles" => "Roles".into(),
        "users" => "Users".into(),
        "invites" => "Invites".into(),
        "content" => "Content".into(),
        "alias_groups" => "Alias Groups".into(),
        "moderation" => "Moderation".into(),
        "soundboard" => "Soundboard".into(),
        OTHER_GROUP => "Other".into(),
        other => {
            let mut label = other.replace('_', " ");
            if let Some(first) = label.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
            label
        }
    }
}

/// The group id of the actions a role holds that the catalog doesn't list.
pub const OTHER_GROUP: &str = "other";

/// The matrix's groups: the catalog's, then "other" with the role's actions none of them list
/// (kept on save, shown read-only), when there are any.
pub fn matrix_groups(
    catalog: &[PermissionGroup],
    actions: &BTreeSet<String>,
) -> Vec<PermissionGroup> {
    let known: BTreeSet<&str> = catalog
        .iter()
        .flat_map(|group| group.actions.iter().map(String::as_str))
        .collect();
    let mut groups = catalog.to_vec();
    let other: Vec<String> = actions
        .iter()
        .filter(|action| !known.contains(action.as_str()))
        .cloned()
        .collect();
    if !other.is_empty() {
        groups.push(PermissionGroup {
            id: OTHER_GROUP.into(),
            actions: other,
        });
    }
    groups
}

/// "Send messages, Speak in voice +3 more": the first `shown` labels and how many are left.
pub fn actions_preview(actions: &[String], shown: usize) -> (Vec<String>, usize) {
    let labels: Vec<String> = actions.iter().take(shown).map(|a| label_of(a)).collect();
    (labels, actions.len().saturating_sub(shown))
}

/// "1 permission", "3 permissions".
pub fn permissions_count(count: usize) -> String {
    if count == 1 {
        "1 permission".into()
    } else {
        format!("{count} permissions")
    }
}

/// The reason a disabled control gives: the permission, by its label.
pub fn needs(action: &str) -> String {
    format!(
        "You need the \u{201c}{}\u{201d} permission",
        label_of(action)
    )
}

// ---- Role names. ----

/// `CreateRoleDto.name`'s 50, counted as core's wire type counts it (characters, after trimming).
pub const ROLE_NAME_MAX: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameError {
    Required,
    TooLong,
    Taken,
}

impl NameError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Required => "Role name is required",
            Self::TooLong => "Role name must not exceed 50 characters",
            Self::Taken => "A role with this name already exists",
        }
    }
}

/// The name as it is sent: without the spaces around it.
pub fn clean_name(typed: &str) -> &str {
    typed.trim()
}

/// A typed role name against the rules and the community's other roles (`others`: their names,
/// this role's own left out). The server compares names exactly, so "mod" beside "Mod" is fine.
pub fn check_role_name<'a>(
    typed: &str,
    others: impl IntoIterator<Item = &'a str>,
) -> Result<(), NameError> {
    let name = clean_name(typed);
    if name.is_empty() {
        return Err(NameError::Required);
    }
    if name.chars().count() > ROLE_NAME_MAX {
        return Err(NameError::TooLong);
    }
    if others.into_iter().any(|other| other.trim() == name) {
        return Err(NameError::Taken);
    }
    Ok(())
}

// ---- The editor's draft. ----

/// What an edit changes: `None` is left as it is. Core's `RolePatch` once it lands; until then
/// the app sends a `RoleDraft` with the role's current values for the `None`s.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoleChanges {
    pub name: Option<String>,
    pub actions: Option<Vec<String>>,
}

impl RoleChanges {
    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.actions.is_none()
    }
}

/// A group checkbox's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tri {
    None,
    Some,
    All,
}

/// The role being made or edited: the typed name and the chosen actions, against what it was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleDraftState {
    pub original_name: Option<String>,
    pub original_actions: BTreeSet<String>,
    pub name: String,
    pub actions: BTreeSet<String>,
}

impl RoleDraftState {
    pub fn create() -> Self {
        Self {
            original_name: None,
            original_actions: BTreeSet::new(),
            name: String::new(),
            actions: BTreeSet::new(),
        }
    }

    pub fn edit(role: &RoleRow) -> Self {
        let actions: BTreeSet<String> = role.actions.iter().cloned().collect();
        Self {
            original_name: Some(role.name.clone()),
            original_actions: actions.clone(),
            name: role.name.clone(),
            actions,
        }
    }

    pub fn is_new(&self) -> bool {
        self.original_name.is_none()
    }

    /// Turns one action on or off. Only one the user may grant: the others stay as they are.
    pub fn toggle(&mut self, action: &str, grantable: &BTreeSet<String>) {
        if !grantable.contains(action) {
            return;
        }
        if !self.actions.remove(action) {
            self.actions.insert(action.to_owned());
        }
    }

    /// The group's checkbox, counting every action of it that is on (ones the user can't grant
    /// too).
    pub fn group_state(&self, group: &[String]) -> Tri {
        let on = group.iter().filter(|a| self.actions.contains(*a)).count();
        if on == 0 {
            Tri::None
        } else if on == group.len() {
            Tri::All
        } else {
            Tri::Some
        }
    }

    /// The group's checkbox pressed: when every action of it the user may grant is on, those go
    /// off; otherwise they all go on. Actions the user can't grant stay as they are.
    pub fn toggle_group(&mut self, group: &[String], grantable: &BTreeSet<String>) {
        let mine: Vec<&String> = group.iter().filter(|a| grantable.contains(*a)).collect();
        if mine.is_empty() {
            return;
        }
        if mine.iter().all(|a| self.actions.contains(*a)) {
            for action in mine {
                self.actions.remove(action);
            }
        } else {
            for action in mine {
                self.actions.insert(action.clone());
            }
        }
    }

    /// What a save of an edit sends: the name only when it changed (spaces around don't count),
    /// the actions only when the set changed (their order doesn't count). Unknown actions are
    /// kept: they're in `actions` from the start and nothing can take them out.
    pub fn changes(&self) -> RoleChanges {
        let name = clean_name(&self.name);
        RoleChanges {
            name: match &self.original_name {
                Some(original) if original.trim() == name => None,
                _ => Some(name.to_owned()),
            },
            actions: (self.actions != self.original_actions)
                .then(|| self.actions.iter().cloned().collect()),
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.is_new() || !self.changes().is_empty()
    }

    /// Why Save is off: the name, or no permission chosen (the server wants one at least).
    pub fn problem<'a>(&self, others: impl IntoIterator<Item = &'a str>) -> Option<String> {
        if let Err(error) = check_role_name(&self.name, others) {
            return Some(error.message().into());
        }
        if self.actions.is_empty() {
            return Some("Role must have at least one permission".into());
        }
        None
    }
}

// ---- The role list. ----

/// The "Member" role: last, can't move or be deleted. `RoleRow::fixed` once it lands.
pub fn is_fixed(role: &RoleRow) -> bool {
    role.is_default && role.name == "Member"
}

/// Whether this role may go one place up or down. `RoleRow::can_move_up`/`can_move_down` once
/// they land; until then the web's rule: not the Member role, not past the ends or below Member.
pub fn can_move(view: &RolesView, index: usize, up: bool) -> bool {
    let Some(role) = view.roles.get(index) else {
        return false;
    };
    if !view.can_reorder || is_fixed(role) {
        return false;
    }
    let target = if up {
        index.checked_sub(1)
    } else {
        Some(index + 1)
    };
    target
        .and_then(|target| view.roles.get(target))
        .is_some_and(|target| !is_fixed(target))
}

/// The order `Core::reorder_roles` gets when this role moves: every role but Member, with this
/// one swapped with its neighbour. `None` when it can't move that way.
pub fn moved_order(roles: &[RoleRow], role_id: &str, up: bool) -> Option<Vec<String>> {
    let mut ids: Vec<String> = roles
        .iter()
        .filter(|role| !is_fixed(role))
        .map(|role| role.id.clone())
        .collect();
    let from = ids.iter().position(|id| id == role_id)?;
    let to = if up {
        from.checked_sub(1)?
    } else {
        from + 1
    };
    if to >= ids.len() {
        return None;
    }
    ids.swap(from, to);
    Some(ids)
}

/// When the role was made. `RoleRow::created_at_ms` once it lands; the column hides until then.
pub fn created_at(_role: &RoleRow) -> Option<i64> {
    None
}

/// Whether the user may see the roles. `RolesView::can_read` once it lands; until then a read the
/// server refused.
pub fn can_read(view: &RolesView) -> bool {
    !matches!(&view.state, LoadState::Failed { error } if error.code == "FORBIDDEN")
}

/// Why the user can't edit this role, or `None` when they can. `RoleRow`'s block reasons once
/// they land.
pub fn edit_block(view: &RolesView, role: &RoleRow) -> Option<String> {
    if role.editable {
        return None;
    }
    let grantable: BTreeSet<&str> = view.grantable.iter().map(String::as_str).collect();
    Some(if !view.can_reorder {
        needs("UPDATE_ROLE")
    } else if role.actions.iter().any(|a| !grantable.contains(a.as_str())) {
        "This role has permissions you don't have".into()
    } else {
        "This role ranks at or above yours".into()
    })
}

/// Why the user can't delete this role.
pub fn delete_block(view: &RolesView, role: &RoleRow) -> Option<String> {
    if role.deletable {
        return None;
    }
    let _ = view;
    Some(if role.is_default {
        "Default roles can't be deleted".into()
    } else {
        "This role ranks at or above yours, or you need the \u{201c}Delete roles\u{201d} permission"
            .into()
    })
}

/// Why the user can't give this role to anyone.
pub fn assign_block(view: &RolesView, role: &RoleRow) -> Option<String> {
    if role.assignable {
        return None;
    }
    let grantable: BTreeSet<&str> = view.grantable.iter().map(String::as_str).collect();
    Some(if role.actions.iter().any(|a| !grantable.contains(a.as_str())) {
        "This role has permissions you don't have".into()
    } else {
        "You can only give roles ranked below yours, with the \u{201c}Edit members\u{201d} permission".into()
    })
}

// ---- Which change an op is about. ----

/// A change the roles views send on the Roles view's op.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RoleOp {
    Create,
    Update { role_id: String },
    Delete { role_id: String },
    Reorder,
    ResetDefaults,
}

/// The change `op` is about, when it is busy or failed. Core's W5-B `AdminOp::actions` once it
/// lands; until then the last change sent.
pub fn op_about(op: &AdminOp, last_sent: Option<&RoleOp>) -> Option<RoleOp> {
    if !op.busy && op.error.is_none() {
        return None;
    }
    last_sent.cloned()
}

/// Where a sent change stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Waiting,
    Succeeded,
    Failed,
}

/// A sent change, followed through the op until it ends. Core marks the op busy as it starts and
/// ends it with an error or none; a refusal before sending ends it with an error, never busy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pending<A> {
    pub action: A,
    saw_busy: bool,
}

impl<A> Pending<A> {
    pub fn new(action: A) -> Self {
        Self {
            action,
            saw_busy: false,
        }
    }

    pub fn observe(&mut self, busy: bool, error: Option<&ErrorView>) -> Outcome {
        if busy {
            self.saw_busy = true;
            Outcome::Waiting
        } else if error.is_some() {
            Outcome::Failed
        } else if self.saw_busy {
            Outcome::Succeeded
        } else {
            Outcome::Waiting
        }
    }
}

// ---- The assignment dialog. ----

/// The roles to give and to take, in the community's order: what's chosen against what's held.
pub fn assignment_diff(
    order: &[RoleRow],
    held: &BTreeSet<String>,
    chosen: &BTreeSet<String>,
) -> (Vec<String>, Vec<String>) {
    let add = order
        .iter()
        .filter(|role| chosen.contains(&role.id) && !held.contains(&role.id))
        .map(|role| role.id.clone())
        .collect();
    let remove = order
        .iter()
        .filter(|role| held.contains(&role.id) && !chosen.contains(&role.id))
        .map(|role| role.id.clone())
        .collect();
    (add, remove)
}

// ---- Channel presets. ----

/// The presets a channel's permissions tab offers, and the stored set no preset makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Card {
    Normal,
    ReadOnly,
    Announcement,
    ModsOnly,
    Custom,
}

impl Card {
    pub fn title(self) -> &'static str {
        match self {
            Self::Normal => "Normal",
            Self::ReadOnly => "Read-only",
            Self::Announcement => "Announcement",
            Self::ModsOnly => "Mods only",
            Self::Custom => "Custom",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Normal => "Everyone can talk.",
            Self::ReadOnly => "Everyone reads. Only chosen roles post or react.",
            Self::Announcement => "Only chosen roles post. Everyone can react.",
            Self::ModsOnly => "Coming soon \u{2014} use Private for now.",
            Self::Custom => "Set with the advanced editor.",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::ReadOnly => "read-only",
            Self::Announcement => "announcement",
            Self::ModsOnly => "mods-only",
            Self::Custom => "custom",
        }
    }

    pub fn preset(self) -> ChannelPreset {
        match self {
            Self::Normal => ChannelPreset::Normal,
            Self::ReadOnly => ChannelPreset::ReadOnly,
            Self::Announcement => ChannelPreset::Announcement,
            Self::ModsOnly => ChannelPreset::ModsOnly,
            Self::Custom => ChannelPreset::Custom,
        }
    }

    /// Whether choosing it builds a set (Normal, Read-only, Announcement).
    pub fn builds(self) -> bool {
        matches!(self, Self::Normal | Self::ReadOnly | Self::Announcement)
    }

    /// Whether it has posters to choose.
    pub fn has_posters(self) -> bool {
        matches!(self, Self::ReadOnly | Self::Announcement)
    }
}

/// The cards in the web's order, with Custom only when the stored set (or the choice) is one.
pub fn cards(stored: Card, chosen: Card) -> Vec<Card> {
    let mut cards = vec![Card::Normal, Card::ReadOnly, Card::Announcement, Card::ModsOnly];
    if stored == Card::Custom || chosen == Card::Custom {
        cards.push(Card::Custom);
    }
    cards
}

/// `presetDenies`: what a preset takes from everyone.
pub fn preset_denies(card: Card, members_can_attach: bool) -> Vec<&'static str> {
    match card {
        Card::Normal if members_can_attach => Vec::new(),
        Card::Normal => vec!["ATTACH_FILES"],
        Card::ReadOnly => vec!["CREATE_MESSAGE", "ATTACH_FILES", "CREATE_REACTION"],
        Card::Announcement => vec!["CREATE_MESSAGE", "ATTACH_FILES"],
        Card::ModsOnly | Card::Custom => Vec::new(),
    }
}

/// What the user picks: the preset, who may post (sorted), and the attach switch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetChoice {
    pub card: Card,
    pub post_role_ids: Vec<String>,
    pub members_can_attach: bool,
}

impl PresetChoice {
    pub fn normalized(mut self) -> Self {
        self.post_role_ids.sort();
        self.post_role_ids.dedup();
        self
    }
}

/// `detectPreset`: which preset the stored set is, with its posters. Core's
/// `ChannelOverwritesView::detected` once it lands.
pub fn detect(overwrites: &[OverwriteRow]) -> PresetChoice {
    let custom = PresetChoice {
        card: Card::Custom,
        post_role_ids: Vec::new(),
        members_can_attach: true,
    };
    if overwrites.is_empty() {
        return PresetChoice {
            card: Card::Normal,
            post_role_ids: Vec::new(),
            members_can_attach: true,
        };
    }
    let everyone: Vec<&OverwriteRow> = overwrites
        .iter()
        .filter(|row| row.target == OverwriteTarget::Everyone)
        .collect();
    let roles: Vec<(&str, &OverwriteRow)> = overwrites
        .iter()
        .filter_map(|row| match &row.target {
            OverwriteTarget::Role { role_id, .. } => Some((role_id.as_str(), row)),
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
    let same = |a: &[String], b: &[&str]| {
        a.len() == b.len() && a.iter().all(|x| b.contains(&x.as_str()))
    };
    if same(deny, &["ATTACH_FILES"]) {
        return if roles
            .iter()
            .all(|(_, row)| row.allow.iter().all(|a| a == "ATTACH_FILES"))
        {
            PresetChoice {
                card: Card::Normal,
                post_role_ids: Vec::new(),
                members_can_attach: false,
            }
        } else {
            custom
        };
    }
    for card in [Card::ReadOnly, Card::Announcement] {
        let full = preset_denies(card, false);
        if !same(deny, &full) {
            continue;
        }
        if !roles.iter().all(|(_, row)| {
            !row.allow.is_empty() && row.allow.iter().all(|a| full.contains(&a.as_str()))
        }) {
            return custom;
        }
        return PresetChoice {
            card,
            post_role_ids: roles
                .iter()
                .filter(|(_, row)| same(&row.allow, &full))
                .map(|(id, _)| (*id).to_owned())
                .collect(),
            members_can_attach: false,
        }
        .normalized();
    }
    custom
}

/// Whether the choice differs from what's stored (the web's `dirty`): only a preset that builds
/// a set can be saved.
pub fn preset_dirty(choice: &PresetChoice, stored: &PresetChoice) -> bool {
    if !choice.card.builds() {
        return false;
    }
    choice.card != stored.card
        || choice.post_role_ids != stored.post_role_ids
        || choice.members_can_attach != stored.members_can_attach
}

/// Why a card can't be chosen: Mods only isn't offered yet, Custom only shows what's stored, and
/// a preset needs every action it denies (`missing`, by core).
pub fn card_block(card: Card, chosen: Card, missing: &[String]) -> Option<String> {
    match card {
        Card::ModsOnly => Some("Coming soon".into()),
        Card::Custom if chosen != Card::Custom => {
            Some("A custom set comes from the advanced editor".into())
        }
        Card::Custom => None,
        _ if !missing.is_empty() => Some(format!(
            "You need {} to use this",
            missing
                .iter()
                .map(|a| label_of(a))
                .collect::<Vec<_>>()
                .join(", ")
                .to_lowercase()
        )),
        _ => None,
    }
}

/// A role as the poster picker sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetRole {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub actions: Vec<String>,
    /// Ranked below the user (everything, for the instance owner): they may pick it.
    pub below_me: bool,
}

/// What the presets need beside the stored set. Core's `ChannelOverwritesView::{roles, detected,
/// missing, default posters}` once they land; `fallback` stands in until then.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetSupport {
    pub roles: Vec<PresetRole>,
    pub detected: PresetChoice,
    /// The actions each preset needs that the user lacks.
    pub missing: Vec<(Card, Vec<String>)>,
    /// The posters a read-only kind starts with: roles below the user that manage permissions.
    pub default_posters: Vec<String>,
}

impl PresetSupport {
    /// From the stored set and the community's roles: a role the user may edit or give ranks
    /// below them, and a preset needs the actions it denies among those they may grant.
    pub fn fallback(overwrites: &[OverwriteRow], roles: &RolesView) -> Self {
        let grantable: BTreeSet<&str> = roles.grantable.iter().map(String::as_str).collect();
        let roles: Vec<PresetRole> = roles
            .roles
            .iter()
            .map(|role| PresetRole {
                id: role.id.clone(),
                name: role.name.clone(),
                position: role.position,
                actions: role.actions.clone(),
                below_me: role.editable || role.assignable || role.deletable,
            })
            .collect();
        let missing = [Card::Normal, Card::ReadOnly, Card::Announcement]
            .into_iter()
            .map(|card| {
                (
                    card,
                    preset_denies(card, false)
                        .into_iter()
                        .filter(|a| !grantable.contains(a))
                        .map(str::to_owned)
                        .collect(),
                )
            })
            .collect();
        let default_posters = roles
            .iter()
            .filter(|role| {
                role.below_me && role.actions.iter().any(|a| a == "MANAGE_CHANNEL_PERMISSIONS")
            })
            .map(|role| role.id.clone())
            .collect();
        Self {
            roles,
            detected: detect(overwrites),
            missing,
            default_posters,
        }
    }

    pub fn missing_for(&self, card: Card) -> &[String] {
        self.missing
            .iter()
            .find(|(c, _)| *c == card)
            .map_or(&[], |(_, missing)| missing.as_slice())
    }
}

/// The choice after a card is pressed: a read-only kind with no posters yet starts with the
/// default ones.
pub fn choose_card(choice: &PresetChoice, card: Card, default_posters: &[String]) -> PresetChoice {
    let mut next = choice.clone();
    next.card = card;
    if card.has_posters() && next.post_role_ids.is_empty() {
        next.post_role_ids = default_posters.to_vec();
    }
    next.normalized()
}

/// A poster chip pressed.
pub fn toggle_poster(choice: &PresetChoice, role_id: &str) -> PresetChoice {
    let mut next = choice.clone();
    if let Some(index) = next.post_role_ids.iter().position(|id| id == role_id) {
        next.post_role_ids.remove(index);
    } else {
        next.post_role_ids.push(role_id.to_owned());
    }
    next.normalized()
}

/// The roles drawn as locked "Kept automatically" chips: those at or above the user that the
/// preset would touch. From core's built set (`auto_allowed`) when the app has it, else the roles
/// above the user holding one of the denied actions.
pub fn kept_roles(
    support: &PresetSupport,
    choice: &PresetChoice,
    auto_allowed: Option<&[String]>,
) -> Vec<String> {
    let deny = preset_denies(choice.card, choice.members_can_attach);
    support
        .roles
        .iter()
        .filter(|role| !role.below_me)
        .filter(|role| match auto_allowed {
            Some(auto) => auto.contains(&role.id),
            None => role.actions.iter().any(|a| deny.contains(&a.as_str())),
        })
        .map(|role| role.id.clone())
        .collect()
}

/// A role row's name in the summary: its name, or "Deleted role" when the role is gone (core
/// names it by its id then; `OverwriteRow::role_missing` once it lands).
pub fn target_name(target: &OverwriteTarget) -> String {
    match target {
        OverwriteTarget::Everyone => "@everyone".into(),
        OverwriteTarget::Role { role_id, name } if name == role_id || name.is_empty() => {
            "Deleted role".into()
        }
        OverwriteTarget::Role { name, .. } => name.clone(),
    }
}

/// `summarizeOverwrites`: "@everyone: can't send messages, attach files".
pub fn summarize(overwrites: &[OverwriteRow]) -> Vec<String> {
    overwrites
        .iter()
        .map(|row| {
            let list = |actions: &[String]| {
                actions
                    .iter()
                    .map(|a| label_of(a))
                    .collect::<Vec<_>>()
                    .join(", ")
                    .to_lowercase()
            };
            let parts: Vec<String> = [
                (!row.allow.is_empty()).then(|| format!("can {}", list(&row.allow))),
                (!row.deny.is_empty()).then(|| format!("can't {}", list(&row.deny))),
            ]
            .into_iter()
            .flatten()
            .collect();
            format!("{}: {}", target_name(&row.target), parts.join("; "))
        })
        .collect()
}
