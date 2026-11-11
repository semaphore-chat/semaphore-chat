//! A community's soundboard. Unit W4-core. Managing sounds is W5's.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait SoundboardBackend: Send + Sync {
    async fn soundboard_controller_list_community_sounds(
        &self,
        _community_id: String,
    ) -> BackendResult<Vec<wire::SoundboardSoundDto>> {
        Err(unsupported("the soundboard"))
    }
}
