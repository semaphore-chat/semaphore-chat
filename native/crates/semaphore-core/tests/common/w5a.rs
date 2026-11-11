//! [`FakeBackend`] for W5-A: running a community, scripted through `FakeBackend::w4` as W4's
//! areas are (answers decoded into the wire type, errors, gates, the calls made). An operation
//! answering nothing (`()`) succeeds unless it's failed.

use super::{FakeBackend, ME, user_json};
use semaphore_core::backend::{BackendResult, CommunityAdminBackend};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

pub const COMMUNITY: &str = "00000000-0000-4000-8000-0000000000c1";
pub const BOB: &str = "00000000-0000-4000-8000-0000000000b0";

pub fn channel_json(id: &str, name: &str, kind: &str, position: i64) -> Value {
    json!({
        "id": id, "name": name, "communityId": COMMUNITY, "type": kind, "position": position,
        "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

pub fn community_json(name: &str) -> Value {
    json!({
        "id": COMMUNITY, "name": name, "description": "About", "avatar": null, "banner": null,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

pub fn group_json(id: &str, name: &str, members: &[&str]) -> Value {
    json!({
        "id": id, "name": name, "communityId": COMMUNITY, "memberCount": members.len(),
        "createdAt": "2026-09-22T18:00:00.000Z",
        "members": members.iter().map(|id| json!({
            "id": id, "username": id, "displayName": null, "avatarUrl": null,
        })).collect::<Vec<_>>(),
    })
}

pub fn summary_json(id: &str, name: &str, count: usize) -> Value {
    json!({ "id": id, "name": name, "communityId": COMMUNITY, "memberCount": count })
}

pub fn emoji_json(id: &str, name: &str) -> Value {
    json!({
        "id": id, "name": name, "communityId": COMMUNITY, "fileId": format!("{id}-file"),
        "createdBy": BOB, "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

pub fn webhook_json(id: &str, name: &str, channel: &str) -> Value {
    json!({
        "id": id, "name": name, "channelId": channel, "avatarUrl": null,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

pub fn invite_json(code: &str, community: &str) -> Value {
    json!({
        "id": format!("{code}-id"), "code": code, "createdById": ME, "uses": 1, "maxUses": 5,
        "validUntil": null, "disabled": false, "createdAt": "2026-09-22T18:00:00.000Z",
        "usages": [], "defaultCommunities": [{ "id": format!("{code}-dc"), "communityId": community }],
    })
}

pub fn private_member_json(user: &str, channel: &str) -> Value {
    json!({
        "id": format!("cm-{user}"), "userId": user, "channelId": channel,
        "joinedAt": "2026-09-22T18:00:00.000Z", "addedBy": ME,
        "user": user_json(user),
    })
}

impl FakeBackend {
    /// `op`, answering `null` unless scripted otherwise: for the calls that answer nothing.
    async fn unit(&self, op: &'static str, args: &[&str]) -> BackendResult<()> {
        self.w4.answers.lock().unwrap().entry(op).or_insert(Value::Null);
        self.w4.run(op, args).await
    }
}

fn body(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).unwrap()
}

#[async_trait::async_trait]
impl CommunityAdminBackend for FakeBackend {
    async fn community_controller_find_one(
        &self,
        id: String,
    ) -> BackendResult<wire::CommunityResponseDto> {
        self.w4.run("community", &[&id]).await
    }
    async fn community_controller_update(
        &self,
        id: String,
        update: wire::UpdateCommunityDto,
    ) -> BackendResult<wire::CommunityResponseDto> {
        self.w4.run("update_community", &[&id, &body(&update)]).await
    }
    async fn community_controller_remove(&self, id: String) -> BackendResult<()> {
        self.unit("delete_community", &[&id]).await
    }
    async fn channels_controller_create(
        &self,
        create: wire::CreateChannelDto,
    ) -> BackendResult<wire::ChannelDto> {
        self.w4.run("create_channel", &[&body(&create)]).await
    }
    async fn channels_controller_update(
        &self,
        id: String,
        update: wire::UpdateChannelDto,
    ) -> BackendResult<wire::ChannelDto> {
        self.w4.run("update_channel", &[&id, &body(&update)]).await
    }
    async fn channels_controller_remove(&self, id: String) -> BackendResult<()> {
        self.unit("delete_channel", &[&id]).await
    }
    async fn channels_controller_move_up(
        &self,
        id: String,
        moved: wire::MoveChannelDto,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        self.w4.run("move_up", &[&id, &body(&moved)]).await
    }
    async fn channels_controller_move_down(
        &self,
        id: String,
        moved: wire::MoveChannelDto,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        self.w4.run("move_down", &[&id, &body(&moved)]).await
    }
    async fn channel_membership_controller_create(
        &self,
        create: wire::CreateChannelMembershipDto,
    ) -> BackendResult<wire::ChannelMembershipResponseDto> {
        self.w4.run("add_private", &[&body(&create)]).await
    }
    async fn channel_membership_controller_find_all_for_channel(
        &self,
        channel_id: String,
    ) -> BackendResult<Vec<wire::ChannelMembershipResponseDto>> {
        self.w4.run("private_members", &[&channel_id]).await
    }
    async fn channel_membership_controller_remove(
        &self,
        channel_id: String,
        user_id: String,
    ) -> BackendResult<()> {
        self.unit("remove_private", &[&channel_id, &user_id]).await
    }
    async fn membership_controller_create(
        &self,
        create: wire::CreateMembershipDto,
    ) -> BackendResult<wire::MembershipResponseDto> {
        self.w4.run("add_member", &[&body(&create)]).await
    }
    async fn alias_groups_controller_get_community_alias_groups(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::AliasGroupSummaryDto>> {
        self.w4.run("alias_groups", &[&community_id]).await
    }
    async fn alias_groups_controller_create_alias_group(
        &self,
        community_id: String,
        create: wire::CreateAliasGroupDto,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        self.w4
            .run("create_group", &[&community_id, &body(&create)])
            .await
    }
    async fn alias_groups_controller_get_alias_group(
        &self,
        group_id: String,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        self.w4.run("alias_group", &[&group_id]).await
    }
    async fn alias_groups_controller_update_alias_group(
        &self,
        group_id: String,
        update: wire::UpdateAliasGroupDto,
    ) -> BackendResult<wire::AliasGroupWithMembersDto> {
        self.w4.run("rename_group", &[&group_id, &body(&update)]).await
    }
    async fn alias_groups_controller_delete_alias_group(
        &self,
        group_id: String,
    ) -> BackendResult<()> {
        self.unit("delete_group", &[&group_id]).await
    }
    async fn alias_groups_controller_add_member(
        &self,
        group_id: String,
        add: wire::AddMemberDto,
    ) -> BackendResult<()> {
        self.unit("group_add", &[&group_id, &add.user_id.to_string()])
            .await
    }
    async fn alias_groups_controller_remove_member(
        &self,
        group_id: String,
        user_id: String,
    ) -> BackendResult<()> {
        self.unit("group_remove", &[&group_id, &user_id]).await
    }
    async fn alias_groups_controller_update_members(
        &self,
        group_id: String,
        update: wire::UpdateMembersDto,
    ) -> BackendResult<()> {
        self.unit("group_members", &[&group_id, &body(&update)]).await
    }
    async fn custom_emoji_controller_create_emoji(
        &self,
        community_id: String,
        create: wire::CreateCustomEmojiDto,
    ) -> BackendResult<wire::CustomEmojiDto> {
        self.w4
            .run("create_emoji", &[&community_id, &create.name])
            .await
    }
    async fn custom_emoji_controller_delete_emoji(
        &self,
        community_id: String,
        emoji_id: String,
    ) -> BackendResult<()> {
        self.unit("delete_emoji", &[&community_id, &emoji_id]).await
    }
    async fn soundboard_controller_create_sound(
        &self,
        community_id: String,
        create: wire::CreateSoundboardSoundDto,
    ) -> BackendResult<wire::SoundboardSoundDto> {
        self.w4
            .run("create_sound", &[&community_id, &body(&create)])
            .await
    }
    async fn soundboard_controller_delete_sound(
        &self,
        community_id: String,
        sound_id: String,
    ) -> BackendResult<()> {
        self.unit("delete_sound", &[&community_id, &sound_id]).await
    }
    async fn webhooks_controller_create(
        &self,
        channel_id: String,
        create: wire::CreateWebhookDto,
    ) -> BackendResult<wire::CreateWebhookResponseDto> {
        self.w4
            .run("create_webhook", &[&channel_id, &body(&create)])
            .await
    }
    async fn webhooks_controller_find_all_for_channel(
        &self,
        channel_id: String,
    ) -> BackendResult<Vec<wire::WebhookDto>> {
        self.w4.run("webhooks", &[&channel_id]).await
    }
    async fn webhooks_controller_remove(
        &self,
        channel_id: String,
        webhook_id: String,
    ) -> BackendResult<()> {
        self.unit("delete_webhook", &[&channel_id, &webhook_id]).await
    }
    async fn invite_controller_get_invites(&self) -> BackendResult<Vec<wire::InviteResponseDto>> {
        self.w4.run("invites", &[]).await
    }
    async fn invite_controller_create_invite(
        &self,
        create: wire::CreateInviteDto,
    ) -> BackendResult<wire::InviteResponseDto> {
        self.w4.run("create_invite", &[&body(&create)]).await
    }
    async fn invite_controller_delete_invite(&self, code: String) -> BackendResult<()> {
        self.unit("delete_invite", &[&code]).await
    }
}
