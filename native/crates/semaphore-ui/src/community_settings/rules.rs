//! What the tabs check before they send, and the labels they draw, with no GPUI in them. Lengths
//! are counted as the web and the server's `class-validator` count them: UTF-16 code units.

use crate::messages::TimeFormat;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionState, AdminOp, ChannelPreset, CommunityCaps,
    DraftFile, ErrorView, InviteRow,
};

/// A string's length as JavaScript's `.length` (and so `maxLength` and `@MaxLength`) counts it.
pub fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `useCommunityForm`'s rule (2 or more), under `CreateCommunityDto`'s 100.
pub const COMMUNITY_NAME_MIN: usize = 2;
pub const COMMUNITY_NAME_MAX: usize = 100;
/// `CreateCommunityDto.description`.
pub const DESCRIPTION_MAX: usize = 500;
/// `CreateChannelDto.name`.
pub const CHANNEL_NAME_MAX: usize = 100;
/// `AliasGroupEditor`'s and `CreateAliasGroupDto`'s 50.
pub const GROUP_NAME_MAX: usize = 50;
/// `CustomEmojiManagement`: "max 256KB".
pub const EMOJI_MAX_BYTES: usize = 256 * 1024;
pub const EMOJI_TYPES: [&str; 3] = ["image/png", "image/gif", "image/webp"];
/// `SoundboardManagement`'s `MAX_SOUND_BYTES`, the server's cap.
pub const SOUND_MAX_BYTES: usize = 1024 * 1024;
pub const SOUND_TYPES: [&str; 5] = [
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/webm",
    "audio/aac",
];
/// `CreateSoundboardSoundDto`.
pub const SOUND_NAME_MAX: usize = 50;
pub const SOUND_EMOJI_MAX: usize = 16;
/// `CreateWebhookDto.name`.
pub const WEBHOOK_NAME_MAX: usize = 80;
/// The images the server takes for a community's avatar and banner.
pub const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

pub fn check_community_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        Err("Community name is required".into())
    } else if js_len(name) < COMMUNITY_NAME_MIN {
        Err("Community name must be at least 2 characters".into())
    } else if js_len(name) > COMMUNITY_NAME_MAX {
        Err(format!(
            "Community name must be at most {COMMUNITY_NAME_MAX} characters"
        ))
    } else {
        Ok(())
    }
}

pub fn check_description(description: &str) -> Result<(), String> {
    if js_len(description.trim()) > DESCRIPTION_MAX {
        Err(format!(
            "Description must be at most {DESCRIPTION_MAX} characters"
        ))
    } else {
        Ok(())
    }
}

pub fn check_channel_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        Err("Channel name is required".into())
    } else if js_len(name) > CHANNEL_NAME_MAX {
        Err(format!(
            "Channel name must be at most {CHANNEL_NAME_MAX} characters"
        ))
    } else {
        Ok(())
    }
}

/// `AliasGroupEditor.validateName`: what's typed, untrimmed, as the web checks it.
pub fn check_group_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        Err("Group name is required".into())
    } else if js_len(name) > GROUP_NAME_MAX {
        Err("Group name must not exceed 50 characters".into())
    } else if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        Err("Group name can only contain letters, numbers, hyphens, and underscores".into())
    } else {
        Ok(())
    }
}

/// What core sends for a shortcode: trimmed, without the colons around it.
pub fn shortcode(typed: &str) -> &str {
    typed.trim().trim_matches(':')
}

/// `NAME_REGEX` (`^(?=.*[a-z])[a-z0-9_]{2,32}$`) on the shortcode.
pub fn check_emoji_name(typed: &str) -> Result<(), String> {
    let name = shortcode(typed);
    let count = name.chars().count();
    let allowed = name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if (2..=32).contains(&count) && allowed && name.chars().any(|c| c.is_ascii_lowercase()) {
        Ok(())
    } else {
        Err("Name must be 2-32 characters of lowercase letters, numbers, or underscores, and include at least one letter.".into())
    }
}

pub fn check_emoji_file(file: &DraftFile) -> Result<(), String> {
    if !EMOJI_TYPES.contains(&file.mime_type.as_str()) || file.bytes.len() > EMOJI_MAX_BYTES {
        Err("Choose an image file (PNG, GIF, or WebP, max 256KB).".into())
    } else {
        Ok(())
    }
}

/// `CreateSoundboardSoundDto.name`: the server's pattern, checked here so the form says why.
pub fn check_sound_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        Err("Sound name must not be empty".into())
    } else if js_len(name) > SOUND_NAME_MAX {
        Err("Sound name must not exceed 50 characters".into())
    } else if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '-'))
    {
        Err("Sound name can only contain letters, numbers, spaces, hyphens, and underscores".into())
    } else {
        Ok(())
    }
}

pub fn check_sound_emoji(emoji: &str) -> Result<(), String> {
    if js_len(emoji.trim()) > SOUND_EMOJI_MAX {
        Err("Emoji must not exceed 16 characters".into())
    } else {
        Ok(())
    }
}

pub fn check_sound_file(file: &DraftFile) -> Result<(), String> {
    if file.bytes.len() > SOUND_MAX_BYTES {
        Err("Sound is too large. Maximum size is 1MB.".into())
    } else if !SOUND_TYPES.contains(&file.mime_type.as_str()) {
        Err("Choose an MP3, WAV, OGG, WebM, or AAC file.".into())
    } else {
        Ok(())
    }
}

/// The web's default name for a picked sound: its file name less the extension, cut to 50.
pub fn sound_name_from_file(file_name: &str) -> String {
    let base = match file_name.rfind('.') {
        Some(dot) if dot > 0 => &file_name[..dot],
        _ => file_name,
    };
    let mut out = String::new();
    for c in base.chars() {
        if js_len(&out) + c.len_utf16() > SOUND_NAME_MAX {
            break;
        }
        out.push(c);
    }
    out
}

pub fn check_webhook_name(name: &str) -> Result<(), String> {
    let count = js_len(name.trim());
    if count == 0 || count > WEBHOOK_NAME_MAX {
        Err("Name must be between 1 and 80 characters".into())
    } else {
        Ok(())
    }
}

/// An avatar or banner for the community: one the server takes, and no larger than its limit.
pub fn check_image(file: &DraftFile, max_bytes: Option<u64>) -> Result<(), String> {
    if !IMAGE_TYPES.contains(&file.mime_type.as_str()) {
        return Err("Choose a PNG, JPEG, GIF or WebP image".into());
    }
    if let Some(max) = max_bytes
        && file.bytes.len() as u64 > max
    {
        return Err(format!(
            "That image is {}; the limit is {}",
            size_label(file.bytes.len() as u64),
            size_label(max)
        ));
    }
    Ok(())
}

/// "256 KB", "1.5 MB".
pub fn size_label(bytes: u64) -> String {
    const KB: f64 = 1024.;
    let bytes = bytes as f64;
    if bytes < KB * KB {
        format!("{} KB", (bytes / KB).ceil() as u64)
    } else {
        let mb = bytes / (KB * KB);
        if (mb - mb.round()).abs() < 0.05 {
            format!("{} MB", mb.round() as u64)
        } else {
            format!("{mb:.1} MB")
        }
    }
}

// ---- Invites. ----

/// "Max Uses": empty is unlimited (`None`), otherwise a whole number of at least 1.
pub fn parse_max_uses(typed: &str) -> Result<Option<u32>, String> {
    let typed = typed.trim();
    if typed.is_empty() {
        return Ok(None);
    }
    if !typed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Max uses must be a whole number".into());
    }
    match typed.parse::<u32>() {
        Err(_) => Err("Max uses is too large".into()),
        Ok(0) => Err("Max uses must be at least 1".into()),
        Ok(uses) => Ok(Some(uses)),
    }
}

/// When a new invite stops working: the web's date picker, as presets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ExpiryPreset {
    #[default]
    Never,
    Hour,
    Day,
    Week,
    Month,
}

impl ExpiryPreset {
    pub const ALL: [ExpiryPreset; 5] =
        [Self::Never, Self::Hour, Self::Day, Self::Week, Self::Month];

    pub fn label(self) -> &'static str {
        match self {
            Self::Never => "Never",
            Self::Hour => "1 hour",
            Self::Day => "1 day",
            Self::Week => "7 days",
            Self::Month => "30 days",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::Hour => "hour",
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
        }
    }

    /// The invite's `valid_until_ms`, from `now_ms`.
    pub fn valid_until(self, now_ms: i64) -> Option<i64> {
        const HOUR: i64 = 60 * 60 * 1000;
        let span = match self {
            Self::Never => return None,
            Self::Hour => HOUR,
            Self::Day => 24 * HOUR,
            Self::Week => 7 * 24 * HOUR,
            Self::Month => 30 * 24 * HOUR,
        };
        Some(now_ms.saturating_add(span))
    }
}

/// The chip on an invite row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteStatus {
    Active,
    Expired,
    MaxedOut,
    Disabled,
}

impl InviteStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Active => "Active",
            Self::Expired => "Expired",
            Self::MaxedOut => "Max Uses Reached",
            Self::Disabled => "Disabled",
        }
    }
}

/// `InviteManagement`: expired (strictly after `valid_until`) wins, then used up, then disabled.
pub fn invite_status(invite: &InviteRow, now_ms: i64) -> InviteStatus {
    if invite.valid_until_ms.is_some_and(|until| now_ms > until) {
        InviteStatus::Expired
    } else if invite
        .max_uses
        .is_some_and(|max| max > 0 && invite.uses >= max)
    {
        InviteStatus::MaxedOut
    } else if invite.disabled {
        InviteStatus::Disabled
    } else {
        InviteStatus::Active
    }
}

/// "Uses: 3/10", or "Uses: 3" without a limit.
pub fn uses_label(invite: &InviteRow) -> String {
    match invite.max_uses {
        Some(max) if max > 0 => format!("Uses: {}/{max}", invite.uses),
        _ => format!("Uses: {}", invite.uses),
    }
}

/// The web's `getInviteUrl`: the server, then its hash route.
pub fn invite_url(base: &str, code: &str) -> String {
    format!("{}/#/join/{code}", base.trim().trim_end_matches('/'))
}

/// "Nov 1, 2026", in `time`'s zone (the user's, unless a story fixes one).
pub fn date_label(time: &TimeFormat, ms: i64) -> String {
    time.format_at(ms, "%b %-d, %Y")
}

// ---- Deleting the community. ----

/// The typed name matches the community's (case and accents count; spaces around don't).
pub fn confirms_name(typed: &str, name: &str) -> bool {
    let name = name.trim();
    !name.is_empty() && typed.trim() == name
}

// ---- Channels. ----

/// The preset chip on a channel row; none for a normal channel.
pub fn preset_label(preset: ChannelPreset) -> Option<&'static str> {
    match preset {
        ChannelPreset::Normal | ChannelPreset::Unknown => None,
        ChannelPreset::ReadOnly => Some("Read-only"),
        ChannelPreset::Announcement => Some("Announcement"),
        ChannelPreset::ModsOnly => Some("Mods only"),
        ChannelPreset::Custom => Some("Custom permissions"),
    }
}

// ---- Why something is turned off. ----

/// The reason a disabled control gives: the permission, by the web's `ACTION_LABELS` name.
pub fn needs(label: &str) -> String {
    format!("You need the \u{201c}{label}\u{201d} permission")
}

/// The community settings sections, in the web's order, with Invites last.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum CommunityTab {
    #[default]
    Overview,
    Members,
    Channels,
    PrivateChannels,
    Roles,
    MentionGroups,
    Emoji,
    Moderation,
    Soundboard,
    Invites,
}

impl CommunityTab {
    pub const ALL: [CommunityTab; 10] = [
        Self::Overview,
        Self::Members,
        Self::Channels,
        Self::PrivateChannels,
        Self::Roles,
        Self::MentionGroups,
        Self::Emoji,
        Self::Moderation,
        Self::Soundboard,
        Self::Invites,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Overview => "Overview",
            Self::Members => "Members",
            Self::Channels => "Channels",
            Self::PrivateChannels => "Private Channels",
            Self::Roles => "Roles",
            Self::MentionGroups => "Mention Groups",
            Self::Emoji => "Custom Emoji",
            Self::Moderation => "Moderation",
            Self::Soundboard => "Soundboard",
            Self::Invites => "Invites",
        }
    }

    /// The nav row's id is `community-tab-<key>`.
    pub fn key(self) -> &'static str {
        match self {
            Self::Overview => "overview",
            Self::Members => "members",
            Self::Channels => "channels",
            Self::PrivateChannels => "private-channels",
            Self::Roles => "roles",
            Self::MentionGroups => "mention-groups",
            Self::Emoji => "emoji",
            Self::Moderation => "moderation",
            Self::Soundboard => "soundboard",
            Self::Invites => "invites",
        }
    }

    /// Why this tab is turned off for these caps, or `None` when it opens. Overview and Invites
    /// always open: Overview reads as a form without the right to save, Invites lists my own.
    pub fn locked(self, caps: &CommunityCaps) -> Option<String> {
        let (open, label) = match self {
            Self::Overview | Self::Invites => (true, ""),
            Self::Members => (caps.read_members, "View members"),
            Self::Channels => (
                caps.create_channel || caps.update_channel || caps.delete_channel,
                "Create channels",
            ),
            Self::PrivateChannels => (caps.manage_private_members, "Add members"),
            Self::Roles => (caps.read_roles, "View roles"),
            Self::MentionGroups => (caps.read_alias_groups, "View mention groups"),
            Self::Emoji => (caps.manage_emoji, "Manage custom emojis"),
            Self::Moderation => (caps.view_bans || caps.view_moderation_log, "View ban list"),
            Self::Soundboard => (caps.read_sounds, "View soundboard sounds"),
        };
        (!open).then(|| needs(label))
    }
}

/// The first tab these caps open, for a route that names none.
pub fn first_open_tab(caps: &CommunityCaps) -> CommunityTab {
    CommunityTab::ALL
        .into_iter()
        .find(|tab| tab.locked(caps).is_none())
        .unwrap_or_default()
}

/// Whether the community's settings entry (the sidebar header's button) is offered: some change
/// these caps allow. Reading alone doesn't count, since the default Member role reads members and
/// sounds, and every member could otherwise open a page of disabled controls. `delete_invite` on
/// its own doesn't count either: it is deliberately ignored below, and a member who holds nothing
/// else (see `reader_caps` in the shell stories) gets no settings entry.
pub fn opens_settings(caps: &CommunityCaps) -> bool {
    let CommunityCaps {
        update_community,
        delete_community,
        create_channel,
        update_channel,
        delete_channel,
        manage_private_members,
        manage_channel_permissions,
        read_roles: _,
        create_role,
        update_role,
        delete_role,
        assign_roles,
        read_members: _,
        add_members,
        read_alias_groups: _,
        create_alias_group,
        update_alias_group,
        delete_alias_group,
        manage_alias_members,
        manage_emoji,
        read_sounds: _,
        create_sound,
        delete_sound,
        manage_webhooks,
        create_invite,
        delete_invite: _,
        ban,
        unban,
        kick,
        timeout,
        view_bans,
        view_moderation_log,
    } = *caps;
    update_community
        || delete_community
        || create_channel
        || update_channel
        || delete_channel
        || manage_private_members
        || manage_channel_permissions
        || create_role
        || update_role
        || delete_role
        || assign_roles
        || add_members
        || create_alias_group
        || update_alias_group
        || delete_alias_group
        || manage_alias_members
        || manage_emoji
        || create_sound
        || delete_sound
        || manage_webhooks
        || create_invite
        || ban
        || unban
        || kick
        || timeout
        || view_bans
        || view_moderation_log
}

// ---- Which change an op is about. ----

/// A change, as core keys it in `AdminOp::actions`.
pub fn act(kind: AdminActionKind, target_id: Option<&str>) -> AdminAction {
    AdminAction {
        kind,
        target_id: target_id.map(str::to_owned),
    }
}

/// This change's own state on `op`: running, or failed until it starts again. `None` once it has
/// succeeded (or before it starts).
pub fn state_of<'a>(op: &'a AdminOp, action: &AdminAction) -> Option<&'a AdminActionState> {
    op.actions.iter().find(|state| state.action == *action)
}

/// This change is on its way (or its file is going up).
pub fn running(op: &AdminOp, action: &AdminAction) -> bool {
    state_of(op, action).is_some_and(|state| state.busy || state.upload.is_some())
}

/// Why this change failed, until it starts again.
pub fn failure<'a>(op: &'a AdminOp, action: &AdminAction) -> Option<&'a ErrorView> {
    state_of(op, action)
        .filter(|state| !state.busy)
        .and_then(|state| state.error.as_ref())
}

/// The running changes of these kinds, oldest first.
pub fn running_of<'a>(
    op: &'a AdminOp,
    kinds: &'a [AdminActionKind],
) -> impl Iterator<Item = &'a AdminActionState> + 'a {
    op.actions
        .iter()
        .filter(move |state| kinds.contains(&state.action.kind))
        .filter(|state| state.busy || state.upload.is_some())
}

/// The newest failure among these kinds, with the change it belongs to.
pub fn failure_of<'a>(
    op: &'a AdminOp,
    kinds: &[AdminActionKind],
) -> Option<(&'a AdminAction, &'a ErrorView)> {
    op.actions
        .iter()
        .rev()
        .filter(|state| kinds.contains(&state.action.kind) && !state.busy)
        .find_map(|state| state.error.as_ref().map(|error| (&state.action, error)))
}

/// Where a sent change stands, from its own entry in the op.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Not started yet, or still on its way.
    Waiting,
    Succeeded,
    Failed,
}

/// A change a view sent, followed until core records that it ended (`AdminOp::finished`): a
/// start and an end that reach the view in one batch can't be missed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pending {
    pub action: AdminAction,
    /// `AdminOp::last_finished_seq` as the change was sent: only a later end is this one's.
    after: u64,
}

impl Pending {
    pub fn new(action: AdminAction, before: &AdminOp) -> Self {
        Self {
            action,
            after: before.last_finished_seq(),
        }
    }

    /// The op as core shows it now: waiting until this action's end is recorded, then whether
    /// it failed.
    pub fn observe(&mut self, op: &AdminOp) -> Outcome {
        match op.finished_since(&self.action, self.after) {
            Some(done) if done.error.is_some() => Outcome::Failed,
            Some(_) => Outcome::Succeeded,
            None => Outcome::Waiting,
        }
    }
}
