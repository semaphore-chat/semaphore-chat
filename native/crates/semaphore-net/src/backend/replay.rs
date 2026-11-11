//! [`HttpBackend`] for [`ReplayBackend`]: the replay buffer, its preview, captures and clips.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, ReplayBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl ReplayBackend for HttpBackend {
    async fn livekit_controller_start_replay_buffer(
        &self,
        body: wire::StartReplayBufferDto,
    ) -> BackendResult<wire::StartReplayResponseDto> {
        let body = &body;
        rpc!(self, c => c.livekit_controller_start_replay_buffer(body))
    }

    async fn livekit_controller_stop_replay_buffer(
        &self,
    ) -> BackendResult<wire::StopReplayResponseDto> {
        rpc!(self, c => c.livekit_controller_stop_replay_buffer())
    }

    async fn livekit_controller_get_session_info(
        &self,
    ) -> BackendResult<wire::SessionInfoResponseDto> {
        rpc!(self, c => c.livekit_controller_get_session_info())
    }

    async fn livekit_controller_get_preview_playlist(&self) -> BackendResult<String> {
        let playlist = bytes(rpc!(self, c => c.livekit_controller_get_preview_playlist())?).await?;
        String::from_utf8(playlist).map_err(|_| failure("the replay playlist isn't text"))
    }

    async fn livekit_controller_get_preview_segment(
        &self,
        segment_file: String,
    ) -> BackendResult<Vec<u8>> {
        let segment_file = segment_file.as_str();
        bytes(rpc!(self, c => c.livekit_controller_get_preview_segment(segment_file))?).await
    }

    async fn livekit_controller_capture_replay(
        &self,
        body: wire::CaptureReplayDto,
    ) -> BackendResult<wire::CaptureReplayResponseDto> {
        let body = &body;
        rpc!(self, c => c.livekit_controller_capture_replay(body))
    }

    async fn livekit_controller_get_my_clips(&self) -> BackendResult<Vec<wire::ClipResponseDto>> {
        rpc!(self, c => c.livekit_controller_get_my_clips())
    }

    async fn livekit_controller_get_user_public_clips(
        &self,
        user_id: String,
    ) -> BackendResult<Vec<wire::ClipResponseDto>> {
        let user_id = user_id.as_str();
        rpc!(self, c => c.livekit_controller_get_user_public_clips(user_id))
    }

    async fn livekit_controller_update_clip(
        &self,
        clip_id: String,
        body: wire::UpdateClipDto,
    ) -> BackendResult<wire::ClipResponseDto> {
        let (clip_id, body) = (clip_id.as_str(), &body);
        rpc!(self, c => c.livekit_controller_update_clip(clip_id, body))
    }

    async fn livekit_controller_delete_clip(
        &self,
        clip_id: String,
    ) -> BackendResult<wire::SuccessResponseDto> {
        let clip_id = clip_id.as_str();
        rpc!(self, c => c.livekit_controller_delete_clip(clip_id))
    }

    async fn livekit_controller_share_clip(
        &self,
        clip_id: String,
        body: wire::ShareClipDto,
    ) -> BackendResult<wire::ShareClipResponseDto> {
        let (clip_id, body) = (clip_id.as_str(), &body);
        rpc!(self, c => c.livekit_controller_share_clip(clip_id, body))
    }
}
