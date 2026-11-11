//! Moderation: ban, kick, timeout, their lists, the moderation log, and what happens when this user
//! is the one moderated. Unit W5-B. Roles are in `roles.rs`, the permission set in
//! `permissions.rs`.
//!
//! This file is W5-B's hub: its state, its cached values, which views its queries feed, how they
//! are fetched, and what it does on a socket event. The shared files only call these.
//!
//! When this user is kicked or banned (`userKicked`/`userBanned` naming them, which can arrive
//! twice, #673) or the community is deleted, core leaves its call, drops its caches, and sends
//! `CoreEvent::CommunityRemoved` once. A timeout locks the composer through the channel
//! capabilities; the server sends nothing when it runs out, so the host calls
//! `Core::timeout_elapsed` at `ChannelPermissions::timed_out_until_ms`. Kicking is W4's
//! `Core::kick_member` (the moderation endpoint, with a reason).

use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
use crate::model::{
    BanListView, BanRequest, ModerationActionKind, ModerationLogView, TimeoutListView,
    TimeoutRequest, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W5-B's state: changes on their way, the removals already announced, the log's paging. Gone at
/// sign-out.
#[derive(Default)]
pub struct W5bState {}

/// W5-B's cached responses, inside `CacheValue::W5b`. W5-B adds a variant per query it caches.
#[derive(Debug, Clone)]
pub enum W5bValue {}

/// The view a W5-B query feeds.
pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

/// The query behind a W5-B view, the reverse of [`view_for`].
pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

impl State {
    /// A W5-B query's data changed: say which views to read again. False when it isn't W5-B's.
    pub(crate) fn w5b_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    /// W5-B's handling of a socket event, before the shared rules (role and moderation events,
    /// `communityDeleted`).
    pub(crate) fn w5b_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W5-B query, or `None` when the key isn't W5-B's.
    pub(crate) async fn w5b_fetch(&self, _key: &QueryKey) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    pub async fn ban_member(
        &self,
        _community_id: String,
        _user_id: String,
        _request: BanRequest,
    ) -> Result<(), CoreError> {
        Err(unavailable("banning a member"))
    }

    pub async fn unban_member(
        &self,
        _community_id: String,
        _user_id: String,
        _reason: Option<String>,
    ) -> Result<(), CoreError> {
        Err(unavailable("lifting a ban"))
    }

    pub async fn timeout_member(
        &self,
        _community_id: String,
        _user_id: String,
        _request: TimeoutRequest,
    ) -> Result<(), CoreError> {
        Err(unavailable("timing out a member"))
    }

    pub async fn remove_timeout(
        &self,
        _community_id: String,
        _user_id: String,
        _reason: Option<String>,
    ) -> Result<(), CoreError> {
        Err(unavailable("lifting a timeout"))
    }

    /// Active bans (`ViewKey::Bans`).
    pub fn bans(&self, community_id: String) -> BanListView {
        BanListView {
            community_id,
            ..Default::default()
        }
    }

    /// Active timeouts (`ViewKey::Timeouts`).
    pub fn timeouts(&self, community_id: String) -> TimeoutListView {
        TimeoutListView {
            community_id,
            ..Default::default()
        }
    }

    /// The moderation log's first pages (`ViewKey::ModerationLog`).
    pub fn moderation_log(&self, community_id: String) -> ModerationLogView {
        ModerationLogView {
            community_id,
            ..Default::default()
        }
    }

    /// Shows only one kind of entry, or all; reads from the first page again.
    pub fn set_moderation_log_filter(
        &self,
        _community_id: String,
        _filter: Option<ModerationActionKind>,
    ) {
    }

    /// Reads the log's next page.
    pub async fn more_moderation_log(&self, _community_id: String) -> Result<(), CoreError> {
        Err(unavailable("the moderation log"))
    }

    /// The host's call at `ChannelPermissions::timed_out_until_ms`: the server says nothing when a
    /// timeout runs out, so core reads the community's capabilities again.
    pub fn timeout_elapsed(&self, _community_id: String) {}
}
