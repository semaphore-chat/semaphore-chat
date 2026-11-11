//! W5-ui-community: the community settings shell and its tabs (overview, members, channels,
//! private channels, mention groups, emoji, soundboard, webhooks, invites), from
//! `pages/EditCommunityPage.tsx` and `components/Community/`.
//!
//! Empty until its unit lands: the W5 freeze adds the module and its story line. What it may show
//! comes from core's `CommunityPermissionsView` and the per-row flags, never from roles.

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
