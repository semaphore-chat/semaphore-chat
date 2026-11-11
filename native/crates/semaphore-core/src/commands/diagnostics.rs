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

    /// The panel as plain text, for "Copy report": status, the LiveKit host (never a token or
    /// path), the engine's numbers, the last failure and the log.
    pub fn voice_diagnostics_report(&self) -> String {
        use std::fmt::Write as _;
        let view = self.voice_diagnostics();
        let mut report = String::from("Semaphore voice diagnostics\n");
        let _ = writeln!(report, "Status: {:?}", view.status);
        let _ = writeln!(
            report,
            "Server: {}",
            view.server_host.as_deref().unwrap_or("unknown")
        );
        if let Some(media) = &view.media {
            let number = |value: Option<u32>, unit: &str| {
                value.map_or_else(|| "unknown".to_owned(), |value| format!("{value} {unit}"))
            };
            let _ = writeln!(report, "Candidates: {}", media.candidate_types.join(", "));
            let _ = writeln!(report, "RTT: {}", number(media.rtt_ms, "ms"));
            let loss = media
                .packet_loss_pct
                .map_or_else(|| "unknown".to_owned(), |loss| format!("{loss:.1} %"));
            let _ = writeln!(report, "Packet loss: {loss}");
            let _ = writeln!(
                report,
                "Audio codec: {}",
                media.audio_codec.as_deref().unwrap_or("unknown")
            );
            let _ = writeln!(
                report,
                "Bitrate in: {}",
                number(media.bitrate_in_kbps, "kbps")
            );
            let _ = writeln!(
                report,
                "Bitrate out: {}",
                number(media.bitrate_out_kbps, "kbps")
            );
        }
        if let Some(failure) = &view.last_failure {
            let _ = writeln!(
                report,
                "Last failed join: {:?} after {} ms at {}: {}",
                failure.class, failure.duration_ms, failure.at_ms, failure.message
            );
        }
        report.push_str("Events:\n");
        for event in &view.events {
            let _ = writeln!(report, "  {} {}", event.at_ms, event.message);
        }
        report
    }

    /// Asks the engine for its numbers now; `ViewKey::VoiceDiagnostics` says when they're in.
    pub async fn refresh_voice_diagnostics(&self) {
        let Some(media) = self.services().and_then(|services| services.media.clone()) else {
            return;
        };
        let epoch = self.read(|state| state.session_epoch);
        let measured = media.diagnostics().await;
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            state.w4.diagnostics.media = measured;
            state.view_changed(ViewKey::VoiceDiagnostics);
        });
    }
}
