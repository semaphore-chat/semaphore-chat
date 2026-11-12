//! W6-ui-users: users: list, filters, the per-user menu, reset password, instance roles and quota dialogs (`pages/admin/AdminUsersPage.tsx`, `components/admin/ResetPasswordDialog.tsx`).
//!
//! Empty until its unit lands: the W6/W7 freeze adds the module and its story line. What it may
//! show comes from core's `InstanceAdminCaps` and the views' per-row flags, never from roles.

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
