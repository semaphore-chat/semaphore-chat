//! W5-ui-moderation: the ban, kick and timeout dialogs, the user moderation menu, the ban and
//! timeout lists and the moderation log, from `components/Moderation/`, and the "you were removed"
//! dialog (`CoreEvent::CommunityRemoved`).
//!
//! Empty until its unit lands: the W5 freeze adds the module and its story line. What it may show
//! comes from core's `CommunityPermissionsView` and the per-row flags, never from roles.

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
