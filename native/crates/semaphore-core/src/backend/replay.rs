//! The replay buffer and the clip library. Unit W4-core.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait ReplayBackend: Send + Sync {
    async fn livekit_controller_start_replay_buffer(
        &self,
        _body: wire::StartReplayBufferDto,
    ) -> BackendResult<wire::StartReplayResponseDto> {
        Err(unsupported("starting the replay buffer"))
    }
    async fn livekit_controller_stop_replay_buffer(
        &self,
    ) -> BackendResult<wire::StopReplayResponseDto> {
        Err(unsupported("stopping the replay buffer"))
    }
    async fn livekit_controller_get_session_info(
        &self,
    ) -> BackendResult<wire::SessionInfoResponseDto> {
        Err(unsupported("reading the replay buffer"))
    }
    /// The preview's HLS playlist, as text.
    async fn livekit_controller_get_preview_playlist(&self) -> BackendResult<String> {
        Err(unsupported("the replay preview"))
    }
    /// One preview segment's bytes (MPEG-TS).
    async fn livekit_controller_get_preview_segment(
        &self,
        _segment_file: String,
    ) -> BackendResult<Vec<u8>> {
        Err(unsupported("the replay preview"))
    }
    async fn livekit_controller_capture_replay(
        &self,
        _body: wire::CaptureReplayDto,
    ) -> BackendResult<wire::CaptureReplayResponseDto> {
        Err(unsupported("capturing a replay"))
    }
    async fn livekit_controller_get_my_clips(&self) -> BackendResult<Vec<wire::ClipResponseDto>> {
        Err(unsupported("the clip library"))
    }
    async fn livekit_controller_get_user_public_clips(
        &self,
        _user_id: String,
    ) -> BackendResult<Vec<wire::ClipResponseDto>> {
        Err(unsupported("a user's clips"))
    }
    async fn livekit_controller_update_clip(
        &self,
        _clip_id: String,
        _body: wire::UpdateClipDto,
    ) -> BackendResult<wire::ClipResponseDto> {
        Err(unsupported("updating a clip"))
    }
    async fn livekit_controller_delete_clip(
        &self,
        _clip_id: String,
    ) -> BackendResult<wire::SuccessResponseDto> {
        Err(unsupported("deleting a clip"))
    }
    async fn livekit_controller_share_clip(
        &self,
        _clip_id: String,
        _body: wire::ShareClipDto,
    ) -> BackendResult<wire::ShareClipResponseDto> {
        Err(unsupported("sharing a clip"))
    }
}
