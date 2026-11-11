//! Notifications: the notification centre, settings, per-channel levels, and the OS notification
//! core decides to raise. Unit W2-core.

use super::{LoadState, MessageLink, UserView};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum NotificationKind {
    /// A user, `@here`/`@channel` or alias mention in a channel.
    #[default]
    Mention,
    /// A message in a DM or group (a mention there too).
    DirectMessage,
    /// Any message in a channel set to `NotifyLevel::All`.
    ChannelMessage,
    /// A reply in a thread this user follows.
    ThreadReply,
}

/// One row of the notification centre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationRow {
    pub id: String,
    pub kind: NotificationKind,
    pub author: UserView,
    /// Where the message is: its channel or DM, never a thread.
    pub link: MessageLink,
    /// Set for a thread reply: opening it opens this thread.
    pub parent_message_id: Option<String>,
    /// The channel's name, when known.
    pub channel_name: Option<String>,
    /// Plain text of the message.
    pub preview: String,
    pub created_at_ms: i64,
    pub read: bool,
}

/// The notification centre, newest first, without dismissed rows. `ViewKey::Notifications` says
/// when to read again; `Core::load_more_notifications` reads the next page.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotificationList {
    pub state: LoadState,
    pub rows: Vec<NotificationRow>,
    pub unread_count: u32,
    /// More rows exist than are loaded.
    pub has_more: bool,
}

/// How much of a channel notifies. Sent as the server's `all`, `mentions` and `none`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum NotifyLevel {
    All,
    #[default]
    Mentions,
    /// Nothing, not even mentions: the server creates no notification at all.
    Muted,
}

/// The sound a notification plays.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum NotifySound {
    #[default]
    Default,
    Mention,
    Dm,
}

/// This user's notification settings, as the server keeps them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationSettings {
    /// Raise OS notifications at all.
    pub desktop_enabled: bool,
    pub play_sound: bool,
    pub sound: NotifySound,
    /// Do not disturb. With both times set it applies only between them, otherwise always.
    pub dnd: bool,
    /// `HH:mm`, 24-hour.
    pub dnd_start: Option<String>,
    pub dnd_end: Option<String>,
    /// IANA, such as `Europe/Berlin`; UTC when unset or unknown.
    pub dnd_timezone: Option<String>,
    /// For channels with no level of their own.
    pub default_level: NotifyLevel,
    /// Notify for DMs and groups.
    pub dm_notifications: bool,
}

impl Default for NotificationSettings {
    /// The server's defaults for a user who never saved any.
    fn default() -> Self {
        Self {
            desktop_enabled: true,
            play_sound: true,
            sound: NotifySound::Default,
            dnd: false,
            dnd_start: None,
            dnd_end: None,
            dnd_timezone: None,
            default_level: NotifyLevel::Mentions,
            dm_notifications: true,
        }
    }
}

/// A change to some settings: `None` leaves a field as it is. For the DND times and timezone,
/// `Some(None)` can't be said over UniFFI, so an empty string clears them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotificationSettingsPatch {
    pub desktop_enabled: Option<bool>,
    pub play_sound: Option<bool>,
    pub sound: Option<NotifySound>,
    pub dnd: Option<bool>,
    pub dnd_start: Option<String>,
    pub dnd_end: Option<String>,
    pub dnd_timezone: Option<String>,
    pub default_level: Option<NotifyLevel>,
    pub dm_notifications: Option<bool>,
}

/// `ViewKey::NotificationSettings` says when to read again. A change shows at once and goes back
/// if the server refuses it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotificationSettingsView {
    pub state: LoadState,
    pub settings: NotificationSettings,
}

/// A channel's level, for its menu. `ViewKey::ChannelNotifyLevel` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelNotifyLevelView {
    pub state: LoadState,
    /// The channel's own level. `None`: it follows `NotificationSettings::default_level`.
    pub level: Option<NotifyLevel>,
    /// What applies: `level`, or else the default.
    pub effective: NotifyLevel,
}

/// An OS notification core decided to raise (`CoreEvent::Notify`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsNotification {
    /// The server's notification id.
    pub id: String,
    /// One per conversation: `dm:<id>` or `channel:<id>` (a thread uses its channel's or DM's).
    /// A newer notification replaces the older one with the same tag, and a click maps back by it.
    pub tag: String,
    pub title: String,
    pub body: String,
    /// What a click opens.
    pub link: MessageLink,
    /// Set for a thread reply: a click opens this thread too.
    pub parent_message_id: Option<String>,
    /// `None`: silent.
    pub sound: Option<NotifySound>,
}
