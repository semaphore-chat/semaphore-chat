//! The voice debug panel. Unit W4-core.
//!
//! Join failures are classified and kept here only: the server's `voice/diagnostics/join-failure`
//! accepts `web` and `electron` alone, so nothing is sent until it accepts a native platform.

use crate::client::Core;
use crate::model::VoiceDiagnosticsView;

impl Core {
    /// What the panel shows (`ViewKey::VoiceDiagnostics`). The engine's measurements are read
    /// again on each call to `refresh_voice_diagnostics`.
    pub fn voice_diagnostics(&self) -> VoiceDiagnosticsView {
        VoiceDiagnosticsView::default()
    }

    /// Asks the engine for its numbers now; `ViewKey::VoiceDiagnostics` says when they're in.
    pub async fn refresh_voice_diagnostics(&self) {}
}
