//! [`HttpBackend`] for [`CommunityAdminBackend`]: community settings, channels and their order,
//! private channel members, adding members, mention groups, custom emoji, sounds, webhooks and
//! invites.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, CommunityAdminBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl CommunityAdminBackend for HttpBackend {
    async fn community_controller_find_one(
        &self,
        id: String,
    ) -> BackendResult<wire::CommunityResponseDto> {
        let id = id.as_str();
        rpc!(self, c => c.community_controller_find_one(id))
    }

    async fn community_controller_update(
        &self,
        id: String,
        body: wire::UpdateCommunityDto,
    ) -> BackendResult<wire::CommunityResponseDto> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.community_controller_update(id, body))
    }

    async fn community_controller_remove(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.community_controller_remove(id))
    }

    async fn channels_controller_create(
        &self,
        body: wire::CreateChannelDto,
    ) -> BackendResult<wire::ChannelDto> {
        let body = &body;
        rpc!(self, c => c.channels_controller_create(body))
    }

    async fn channels_controller_update(
        &self,
        id: String,
        body: wire::UpdateChannelDto,
    ) -> BackendResult<wire::ChannelDto> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.channels_controller_update(id, body))
    }

    async fn channels_controller_remove(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.channels_controller_remove(id))
    }

    async fn channels_controller_move_up(
        &self,
        id: String,
        body: wire::MoveChannelDto,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.channels_controller_move_up(id, body))
    }

    async fn channels_controller_move_down(
        &self,
        id: String,
        body: wire::MoveChannelDto,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.channels_controller_move_down(id, body))
    }

    async fn channel_membership_controller_create(
        &self,
        body: wire::CreateChannelMembershipDto,
    ) -> BackendResult<wire::ChannelMembershipResponseDto> {
        let body = &body;
        rpc!(self, c => c.channel_membership_controller_create(body))
    }

    async fn channel_membership_controller_find_all_for_channel(
        &self,
        channel_id: String,
    ) -> BackendResult<Vec<wire::ChannelMembershipResponseDto>> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.channel_membership_controller_find_all_for_channel(channel_id))
    }

    async fn channel_membership_controller_remove(
        &self,
        channel_id: String,
        user_id: String,
    ) -> BackendResult<()> {
        let (channel_id, user_id) = (channel_id.as_str(), user_id.as_str());
        rpc!(self, c => c.channel_membership_controller_remove(channel_id, user_id))
    }

    async fn membership_controller_create(
        &self,
        body: wire::CreateMembershipDto,
    ) -> BackendResult<wire::MembershipResponseDto> {
        let body = &body;
        rpc!(self, c => c.membership_controller_create(body))
    }

    async fn alias_groups_controller_get_community_alias_groups(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::AliasGroupSummaryDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.alias_groups_controller_get_community_alias_groups(community_id))
    }

    async fn alias_groups_controller_create_alias_group(
        &self,
        community_id: String,
        body: wire::CreateAliasGroupDto,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        let (community_id, body) = (community_id.as_str(), &body);
        rpc!(self, c => c.alias_groups_controller_create_alias_group(community_id, body))
    }

    async fn alias_groups_controller_get_alias_group(
        &self,
        group_id: String,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        let group_id = group_id.as_str();
        rpc!(self, c => c.alias_groups_controller_get_alias_group(group_id))
    }

    async fn alias_groups_controller_update_alias_group(
        &self,
        group_id: String,
        body: wire::UpdateAliasGroupDto,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        let (group_id, body) = (group_id.as_str(), &body);
        rpc!(self, c => c.alias_groups_controller_update_alias_group(group_id, body))
    }

    async fn alias_groups_controller_delete_alias_group(
        &self,
        group_id: String,
    ) -> BackendResult<()> {
        let group_id = group_id.as_str();
        rpc!(self, c => c.alias_groups_controller_delete_alias_group(group_id))
    }

    async fn alias_groups_controller_add_member(
        &self,
        group_id: String,
        body: wire::AddMemberDto,
    ) -> BackendResult<()> {
        let (group_id, body) = (group_id.as_str(), &body);
        rpc!(self, c => c.alias_groups_controller_add_member(group_id, body))
    }

    async fn alias_groups_controller_remove_member(
        &self,
        group_id: String,
        user_id: String,
    ) -> BackendResult<()> {
        let (group_id, user_id) = (group_id.as_str(), user_id.as_str());
        rpc!(self, c => c.alias_groups_controller_remove_member(group_id, user_id))
    }

    async fn alias_groups_controller_update_members(
        &self,
        group_id: String,
        body: wire::UpdateMembersDto,
    ) -> BackendResult<()> {
        let (group_id, body) = (group_id.as_str(), &body);
        rpc!(self, c => c.alias_groups_controller_update_members(group_id, body))
    }

    async fn custom_emoji_controller_create_emoji(
        &self,
        community_id: String,
        body: wire::CreateCustomEmojiDto,
    ) -> BackendResult<wire::CustomEmojiDto> {
        let (community_id, body) = (community_id.as_str(), &body);
        rpc!(self, c => c.custom_emoji_controller_create_emoji(community_id, body))
    }

    async fn custom_emoji_controller_delete_emoji(
        &self,
        community_id: String,
        emoji_id: String,
    ) -> BackendResult<()> {
        let (community_id, emoji_id) = (community_id.as_str(), emoji_id.as_str());
        rpc!(self, c => c.custom_emoji_controller_delete_emoji(community_id, emoji_id))
    }

    async fn soundboard_controller_create_sound(
        &self,
        community_id: String,
        body: wire::CreateSoundboardSoundDto,
    ) -> BackendResult<wire::SoundboardSoundDto> {
        let (community_id, body) = (community_id.as_str(), &body);
        rpc!(self, c => c.soundboard_controller_create_sound(community_id, body))
    }

    async fn soundboard_controller_delete_sound(
        &self,
        community_id: String,
        sound_id: String,
    ) -> BackendResult<()> {
        let (community_id, sound_id) = (community_id.as_str(), sound_id.as_str());
        rpc!(self, c => c.soundboard_controller_delete_sound(community_id, sound_id))
    }

    async fn webhooks_controller_create(
        &self,
        channel_id: String,
        body: wire::CreateWebhookDto,
    ) -> BackendResult<wire::CreateWebhookResponseDto> {
        let (channel_id, body) = (channel_id.as_str(), &body);
        rpc!(self, c => c.webhooks_controller_create(channel_id, body))
    }

    async fn webhooks_controller_find_all_for_channel(
        &self,
        channel_id: String,
    ) -> BackendResult<Vec<wire::WebhookDto>> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.webhooks_controller_find_all_for_channel(channel_id))
    }

    async fn webhooks_controller_remove(
        &self,
        channel_id: String,
        webhook_id: String,
    ) -> BackendResult<()> {
        let (channel_id, webhook_id) = (channel_id.as_str(), webhook_id.as_str());
        rpc!(self, c => c.webhooks_controller_remove(channel_id, webhook_id))
    }

    async fn invite_controller_get_invites(&self) -> BackendResult<Vec<wire::InviteResponseDto>> {
        rpc!(self, c => c.invite_controller_get_invites())
    }

    async fn invite_controller_create_invite(
        &self,
        body: wire::CreateInviteDto,
    ) -> BackendResult<wire::InviteResponseDto> {
        let body = &body;
        rpc!(self, c => c.invite_controller_create_invite(body))
    }

    async fn invite_controller_delete_invite(&self, code: String) -> BackendResult<()> {
        let code = code.as_str();
        rpc!(self, c => c.invite_controller_delete_invite(code))
    }
}
