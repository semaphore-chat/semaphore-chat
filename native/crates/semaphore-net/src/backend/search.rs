//! [`HttpBackend`] for [`SearchBackend`]: message search, a page at a time.
//!
//! The next page's cursor arrives in `X-Continuation-Token` (`setSearchPageHeader` in the
//! backend's `messages.controller.ts`), so these calls keep the response's headers instead of
//! `rpc!`, which drops them.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, SearchBackend, SearchPage};
use semaphore_wire::types as wire;

use super::*;

/// The header the backend sends the next page's cursor in.
const CONTINUATION: &str = "x-continuation-token";

/// The rows and, when the page was full, the cursor after its last one.
fn page<T>(response: ResponseValue<Vec<T>>) -> SearchPage<T> {
    let next = response
        .headers()
        .get(CONTINUATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    SearchPage {
        items: response.into_inner(),
        next,
    }
}

#[async_trait]
impl SearchBackend for HttpBackend {
    async fn messages_controller_search_channel_messages(
        &self,
        channel_id: String,
        q: String,
        limit: Option<i64>,
        continuation_token: Option<String>,
    ) -> BackendResult<SearchPage<wire::MessageDto>> {
        let (channel_id, q, token) = (
            channel_id.as_str(),
            q.as_str(),
            continuation_token.as_deref(),
        );
        let response = self
            .call(|c: Arc<Client>| async move {
                c.messages_controller_search_channel_messages(channel_id, token, limit, q)
                    .await
            })
            .await?;
        Ok(page(response))
    }

    async fn messages_controller_search_direct_messages(
        &self,
        group_id: String,
        q: String,
        limit: Option<i64>,
        continuation_token: Option<String>,
    ) -> BackendResult<SearchPage<wire::MessageDto>> {
        let (group_id, q, token) = (group_id.as_str(), q.as_str(), continuation_token.as_deref());
        let response = self
            .call(|c: Arc<Client>| async move {
                c.messages_controller_search_direct_messages(group_id, token, limit, q)
                    .await
            })
            .await?;
        Ok(page(response))
    }

    async fn messages_controller_search_community_messages(
        &self,
        community_id: String,
        q: String,
        limit: Option<i64>,
        continuation_token: Option<String>,
    ) -> BackendResult<SearchPage<wire::CommunitySearchResultDto>> {
        let (community_id, q, token) = (
            community_id.as_str(),
            q.as_str(),
            continuation_token.as_deref(),
        );
        let response = self
            .call(|c: Arc<Client>| async move {
                c.messages_controller_search_community_messages(community_id, token, limit, q)
                    .await
            })
            .await?;
        Ok(page(response))
    }
}
