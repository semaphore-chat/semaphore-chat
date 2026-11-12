//! W7-A: GIF search.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait GifsBackend: Send + Sync {
    /// `GET /gifs/featured`.
    async fn gifs_controller_featured(
        &self,
        _limit: Option<std::num::NonZeroU64>,
        _pos: Option<String>,
    ) -> BackendResult<wire::GifSearchResponseDto> {
        Err(unsupported("GIFs"))
    }
    /// `GET /gifs/search`.
    async fn gifs_controller_search(
        &self,
        _limit: Option<std::num::NonZeroU64>,
        _pos: Option<String>,
        _q: String,
    ) -> BackendResult<wire::GifSearchResponseDto> {
        Err(unsupported("GIF search"))
    }
}
