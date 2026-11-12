//! W5: running a community: its settings, channels, private channel members, members, mention
//! groups, custom emoji, soundboard sounds, webhooks and invites. Unit W5-A.
//!
//! Finding users to add uses `DmsBackend::user_controller_search_users` with the community's id.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait CommunityAdminBackend: Send + Sync {
    async fn community_controller_find_one(
        &self,
        _id: String,
    ) -> BackendResult<wire::CommunityResponseDto> {
        Err(unsupported("reading a community"))
    }
    async fn community_controller_update(
        &self,
        _id: String,
        _body: wire::UpdateCommunityDto,
    ) -> BackendResult<wire::CommunityResponseDto> {
        Err(unsupported("updating a community"))
    }
    async fn community_controller_remove(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("deleting a community"))
    }
    async fn channels_controller_create(
        &self,
        _body: wire::CreateChannelDto,
    ) -> BackendResult<wire::ChannelDto> {
        Err(unsupported("creating a channel"))
    }
    async fn channels_controller_update(
        &self,
        _id: String,
        _body: wire::UpdateChannelDto,
    ) -> BackendResult<wire::ChannelDto> {
        Err(unsupported("updating a channel"))
    }
    async fn channels_controller_remove(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("deleting a channel"))
    }
    /// The community's channels in their new order.
    async fn channels_controller_move_up(
        &self,
        _id: String,
        _body: wire::MoveChannelDto,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        Err(unsupported("moving a channel"))
    }
    async fn channels_controller_move_down(
        &self,
        _id: String,
        _body: wire::MoveChannelDto,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        Err(unsupported("moving a channel"))
    }
    async fn channel_membership_controller_create(
        &self,
        _body: wire::CreateChannelMembershipDto,
    ) -> BackendResult<wire::ChannelMembershipResponseDto> {
        Err(unsupported("adding a private channel member"))
    }
    async fn channel_membership_controller_find_all_for_channel(
        &self,
        _channel_id: String,
    ) -> BackendResult<Vec<wire::ChannelMembershipResponseDto>> {
        Err(unsupported("listing private channel members"))
    }
    async fn channel_membership_controller_remove(
        &self,
        _channel_id: String,
        _user_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("removing a private channel member"))
    }
    async fn membership_controller_create(
        &self,
        _body: wire::CreateMembershipDto,
    ) -> BackendResult<wire::MembershipResponseDto> {
        Err(unsupported("adding a member"))
    }
    async fn alias_groups_controller_get_community_alias_groups(
        &self,
        _community_id: String,
    ) -> BackendResult<Vec<wire::AliasGroupSummaryDto>> {
        Err(unsupported("listing mention groups"))
    }
    async fn alias_groups_controller_create_alias_group(
        &self,
        _community_id: String,
        _body: wire::CreateAliasGroupDto,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        Err(unsupported("creating a mention group"))
    }
    async fn alias_groups_controller_get_alias_group(
        &self,
        _group_id: String,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        Err(unsupported("reading a mention group"))
    }
    async fn alias_groups_controller_update_alias_group(
        &self,
        _group_id: String,
        _body: wire::UpdateAliasGroupDto,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        Err(unsupported("renaming a mention group"))
    }
    async fn alias_groups_controller_delete_alias_group(
        &self,
        _group_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("deleting a mention group"))
    }
    async fn alias_groups_controller_add_member(
        &self,
        _group_id: String,
        _body: wire::AddMemberDto,
    ) -> BackendResult<()> {
        Err(unsupported("adding to a mention group"))
    }
    async fn alias_groups_controller_remove_member(
        &self,
        _group_id: String,
        _user_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("removing from a mention group"))
    }
    async fn alias_groups_controller_update_members(
        &self,
        _group_id: String,
        _body: wire::UpdateMembersDto,
    ) -> BackendResult<()> {
        Err(unsupported("setting a mention group's members"))
    }
    /// After the file is uploaded (`ResourceType::CustomEmoji`).
    async fn custom_emoji_controller_create_emoji(
        &self,
        _community_id: String,
        _body: wire::CreateCustomEmojiDto,
    ) -> BackendResult<wire::CustomEmojiDto> {
        Err(unsupported("adding a custom emoji"))
    }
    async fn custom_emoji_controller_delete_emoji(
        &self,
        _community_id: String,
        _emoji_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("deleting a custom emoji"))
    }
    async fn soundboard_controller_create_sound(
        &self,
        _community_id: String,
        _body: wire::CreateSoundboardSoundDto,
    ) -> BackendResult<wire::SoundboardSoundDto> {
        Err(unsupported("adding a sound"))
    }
    async fn soundboard_controller_delete_sound(
        &self,
        _community_id: String,
        _sound_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("deleting a sound"))
    }
    /// The only answer that carries the webhook's URL.
    async fn webhooks_controller_create(
        &self,
        _channel_id: String,
        _body: wire::CreateWebhookDto,
    ) -> BackendResult<wire::CreateWebhookResponseDto> {
        Err(unsupported("creating a webhook"))
    }
    async fn webhooks_controller_find_all_for_channel(
        &self,
        _channel_id: String,
    ) -> BackendResult<Vec<wire::WebhookDto>> {
        Err(unsupported("listing webhooks"))
    }
    async fn webhooks_controller_remove(
        &self,
        _channel_id: String,
        _webhook_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("deleting a webhook"))
    }
    /// Every invite this user created, for every community.
    async fn invite_controller_get_invites(&self) -> BackendResult<Vec<wire::InviteResponseDto>> {
        Err(unsupported("listing invites"))
    }
    async fn invite_controller_create_invite(
        &self,
        _body: wire::CreateInviteDto,
    ) -> BackendResult<wire::InviteResponseDto> {
        Err(unsupported("creating an invite"))
    }
    async fn invite_controller_delete_invite(&self, _code: String) -> BackendResult<()> {
        Err(unsupported("deleting an invite"))
    }
}
