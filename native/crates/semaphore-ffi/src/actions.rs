//! W1 part A's exports: edit, delete, pin and react.

use crate::SemaphoreCore;
use semaphore_core::CoreError;

#[uniffi::export]
impl SemaphoreCore {
    pub async fn toggle_reaction(
        &self,
        message_id: String,
        emoji: String,
    ) -> Result<(), CoreError> {
        self.core.toggle_reaction(message_id, emoji).await
    }
}
