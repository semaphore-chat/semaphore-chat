//! [`HttpBackend`] for [`CommunitiesBackend`].

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, CommunitiesBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl CommunitiesBackend for HttpBackend {
    async fn community_controller_find_all_mine(
        &self,
    ) -> BackendResult<Vec<wire::CommunityResponseDto>> {
        rpc!(self, c => c.community_controller_find_all_mine())
    }

    async fn channels_controller_find_all_for_community(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.channels_controller_find_all_for_community(community_id))
    }

    async fn channel_permissions_controller_get_my_community_channel_permissions(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityChannelCapabilitiesDto> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.channel_permissions_controller_get_my_community_channel_permissions(community_id))
    }

    async fn read_receipts_controller_get_unread_counts(
        &self,
    ) -> BackendResult<Vec<wire::UnreadCountDto>> {
        rpc!(self, c => c.read_receipts_controller_get_unread_counts())
    }

    async fn membership_controller_search_community_members(
        &self,
        community_id: String,
        query: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MembershipResponseDto>> {
        let community_id = community_id.as_str();
        let query = query.as_str();
        rpc!(self, c => c.membership_controller_search_community_members(community_id, limit, query))
    }

    async fn membership_controller_find_all_for_community(
        &self,
        community_id: String,
        limit: Option<i64>,
        continuation_token: Option<String>,
    ) -> BackendResult<wire::PaginatedMembershipsResponseDto> {
        let community_id = community_id.as_str();
        let token = continuation_token.as_deref();
        rpc!(self, c => c.membership_controller_find_all_for_community(community_id, token, limit))
    }

    async fn presence_controller_get_bulk_presence(
        &self,
    ) -> BackendResult<wire::BulkPresenceResponseDto> {
        rpc!(self, c => c.presence_controller_get_bulk_presence())
    }

    async fn notifications_controller_get_unread_count(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto> {
        rpc!(self, c => c.notifications_controller_get_unread_count())
    }

    async fn channels_controller_get_mentionable_channels(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.channels_controller_get_mentionable_channels(community_id))
    }

    async fn custom_emoji_controller_list_community_emojis(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::CustomEmojiDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.custom_emoji_controller_list_community_emojis(community_id))
    }
}
