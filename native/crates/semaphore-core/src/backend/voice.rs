//! LiveKit and voice presence.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). W4's calls default to unsupported until a backend has them.
#[async_trait]
pub trait VoiceBackend: Send + Sync {
    // Voice
    async fn livekit_controller_get_connection_info(
        &self,
    ) -> BackendResult<wire::ConnectionInfoResponseDto>;
    async fn livekit_controller_generate_token(
        &self,
        body: wire::CreateTokenDto,
    ) -> BackendResult<wire::TokenResponseDto>;
    async fn voice_presence_controller_get_channel_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::ChannelVoicePresenceResponseDto>;
    async fn voice_presence_controller_join_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;
    async fn voice_presence_controller_refresh_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;
    async fn voice_presence_controller_leave_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;
    async fn voice_presence_controller_update_deafen_state(
        &self,
        channel_id: String,
        body: wire::UpdateDeafenStateDto,
    ) -> BackendResult<wire::RefreshPresenceResponseDto>;

    // W4: DM calls and moderator voice actions.
    /// A token for the DM group's room (`roomId` is the group's id).
    async fn livekit_controller_generate_dm_token(
        &self,
        _body: wire::CreateTokenDto,
    ) -> BackendResult<wire::TokenResponseDto> {
        Err(unsupported("DM call tokens"))
    }
    async fn dm_voice_presence_controller_get_dm_presence(
        &self,
        _dm_group_id: String,
    ) -> BackendResult<wire::DmVoicePresenceResponseDto> {
        Err(unsupported("DM call presence"))
    }
    /// Also registers this user when the server doesn't list them, as a join would: the DM's
    /// presence otherwise comes from LiveKit's webhook only. There's no leave.
    async fn dm_voice_presence_controller_refresh_dm_presence(
        &self,
        _dm_group_id: String,
    ) -> BackendResult<wire::RefreshDmPresenceResponseDto> {
        Err(unsupported("refreshing DM call presence"))
    }
    /// Tells the DM's room this user won't answer (`dmVoiceCallDeclined`): a 1:1 caller's call
    /// ends there. Only a decline the server hasn't seen is news.
    async fn dm_voice_presence_controller_decline_dm_voice_call(
        &self,
        _dm_group_id: String,
    ) -> BackendResult<wire::DeclineDmVoiceCallResponseDto> {
        Err(unsupported("declining a DM call"))
    }
    async fn livekit_controller_mute_participant(
        &self,
        _channel_id: String,
        _body: wire::MuteParticipantDto,
    ) -> BackendResult<wire::SuccessResponseDto> {
        Err(unsupported("server mute"))
    }
    /// One failed join, for the server's log (`ReportJoinFailureDto`, `platform: native`).
    /// Diagnostic only: nothing about the user's screen or the join's outcome depends on it.
    async fn voice_diagnostics_controller_report_join_failure(
        &self,
        _body: wire::ReportJoinFailureDto,
    ) -> BackendResult<()> {
        Err(unsupported("join-failure reports"))
    }
}
