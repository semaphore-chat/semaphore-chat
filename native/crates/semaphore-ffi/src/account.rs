//! W3's sessions and appearance settings.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    AccentColor, Appearance, AppearancePatch, AppearanceView, InstancePermissionsView, LoadState,
    SessionRow, SessionsView, ThemeIntensity, ThemeMode,
};

#[uniffi::remote(Record)]
pub struct SessionRow {
    pub id: String,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    pub created_at_ms: i64,
    pub last_used_at_ms: i64,
    pub expires_at_ms: i64,
    pub is_current: bool,
    pub busy: bool,
}

#[uniffi::remote(Record)]
pub struct SessionsView {
    pub state: LoadState,
    pub sessions: Vec<SessionRow>,
    pub revoking_others: bool,
}

#[uniffi::remote(Record)]
pub struct InstancePermissionsView {
    pub state: LoadState,
    pub can_create_community: bool,
    pub can_create_invite: bool,
    pub can_delete_invite: bool,
}

#[uniffi::remote(Enum)]
pub enum ThemeMode {
    Dark,
    Light,
}

#[uniffi::remote(Enum)]
pub enum AccentColor {
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

#[uniffi::remote(Enum)]
pub enum ThemeIntensity {
    Minimal,
    Balanced,
    Vibrant,
}

#[uniffi::remote(Record)]
pub struct Appearance {
    pub mode: ThemeMode,
    pub accent: AccentColor,
    pub intensity: ThemeIntensity,
}

#[uniffi::remote(Record)]
pub struct AppearancePatch {
    pub mode: Option<ThemeMode>,
    pub accent: Option<AccentColor>,
    pub intensity: Option<ThemeIntensity>,
}

#[uniffi::remote(Record)]
pub struct AppearanceView {
    pub state: LoadState,
    pub appearance: Appearance,
}

/// `semaphore_core::commands::account::SESSIONS_STALE_MS`.
#[uniffi::export]
pub fn sessions_stale_ms() -> u64 {
    semaphore_core::commands::account::SESSIONS_STALE_MS
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn sessions(&self) -> SessionsView {
        self.core.sessions()
    }

    pub async fn revoke_session(&self, session_id: String) -> Result<(), CoreError> {
        self.core.revoke_session(session_id).await
    }

    pub async fn revoke_other_sessions(&self) -> Result<u32, CoreError> {
        self.core.revoke_other_sessions().await
    }

    pub fn instance_permissions(&self) -> InstancePermissionsView {
        self.core.instance_permissions()
    }

    pub fn appearance(&self) -> AppearanceView {
        self.core.appearance()
    }

    pub async fn update_appearance(&self, patch: AppearancePatch) -> Result<(), CoreError> {
        self.core.update_appearance(patch).await
    }
}
