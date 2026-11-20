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
        self.run(move |core| async move { core.toggle_reaction(message_id, emoji).await })
            .await
    }

    pub async fn add_reaction(&self, message_id: String, emoji: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.add_reaction(message_id, emoji).await })
            .await
    }

    pub async fn remove_reaction(
        &self,
        message_id: String,
        emoji: String,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.remove_reaction(message_id, emoji).await })
            .await
    }

    pub fn reaction_users(&self, message_id: String, emoji: String) -> ReactionUsers {
        self.sync(move |core| core.reaction_users(message_id, emoji))
    }

    pub fn edit_draft(&self, message_id: String) -> Option<MessageDraft> {
        self.sync(move |core| core.edit_draft(message_id))
    }

    pub async fn edit_message(
        &self,
        message_id: String,
        draft: MessageDraft,
        keep_attachment_ids: Option<Vec<String>>,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move {
            core.edit_message(message_id, draft, keep_attachment_ids)
                .await
        })
        .await
    }

    pub async fn delete_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.delete_message(message_id, reason).await })
            .await
    }

    pub async fn pin_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.pin_message(message_id, reason).await })
            .await
    }

    pub async fn unpin_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.unpin_message(message_id, reason).await })
            .await
    }

    pub fn pinned_messages(&self, channel_id: String) -> PinnedList {
        self.sync(move |core| core.pinned_messages(channel_id))
    }

    pub fn channel_moderation(&self, channel_id: String) -> ChannelModerationView {
        self.sync(move |core| core.channel_moderation(channel_id))
    }

    /// Reads again whatever failed: a `Failed` moderation view or pins list, among others.
    pub fn retry_failed(&self) {
        self.sync(move |core| core.retry_failed())
    }
}
