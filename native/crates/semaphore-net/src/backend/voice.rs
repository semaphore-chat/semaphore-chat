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
}
