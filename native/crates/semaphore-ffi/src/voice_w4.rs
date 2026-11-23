//! W4's voice: DM calls and the incoming call, the soundboard, moderator voice actions, the replay
//! buffer and clips, and the voice debug panel.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    CaptureRequest, CapturedClip, Clip, ClipDestination, ClipsView, ErrorView, IncomingCallView,
    JoinFailure, JoinFailureClass, LoadState, MediaDiagnostics, PreviewSegment, ReplayMinutes,
    ReplaySessionView, ReplayState, ReplayTrim, ShareTracks, SoundCue, SoundboardSound,
    SoundboardView, UserView, VoiceDiagnosticEvent, VoiceDiagnosticsView, VoiceJoinMode,
    VoiceJoinOptions, VoiceModerationCaps, VoicePreJoinView, VoiceRoom, VoiceStatus,
};

/// A mobile host's way to keep the device awake during a call (iOS `isIdleTimerDisabled` or an
/// audio session, Android a wake lock or the call's foreground service). `set` returns whether it
/// took.
#[uniffi::export(with_foreign)]
pub trait KeepAwakeHost: Send + Sync {
    fn set(&self, on: bool) -> bool;
}

pub(crate) struct ForeignKeepAwake(pub(crate) std::sync::Arc<dyn KeepAwakeHost>);

impl semaphore_core::platform::KeepAwake for ForeignKeepAwake {
    fn set(&self, on: bool) -> Result<(), CoreError> {
        if self.0.set(on) {
            Ok(())
        } else {
            Err(CoreError::Failed {
                message: format!("the host couldn't keep the device awake ({on})"),
            })
        }
    }
}

#[uniffi::remote(Enum)]
pub enum VoiceJoinMode {
    None,
    ListenOnly,
    Full,
}

#[uniffi::remote(Record)]
pub struct VoiceJoinOptions {
    pub muted: bool,
    pub deafened: bool,
}

#[uniffi::remote(Record)]
pub struct VoicePreJoinView {
    pub state: LoadState,
    pub channel_id: String,
    pub community_id: String,
    pub channel_name: String,
    pub users: Vec<UserView>,
    pub mode: VoiceJoinMode,
    pub timed_out_until_ms: Option<i64>,
    pub connected_elsewhere: Option<String>,
    pub muted: bool,
    pub deafened: bool,
}

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
    pub is_group: bool,
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
    pub mime_type: String,
    pub has_thumbnail: bool,
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
        self.run(move |core| async move { core.join_dm_call(dm_group_id).await })
            .await
    }

    pub fn incoming_call(&self) -> Option<IncomingCallView> {
        self.sync(move |core| core.incoming_call())
    }

    pub async fn accept_incoming_call(&self) -> Result<(), CoreError> {
        self.run(move |core| async move { core.accept_incoming_call().await })
            .await
    }

    pub fn decline_incoming_call(&self) {
        self.sync(move |core| {
            core.decline_incoming_call();
        })
    }

    pub fn expire_incoming_call(&self) {
        self.sync(move |core| {
            core.expire_incoming_call();
        })
    }

    pub async fn server_mute(&self, identity: String, mute: bool) -> Result<(), CoreError> {
        self.run(move |core| async move { core.server_mute(identity, mute).await })
            .await
    }

    pub async fn kick_member(
        &self,
        community_id: String,
        user_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.kick_member(community_id, user_id, reason).await })
            .await
    }

    pub fn voice_moderation_caps(&self, channel_id: String) -> VoiceModerationCaps {
        self.sync(move |core| core.voice_moderation_caps(channel_id))
    }

    pub fn set_participant_volume(&self, identity: String, percent: u32) {
        self.sync(move |core| {
            core.set_participant_volume(identity, percent);
        })
    }

    pub fn set_screen_share_volume(&self, identity: String, percent: u32) {
        self.sync(move |core| {
            core.set_screen_share_volume(identity, percent);
        })
    }

    pub fn soundboard(&self, community_id: String) -> SoundboardView {
        self.sync(move |core| core.soundboard(community_id))
    }

    pub async fn play_sound(&self, sound_id: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.play_sound(sound_id).await })
            .await
    }

    pub fn stop_sound(&self) {
        self.sync(move |core| {
            core.stop_sound();
        })
    }

    pub fn replay_session(&self) -> ReplaySessionView {
        self.sync(move |core| core.replay_session())
    }

    pub async fn replay_preview(&self) -> Result<Vec<PreviewSegment>, CoreError> {
        self.run(move |core| async move { core.replay_preview().await })
            .await
    }

    pub async fn replay_segment(&self, segment: PreviewSegment) -> Result<Vec<u8>, CoreError> {
        self.run(move |core| async move { core.replay_segment(segment).await })
            .await
    }

    pub async fn download_replay(&self, minutes: ReplayMinutes) -> Result<Vec<u8>, CoreError> {
        self.run(move |core| async move { core.download_replay(minutes).await })
            .await
    }

    pub async fn capture_replay(&self, request: CaptureRequest) -> Result<CapturedClip, CoreError> {
        self.run(move |core| async move { core.capture_replay(request).await })
            .await
    }

    pub fn clips(&self) -> ClipsView {
        self.sync(move |core| core.clips())
    }

    pub fn user_clips(&self, user_id: String) -> ClipsView {
        self.sync(move |core| core.user_clips(user_id))
    }

    pub async fn set_clip_public(&self, clip_id: String, public: bool) -> Result<(), CoreError> {
        self.run(move |core| async move { core.set_clip_public(clip_id, public).await })
            .await
    }

    pub async fn delete_clip(&self, clip_id: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.delete_clip(clip_id).await })
            .await
    }

    pub async fn share_clip(
        &self,
        clip_id: String,
        destination: ClipDestination,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.share_clip(clip_id, destination).await })
            .await
    }

    pub fn voice_diagnostics(&self) -> VoiceDiagnosticsView {
        self.sync(move |core| core.voice_diagnostics())
    }

    pub fn voice_diagnostics_report(&self) -> String {
        self.sync(move |core| core.voice_diagnostics_report())
    }

    pub fn expire_replay_audio_wait(&self) {
        self.sync(move |core| {
            core.expire_replay_audio_wait();
        })
    }

    pub fn retry_replay(&self) {
        self.sync(move |core| {
            core.retry_replay();
        })
    }

    /// The host's sleep inhibitor, held while a call runs.
    pub fn set_keep_awake(&self, host: std::sync::Arc<dyn KeepAwakeHost>) {
        self.sync(move |core| {
            core.set_keep_awake(std::sync::Arc::new(ForeignKeepAwake(host)));
        })
    }

    pub async fn refresh_voice_diagnostics(&self) {
        self.run(move |core| async move {
            core.refresh_voice_diagnostics().await;
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::platform::KeepAwake;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Host(Mutex<Vec<bool>>, bool);

    impl KeepAwakeHost for Host {
        fn set(&self, on: bool) -> bool {
            self.0.lock().unwrap().push(on);
            self.1
        }
    }

    #[test]
    fn keep_awake_reaches_the_foreign_host_and_its_refusal_comes_back() {
        let host = Arc::new(Host(Mutex::new(Vec::new()), true));
        let adapter = ForeignKeepAwake(host.clone());
        adapter.set(true).unwrap();
        adapter.set(false).unwrap();
        assert_eq!(*host.0.lock().unwrap(), vec![true, false]);
        let refusing = ForeignKeepAwake(Arc::new(Host(Mutex::new(Vec::new()), false)));
        assert!(refusing.set(true).is_err());
    }
}
