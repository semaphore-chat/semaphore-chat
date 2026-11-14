//! The voice debug panel and the join-failure upload. Unit W4-core.
//!
//! Join failures are classified (`commands/voice.rs`), kept for the panel, and sent to
//! `POST /voice/diagnostics/join-failure` as the web's `reportJoinFailure` sends them: at most one
//! a minute, `platform: native`, best effort. The backend logs the report and never stores it.

use crate::client::{Core, JoinFailureReport};
use crate::model::{JoinFailureClass, ViewKey, VoiceDiagnosticsView};
use semaphore_wire::{enums, types as wire};

/// The backend's `JOIN_FAILURE_MESSAGE_MAX`.
const MESSAGE_MAX: usize = 500;
/// The backend's `@MaxLength(64)` on `os`, `appVersion` and `channelId`.
const TEXT_MAX: usize = 64;
/// The backend's `@Max(10 * 60 * 1000)` on `durationMs`.
const DURATION_MAX_MS: i64 = 10 * 60 * 1000;

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
        report_text(&self.voice_diagnostics())
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

    /// One failed join, for the server's log. Best effort, as the web's `reportJoinFailure`: an
    /// error is logged at debug and changes nothing the user sees, and a report from a session
    /// that has ended since is dropped.
    ///
    /// There is no write after the request, so a sign-out while it is out leaves nothing behind.
    pub(crate) async fn send_join_failure_report(&self, report: JoinFailureReport) {
        let Some(services) = self.services() else {
            return;
        };
        if self.read(|state| state.session_epoch) != report.epoch {
            return;
        }
        let Some(body) = report.body(self.app_version()) else {
            log::debug!("join-failure report not sent: a field was out of the contract's bounds");
            return;
        };
        if let Err(error) = services
            .backend
            .voice_diagnostics_controller_report_join_failure(body)
            .await
        {
            log::debug!("join-failure report not sent: {error}");
        }
    }
}

impl JoinFailureReport {
    /// The web's body, field for field: no token, no URL, no DM group id, and no ICE candidate
    /// types (the web only knows those after a *successful* connect, so a report never has them).
    /// `None` only when a capped field is still outside the contract, which the caps prevent.
    fn body(&self, app_version: &str) -> Option<wire::ReportJoinFailureDto> {
        let channel_id = match (&self.channel_id, self.is_dm) {
            (Some(id), false) => Some(capped(id, TEXT_MAX).parse().ok()?),
            _ => None,
        };
        Some(wire::ReportJoinFailureDto {
            app_version: capped(app_version, TEXT_MAX).parse().ok()?,
            candidate_types: Vec::new(),
            channel_id,
            duration_ms: i64::try_from(self.duration_ms)
                .unwrap_or(i64::MAX)
                .min(DURATION_MAX_MS),
            error_class: wire_class(self.class),
            is_dm: self.is_dm,
            message: capped(&self.message, MESSAGE_MAX).parse().ok()?,
            os: Some(capped(std::env::consts::OS, TEXT_MAX).parse().ok()?),
            platform: enums::VoiceClientPlatform::Native,
        })
    }
}

/// The backend's own classes, as the wire spells them. `errorClass: "unknown"` is a value the
/// pinned contract doesn't list (the backend added it after), so it travels as the tolerant enum's
/// unknown string.
fn wire_class(class: JoinFailureClass) -> enums::VoiceJoinErrorClass {
    use enums::VoiceJoinErrorClass as W;
    match class {
        JoinFailureClass::MediaUnreachable => W::MediaUnreachable,
        JoinFailureClass::ServerUnreachable => W::ServerUnreachable,
        JoinFailureClass::Permission => W::Permission,
        JoinFailureClass::NotFound => W::NotFound,
        JoinFailureClass::Session => W::Session,
        JoinFailureClass::ServerError => W::ServerError,
        JoinFailureClass::Unknown => W::Unknown("unknown".to_owned()),
    }
}

/// `text` at most `max` characters, as every string field the backend takes is capped.
fn capped(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// The report's text for a view. Every message is redacted again here: a report is pasted into
/// issues, whatever wrote the failure or the event.
fn report_text(view: &VoiceDiagnosticsView) -> String {
    use std::fmt::Write as _;
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
            failure.class,
            failure.duration_ms,
            failure.at_ms,
            crate::redact::redact(&failure.message)
        );
    }
    report.push_str("Events:\n");
    for event in &view.events {
        // Redacted again here: a report is pasted into issues, whatever wrote the event.
        let _ = writeln!(
            report,
            "  {} {}",
            event.at_ms,
            crate::redact::redact(&event.message)
        );
    }
    report
}

#[cfg(test)]
mod tests {
    use super::report_text;
    use crate::model::{JoinFailure, JoinFailureClass, VoiceDiagnosticEvent, VoiceDiagnosticsView};

    #[test]
    fn the_copied_report_redacts_raw_messages() {
        let view = VoiceDiagnosticsView {
            last_failure: Some(JoinFailure {
                class: JoinFailureClass::MediaUnreachable,
                message: "wss://lk.example.org/rtc?access_token=at-raw-1".into(),
                duration_ms: 812,
                at_ms: 5,
            }),
            events: vec![VoiceDiagnosticEvent {
                at_ms: 6,
                message: "token: \"lk-raw-2\" Bearer at-raw-3".into(),
            }],
            ..Default::default()
        };
        let report = report_text(&view);
        assert!(
            report.contains("Last failed join: MediaUnreachable after 812 ms"),
            "{report}"
        );
        for secret in ["at-raw-1", "lk-raw-2", "at-raw-3"] {
            assert!(!report.contains(secret), "{secret} in {report}");
        }
    }
}
