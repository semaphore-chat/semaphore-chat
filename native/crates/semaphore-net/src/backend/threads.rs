//! [`HttpBackend`] for [`ThreadsBackend`]: thread metadata and subscriptions.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, ThreadsBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl ThreadsBackend for HttpBackend {
    async fn threads_controller_get_metadata(
        &self,
        parent_message_id: String,
    ) -> BackendResult<wire::ThreadMetadataDto> {
        let parent_message_id = parent_message_id.as_str();
        rpc!(self, c => c.threads_controller_get_metadata(parent_message_id))
    }

    async fn threads_controller_subscribe(&self, parent_message_id: String) -> BackendResult<()> {
        let parent_message_id = parent_message_id.as_str();
        rpc!(self, c => c.threads_controller_subscribe(parent_message_id))
    }

    async fn threads_controller_unsubscribe(&self, parent_message_id: String) -> BackendResult<()> {
        let parent_message_id = parent_message_id.as_str();
        rpc!(self, c => c.threads_controller_unsubscribe(parent_message_id))
    }
}
