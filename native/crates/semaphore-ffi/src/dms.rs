//! W2's direct messages and groups.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{DmList, DmPreview, DmRow, LoadState, UserView};

#[uniffi::remote(Record)]
pub struct DmPreview {
    pub author_id: String,
    pub text: String,
    pub sent_at_ms: i64,
}

#[uniffi::remote(Record)]
pub struct DmRow {
    pub id: String,
    pub name: Option<String>,
    pub is_group: bool,
    pub members: Vec<UserView>,
    pub last_message: Option<DmPreview>,
    pub unread: u32,
    pub mentions: u32,
    pub online: bool,
}

#[uniffi::remote(Record)]
pub struct DmList {
    pub state: LoadState,
    pub rows: Vec<DmRow>,
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn dm_list(&self) -> DmList {
        self.sync(move |core| core.dm_list())
    }

    pub fn dm(&self, dm_id: String) -> Option<DmRow> {
        self.sync(move |core| core.dm(dm_id))
    }

    pub async fn search_users(
        &self,
        query: String,
        limit: Option<u32>,
    ) -> Result<Vec<UserView>, CoreError> {
        self.run(move |core| async move { core.search_users(query, limit).await })
            .await
    }

    pub async fn create_dm(
        &self,
        user_ids: Vec<String>,
        name: Option<String>,
    ) -> Result<String, CoreError> {
        self.run(move |core| async move { core.create_dm(user_ids, name).await })
            .await
    }

    pub async fn add_dm_members(
        &self,
        dm_id: String,
        user_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.add_dm_members(dm_id, user_ids).await })
            .await
    }

    pub async fn leave_dm(&self, dm_id: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.leave_dm(dm_id).await })
            .await
    }
}
