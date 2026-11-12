//! W5-A's community administration: settings, channels, private members, mention groups, custom
//! emoji, soundboard sounds, webhooks and invites.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionOutcome, AdminActionState, AdminOp, AliasGroupRow,
    AliasGroupView, AliasGroupsView, ChannelDraft, ChannelKind, ChannelMove, CommunityPatch,
    CommunitySettingsView, CreatedWebhook, CustomEmojiRow, CustomEmojiView, DraftFile, ErrorView,
    ImageChange, InviteDraft, InviteRow, InvitesView, LoadState, PrivateMemberRow,
    PrivateMembersView, SoundDraft, UploadView, UserView, WebhookRow, WebhooksView,
};

#[uniffi::remote(Record)]
pub struct AdminOp {
    pub busy: bool,
    pub upload: Option<UploadView>,
    pub error: Option<ErrorView>,
    pub action: Option<AdminAction>,
    pub actions: Vec<AdminActionState>,
    pub finished: Vec<AdminActionOutcome>,
}

#[uniffi::remote(Record)]
pub struct AdminActionOutcome {
    pub action: AdminAction,
    pub seq: u64,
    pub error: Option<ErrorView>,
}

#[uniffi::remote(Enum)]
pub enum AdminActionKind {
    UpdateCommunity,
    DeleteCommunity,
    CreateChannel,
    UpdateChannel,
    DeleteChannel,
    MoveChannel,
    AddMember,
    AddSound,
    DeleteSound,
    AddPrivateMember,
    RemovePrivateMember,
    CreateAliasGroup,
    RenameAliasGroup,
    DeleteAliasGroup,
    SetAliasGroupMembers,
    AddAliasGroupMember,
    RemoveAliasGroupMember,
    AddCustomEmoji,
    DeleteCustomEmoji,
    CreateWebhook,
    DeleteWebhook,
    CreateInvite,
    DeleteInvite,
    CreateRole,
    UpdateRole,
    DeleteRole,
    ReorderRoles,
    ResetDefaults,
    AssignRole,
    UnassignRole,
    ReplaceOverwrites,
    Ban,
    Unban,
    Kick,
    Timeout,
    RemoveTimeout,
}

#[uniffi::remote(Record)]
pub struct AdminAction {
    pub kind: AdminActionKind,
    pub target_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct AdminActionState {
    pub action: AdminAction,
    pub busy: bool,
    pub upload: Option<UploadView>,
    pub error: Option<ErrorView>,
}

#[uniffi::remote(Record)]
pub struct CommunitySettingsView {
    pub state: LoadState,
    pub community_id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_file_id: Option<String>,
    pub banner_file_id: Option<String>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct CommunityPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<ImageChange>,
    pub banner: Option<ImageChange>,
}

#[uniffi::remote(Record)]
pub struct ChannelDraft {
    pub name: String,
    pub kind: ChannelKind,
    pub is_private: bool,
    pub slowmode_seconds: u32,
}

#[uniffi::remote(Enum)]
pub enum ChannelMove {
    Up,
    Down,
}

#[uniffi::remote(Record)]
pub struct PrivateMemberRow {
    pub user: UserView,
    pub joined_at_ms: i64,
    pub added_by: Option<String>,
}

#[uniffi::remote(Record)]
pub struct PrivateMembersView {
    pub state: LoadState,
    pub channel_id: String,
    pub members: Vec<PrivateMemberRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct AliasGroupRow {
    pub id: String,
    pub name: String,
    pub member_count: u32,
}

#[uniffi::remote(Record)]
pub struct AliasGroupsView {
    pub state: LoadState,
    pub community_id: String,
    pub groups: Vec<AliasGroupRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct AliasGroupView {
    pub state: LoadState,
    pub group_id: String,
    pub name: String,
    pub members: Vec<UserView>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct CustomEmojiRow {
    pub id: String,
    pub name: String,
    pub file_id: String,
    pub created_by: Option<UserView>,
}

#[uniffi::remote(Record)]
pub struct CustomEmojiView {
    pub state: LoadState,
    pub community_id: String,
    pub emojis: Vec<CustomEmojiRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct SoundDraft {
    pub name: String,
    pub emoji: Option<String>,
    pub file: DraftFile,
}

#[uniffi::remote(Record)]
pub struct WebhookRow {
    pub id: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub created_at_ms: i64,
}

#[uniffi::remote(Record)]
pub struct WebhooksView {
    pub state: LoadState,
    pub channel_id: String,
    pub webhooks: Vec<WebhookRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct CreatedWebhook {
    pub id: String,
    pub url: String,
}

#[uniffi::remote(Record)]
pub struct InviteRow {
    pub code: String,
    pub uses: u32,
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
    pub disabled: bool,
    pub created_at_ms: i64,
}

#[uniffi::remote(Record)]
pub struct InvitesView {
    pub state: LoadState,
    pub community_id: String,
    pub invites: Vec<InviteRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct InviteDraft {
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn community_settings(&self, community_id: String) -> CommunitySettingsView {
        self.core.community_settings(community_id)
    }

    pub async fn update_community(
        &self,
        community_id: String,
        patch: CommunityPatch,
    ) -> Result<(), CoreError> {
        self.core.update_community(community_id, patch).await
    }

    pub async fn delete_community(&self, community_id: String) -> Result<(), CoreError> {
        self.core.delete_community(community_id).await
    }

    pub async fn create_channel(
        &self,
        community_id: String,
        draft: ChannelDraft,
    ) -> Result<String, CoreError> {
        self.core.create_channel(community_id, draft).await
    }

    pub async fn update_channel(
        &self,
        channel_id: String,
        draft: ChannelDraft,
    ) -> Result<(), CoreError> {
        self.core.update_channel(channel_id, draft).await
    }

    pub async fn delete_channel(&self, channel_id: String) -> Result<(), CoreError> {
        self.core.delete_channel(channel_id).await
    }

    pub async fn move_channel(
        &self,
        channel_id: String,
        step: ChannelMove,
    ) -> Result<(), CoreError> {
        self.core.move_channel(channel_id, step).await
    }

    pub fn private_members(&self, channel_id: String) -> PrivateMembersView {
        self.core.private_members(channel_id)
    }

    pub async fn add_private_member(
        &self,
        channel_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        self.core.add_private_member(channel_id, user_id).await
    }

    pub async fn remove_private_member(
        &self,
        channel_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        self.core.remove_private_member(channel_id, user_id).await
    }

    pub async fn search_users_to_add(
        &self,
        community_id: String,
        query: String,
    ) -> Result<Vec<UserView>, CoreError> {
        self.core.search_users_to_add(community_id, query).await
    }

    pub async fn add_member(&self, community_id: String, user_id: String) -> Result<(), CoreError> {
        self.core.add_member(community_id, user_id).await
    }

    pub fn alias_groups(&self, community_id: String) -> AliasGroupsView {
        self.core.alias_groups(community_id)
    }

    pub fn alias_group(&self, group_id: String) -> AliasGroupView {
        self.core.alias_group(group_id)
    }

    pub async fn create_alias_group(
        &self,
        community_id: String,
        name: String,
        member_ids: Vec<String>,
    ) -> Result<String, CoreError> {
        self.core
            .create_alias_group(community_id, name, member_ids)
            .await
    }

    pub async fn rename_alias_group(
        &self,
        group_id: String,
        name: String,
    ) -> Result<(), CoreError> {
        self.core.rename_alias_group(group_id, name).await
    }

    pub async fn delete_alias_group(&self, group_id: String) -> Result<(), CoreError> {
        self.core.delete_alias_group(group_id).await
    }

    pub async fn set_alias_group_members(
        &self,
        group_id: String,
        member_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        self.core
            .set_alias_group_members(group_id, member_ids)
            .await
    }

    pub async fn add_alias_group_member(
        &self,
        group_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        self.core.add_alias_group_member(group_id, user_id).await
    }

    pub async fn remove_alias_group_member(
        &self,
        group_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        self.core.remove_alias_group_member(group_id, user_id).await
    }

    pub fn custom_emoji(&self, community_id: String) -> CustomEmojiView {
        self.core.custom_emoji(community_id)
    }

    pub async fn add_custom_emoji(
        &self,
        community_id: String,
        name: String,
        file: DraftFile,
    ) -> Result<(), CoreError> {
        self.core.add_custom_emoji(community_id, name, file).await
    }

    pub async fn delete_custom_emoji(
        &self,
        community_id: String,
        emoji_id: String,
    ) -> Result<(), CoreError> {
        self.core.delete_custom_emoji(community_id, emoji_id).await
    }

    pub async fn add_sound(
        &self,
        community_id: String,
        draft: SoundDraft,
    ) -> Result<(), CoreError> {
        self.core.add_sound(community_id, draft).await
    }

    pub async fn delete_sound(
        &self,
        community_id: String,
        sound_id: String,
    ) -> Result<(), CoreError> {
        self.core.delete_sound(community_id, sound_id).await
    }

    pub fn webhooks(&self, channel_id: String) -> WebhooksView {
        self.core.webhooks(channel_id)
    }

    pub async fn create_webhook(
        &self,
        channel_id: String,
        name: String,
        avatar_url: Option<String>,
    ) -> Result<CreatedWebhook, CoreError> {
        self.core.create_webhook(channel_id, name, avatar_url).await
    }

    pub async fn delete_webhook(
        &self,
        channel_id: String,
        webhook_id: String,
    ) -> Result<(), CoreError> {
        self.core.delete_webhook(channel_id, webhook_id).await
    }

    pub fn community_invites(&self, community_id: String) -> InvitesView {
        self.core.community_invites(community_id)
    }

    pub async fn create_invite(
        &self,
        community_id: String,
        draft: InviteDraft,
    ) -> Result<String, CoreError> {
        self.core.create_invite(community_id, draft).await
    }

    pub async fn delete_invite(&self, code: String) -> Result<(), CoreError> {
        self.core.delete_invite(code).await
    }
}
