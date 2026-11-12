//! W6-D: every community (with force delete) and the instance invites.
//!
//! This file is W6-D's own: its state, its cached values (`ContentValue`, inside
//! `CacheValue::W6(W6Value::Content(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file. The W6/W7 freeze left them as
//! stubs: reads answer default views and changes `CoreError::Unavailable`.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`).

use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
#[allow(unused_imports)]
use crate::model::{
    AdminCommunitiesView, AdminCommunityView, AdminInvitesView, InstanceInviteDraft, ViewKey,
};
use crate::platform::CoreError;
#[allow(unused_imports)]
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W6-D's query ids: the web's `operationId`s.
pub mod keys {
    pub const COMMUNITIES: &str = "communityControllerFindAllWithStats";
    pub const COMMUNITY: &str = "communityControllerFindOneWithStats";
    pub const INVITES: &str = "inviteControllerGetInvites.admin";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[COMMUNITIES, COMMUNITY, INVITES];
}

/// W6-D's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct ContentState {}

/// W6-D's cached responses.
#[derive(Debug, Clone)]
pub enum ContentValue {}

/// The view a W6-D query feeds.
pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

/// The query a W6-D view reads.
pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

impl State {
    /// A W6-D query's data changed: say which views to read again. False when it isn't
    /// W6-D's.
    pub(crate) fn w6_content_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    /// One socket event, before the shared rules.
    pub(crate) fn w6_content_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-D query; `None` when it isn't one.
    pub(crate) async fn w6_content_fetch(
        &self,
        _key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    pub fn admin_communities(&self, _search: String) -> AdminCommunitiesView {
        AdminCommunitiesView::default()
    }

    pub async fn load_more_admin_communities(&self, _search: String) -> Result<(), CoreError> {
        Err(unavailable("the communities list"))
    }

    pub fn admin_community(&self, _community_id: String) -> AdminCommunityView {
        AdminCommunityView::default()
    }

    /// Deletes a community whoever owns it. The server tells its members.
    pub async fn force_delete_community(&self, _community_id: String) -> Result<(), CoreError> {
        Err(unavailable("community administration"))
    }

    pub fn admin_invites(&self) -> AdminInvitesView {
        AdminInvitesView::default()
    }

    /// Returns the new code.
    pub async fn create_instance_invite(
        &self,
        _draft: InstanceInviteDraft,
    ) -> Result<String, CoreError> {
        Err(unavailable("instance invites"))
    }

    pub async fn delete_instance_invite(&self, _code: String) -> Result<(), CoreError> {
        Err(unavailable("instance invites"))
    }
}
