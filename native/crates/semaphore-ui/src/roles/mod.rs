//! W5-ui-roles: the role list, the role editor and its permission matrix, the assignment dialog
//! and channel permission overrides, from `components/Community/RoleManagement.tsx`,
//! `RoleEditor.tsx`, `RoleAssignmentDialog.tsx` and `ChannelPermissionsTab.tsx`.
//!
//! The views take core's view models through `set_*` and emit events; the app runs the core
//! commands. What the user may do comes from core's flags (`RolesView`, `RoleRow`,
//! `MemberRolesView`, `ChannelOverwritesView`), never from rank or permission rules here; where a
//! flag hasn't landed in core yet, one `*_fallback`-style helper in `rules` stands in.
//!
//! - [`RolesPanel`] (`RolesEvent`): the Roles tab, for `CommunitySettingsScreen::set_roles_slot`.
//! - [`RoleAssignmentDialog`] (`RoleAssignmentEvent`): one member's roles, opened from
//!   `MembersEvent::ManageRoles { user_id }`.
//! - [`ChannelOverrides`] (`ChannelOverridesEvent`): a channel's presets, for
//!   `ChannelsTab::set_permissions_slot`.

mod assign;
mod common;
mod editor;
mod list;
mod overrides;
pub mod rules;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

pub use assign::{RoleAssignmentDialog, RoleAssignmentEvent};
pub use list::{RolesEvent, RolesPanel};
pub use overrides::{ChannelOverrides, ChannelOverridesEvent};
pub use rules::{Card, PresetChoice, PresetRole, PresetSupport, RoleChanges};

/// "Nov 1, 2026", in UTC.
pub(crate) fn date_label(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|date| date.format("%b %-d, %Y").to_string())
        .unwrap_or_default()
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::all()
}
