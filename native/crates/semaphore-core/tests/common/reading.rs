//! [`FakeBackend`] for W1 part B: threads and search, scripted through `FakeBackend::reading`.

use super::{FakeBackend, decoded, not_found};
use semaphore_core::backend::{BackendError, BackendResult, SearchBackend, ThreadsBackend};
use semaphore_wire::types as wire;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::oneshot;

/// One search request: scope (`channel`, `group`, `community`), id, query and limit.
pub type SearchCall = (String, String, String, Option<i64>);

#[derive(Default)]
pub struct ReadingFakes {
    /// Thread metadata by parent. A parent not here answers 404.
    pub meta: Mutex<HashMap<String, Value>>,
    pub meta_requests: AtomicU64,
    /// Each subscribe (`true`) and unsubscribe (`false`), in order.
    pub subscribe_calls: Mutex<Vec<(String, bool)>>,
    /// The next subscription change fails with this.
    pub subscribe_error: Mutex<Option<BackendError>>,
    /// Holds the next subscription change's answer until this fires.
    pub subscribe_gate: Mutex<Option<oneshot::Receiver<()>>>,
    pub search_calls: Mutex<Vec<SearchCall>>,
    /// What a channel or DM search answers.
    pub search_results: Mutex<Vec<Value>>,
    /// What a community search answers.
    pub community_results: Mutex<Vec<Value>>,
}

impl ReadingFakes {
    pub fn meta_requests(&self) -> u64 {
        self.meta_requests.load(Ordering::SeqCst)
    }

    pub fn set_meta(&self, parent: &str, subscribed: bool, reply_count: i64) {
        self.meta.lock().unwrap().insert(
            parent.to_owned(),
            serde_json::json!({
                "parentMessageId": parent,
                "replyCount": reply_count,
                "lastReplyAt": "2026-09-22T18:05:00.000Z",
                "isSubscribed": subscribed,
            }),
        );
    }

    async fn change(&self, parent: String, subscribed: bool) -> BackendResult<()> {
        self.subscribe_calls
            .lock()
            .unwrap()
            .push((parent.clone(), subscribed));
        let gate = self.subscribe_gate.lock().unwrap().take();
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        if let Some(error) = self.subscribe_error.lock().unwrap().take() {
            return Err(error);
        }
        let mut meta = self.meta.lock().unwrap();
        match meta.get_mut(&parent) {
            Some(value) => {
                value["isSubscribed"] = Value::Bool(subscribed);
                Ok(())
            }
            None => Err(not_found()),
        }
    }

    fn search(&self, scope: &str, id: String, q: String, limit: Option<i64>) {
        self.search_calls
            .lock()
            .unwrap()
            .push((scope.to_owned(), id, q, limit));
    }
}

#[async_trait::async_trait]
impl ThreadsBackend for FakeBackend {
    async fn threads_controller_get_metadata(
        &self,
        parent_message_id: String,
    ) -> BackendResult<wire::ThreadMetadataDto> {
        self.reading.meta_requests.fetch_add(1, Ordering::SeqCst);
        let value = self
            .reading
            .meta
            .lock()
            .unwrap()
            .get(&parent_message_id)
            .cloned();
        match value {
            Some(value) => decoded(value),
            None => Err(not_found()),
        }
    }

    async fn threads_controller_subscribe(&self, parent_message_id: String) -> BackendResult<()> {
        self.reading.change(parent_message_id, true).await
    }

    async fn threads_controller_unsubscribe(&self, parent_message_id: String) -> BackendResult<()> {
        self.reading.change(parent_message_id, false).await
    }
}

#[async_trait::async_trait]
impl SearchBackend for FakeBackend {
    async fn messages_controller_search_channel_messages(
        &self,
        channel_id: String,
        q: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MessageDto>> {
        self.reading.search("channel", channel_id, q, limit);
        decoded(Value::Array(
            self.reading.search_results.lock().unwrap().clone(),
        ))
    }

    async fn messages_controller_search_direct_messages(
        &self,
        group_id: String,
        q: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MessageDto>> {
        self.reading.search("group", group_id, q, limit);
        decoded(Value::Array(
            self.reading.search_results.lock().unwrap().clone(),
        ))
    }

    async fn messages_controller_search_community_messages(
        &self,
        community_id: String,
        q: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::CommunitySearchResultDto>> {
        self.reading.search("community", community_id, q, limit);
        decoded(Value::Array(
            self.reading.community_results.lock().unwrap().clone(),
        ))
    }
}
