//! [`HttpBackend`] for [`DmsBackend`]: direct messages, groups and user search.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, DmsBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl DmsBackend for HttpBackend {
    async fn direct_messages_controller_find_user_dm_groups(
        &self,
    ) -> BackendResult<Vec<wire::DmGroupResponseDto>> {
        rpc!(self, c => c.direct_messages_controller_find_user_dm_groups())
    }

    async fn direct_messages_controller_create_dm_group(
        &self,
        body: wire::CreateDmGroupDto,
    ) -> BackendResult<wire::DmGroupResponseDto> {
        let body = &body;
        rpc!(self, c => c.direct_messages_controller_create_dm_group(body))
    }

    async fn direct_messages_controller_add_members(
        &self,
        id: String,
        body: wire::AddMembersDto,
    ) -> BackendResult<wire::DmGroupResponseDto> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.direct_messages_controller_add_members(id, body))
    }

    async fn direct_messages_controller_leave_dm_group(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.direct_messages_controller_leave_dm_group(id))
    }

    async fn user_controller_search_users(
        &self,
        community_id: Option<String>,
        limit: Option<i64>,
        q: String,
    ) -> BackendResult<Vec<wire::UserEntity>> {
        let (community_id, q) = (community_id.as_deref(), q.as_str());
        rpc!(self, c => c.user_controller_search_users(community_id, limit, q))
    }
}
