//! What the roles views check and work out, with no GPUI in them: the action and group labels,
//! the role name rules, the editor's draft and what a save sends, the matrix's group checkbox,
//! moving a role, the assignment dialog's changes, and the channel presets as the web shows them.
//!
//! Permission and rank rules are core's: these read its flags and turn its reasons into words.

use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionState, AdminOp, ChannelPreset, DetectedPreset,
    ErrorView, NotAllowed, OverwriteRoleOption, OverwriteRow, OverwriteTarget, PermissionGroup,
    PresetAccess, RoleBlock, RolePatch, RoleRow, RolesView,
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

/// Whether a patch changes nothing.
pub fn patch_is_empty(patch: &RolePatch) -> bool {
    patch.name.is_none() && patch.actions.is_none()
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
    pub fn changes(&self) -> RolePatch {
        let name = clean_name(&self.name);
        RolePatch {
            name: match &self.original_name {
                Some(original) if original.trim() == name => None,
                _ => Some(name.to_owned()),
            },
            actions: (self.actions != self.original_actions)
                .then(|| self.actions.iter().cloned().collect()),
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.is_new() || !patch_is_empty(&self.changes())
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

/// The order `Core::reorder_roles` gets when this role moves: every role but Member, with this
/// one swapped with its neighbour. `None` when there is no neighbour that way.
pub fn moved_order(roles: &[RoleRow], role_id: &str, up: bool) -> Option<Vec<String>> {
    let mut ids: Vec<String> = roles
        .iter()
        .filter(|role| !role.fixed)
        .map(|role| role.id.clone())
        .collect();
    let from = ids.iter().position(|id| id == role_id)?;
    let to = if up { from.checked_sub(1)? } else { from + 1 };
    if to >= ids.len() {
        return None;
    }
    ids.swap(from, to);
    Some(ids)
}

/// Which change a role can be blocked from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleChange {
    Edit,
    Delete,
    Assign,
}

/// The sentence for core's reason a role is off.
pub fn block_reason(change: RoleChange, block: Option<RoleBlock>) -> String {
    match block {
        Some(RoleBlock::Missing) => needs(match change {
            RoleChange::Edit => "UPDATE_ROLE",
            RoleChange::Delete => "DELETE_ROLE",
            RoleChange::Assign => "UPDATE_MEMBER",
        }),
        Some(RoleBlock::Rank) => "This role ranks at or above yours".into(),
        Some(RoleBlock::HoldsUngrantable) => "This role has permissions you don't have".into(),
        Some(RoleBlock::DefaultRole) => "Default roles can't be deleted".into(),
        None => match change {
            RoleChange::Edit => "You can't edit this role".into(),
            RoleChange::Delete => "You can't delete this role".into(),
            RoleChange::Assign => "You can't give this role".into(),
        },
    }
}

/// Why the user can't edit this role, or `None` when they can.
pub fn edit_block(role: &RoleRow) -> Option<String> {
    (!role.editable).then(|| block_reason(RoleChange::Edit, role.edit_blocked))
}

/// Why the user can't delete this role.
pub fn delete_block(role: &RoleRow) -> Option<String> {
    (!role.deletable).then(|| block_reason(RoleChange::Delete, role.delete_blocked))
}

/// Why the user can't give this role to anyone.
pub fn assign_block(role: &RoleRow) -> Option<String> {
    (!role.assignable).then(|| block_reason(RoleChange::Assign, role.assign_blocked))
}

/// Why a move arrow is off, or `None` when the role can go that way.
pub fn move_block(view: &RolesView, role: &RoleRow, up: bool, moving: bool) -> Option<String> {
    let can = if up {
        role.can_move_up
    } else {
        role.can_move_down
    };
    if !view.can_reorder {
        Some(needs("UPDATE_ROLE"))
    } else if moving {
        Some("Moving roles\u{2026}".into())
    } else if can {
        None
    } else {
        Some("You can only move roles ranked below yours, past others below yours".into())
    }
}

/// Why the user can't change this member's roles at all.
pub fn member_block(reason: NotAllowed) -> &'static str {
    match reason {
        NotAllowed::Missing => "You need the \u{201c}Edit members\u{201d} permission",
        NotAllowed::Rank => "This member ranks at or above you",
        NotAllowed::SelfTarget => "You can't change your own roles here",
    }
}

// ---- Which change an op is about. ----

/// A change the role list sends, as core names it in `AdminOp::actions`.
pub fn role_action(kind: AdminActionKind, target_id: Option<&str>) -> AdminAction {
    AdminAction {
        kind,
        target_id: target_id.map(str::to_owned),
    }
}

pub fn state_of<'a>(op: &'a AdminOp, action: &AdminAction) -> Option<&'a AdminActionState> {
    op.actions.iter().find(|state| state.action == *action)
}

/// This change is on its way.
pub fn running(op: &AdminOp, action: &AdminAction) -> bool {
    state_of(op, action).is_some_and(|state| state.busy)
}

/// Why this change failed, until it starts again.
pub fn failure<'a>(op: &'a AdminOp, action: &AdminAction) -> Option<&'a ErrorView> {
    state_of(op, action)
        .filter(|state| !state.busy)
        .and_then(|state| state.error.as_ref())
}

/// Any change of these kinds on its way.
pub fn any_running(op: &AdminOp, kinds: &[AdminActionKind]) -> bool {
    op.actions
        .iter()
        .any(|state| kinds.contains(&state.action.kind) && state.busy)
}

pub use crate::community_settings::rules::{Outcome, Pending};

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

    /// The card for core's preset; an unknown one shows as Custom.
    pub fn of(preset: ChannelPreset) -> Self {
        match preset {
            ChannelPreset::Normal => Self::Normal,
            ChannelPreset::ReadOnly => Self::ReadOnly,
            ChannelPreset::Announcement => Self::Announcement,
            ChannelPreset::ModsOnly => Self::ModsOnly,
            ChannelPreset::Custom | ChannelPreset::Unknown => Self::Custom,
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
    let mut cards = vec![
        Card::Normal,
        Card::ReadOnly,
        Card::Announcement,
        Card::ModsOnly,
    ];
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

/// The stored set as a choice (core's `DetectedPreset`).
pub fn stored_choice(detected: &DetectedPreset) -> PresetChoice {
    PresetChoice {
        card: Card::of(detected.preset),
        post_role_ids: detected.post_role_ids.clone(),
        members_can_attach: detected.members_can_attach,
    }
    .normalized()
}

/// What this user lacks to apply a card's preset (core's `PresetAccess`).
pub fn missing_for(access: &[PresetAccess], card: Card) -> Vec<String> {
    access
        .iter()
        .find(|entry| Card::of(entry.preset) == card)
        .map(|entry| entry.missing.clone())
        .unwrap_or_default()
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

/// The roles drawn as locked "Kept automatically" chips: those at or above the user that the set
/// keeps. From `Core::build_preset`'s `auto_allowed_role_ids` for the current choice when the app
/// has answered; before that, for the stored set, the roles at or above the user it allows.
pub fn kept_roles(
    roles: &[OverwriteRoleOption],
    overwrites: &[OverwriteRow],
    choice: &PresetChoice,
    stored: &PresetChoice,
    auto_allowed: Option<&[String]>,
) -> Vec<String> {
    roles
        .iter()
        .filter(|role| !role.below_me)
        .filter(|role| match auto_allowed {
            Some(auto) => auto.contains(&role.id),
            None => {
                choice == stored
                    && overwrites.iter().any(|row| {
                        !row.allow.is_empty()
                            && matches!(&row.target, OverwriteTarget::Role { role_id, .. } if *role_id == role.id)
                    })
            }
        })
        .map(|role| role.id.clone())
        .collect()
}

/// A row's name in the summary: "@everyone", the role's name, or "Deleted role".
pub fn target_name(row: &OverwriteRow) -> String {
    match &row.target {
        OverwriteTarget::Everyone => "@everyone".into(),
        OverwriteTarget::Role { .. } if row.role_missing => "Deleted role".into(),
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
                    .map(|a| action_label(a).map_or_else(|| a.clone(), str::to_lowercase))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let parts: Vec<String> = [
                (!row.allow.is_empty()).then(|| format!("can {}", list(&row.allow))),
                (!row.deny.is_empty()).then(|| format!("can't {}", list(&row.deny))),
            ]
            .into_iter()
            .flatten()
            .collect();
            format!("{}: {}", target_name(row), parts.join("; "))
        })
        .collect()
}
