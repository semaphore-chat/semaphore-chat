//! This account's sessions and appearance settings. Unit W3-core.

use crate::client::Core;
use crate::model::{AppearancePatch, AppearanceView, SessionsView};
use crate::platform::CoreError;
use crate::resync::unavailable;

/// Sessions read longer ago than this are read again when shown: nothing says they changed.
pub const SESSIONS_STALE_MS: u64 = 30_000;

impl Core {
    /// This account's sessions. `ViewKey::Sessions` says when to read again.
    pub fn sessions(&self) -> SessionsView {
        SessionsView::default()
    }

    /// Signs another device out. Its row shows `busy` until the server answers. This client's own
    /// session is refused: that's `sign_out`.
    pub async fn revoke_session(&self, _session_id: String) -> Result<(), CoreError> {
        Err(unavailable("sessions"))
    }

    /// Signs every other device out, never this one. Returns how many the server ended.
    pub async fn revoke_other_sessions(&self) -> Result<u32, CoreError> {
        Err(unavailable("sessions"))
    }

    /// The theme the server keeps for this account. `ViewKey::Appearance` says when to read again.
    pub fn appearance(&self) -> AppearanceView {
        AppearanceView::default()
    }

    /// Changes the fields the patch sets. Shown at once; back if the server refuses.
    pub async fn update_appearance(&self, _patch: AppearancePatch) -> Result<(), CoreError> {
        Err(unavailable("appearance settings"))
    }
}
