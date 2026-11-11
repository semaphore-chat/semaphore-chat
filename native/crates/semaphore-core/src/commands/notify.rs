//! Notifications: the centre, settings, per-channel levels, the tray badge, and the decision to
//! raise an OS notification (`CoreEvent::Notify`). Unit W2-core.

use crate::client::Core;
use crate::model::{
    ChannelNotifyLevelView, NotificationList, NotificationSettingsPatch, NotificationSettingsView,
    NotifyLevel,
};
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// The notification centre's first page, and what's loaded since. `ViewKey::Notifications` says
    /// when to read again.
    pub fn notifications(&self) -> NotificationList {
        NotificationList::default()
    }

    /// Reads the next page. Nothing to do when `has_more` is false.
    pub async fn load_more_notifications(&self) -> Result<(), CoreError> {
        Err(unavailable("notifications"))
    }

    /// Shown read at once; back if the server refuses.
    pub async fn mark_notification_read(&self, _notification_id: String) -> Result<(), CoreError> {
        Err(unavailable("notifications"))
    }

    pub async fn mark_all_notifications_read(&self) -> Result<(), CoreError> {
        Err(unavailable("notifications"))
    }

    /// Takes it off the list.
    pub async fn dismiss_notification(&self, _notification_id: String) -> Result<(), CoreError> {
        Err(unavailable("notifications"))
    }

    /// `ViewKey::NotificationSettings` says when to read again.
    pub fn notification_settings(&self) -> NotificationSettingsView {
        NotificationSettingsView::default()
    }

    /// Changes the fields the patch sets. Shown at once; back if the server refuses.
    pub async fn update_notification_settings(
        &self,
        _patch: NotificationSettingsPatch,
    ) -> Result<(), CoreError> {
        Err(unavailable("notification settings"))
    }

    /// `ViewKey::ChannelNotifyLevel` says when to read again.
    pub fn channel_notify_level(&self, _channel_id: String) -> ChannelNotifyLevelView {
        ChannelNotifyLevelView::default()
    }

    /// Gives a channel its own level, or (`None`) puts it back to the default.
    pub async fn set_channel_notify_level(
        &self,
        _channel_id: String,
        _level: Option<NotifyLevel>,
    ) -> Result<(), CoreError> {
        Err(unavailable("channel notification levels"))
    }

    /// The tray and dock badge: unread notifications, as the web's `useAppBadge`. 0 when signed
    /// out. `ViewKey::Badge` says when to read again.
    pub fn badge_count(&self) -> u32 {
        0
    }
}

/// What W2's commands keep between calls. Forgotten at sign-out.
#[derive(Debug, Default)]
pub(crate) struct W2State {}
