//! Thread metadata and subscriptions. Replies are in [`MessagesBackend`](super::MessagesBackend).

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait ThreadsBackend: Send + Sync {
    async fn threads_controller_get_metadata(
        &self,
        _parent_message_id: String,
    ) -> BackendResult<wire::ThreadMetadataDto> {
        Err(unsupported("reading thread metadata"))
    }
    async fn threads_controller_subscribe(&self, _parent_message_id: String) -> BackendResult<()> {
        Err(unsupported("subscribing to threads"))
    }
    async fn threads_controller_unsubscribe(
        &self,
        _parent_message_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("unsubscribing from threads"))
    }
}
