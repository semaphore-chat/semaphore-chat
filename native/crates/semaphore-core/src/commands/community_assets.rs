//! A community's mention groups, custom emoji, soundboard sounds, webhooks and invites. Unit W5-A.
//!
//! The server sends no socket event for any of these changing, so their views read again after this
//! user's own changes, when shown and older than 30 s, and on a new connection (W2's rule).

use crate::client::Core;
use crate::model::{
    AliasGroupView, AliasGroupsView, CreatedWebhook, CustomEmojiView, DraftFile, InviteDraft,
    InvitesView, SoundDraft, WebhooksView,
};
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// `ViewKey::AliasGroups`.
    pub fn alias_groups(&self, community_id: String) -> AliasGroupsView {
        AliasGroupsView {
            community_id,
            ..Default::default()
        }
    }

    /// One group with its members, for the editor (`ViewKey::AliasGroup`).
    pub fn alias_group(&self, group_id: String) -> AliasGroupView {
        AliasGroupView {
            group_id,
            ..Default::default()
        }
    }

    /// Makes a mention group; returns its id.
    pub async fn create_alias_group(
        &self,
        _community_id: String,
        _name: String,
        _member_ids: Vec<String>,
    ) -> Result<String, CoreError> {
        Err(unavailable("creating a mention group"))
    }

    pub async fn rename_alias_group(
        &self,
        _group_id: String,
        _name: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("renaming a mention group"))
    }

    pub async fn delete_alias_group(&self, _group_id: String) -> Result<(), CoreError> {
        Err(unavailable("deleting a mention group"))
    }

    /// Replaces the group's members.
    pub async fn set_alias_group_members(
        &self,
        _group_id: String,
        _member_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        Err(unavailable("changing a mention group"))
    }

    /// The emoji tab (`ViewKey::CustomEmoji`).
    pub fn custom_emoji(&self, community_id: String) -> CustomEmojiView {
        CustomEmojiView {
            community_id,
            ..Default::default()
        }
    }

    /// Uploads the image, then adds it as `:name:`.
    pub async fn add_custom_emoji(
        &self,
        _community_id: String,
        _name: String,
        _file: DraftFile,
    ) -> Result<(), CoreError> {
        Err(unavailable("adding a custom emoji"))
    }

    pub async fn delete_custom_emoji(
        &self,
        _community_id: String,
        _emoji_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("deleting a custom emoji"))
    }

    /// Uploads the sound, then adds it to the soundboard (W4's `Core::soundboard` lists it).
    pub async fn add_sound(
        &self,
        _community_id: String,
        _draft: SoundDraft,
    ) -> Result<(), CoreError> {
        Err(unavailable("adding a sound"))
    }

    pub async fn delete_sound(
        &self,
        _community_id: String,
        _sound_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("deleting a sound"))
    }

    /// A channel's webhooks (`ViewKey::Webhooks`).
    pub fn webhooks(&self, channel_id: String) -> WebhooksView {
        WebhooksView {
            channel_id,
            ..Default::default()
        }
    }

    /// Makes a webhook. Its URL is in the answer only: nothing shows it again.
    pub async fn create_webhook(
        &self,
        _channel_id: String,
        _name: String,
    ) -> Result<CreatedWebhook, CoreError> {
        Err(unavailable("creating a webhook"))
    }

    pub async fn delete_webhook(
        &self,
        _channel_id: String,
        _webhook_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("deleting a webhook"))
    }

    /// My invites that include this community (`ViewKey::Invites`).
    pub fn community_invites(&self, community_id: String) -> InvitesView {
        InvitesView {
            community_id,
            ..Default::default()
        }
    }

    /// Makes an invite to this community; returns its code.
    pub async fn create_invite(
        &self,
        _community_id: String,
        _draft: InviteDraft,
    ) -> Result<String, CoreError> {
        Err(unavailable("creating an invite"))
    }

    pub async fn delete_invite(&self, _code: String) -> Result<(), CoreError> {
        Err(unavailable("deleting an invite"))
    }
}
