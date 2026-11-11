//! Direct messages and groups: the list, creating one, adding members and leaving, and finding
//! users. The conversation itself is `Conversation::DirectMessage` with the message commands.
//! Unit W2-core.

use crate::client::Core;
use crate::model::{DmList, DmRow, UserView};
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// This user's DMs and groups, the most recently active first. `ViewKey::DirectMessages` says
    /// when to read again.
    pub fn dm_list(&self) -> DmList {
        DmList::default()
    }

    /// One DM or group, for its header. `None` until the list has it.
    pub fn dm(&self, _dm_id: String) -> Option<DmRow> {
        None
    }

    /// Users whose name matches, to start a DM with or to befriend. Never this user.
    pub async fn search_users(
        &self,
        _query: String,
        _limit: Option<u32>,
    ) -> Result<Vec<UserView>, CoreError> {
        Err(unavailable("user search"))
    }

    /// Starts a DM with one user, or a group with several, and returns its id. A DM with one user
    /// that already exists comes back as itself. `name` applies to a group only.
    pub async fn create_dm(
        &self,
        _user_ids: Vec<String>,
        _name: Option<String>,
    ) -> Result<String, CoreError> {
        Err(unavailable("creating direct messages"))
    }

    /// Adds people to a group. A one-to-one DM can't grow: the server refuses.
    pub async fn add_dm_members(
        &self,
        _dm_id: String,
        _user_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        Err(unavailable("adding group members"))
    }

    /// Leaves a group. It goes from the list once the server agrees.
    pub async fn leave_dm(&self, _dm_id: String) -> Result<(), CoreError> {
        Err(unavailable("leaving groups"))
    }
}
