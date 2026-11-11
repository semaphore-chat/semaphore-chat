//! W1 part B's exports: threads, search, the unread divider and message links.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    Conversation, MessageLink, SearchHit, SearchScope, ThreadInfo, UnreadMarker,
};

/// `semaphore_core::links::parse_message_link`: what a link on this server points to.
#[uniffi::export]
pub fn parse_message_link(server_url: String, link: String) -> Option<MessageLink> {
    semaphore_core::links::parse_message_link(&server_url, &link)
}

#[uniffi::export]
impl SemaphoreCore {
    pub async fn mark_read(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        self.core.mark_read(conversation, message_id).await
    }

    pub fn thread_info(&self, parent_message_id: String) -> ThreadInfo {
        self.core.thread_info(parent_message_id)
    }

    pub async fn set_thread_subscribed(
        &self,
        parent_message_id: String,
        subscribed: bool,
    ) -> Result<(), CoreError> {
        self.core
            .set_thread_subscribed(parent_message_id, subscribed)
            .await
    }

    pub async fn search_messages(
        &self,
        scope: SearchScope,
        query: String,
        limit: Option<u32>,
    ) -> Result<Vec<SearchHit>, CoreError> {
        self.core.search_messages(scope, query, limit).await
    }

    pub fn unread_marker(&self, conversation: Conversation) -> Option<UnreadMarker> {
        self.core.unread_marker(conversation)
    }

    pub fn clear_unread_marker(&self, conversation: Conversation) {
        self.core.clear_unread_marker(conversation);
    }

    pub async fn open_message_link(
        &self,
        link: String,
        parent_message_id: Option<String>,
    ) -> Result<Conversation, CoreError> {
        self.core.open_message_link(link, parent_message_id).await
    }
}
