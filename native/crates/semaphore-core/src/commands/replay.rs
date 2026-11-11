//! The replay buffer, capturing clips, and the clip library. Unit W4-core.
//!
//! The buffer starts by itself once our screen share in a channel call is published with its track
//! sids (`LocalMediaView::screen_tracks`), and stops with the share or the call, as on the web
//! (chosen for the owner, 2026-11-11). `VoiceView::replay` shows it; `replayBufferStopped` and
//! `replayBufferFailed` end it; `egressSegmentsReady` reads the session again.

use crate::client::Core;
use crate::model::{
    CaptureRequest, CapturedClip, ClipDestination, ClipsView, PreviewSegment, ReplaySessionView,
};
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// What the buffer holds now, for the trim timeline (`ViewKey::ReplaySession`).
    pub fn replay_session(&self) -> ReplaySessionView {
        ReplaySessionView::default()
    }

    /// The buffer's preview: its HLS segments in order, with URLs that need the session's
    /// `Authorization`.
    pub async fn replay_preview(&self) -> Result<Vec<PreviewSegment>, CoreError> {
        Err(unavailable("the replay preview"))
    }

    /// Saves the last `minutes` (trimmed when asked) as a clip, to the library or posted to a
    /// channel or DM.
    pub async fn capture_replay(
        &self,
        _request: CaptureRequest,
    ) -> Result<CapturedClip, CoreError> {
        Err(unavailable("capturing a replay"))
    }

    /// My clip library (`ViewKey::Clips`).
    pub fn clips(&self) -> ClipsView {
        ClipsView::default()
    }

    /// Another user's public clips (`ViewKey::UserClips`).
    pub fn user_clips(&self, _user_id: String) -> ClipsView {
        ClipsView::default()
    }

    pub async fn set_clip_public(&self, _clip_id: String, _public: bool) -> Result<(), CoreError> {
        Err(unavailable("updating a clip"))
    }

    pub async fn delete_clip(&self, _clip_id: String) -> Result<(), CoreError> {
        Err(unavailable("deleting a clip"))
    }

    /// Posts a clip to a channel or DM. `ClipDestination::Library` is refused.
    pub async fn share_clip(
        &self,
        _clip_id: String,
        _destination: ClipDestination,
    ) -> Result<(), CoreError> {
        Err(unavailable("sharing a clip"))
    }
}
