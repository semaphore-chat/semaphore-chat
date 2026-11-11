//! W1 part B's exports: threads, search, the unread divider and message links.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::Conversation;

#[uniffi::export]
impl SemaphoreCore {
    pub async fn mark_read(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        self.core.mark_read(conversation, message_id).await
    }
}
