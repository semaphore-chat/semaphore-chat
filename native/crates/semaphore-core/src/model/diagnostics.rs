//! W4: the voice debug panel and join-failure records.

use super::VoiceStatus;

/// Why a join failed, in the backend's own classes (`VoiceJoinErrorClass`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinFailureClass {
    MediaUnreachable,
    ServerUnreachable,
    Permission,
    NotFound,
    Session,
    ServerError,
    Unknown,
}

/// The last failed join. The debug panel shows it, and it is what `POST
/// /voice/diagnostics/join-failure` is sent for (`platform: native`, one a minute).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinFailure {
    pub class: JoinFailureClass,
    pub message: String,
    pub duration_ms: u64,
    pub at_ms: u64,
}

/// What the media engine measures about the call (`MediaEngine::diagnostics`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MediaDiagnostics {
    /// ICE candidate types in use: `host`, `srflx`, `prflx`, `relay`.
    pub candidate_types: Vec<String>,
    pub rtt_ms: Option<u32>,
    pub packet_loss_pct: Option<f32>,
    pub audio_codec: Option<String>,
    pub bitrate_in_kbps: Option<u32>,
    pub bitrate_out_kbps: Option<u32>,
}

/// One line of the panel's event log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceDiagnosticEvent {
    pub at_ms: u64,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct VoiceDiagnosticsView {
    pub status: VoiceStatus,
    /// The LiveKit server's host, never its token.
    pub server_host: Option<String>,
    pub media: Option<MediaDiagnostics>,
    pub last_failure: Option<JoinFailure>,
    pub events: Vec<VoiceDiagnosticEvent>,
}
