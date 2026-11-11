//! Running a community: its settings, channels and their order, private channel members, and
//! adding members. Unit W5-A. Mention groups, emoji, sounds, webhooks and invites are in
//! `community_assets.rs`.
//!
//! This file is W5-A's hub: its state, its cached values, which views its queries feed, how they
//! are fetched, and what it does on a socket event. The shared files (`cache.rs`,
//! `commands/mod.rs`, `queries.rs`, `events.rs`, `client.rs`) only call these, so W5-A and W5-B
//! never edit the same lines.
//!
//! What this user may do is W5-B's `Core::community_permissions`; commands here don't check it,
//! the server does.

use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
use crate::model::{
    ChannelDraft, ChannelMove, CommunityPatch, CommunitySettingsView, PrivateMembersView, UserView,
    ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W5-A's state: changes on their way and their errors. Gone at sign-out.
#[derive(Default)]
pub struct W5aState {}

/// W5-A's cached responses, inside `CacheValue::W5a`. W5-A adds a variant per query it caches.
#[derive(Debug, Clone)]
pub enum W5aValue {}

/// The view a W5-A query feeds (`commands::view_for` asks here for what it doesn't know).
pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

/// The query behind a W5-A view, the reverse of [`view_for`].
pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

impl State {
    /// A W5-A query's data changed: say which views to read again. False when it isn't W5-A's.
    pub(crate) fn w5a_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    /// W5-A's handling of a socket event, before the shared rules (channel and community events,
    /// `channelPermissionsUpdated`, `memberAddedToCommunity`).
    pub(crate) fn w5a_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W5-A query, or `None` when the key isn't W5-A's.
    pub(crate) async fn w5a_fetch(&self, _key: &QueryKey) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    /// The overview tab (`ViewKey::CommunitySettings`).
    pub fn community_settings(&self, community_id: String) -> CommunitySettingsView {
        CommunitySettingsView {
            community_id,
            ..Default::default()
        }
    }

    /// Changes the name, description, avatar or banner. Images go up first.
    pub async fn update_community(
        &self,
        _community_id: String,
        _patch: CommunityPatch,
    ) -> Result<(), CoreError> {
        Err(unavailable("updating a community"))
    }

    /// Deletes the community for everyone. `communityDeleted` then removes it here too.
    pub async fn delete_community(&self, _community_id: String) -> Result<(), CoreError> {
        Err(unavailable("deleting a community"))
    }

    /// Makes a channel; returns its id.
    pub async fn create_channel(
        &self,
        _community_id: String,
        _draft: ChannelDraft,
    ) -> Result<String, CoreError> {
        Err(unavailable("creating a channel"))
    }

    /// Changes a channel's name, privacy and slow mode (its kind stays).
    pub async fn update_channel(
        &self,
        _channel_id: String,
        _draft: ChannelDraft,
    ) -> Result<(), CoreError> {
        Err(unavailable("updating a channel"))
    }

    pub async fn delete_channel(&self, _channel_id: String) -> Result<(), CoreError> {
        Err(unavailable("deleting a channel"))
    }

    /// Moves a channel one place up or down among its kind.
    pub async fn move_channel(
        &self,
        _channel_id: String,
        _step: ChannelMove,
    ) -> Result<(), CoreError> {
        Err(unavailable("moving a channel"))
    }

    /// A private channel's members (`ViewKey::PrivateMembers`).
    pub fn private_members(&self, channel_id: String) -> PrivateMembersView {
        PrivateMembersView {
            channel_id,
            ..Default::default()
        }
    }

    pub async fn add_private_member(
        &self,
        _channel_id: String,
        _user_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("adding a private channel member"))
    }

    pub async fn remove_private_member(
        &self,
        _channel_id: String,
        _user_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("removing a private channel member"))
    }

    /// Users on the instance who aren't members yet, to add (`userControllerSearchUsers` with the
    /// community, not the web's admin-only user list).
    pub async fn search_users_to_add(
        &self,
        _community_id: String,
        _query: String,
    ) -> Result<Vec<UserView>, CoreError> {
        Err(unavailable("searching users to add"))
    }

    /// Adds a user to the community.
    pub async fn add_member(
        &self,
        _community_id: String,
        _user_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("adding a member"))
    }
}
