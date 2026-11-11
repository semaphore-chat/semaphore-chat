//! W5-ui-moderation: the user moderation menu, the ban, kick, timeout, unban and remove-timeout
//! dialogs, the Moderation tab (ban list, timeout list, moderation log), from
//! `components/Moderation/`, and the "you were removed" notice (`CoreEvent::CommunityRemoved`).
//!
//! What may be done comes from core (`ModerationTargetView`, `CommunityCaps`, the rows'
//! `can_lift`), never from roles or ranks here. Views take data through `set_*` and emit events;
//! the app calls core:
//!
//! - [`ModerationMenu`]: from a member row's `MembersEvent::Moderate`, or any member context menu.
//!   Its events say which dialog to open.
//! - [`ModerationDialog`]: one entity for all five dialogs (`open_ban`, `open_kick`,
//!   `open_timeout`, `open_unban`, `open_remove_timeout`). Its events name the core call; fed the
//!   op its action lives on (`set_op`), it follows that action's own entry: busy while it runs,
//!   the server's words when it fails, closed with `Succeeded` when it goes. `set_busy`,
//!   `set_error` and `close` drive it by hand where there is no op (the W4 participant menu's
//!   kick confirm, which this replaces).
//! - [`ModerationTab`]: the slot for `CommunitySettingsScreen::set_moderation_slot`.
//! - [`RemovedNotice`]: shown once on `CoreEvent::CommunityRemoved`.
//!
//! Times go through `messages::TimeFormat`, the zone and clock message times use.

mod common;
mod dialogs;
pub mod format;
mod menu;
mod removed;
#[cfg(feature = "stories")]
mod stories;
mod tab;
#[cfg(test)]
mod tests;

pub use dialogs::{DialogKind, ModerationDialog, ModerationDialogEvent};
pub use menu::{ModerationMenu, ModerationMenuEvent};
pub use removed::{RemovedNotice, RemovedNoticeEvent};
pub use tab::{ModerationTab, ModerationTabEvent};

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
