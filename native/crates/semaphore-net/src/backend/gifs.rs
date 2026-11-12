//! [`HttpBackend`] for [`GifsBackend`]: GIF search. Each method is one generated operation.

use async_trait::async_trait;
use semaphore_core::backend::{BackendResult, GifsBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl GifsBackend for HttpBackend {
    async fn gifs_controller_featured(
        &self,
        limit: Option<std::num::NonZeroU64>,
        pos: Option<String>,
    ) -> BackendResult<wire::GifSearchResponseDto> {
        let pos = pos.as_deref();
        rpc!(self, c => c.gifs_controller_featured(limit, pos))
    }

    async fn gifs_controller_search(
        &self,
        limit: Option<std::num::NonZeroU64>,
        pos: Option<String>,
        q: String,
    ) -> BackendResult<wire::GifSearchResponseDto> {
        let (pos, q) = (pos.as_deref(), q.as_str());
        rpc!(self, c => c.gifs_controller_search(limit, pos, q))
    }
}
