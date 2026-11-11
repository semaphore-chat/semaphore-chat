//! W1 part A's exports: edit, delete, pin and react.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{ChannelModerationView, MessageDraft, PinnedList, ReactionUsers};

#[uniffi::export]
impl SemaphoreCore {
    pub async fn toggle_reaction(
        &self,
        message_id: String,
        emoji: String,
    ) -> Result<(), CoreError> {
        self.core.toggle_reaction(message_id, emoji).await
    }

    pub async fn add_reaction(&self, message_id: String, emoji: String) -> Result<(), CoreError> {
        self.core.add_reaction(message_id, emoji).await
    }

    pub async fn remove_reaction(
        &self,
        message_id: String,
        emoji: String,
    ) -> Result<(), CoreError> {
        self.core.remove_reaction(message_id, emoji).await
    }

    pub fn reaction_users(&self, message_id: String, emoji: String) -> ReactionUsers {
        self.core.reaction_users(message_id, emoji)
    }

    pub fn edit_draft(&self, message_id: String) -> Option<MessageDraft> {
        self.core.edit_draft(message_id)
    }

    pub async fn edit_message(
        &self,
        message_id: String,
        draft: MessageDraft,
        keep_attachment_ids: Option<Vec<String>>,
    ) -> Result<(), CoreError> {
        self.core
            .edit_message(message_id, draft, keep_attachment_ids)
            .await
    }

    pub async fn delete_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.core.delete_message(message_id, reason).await
    }

    pub async fn pin_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.core.pin_message(message_id, reason).await
    }

    pub async fn unpin_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.core.unpin_message(message_id, reason).await
    }

    pub fn pinned_messages(&self, channel_id: String) -> PinnedList {
        self.core.pinned_messages(channel_id)
    }

    pub fn channel_moderation(&self, channel_id: String) -> ChannelModerationView {
        self.core.channel_moderation(channel_id)
    }

    /// Reads again whatever failed: a `Failed` moderation view or pins list, among others.
    pub fn retry_failed(&self) {
        self.core.retry_failed()
    }
}
