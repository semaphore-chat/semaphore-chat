//! W4's voice: DM calls and the incoming call, the soundboard, moderator voice actions, the replay
//! buffer and clips, and the voice debug panel.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    CaptureRequest, CapturedClip, Clip, ClipDestination, ClipsView, ErrorView, IncomingCallView,
    JoinFailure, JoinFailureClass, LoadState, MediaDiagnostics, PreviewSegment, ReplayMinutes,
    ReplaySessionView, ReplayState, ReplayTrim, ShareTracks, SoundCue, SoundboardSound,
    SoundboardView, UserView, VoiceDiagnosticEvent, VoiceDiagnosticsView, VoiceModerationCaps,
    VoiceRoom, VoiceStatus,
};

#[uniffi::remote(Enum)]
pub enum VoiceRoom {
    Channel {
        channel_id: String,
        community_id: Option<String>,
    },
    Dm {
        dm_group_id: String,
    },
}

#[uniffi::remote(Record)]
pub struct ShareTracks {
    pub video_sid: String,
    pub audio_sid: Option<String>,
}

#[uniffi::remote(Record)]
pub struct IncomingCallView {
    pub dm_group_id: String,
    pub group_name: String,
    pub caller: UserView,
    pub started_at_ms: u64,
    pub expires_at_ms: u64,
}

#[uniffi::remote(Enum)]
pub enum SoundCue {
    UserJoined,
    UserLeft,
    Connected,
    Disconnected,
    IncomingRingStart,
    IncomingRingStop,
    CallEnded,
}

#[uniffi::remote(Record)]
pub struct VoiceModerationCaps {
    pub can_server_mute: bool,
    pub can_kick: bool,
}

#[uniffi::remote(Record)]
pub struct SoundboardSound {
    pub id: String,
    pub name: String,
    pub emoji: Option<String>,
    pub file_id: String,
}

#[uniffi::remote(Record)]
pub struct SoundboardView {
    pub community_id: String,
    pub state: LoadState,
    pub sounds: Vec<SoundboardSound>,
    pub playing: Option<String>,
    pub error: Option<ErrorView>,
}

#[uniffi::remote(Enum)]
pub enum ReplayState {
    Off,
    Starting,
    Recording { session_id: String },
    Failed { message: String },
}

#[uniffi::remote(Enum)]
pub enum ReplayMinutes {
    One,
    Two,
    Five,
    Ten,
}

#[uniffi::remote(Enum)]
pub enum ClipDestination {
    Library,
    Channel { channel_id: String },
    Dm { dm_group_id: String },
}

#[uniffi::remote(Record)]
pub struct ReplayTrim {
    pub start_seconds: u32,
    pub end_seconds: u32,
}

#[uniffi::remote(Record)]
pub struct CaptureRequest {
    pub minutes: ReplayMinutes,
    pub trim: Option<ReplayTrim>,
    pub destination: ClipDestination,
}

#[uniffi::remote(Record)]
pub struct CapturedClip {
    pub clip_id: String,
    pub file_id: String,
    pub duration_seconds: u32,
    pub size_bytes: u64,
    pub download_url: String,
    pub message_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct Clip {
    pub id: String,
    pub file_id: String,
    pub channel_id: Option<String>,
    pub duration_seconds: u32,
    pub is_public: bool,
    pub captured_at_ms: i64,
    pub download_url: String,
    pub size_bytes: u64,
    pub filename: String,
}

#[uniffi::remote(Record)]
pub struct ClipsView {
    pub state: LoadState,
    pub clips: Vec<Clip>,
    pub busy: Vec<String>,
    pub error: Option<ErrorView>,
}

#[uniffi::remote(Record)]
pub struct ReplaySessionView {
    pub state: LoadState,
    pub active: bool,
    pub total_segments: u32,
    pub total_seconds: u32,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[uniffi::remote(Record)]
pub struct PreviewSegment {
    pub url: String,
    pub duration_ms: u32,
}

#[uniffi::remote(Enum)]
pub enum JoinFailureClass {
    MediaUnreachable,
    ServerUnreachable,
    Permission,
    NotFound,
    Session,
    ServerError,
    Unknown,
}

#[uniffi::remote(Record)]
pub struct JoinFailure {
    pub class: JoinFailureClass,
    pub message: String,
    pub duration_ms: u64,
    pub at_ms: u64,
}

#[uniffi::remote(Record)]
pub struct MediaDiagnostics {
    pub candidate_types: Vec<String>,
    pub rtt_ms: Option<u32>,
    pub packet_loss_pct: Option<f32>,
    pub audio_codec: Option<String>,
    pub bitrate_in_kbps: Option<u32>,
    pub bitrate_out_kbps: Option<u32>,
}

#[uniffi::remote(Record)]
pub struct VoiceDiagnosticEvent {
    pub at_ms: u64,
    pub message: String,
}

#[uniffi::remote(Record)]
pub struct VoiceDiagnosticsView {
    pub status: VoiceStatus,
    pub server_host: Option<String>,
    pub media: Option<MediaDiagnostics>,
    pub last_failure: Option<JoinFailure>,
    pub events: Vec<VoiceDiagnosticEvent>,
}

#[uniffi::export]
impl SemaphoreCore {
    pub async fn join_dm_call(&self, dm_group_id: String) -> Result<(), CoreError> {
        self.core.join_dm_call(dm_group_id).await
    }

    pub fn incoming_call(&self) -> Option<IncomingCallView> {
        self.core.incoming_call()
    }

    pub async fn accept_incoming_call(&self) -> Result<(), CoreError> {
        self.core.accept_incoming_call().await
    }

    pub fn decline_incoming_call(&self) {
        self.core.decline_incoming_call();
    }

    pub fn expire_incoming_call(&self) {
        self.core.expire_incoming_call();
    }

    pub async fn server_mute(&self, identity: String, mute: bool) -> Result<(), CoreError> {
        self.core.server_mute(identity, mute).await
    }

    pub async fn kick_member(
        &self,
        community_id: String,
        user_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.core.kick_member(community_id, user_id, reason).await
    }

    pub fn voice_moderation_caps(&self, channel_id: String) -> VoiceModerationCaps {
        self.core.voice_moderation_caps(channel_id)
    }

    pub fn set_participant_volume(&self, identity: String, percent: u32) {
        self.core.set_participant_volume(identity, percent);
    }

    pub fn soundboard(&self, community_id: String) -> SoundboardView {
        self.core.soundboard(community_id)
    }

    pub async fn play_sound(&self, sound_id: String) -> Result<(), CoreError> {
        self.core.play_sound(sound_id).await
    }

    pub fn stop_sound(&self) {
        self.core.stop_sound();
    }

    pub fn replay_session(&self) -> ReplaySessionView {
        self.core.replay_session()
    }

    pub async fn replay_preview(&self) -> Result<Vec<PreviewSegment>, CoreError> {
        self.core.replay_preview().await
    }

    pub async fn replay_segment(&self, segment: PreviewSegment) -> Result<Vec<u8>, CoreError> {
        self.core.replay_segment(segment).await
    }

    pub async fn capture_replay(&self, request: CaptureRequest) -> Result<CapturedClip, CoreError> {
        self.core.capture_replay(request).await
    }

    pub fn clips(&self) -> ClipsView {
        self.core.clips()
    }

    pub fn user_clips(&self, user_id: String) -> ClipsView {
        self.core.user_clips(user_id)
    }

    pub async fn set_clip_public(&self, clip_id: String, public: bool) -> Result<(), CoreError> {
        self.core.set_clip_public(clip_id, public).await
    }

    pub async fn delete_clip(&self, clip_id: String) -> Result<(), CoreError> {
        self.core.delete_clip(clip_id).await
    }

    pub async fn share_clip(
        &self,
        clip_id: String,
        destination: ClipDestination,
    ) -> Result<(), CoreError> {
        self.core.share_clip(clip_id, destination).await
    }

    pub fn voice_diagnostics(&self) -> VoiceDiagnosticsView {
        self.core.voice_diagnostics()
    }

    pub async fn refresh_voice_diagnostics(&self) {
        self.core.refresh_voice_diagnostics().await;
    }
}
