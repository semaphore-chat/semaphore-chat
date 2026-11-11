//! The voice debug panel. Unit W4-core.
//!
//! Join failures are classified (`commands/voice.rs`) and kept here only: the server's
//! `voice/diagnostics/join-failure` accepts `web` and `electron` alone (#661), so nothing is sent
//! until it accepts a native platform.

use crate::client::Core;
use crate::model::{ViewKey, VoiceDiagnosticsView};

impl Core {
    /// What the panel shows (`ViewKey::VoiceDiagnostics`). The engine's measurements are those of
    /// the last `refresh_voice_diagnostics`.
    pub fn voice_diagnostics(&self) -> VoiceDiagnosticsView {
        self.read(|state| {
            let diagnostics = &state.w4.diagnostics;
            VoiceDiagnosticsView {
                status: state.voice.status,
                server_host: diagnostics.server_host.clone(),
                media: diagnostics.media.clone(),
                last_failure: diagnostics.last_failure.clone(),
                events: diagnostics.events.iter().cloned().collect(),
            }
        })
    }

    /// Asks the engine for its numbers now; `ViewKey::VoiceDiagnostics` says when they're in.
    pub async fn refresh_voice_diagnostics(&self) {
        let Some(media) = self.services().and_then(|services| services.media.clone()) else {
            return;
        };
        let measured = media.diagnostics().await;
        self.write(|state, _| {
            state.w4.diagnostics.media = measured;
            state.view_changed(ViewKey::VoiceDiagnostics);
        });
    }
}
