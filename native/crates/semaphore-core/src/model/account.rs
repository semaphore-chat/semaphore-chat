//! This account's sessions and appearance settings. Unit W3-core.

use super::LoadState;

/// One signed-in device, from `GET /auth/sessions`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionRow {
    pub id: String,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    pub created_at_ms: i64,
    pub last_used_at_ms: i64,
    pub expires_at_ms: i64,
    /// This client's own session. `Core::revoke_session` refuses it: that's signing out.
    pub is_current: bool,
    /// A revoke of it is on its way.
    pub busy: bool,
}

/// `Core::sessions`, most recently used first. `ViewKey::Sessions` says when to read again. The
/// server sends no event when the list changes, so it's read again when shown and older than
/// `commands::account::SESSIONS_STALE_MS`, after each revoke, and when a desktop app signs in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionsView {
    pub state: LoadState,
    pub sessions: Vec<SessionRow>,
    /// `Core::revoke_other_sessions` is on its way.
    pub revoking_others: bool,
}

/// What this user may do on the instance, from their instance roles (`GET /roles/my/instance`)
/// and whether they own it (an owner may do everything, as the server's `RbacGuard`).
/// `ViewKey::InstancePermissions` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstancePermissionsView {
    pub state: LoadState,
    /// `CREATE_COMMUNITY`: show "Create community". False until known.
    pub can_create_community: bool,
}

/// Dark or light, as the server stores it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum ThemeMode {
    #[default]
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum AccentColor {
    #[default]
    Teal,
    Blue,
    Indigo,
    Purple,
    Rose,
    Red,
    Orange,
    Amber,
    Lime,
    Emerald,
    Cyan,
    Slate,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum ThemeIntensity {
    #[default]
    Minimal,
    Balanced,
    Vibrant,
}

/// The theme, synced through the server (`appearance-settings`), as the web's `useThemeSync`.
/// The defaults are the server's.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct Appearance {
    pub mode: ThemeMode,
    pub accent: AccentColor,
    pub intensity: ThemeIntensity,
}

/// What `Core::update_appearance` changes: each `None` is left as it is.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AppearancePatch {
    pub mode: Option<ThemeMode>,
    pub accent: Option<AccentColor>,
    pub intensity: Option<ThemeIntensity>,
}

/// `Core::appearance`: read at sign-in, so the theme can apply before anything opens settings.
/// `ViewKey::Appearance` says when to read again. Shows a change at once, while it's on its way.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppearanceView {
    pub state: LoadState,
    pub appearance: Appearance,
}
