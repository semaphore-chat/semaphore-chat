//! W2's notification centre, settings, channel levels, badge and OS notifications.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    ChannelNotifyLevelView, LoadState, MessageLink, NotificationKind, NotificationList,
    NotificationRow, NotificationSettings, NotificationSettingsPatch, NotificationSettingsView,
    NotifyLevel, NotifySound, OsNotification, UserView,
};

#[uniffi::remote(Enum)]
pub enum NotificationKind {
    Mention,
    DirectMessage,
    ChannelMessage,
    ThreadReply,
}

#[uniffi::remote(Record)]
pub struct NotificationRow {
    pub id: String,
    pub kind: NotificationKind,
    pub author: UserView,
    pub link: MessageLink,
    pub parent_message_id: Option<String>,
    pub channel_name: Option<String>,
    pub preview: String,
    pub created_at_ms: i64,
    pub read: bool,
}

#[uniffi::remote(Record)]
pub struct NotificationList {
    pub state: LoadState,
    pub rows: Vec<NotificationRow>,
    pub unread_count: u32,
    pub has_more: bool,
}

#[uniffi::remote(Enum)]
pub enum NotifyLevel {
    All,
    Mentions,
    Muted,
}

#[uniffi::remote(Enum)]
pub enum NotifySound {
    Default,
    Mention,
    Dm,
}

#[uniffi::remote(Record)]
pub struct NotificationSettings {
    pub desktop_enabled: bool,
    pub play_sound: bool,
    pub sound: NotifySound,
    pub dnd: bool,
    pub dnd_start: Option<String>,
    pub dnd_end: Option<String>,
    pub dnd_timezone: Option<String>,
    pub default_level: NotifyLevel,
    pub dm_notifications: bool,
}

#[uniffi::remote(Record)]
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

#[uniffi::remote(Record)]
pub struct NotificationSettingsView {
    pub state: LoadState,
    pub settings: NotificationSettings,
}

#[uniffi::remote(Record)]
pub struct ChannelNotifyLevelView {
    pub state: LoadState,
    pub level: Option<NotifyLevel>,
    pub effective: NotifyLevel,
}

#[uniffi::remote(Record)]
pub struct OsNotification {
    pub id: String,
    pub tag: String,
    pub title: String,
    pub body: String,
    pub link: MessageLink,
    pub parent_message_id: Option<String>,
    pub sound: Option<NotifySound>,
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn notifications(&self) -> NotificationList {
        self.core.notifications()
    }

    pub async fn load_more_notifications(&self) -> Result<(), CoreError> {
        self.core.load_more_notifications().await
    }

    pub async fn mark_notification_read(&self, notification_id: String) -> Result<(), CoreError> {
        self.core.mark_notification_read(notification_id).await
    }

    pub async fn mark_all_notifications_read(&self) -> Result<(), CoreError> {
        self.core.mark_all_notifications_read().await
    }

    pub async fn dismiss_notification(&self, notification_id: String) -> Result<(), CoreError> {
        self.core.dismiss_notification(notification_id).await
    }

    pub fn notification_settings(&self) -> NotificationSettingsView {
        self.core.notification_settings()
    }

    pub async fn update_notification_settings(
        &self,
        patch: NotificationSettingsPatch,
    ) -> Result<(), CoreError> {
        self.core.update_notification_settings(patch).await
    }

    pub fn channel_notify_level(&self, channel_id: String) -> ChannelNotifyLevelView {
        self.core.channel_notify_level(channel_id)
    }

    pub async fn set_channel_notify_level(
        &self,
        channel_id: String,
        level: Option<NotifyLevel>,
    ) -> Result<(), CoreError> {
        self.core.set_channel_notify_level(channel_id, level).await
    }

    pub fn badge_count(&self) -> u32 {
        self.core.badge_count()
    }
}
