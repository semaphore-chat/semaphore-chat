//! Communities, channels, members, counters and what the composer offers.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::BackendResult;

/// Part of [`Backend`](super::Backend).
#[async_trait]
pub trait CommunitiesBackend: Send + Sync {
    // Navigation
    async fn community_controller_find_all_mine(
        &self,
    ) -> BackendResult<Vec<wire::CommunityResponseDto>>;
    async fn channels_controller_find_all_for_community(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>>;
    async fn channel_permissions_controller_get_my_community_channel_permissions(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityChannelCapabilitiesDto>;
    async fn read_receipts_controller_get_unread_counts(
        &self,
    ) -> BackendResult<Vec<wire::UnreadCountDto>>;

    // Members and counters
    async fn membership_controller_find_all_for_community(
        &self,
        community_id: String,
        limit: Option<i64>,
        continuation_token: Option<String>,
    ) -> BackendResult<wire::PaginatedMembershipsResponseDto>;
    async fn presence_controller_get_bulk_presence(
        &self,
    ) -> BackendResult<wire::BulkPresenceResponseDto>;
    async fn notifications_controller_get_unread_count(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto>;

    // Composer
    async fn membership_controller_search_community_members(
        &self,
        community_id: String,
        query: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MembershipResponseDto>>;
    async fn channels_controller_get_mentionable_channels(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>>;
    async fn custom_emoji_controller_list_community_emojis(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::CustomEmojiDto>>;
}
