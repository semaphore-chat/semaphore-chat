//! [`HttpBackend`] for [`VoiceBackend`].

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, VoiceBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl VoiceBackend for HttpBackend {
    async fn livekit_controller_get_connection_info(
        &self,
    ) -> BackendResult<wire::ConnectionInfoResponseDto> {
        rpc!(self, c => c.livekit_controller_get_connection_info())
    }

    async fn livekit_controller_generate_token(
        &self,
        body: wire::CreateTokenDto,
    ) -> BackendResult<wire::TokenResponseDto> {
        let body = &body;
        rpc!(self, c => c.livekit_controller_generate_token(body))
    }

    async fn voice_presence_controller_get_channel_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::ChannelVoicePresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_get_channel_presence(channel_id))
    }

    async fn voice_presence_controller_join_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_join_presence(channel_id))
    }

    async fn voice_presence_controller_refresh_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_refresh_presence(channel_id))
    }

    async fn voice_presence_controller_leave_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_leave_presence(channel_id))
    }

    async fn voice_presence_controller_update_deafen_state(
        &self,
        channel_id: String,
        body: wire::UpdateDeafenStateDto,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        let body = &body;
        rpc!(self, c => c.voice_presence_controller_update_deafen_state(channel_id, body))
    }

    async fn livekit_controller_generate_dm_token(
        &self,
        body: wire::CreateTokenDto,
    ) -> BackendResult<wire::TokenResponseDto> {
        let body = &body;
        rpc!(self, c => c.livekit_controller_generate_dm_token(body))
    }

    async fn dm_voice_presence_controller_get_dm_presence(
        &self,
        dm_group_id: String,
    ) -> BackendResult<wire::DmVoicePresenceResponseDto> {
        let dm_group_id = dm_group_id.as_str();
        rpc!(self, c => c.dm_voice_presence_controller_get_dm_presence(dm_group_id))
    }

    async fn dm_voice_presence_controller_refresh_dm_presence(
        &self,
        dm_group_id: String,
    ) -> BackendResult<wire::RefreshDmPresenceResponseDto> {
        let dm_group_id = dm_group_id.as_str();
        rpc!(self, c => c.dm_voice_presence_controller_refresh_dm_presence(dm_group_id))
    }

    async fn dm_voice_presence_controller_decline_dm_voice_call(
        &self,
        dm_group_id: String,
    ) -> BackendResult<wire::DeclineDmVoiceCallResponseDto> {
        let dm_group_id = dm_group_id.as_str();
        rpc!(self, c => c.dm_voice_presence_controller_decline_dm_voice_call(dm_group_id))
    }

    async fn livekit_controller_mute_participant(
        &self,
        channel_id: String,
        body: wire::MuteParticipantDto,
    ) -> BackendResult<wire::SuccessResponseDto> {
        // The backend answers 201 (a Nest `@Post` with no `@HttpCode`), but the spec says 200
        // (`@ApiOkResponse`), and the generated client refuses any status the spec doesn't name.
        // So this one is sent by hand and takes any 2xx.
        let path = format!("/api/livekit/channels/{channel_id}/mute-participant");
        let (path, body) = (
            path.as_str(),
            serde_json::to_value(&body).unwrap_or_default(),
        );
        let body = &body;
        rpc!(self, c => async move {
            let response =
                super::notify::raw(&c, reqwest::Method::POST, path, Some(body)).await?;
            ResponseValue::from_response(response).await
        })
    }
}
