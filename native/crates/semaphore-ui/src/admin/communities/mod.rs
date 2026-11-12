//! W6-ui-content: every community, with force delete (`pages/admin/AdminCommunitiesPage.tsx`).
//!
//! Empty until its unit lands: the W6/W7 freeze adds the module and its story line. What it may
//! show comes from core's `InstanceAdminCaps` and the views' per-row flags, never from roles.

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
