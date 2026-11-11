//! [`FakeBackend`] for W4: the replay and soundboard areas, scripted through `FakeBackend::w4` as
//! W3's are (answers decoded into the wire type, errors, gates, the calls made). DM calls, server
//! mute and kick are in `mod.rs`'s `VoiceBackend` and `actions.rs`'s `ModerationBackend`, on the
//! same script.

use super::FakeBackend;
use semaphore_core::backend::{BackendResult, ReplayBackend, SoundboardBackend};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

pub fn sound_json(id: &str, file_id: &str) -> Value {
    json!({
        "id": id, "communityId": "community", "name": format!("{id} name"), "emoji": "🔔",
        "fileId": file_id, "createdBy": null, "createdAt": "2026-11-01T00:00:00Z",
    })
}

pub fn clip_json(id: &str, public: bool) -> Value {
    json!({
        "id": id, "fileId": format!("{id}-file"), "channelId": "chan", "durationSeconds": 60,
        "isPublic": public, "capturedAt": "2026-11-01T00:00:00Z",
        "downloadUrl": format!("/api/file/{id}-file"), "sizeBytes": 1000, "filename": format!("{id}.mp4"),
    })
}

#[async_trait::async_trait]
impl ReplayBackend for FakeBackend {
    async fn livekit_controller_start_replay_buffer(
        &self,
        body: wire::StartReplayBufferDto,
    ) -> BackendResult<wire::StartReplayResponseDto> {
        let audio = body.audio_track_id.unwrap_or_default();
        let identity = body.participant_identity.unwrap_or_default();
        let channel = body.channel_id.to_string();
        self.w4
            .run(
                "replay_start",
                &[&channel, &body.video_track_id, &audio, &identity],
            )
            .await
    }
    async fn livekit_controller_stop_replay_buffer(
        &self,
    ) -> BackendResult<wire::StopReplayResponseDto> {
        self.w4.run("replay_stop", &[]).await
    }
    async fn livekit_controller_get_session_info(
        &self,
    ) -> BackendResult<wire::SessionInfoResponseDto> {
        self.w4.run("session_info", &[]).await
    }
    async fn livekit_controller_get_preview_playlist(&self) -> BackendResult<String> {
        self.w4.run("playlist", &[]).await
    }
    async fn livekit_controller_stream_replay(
        &self,
        duration_minutes: semaphore_wire::enums::ReplayDurationMinutes,
    ) -> BackendResult<Vec<u8>> {
        let minutes = serde_json::to_string(&duration_minutes).unwrap();
        self.w4.run("stream", &[&minutes]).await
    }
    async fn livekit_controller_capture_replay(
        &self,
        body: wire::CaptureReplayDto,
    ) -> BackendResult<wire::CaptureReplayResponseDto> {
        let body = serde_json::to_string(&body).unwrap();
        self.w4.run("capture", &[&body]).await
    }
    async fn livekit_controller_get_my_clips(&self) -> BackendResult<Vec<wire::ClipResponseDto>> {
        self.w4.run("clips", &[]).await
    }
    async fn livekit_controller_get_user_public_clips(
        &self,
        user_id: String,
    ) -> BackendResult<Vec<wire::ClipResponseDto>> {
        self.w4.run("user_clips", &[&user_id]).await
    }
    async fn livekit_controller_update_clip(
        &self,
        clip_id: String,
        body: wire::UpdateClipDto,
    ) -> BackendResult<wire::ClipResponseDto> {
        let public = body
            .is_public
            .map(|public| public.to_string())
            .unwrap_or_default();
        self.w4.run("update_clip", &[&clip_id, &public]).await
    }
    async fn livekit_controller_delete_clip(
        &self,
        clip_id: String,
    ) -> BackendResult<wire::SuccessResponseDto> {
        self.w4.run("delete_clip", &[&clip_id]).await
    }
    async fn livekit_controller_share_clip(
        &self,
        clip_id: String,
        body: wire::ShareClipDto,
    ) -> BackendResult<wire::ShareClipResponseDto> {
        let body = serde_json::to_string(&body).unwrap();
        self.w4.run("share_clip", &[&clip_id, &body]).await
    }
}

#[async_trait::async_trait]
impl SoundboardBackend for FakeBackend {
    async fn soundboard_controller_list_community_sounds(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::SoundboardSoundDto>> {
        self.w4.run("sounds", &[&community_id]).await
    }
}
