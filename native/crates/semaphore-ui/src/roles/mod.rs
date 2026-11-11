//! W5-ui-roles: the role list, the role editor and its permission matrix, the assignment dialog
//! and channel permission overrides, from `components/Community/RoleManagement.tsx`,
//! `RoleEditor.tsx`, `RoleAssignmentDialog.tsx` and `ChannelPermissionsTab.tsx`.
//!
//! Empty until its unit lands: the W5 freeze adds the module and its story line. What it may show
//! comes from core's `CommunityPermissionsView` and the per-row flags, never from roles.

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
