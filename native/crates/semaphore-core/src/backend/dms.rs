//! Direct messages and groups, and finding users to start one with. Their messages are in
//! [`MessagesBackend`](super::MessagesBackend).

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait DmsBackend: Send + Sync {
    async fn direct_messages_controller_find_user_dm_groups(
        &self,
    ) -> BackendResult<Vec<wire::DmGroupResponseDto>> {
        Err(unsupported("listing direct messages"))
    }
    async fn direct_messages_controller_create_dm_group(
        &self,
        _body: wire::CreateDmGroupDto,
    ) -> BackendResult<wire::DmGroupResponseDto> {
        Err(unsupported("creating direct messages"))
    }
    async fn direct_messages_controller_add_members(
        &self,
        _id: String,
        _body: wire::AddMembersDto,
    ) -> BackendResult<wire::DmGroupResponseDto> {
        Err(unsupported("adding group members"))
    }
    async fn direct_messages_controller_leave_dm_group(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("leaving groups"))
    }
    async fn user_controller_search_users(
        &self,
        _community_id: Option<String>,
        _limit: Option<i64>,
        _q: String,
    ) -> BackendResult<Vec<wire::UserEntity>> {
        Err(unsupported("searching users"))
    }
}
