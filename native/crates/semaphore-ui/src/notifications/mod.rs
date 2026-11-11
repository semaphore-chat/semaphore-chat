//! W2-ui-notifications: the notification centre, the per-channel level menu and the notification
//! settings section. Reads `NotificationList`, `ChannelNotifyLevelView` and
//! `NotificationSettingsView`.
//!
//! - `NotificationCenter` (`NotificationCenter.tsx`, `NotificationList.tsx`): what the shell's side
//!   panel shows when the bell is pressed. Rows with the author, the kind, the preview and the time,
//!   unread ones marked; mark one or all read, dismiss, load more.
//! - `ChannelNotifyMenu` (`ChannelNotificationMenu.tsx`): the channel header's level button and
//!   its menu, for `Shell::set_header_accessory`.
//! - `NotificationSettingsSection` (`Settings/NotificationSettings.tsx`): the settings form, saved
//!   with a Save button. `SettingsForm` is its draft and the patch it saves, with no GPUI in it.

mod center;
mod menu;
mod settings;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;

pub use center::{kind_label, notification_label};
pub use menu::{level_label, level_tooltip};
pub use settings::{SettingsError, SettingsForm, valid_time};

use crate::panel::PanelClock;
use gpui_kit::component::input::InputState;
use gpui_kit::*;
use semaphore_core::model::{
    ChannelNotifyLevelView, MessageLink, NotificationList, NotificationSettingsPatch, NotifyLevel,
    NotifySound,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationEvent {
    /// A row was clicked: the owner opens `link` (and the thread when `parent_message_id` is set)
    /// and closes the panel. An unread row emits `MarkRead` first.
    Open {
        notification_id: String,
        link: MessageLink,
        parent_message_id: Option<String>,
    },
    /// `Core::mark_notification_read`.
    MarkRead {
        id: String,
    },
    /// `Core::mark_all_notifications_read`.
    MarkAllRead,
    /// `Core::dismiss_notification`.
    Dismiss {
        id: String,
    },
    /// "Load more": `Core::load_more_notifications`, with `loading_more` set until it returns.
    LoadMore,
    /// The list failed, or the empty list's Refresh: `Core::retry_failed`.
    Retry,
    Close,
}

pub struct NotificationCenter {
    list: NotificationList,
    loading_more: bool,
    clock: PanelClock,
}

impl EventEmitter<NotificationEvent> for NotificationCenter {}

impl NotificationCenter {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            list: NotificationList::default(),
            loading_more: false,
            clock: PanelClock::default(),
        }
    }

    /// `Core::notifications`, read again on `ViewChanged { Notifications }`; `loading_more` while
    /// a `load_more_notifications` is on its way.
    pub fn set_list(&mut self, list: NotificationList, loading_more: bool, cx: &mut Context<Self>) {
        self.list = list;
        self.loading_more = loading_more;
        cx.notify();
    }

    /// What "5m ago" is measured from. The real clock unless a story fixes it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelNotifyEvent {
    /// `Core::set_channel_notify_level(channel_id, level)`; `None` is "Use Default".
    SetLevel(Option<NotifyLevel>),
}

pub struct ChannelNotifyMenu {
    view: ChannelNotifyLevelView,
    channel_name: Option<String>,
    default_level: NotifyLevel,
    busy: bool,
    open: bool,
}

impl EventEmitter<ChannelNotifyEvent> for ChannelNotifyMenu {}

impl ChannelNotifyMenu {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            view: ChannelNotifyLevelView::default(),
            channel_name: None,
            default_level: NotifyLevel::Mentions,
            busy: false,
            open: false,
        }
    }

    /// `Core::channel_notify_level(channel_id)`, read again on `ViewChanged`.
    pub fn set_view(&mut self, view: ChannelNotifyLevelView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// For the menu's title, "Notifications for #name".
    pub fn set_channel_name(&mut self, name: Option<String>, cx: &mut Context<Self>) {
        self.channel_name = name;
        cx.notify();
    }

    /// `NotificationSettings::default_level`, for "Use Default (Currently: ...)".
    pub fn set_default(&mut self, level: NotifyLevel, cx: &mut Context<Self>) {
        self.default_level = level;
        cx.notify();
    }

    /// A change is on its way: the button waits, as the web's does.
    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        cx.notify();
    }

    pub fn is_open(&self) -> bool {
        self.open
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsEvent {
    /// Save: `Core::update_notification_settings(patch)`, with `set_saving(true)` until it returns.
    /// Only the fields that differ from what was loaded are set.
    Save(NotificationSettingsPatch),
    /// The sound type's play button: the owner plays it.
    PreviewSound(NotifySound),
    /// "Send Test Notification": the owner raises one through the OS.
    SendTest,
    /// The settings failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct NotificationSettingsSection {
    form: SettingsForm,
    state: semaphore_core::model::LoadState,
    start: Entity<InputState>,
    end: Entity<InputState>,
    saving: bool,
    local_timezone: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SettingsEvent> for NotificationSettingsSection {}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
