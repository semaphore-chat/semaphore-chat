//! [`HttpBackend`] for [`SoundboardBackend`].

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, SoundboardBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl SoundboardBackend for HttpBackend {
    async fn soundboard_controller_list_community_sounds(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::SoundboardSoundDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.soundboard_controller_list_community_sounds(community_id))
    }
}
