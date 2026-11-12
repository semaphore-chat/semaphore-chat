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
//!
//! Every change shows on one view's `AdminOp` (busy while it runs, the server's message when it
//! fails): the community's own changes, its channels, adding members and its sounds on
//! `CommunitySettings`; the rest on the view they change. A rename, a move or a removal shows at
//! once and goes back if the server refuses, field by field, and only where nothing has changed
//! that field since. Nothing an ended session started lands (`session_epoch`).
//!
//! Socket events: `channelCreated`/`channelUpdated`/`channelDeleted`/`channelsReordered` and
//! `communityUpdated` change the cached lists at once (the shared rules then read them again);
//! `channelDeleted` sends `CoreEvent::ChannelRemoved` and `communityDeleted` sends
//! `CoreEvent::CommunityRemoved { cause: Deleted }`, each once, after leaving a call there and
//! dropping what core holds of it. A community this core deleted itself isn't announced: the
//! caller knows.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::backend::{BackendError, BackendResult, FileUpload, UploadProgress};
use crate::cache::{CacheValue, QueryKey, keys};
use crate::client::{Core, Effect, Services, State, user_view};
use crate::model::{
    AdminAction, AdminActionKind, AdminActionOutcome, AdminActionState, AdminOp, ChannelDraft,
    ChannelKind, ChannelMove, CommunityPatch, CommunitySettingsView, DraftFile, ErrorView,
    FINISHED_KEPT, ImageChange, PrivateMemberRow, PrivateMembersView, RemovalCause, UploadView,
    UserView, ViewKey, VoiceRoom, VoiceView,
};
use crate::platform::{CoreError, CoreEvent};
use crate::resync::unavailable;
use semaphore_wire::enums::{ChannelType, ResourceType};
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

/// A view without socket events is read again when shown and older than this (W2's rule).
pub const ADMIN_STALE_MS: u64 = 30_000;
/// How many users "Add member" asks the search for.
const ADD_SEARCH_LIMIT: i64 = 25;

/// W5-A's query ids: the web's `operationId`s, except the emoji list this tab reads, which is
/// kept apart from the pickers' (`customEmojiControllerListCommunityEmojis`) so its arrival can
/// say so.
pub mod admin_keys {
    pub const COMMUNITY: &str = "communityControllerFindOne";
    pub const PRIVATE_MEMBERS: &str = "channelMembershipControllerFindAllForChannel";
    pub const ALIAS_GROUPS: &str = "aliasGroupsControllerGetCommunityAliasGroups";
    pub const ALIAS_GROUP: &str = "aliasGroupsControllerGetAliasGroup";
    pub const EMOJIS: &str = "customEmojiControllerListCommunityEmojis.manage";
    pub const WEBHOOKS: &str = "webhooksControllerFindAllForChannel";
    pub const INVITES: &str = "inviteControllerGetInvites";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[
        PRIVATE_MEMBERS,
        ALIAS_GROUPS,
        ALIAS_GROUP,
        EMOJIS,
        WEBHOOKS,
        INVITES,
    ];
}
use admin_keys as k;

/// One action's changes on a view: how many are running, the file going up, its last failure.
pub(crate) struct OpEntry {
    action: AdminAction,
    running: u32,
    /// The upload's change number and progress.
    upload: Option<(u64, UploadView)>,
    error: Option<ErrorView>,
    /// When it last started (a change number): the newest describes the view's `AdminOp`.
    started: u64,
}

/// A change's view, and which action it is there.
#[derive(Debug, Clone)]
pub(crate) struct OpKey {
    pub view: ViewKey,
    pub action: AdminAction,
}

impl OpKey {
    pub(crate) fn new(view: ViewKey, kind: AdminActionKind, target_id: Option<String>) -> Self {
        Self {
            view,
            action: AdminAction { kind, target_id },
        }
    }
}

/// W5-A's state: changes on their way and their errors. Gone at sign-out.
#[derive(Default)]
pub struct W5aState {
    pub(crate) ops: HashMap<ViewKey, Vec<OpEntry>>,
    /// The changes that ended on each view, oldest first, at most `FINISHED_KEPT`.
    pub(crate) finished: HashMap<ViewKey, std::collections::VecDeque<AdminActionOutcome>>,
    /// Communities whose removal was announced or that this core deleted: announced once.
    pub(crate) removed_communities: HashSet<String>,
    /// Communities this core is deleting: their `communityDeleted` isn't announced.
    pub(crate) deleting: HashSet<String>,
    /// Channels whose removal was announced.
    pub(crate) removed_channels: HashSet<String>,
}

/// W5-A's cached responses, inside `CacheValue::W5a`. The emoji tab's list is a
/// `CacheValue::Emojis` under its own key.
#[derive(Debug, Clone)]
pub enum W5aValue {
    Community(wire::CommunityResponseDto),
    PrivateMembers(Vec<wire::ChannelMembershipResponseDto>),
    AliasGroups(Vec<wire::AliasGroupSummaryDto>),
    AliasGroup(wire::AliasGroupWithMembersDto),
    Webhooks(Vec<wire::WebhookDto>),
    Invites(Vec<wire::InviteResponseDto>),
}

/// The view a W5-A query feeds (`commands::view_for` asks here for what it doesn't know).
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    let id = key.segments.get(1).cloned().unwrap_or_default();
    Some(match key.op() {
        k::COMMUNITY => ViewKey::CommunitySettings { community_id: id },
        k::PRIVATE_MEMBERS => ViewKey::PrivateMembers { channel_id: id },
        k::ALIAS_GROUPS => ViewKey::AliasGroups { community_id: id },
        k::ALIAS_GROUP => ViewKey::AliasGroup { group_id: id },
        k::EMOJIS => ViewKey::CustomEmoji { community_id: id },
        k::WEBHOOKS => ViewKey::Webhooks { channel_id: id },
        k::INVITES => ViewKey::Invites,
        _ => return None,
    })
}

/// The query behind a W5-A view, the reverse of [`view_for`].
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    Some(match view {
        ViewKey::CommunitySettings { community_id } => keys::scoped(k::COMMUNITY, community_id),
        ViewKey::PrivateMembers { channel_id } => keys::scoped(k::PRIVATE_MEMBERS, channel_id),
        ViewKey::AliasGroups { community_id } => keys::scoped(k::ALIAS_GROUPS, community_id),
        ViewKey::AliasGroup { group_id } => keys::scoped(k::ALIAS_GROUP, group_id),
        ViewKey::CustomEmoji { community_id } => keys::scoped(k::EMOJIS, community_id),
        ViewKey::Webhooks { channel_id } => keys::scoped(k::WEBHOOKS, channel_id),
        ViewKey::Invites => keys::op(k::INVITES),
        _ => return None,
    })
}

pub(crate) fn uuid(id: &str, what: &str) -> Result<uuid::Uuid, CoreError> {
    id.parse().map_err(|_| CoreError::Failed {
        message: format!("{what} isn't a valid id"),
    })
}

pub(crate) fn invalid(what: &str) -> CoreError {
    CoreError::Failed {
        message: format!("the {what} isn't valid"),
    }
}

fn non_empty(text: Option<&String>) -> Option<String> {
    text.filter(|text| !text.is_empty()).cloned()
}

fn wire_kind(kind: ChannelKind) -> Option<ChannelType> {
    match kind {
        ChannelKind::Text => Some(ChannelType::Text),
        ChannelKind::Voice => Some(ChannelType::Voice),
        ChannelKind::Unknown => None,
    }
}

/// A typed read and edit of one `W5aValue` variant.
macro_rules! w5a_typed {
    ($get:ident, $edit:ident, $variant:ident, $ty:ty) => {
        pub(crate) fn $get(&self, key: &QueryKey) -> Option<&$ty> {
            match self.w5a_value(key) {
                Some(W5aValue::$variant(value)) => Some(value),
                _ => None,
            }
        }

        /// Changes the cached value in place, as a direct update: `None` when it isn't cached.
        pub(crate) fn $edit<R>(
            &mut self,
            key: &QueryKey,
            change: impl FnOnce(&mut $ty) -> R,
        ) -> Option<R> {
            self.w5a_edit(key, |value| match value {
                W5aValue::$variant(value) => Some(change(value)),
                _ => None,
            })
            .flatten()
        }
    };
}

impl State {
    pub(crate) fn w5a_value(&self, key: &QueryKey) -> Option<&W5aValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W5a(value)) => Some(value),
            _ => None,
        }
    }

    /// Edits a cached W5-A value, keeping when it was read and whether it's stale.
    fn w5a_edit<R>(
        &mut self,
        key: &QueryKey,
        change: impl FnOnce(&mut W5aValue) -> R,
    ) -> Option<R> {
        let entry = self.cache.get(key)?.clone();
        let CacheValue::W5a(mut value) = entry.value else {
            return None;
        };
        let result = change(&mut value);
        self.cache
            .set(key.clone(), CacheValue::W5a(value), entry.fetched_at_ms);
        if entry.stale {
            self.cache.invalidate_prefix(key);
        }
        self.note_direct_update(key);
        if let Some(view) = view_for(key) {
            self.view_changed(view);
        }
        Some(result)
    }

    w5a_typed!(
        w5a_community,
        w5a_community_edit,
        Community,
        wire::CommunityResponseDto
    );
    w5a_typed!(
        w5a_private_members,
        w5a_private_members_edit,
        PrivateMembers,
        Vec<wire::ChannelMembershipResponseDto>
    );
    w5a_typed!(
        w5a_alias_groups,
        w5a_alias_groups_edit,
        AliasGroups,
        Vec<wire::AliasGroupSummaryDto>
    );
    w5a_typed!(
        w5a_alias_group,
        w5a_alias_group_edit,
        AliasGroup,
        wire::AliasGroupWithMembersDto
    );
    w5a_typed!(
        w5a_webhooks,
        w5a_webhooks_edit,
        Webhooks,
        Vec<wire::WebhookDto>
    );
    w5a_typed!(
        w5a_invites,
        w5a_invites_edit,
        Invites,
        Vec<wire::InviteResponseDto>
    );

    /// Reads a view's query: again when it's older than [`ADMIN_STALE_MS`], since no event says
    /// it changed.
    pub(crate) fn w5a_ensure(&mut self, key: &QueryKey, now: u64, ages: bool) {
        let old = ages
            && self.cache.get(key).is_some_and(|entry| {
                !entry.stale && now.saturating_sub(entry.fetched_at_ms) > ADMIN_STALE_MS
            });
        if old {
            self.invalidate(key);
        }
        self.ensure_query(key.clone());
    }

    /// Read again now (after this user's own change): the view keeps its data meanwhile.
    pub(crate) fn w5a_reread(&mut self, key: &QueryKey) {
        self.failed_queries.remove(key);
        self.invalidate(key);
    }

    /// The entry for `op`'s action on its view, made when missing.
    fn w5a_entry(&mut self, op: &OpKey) -> &mut OpEntry {
        let entries = self.w5a.ops.entry(op.view.clone()).or_default();
        let index = match entries.iter().position(|entry| entry.action == op.action) {
            Some(index) => index,
            None => {
                entries.push(OpEntry {
                    action: op.action.clone(),
                    running: 0,
                    upload: None,
                    error: None,
                    started: 0,
                });
                entries.len() - 1
            }
        };
        &mut entries[index]
    }

    /// A change starts: its action busy and that action's last failure cleared (another action's
    /// stays).
    pub(crate) fn w5a_op_begin(&mut self, op: &OpKey) -> u64 {
        let change = self.next_change();
        let entry = self.w5a_entry(op);
        entry.running += 1;
        entry.error = None;
        entry.started = change;
        self.view_changed(op.view.clone());
        change
    }

    /// A change ended, with its failure if it failed. An action that succeeded and has nothing
    /// running leaves the list.
    pub(crate) fn w5a_op_end(&mut self, op: &OpKey, change: u64, error: Option<ErrorView>) {
        let entry = self.w5a_entry(op);
        entry.running = entry.running.saturating_sub(1);
        if entry.upload.as_ref().is_some_and(|(of, _)| *of == change) {
            entry.upload = None;
        }
        let failure = error.clone();
        if error.is_some() {
            entry.error = error;
        }
        if let Some(entries) = self.w5a.ops.get_mut(&op.view) {
            entries.retain(|entry| entry.running > 0 || entry.error.is_some());
        }
        self.w5a_finished(op, failure);
        self.view_changed(op.view.clone());
    }

    /// Records that `op`'s change ended, for `AdminOp::finished`.
    fn w5a_finished(&mut self, op: &OpKey, error: Option<ErrorView>) {
        let seq = self.next_change();
        let done = self.w5a.finished.entry(op.view.clone()).or_default();
        done.push_back(AdminActionOutcome {
            action: op.action.clone(),
            seq,
            error,
        });
        while done.len() > FINISHED_KEPT {
            done.pop_front();
        }
    }

    /// A change refused before it was sent: the form shows why, on that action.
    pub(crate) fn w5a_op_refused(&mut self, op: &OpKey, error: &CoreError) {
        let change = self.next_change();
        let failure = ErrorView {
            code: "VALIDATION_FAILED".into(),
            message: match error {
                CoreError::Failed { message } => message.clone(),
                other => other.to_string(),
            },
            retryable: false,
            retry_after_ms: None,
        };
        let entry = self.w5a_entry(op);
        entry.started = change;
        entry.error = Some(failure.clone());
        self.w5a_finished(op, Some(failure));
        self.view_changed(op.view.clone());
    }

    pub(crate) fn w5a_op(&self, view: &ViewKey) -> AdminOp {
        let finished: Vec<AdminActionOutcome> = self
            .w5a
            .finished
            .get(view)
            .map(|done| done.iter().cloned().collect())
            .unwrap_or_default();
        let Some(entries) = self.w5a.ops.get(view).filter(|entries| !entries.is_empty()) else {
            return AdminOp {
                finished,
                ..AdminOp::default()
            };
        };
        let mut ordered: Vec<&OpEntry> = entries.iter().collect();
        ordered.sort_by_key(|entry| entry.started);
        let last = ordered.last().expect("not empty");
        AdminOp {
            busy: entries.iter().any(|entry| entry.running > 0),
            upload: last.upload.as_ref().map(|(_, upload)| upload.clone()),
            error: last.error.clone(),
            action: Some(last.action.clone()),
            actions: ordered
                .iter()
                .map(|entry| AdminActionState {
                    action: entry.action.clone(),
                    busy: entry.running > 0,
                    upload: entry.upload.as_ref().map(|(_, upload)| upload.clone()),
                    error: entry.error.clone(),
                })
                .collect(),
            finished,
        }
    }

    /// A W5-A query's data changed: say which views to read again. False when it isn't W5-A's.
    pub(crate) fn w5a_query_changed(&mut self, key: &QueryKey) -> bool {
        let Some(view) = view_for(key) else {
            return false;
        };
        self.view_changed(view);
        true
    }

    /// The channel in the community's cached list, and the list's key.
    fn cached_channel(&self, channel_id: &str) -> Option<(QueryKey, wire::ChannelDto)> {
        self.cache
            .keys_with_op(keys::CHANNELS)
            .into_iter()
            .find_map(|key| {
                let channel = self
                    .cache
                    .channels(&key)?
                    .iter()
                    .find(|channel| channel.id == channel_id)?
                    .clone();
                Some((key, channel))
            })
    }

    /// Changes a community's cached channel list, as a direct update.
    fn channels_edit(
        &mut self,
        community_id: &str,
        change: impl FnOnce(&mut Vec<wire::ChannelDto>),
    ) {
        let key = keys::scoped(keys::CHANNELS, community_id);
        let Some(channels) = self.cache.channels_mut(&key) else {
            return;
        };
        change(channels);
        self.note_direct_update(&key);
        self.view_changed(ViewKey::Channels {
            community_id: community_id.to_owned(),
        });
        self.view_changed(ViewKey::Communities);
    }

    /// Changes the community in the rail's list and in its settings, as a direct update.
    fn community_edit(
        &mut self,
        community_id: &str,
        change: impl Fn(&mut wire::CommunityResponseDto),
    ) {
        let list = keys::op(keys::COMMUNITIES);
        if let Some(community) = self.cache.communities_mut(&list).and_then(|list| {
            list.iter_mut()
                .find(|community| community.id == community_id)
        }) {
            change(community);
            self.note_direct_update(&list);
            self.view_changed(ViewKey::Communities);
        }
        self.w5a_community_edit(&keys::scoped(k::COMMUNITY, community_id), |community| {
            change(community)
        });
    }

    /// A channel is gone for this user: out of its list, its own caches dropped, the call left if
    /// it's there, and `CoreEvent::ChannelRemoved` once.
    pub(crate) fn w5a_drop_channel(&mut self, community_id: &str, channel_id: &str) {
        self.channels_edit(community_id, |channels| {
            channels.retain(|channel| channel.id != channel_id)
        });
        for op in [k::PRIVATE_MEMBERS, k::WEBHOOKS] {
            self.cache.remove_prefix(&keys::scoped(op, channel_id));
        }
        if self.voice.channel_id.as_deref() == Some(channel_id) {
            self.w5a_end_call();
        }
        if self.w5a.removed_channels.insert(channel_id.to_owned()) {
            self.push_event(CoreEvent::ChannelRemoved {
                community_id: community_id.to_owned(),
                channel_id: channel_id.to_owned(),
            });
        }
    }

    /// The call ends here, as at sign-out: the server has already dropped its room.
    fn w5a_end_call(&mut self) {
        self.voice = VoiceView::default();
        self.media = None;
        self.view_changed(ViewKey::Voice);
        self.push_effect(Effect::EndCall);
    }

    /// The community is gone for this user. The one place that handles that, for every cause:
    /// W5-A's `communityDeleted` and this core's own `delete_community`, W5-B's kick and ban.
    ///
    /// Contract (stable, W5-B calls it):
    /// - leaves a channel call in this community (the server already dropped its room);
    /// - drops the community from the rail and every shared and W5-A cache keyed by it or by its
    ///   channels and mention groups (W5-B drops its own after);
    /// - with `Some(cause)`, sends `CoreEvent::CommunityRemoved { community_id, name, cause }`
    ///   with the name the rail last had, at most once until this user is added to it again
    ///   (`memberAddedToCommunity` naming them), however many events say so (#673);
    /// - with `None` (this core deleted it), announces nothing, and later calls don't either.
    ///
    /// Idempotent: a second call changes nothing more.
    pub(crate) fn w5a_drop_community(&mut self, community_id: &str, cause: Option<RemovalCause>) {
        let list = keys::op(keys::COMMUNITIES);
        let mut name = String::new();
        if let Some(communities) = self.cache.communities_mut(&list) {
            if let Some(community) = communities.iter().find(|c| c.id == community_id) {
                name = community.name.clone();
            }
            communities.retain(|community| community.id != community_id);
            self.note_direct_update(&list);
        }
        let channels_key = keys::scoped(keys::CHANNELS, community_id);
        let channel_ids: Vec<String> = self
            .cache
            .channels(&channels_key)
            .map(|channels| channels.iter().map(|channel| channel.id.clone()).collect())
            .unwrap_or_default();
        let in_call = match &self.voice.room {
            Some(VoiceRoom::Channel {
                channel_id,
                community_id: of,
            }) => {
                of.as_deref() == Some(community_id) || channel_ids.iter().any(|id| id == channel_id)
            }
            _ => false,
        };
        if in_call {
            self.w5a_end_call();
        }
        for channel_id in &channel_ids {
            // Who's in its voice channels too: Home's "In voice now" reads them.
            for op in [k::PRIVATE_MEMBERS, k::WEBHOOKS, keys::VOICE_PRESENCE] {
                self.cache.remove_prefix(&keys::scoped(op, channel_id));
            }
        }
        // Mention groups by id aren't keyed by community: drop the ones the list names.
        let groups: Vec<String> = self
            .w5a_alias_groups(&keys::scoped(k::ALIAS_GROUPS, community_id))
            .map(|groups| groups.iter().map(|group| group.id.clone()).collect())
            .unwrap_or_default();
        for group in groups {
            self.cache
                .remove_prefix(&keys::scoped(k::ALIAS_GROUP, &group));
        }
        for op in [
            keys::CHANNELS,
            keys::CAPABILITIES,
            keys::MEMBERS,
            keys::MEMBER_SEARCH,
            keys::MENTIONABLE,
            keys::EMOJIS,
            keys::SOUNDBOARD,
            k::COMMUNITY,
            k::ALIAS_GROUPS,
            k::EMOJIS,
        ] {
            self.cache.remove_prefix(&keys::scoped(op, community_id));
        }
        self.w5a_invites_edit(&keys::op(k::INVITES), |invites| {
            invites.retain(|invite| {
                !invite
                    .default_communities
                    .iter()
                    .any(|community| community.community_id == community_id)
            })
        });
        self.view_changed(ViewKey::Communities);
        self.view_changed(ViewKey::Channels {
            community_id: community_id.to_owned(),
        });
        self.view_changed(ViewKey::CommunitySettings {
            community_id: community_id.to_owned(),
        });
        let first = self.w5a.removed_communities.insert(community_id.to_owned());
        if let Some(cause) = cause
            && first
        {
            self.push_event(CoreEvent::CommunityRemoved {
                community_id: community_id.to_owned(),
                name,
                cause,
            });
        }
    }

    /// W5-A's handling of a socket event, before the shared rules (channel and community events,
    /// `channelPermissionsUpdated`, `memberAddedToCommunity`).
    pub(crate) fn w5a_event(&mut self, event: &ServerEvent, _now: u64) {
        match event {
            ServerEvent::ChannelCreated(payload) => {
                self.w5a_put_channel(&payload.community_id, payload.channel.clone());
            }
            ServerEvent::ChannelUpdated(payload) => {
                self.w5a_put_channel(&payload.community_id, payload.channel.clone());
            }
            ServerEvent::ChannelDeleted(payload) => {
                self.w5a_drop_channel(&payload.community_id, &payload.channel_id);
            }
            // Only the channels everyone can see: each takes its new place, the rest stay.
            ServerEvent::ChannelsReordered(payload) => {
                let order = payload.channels.clone();
                self.channels_edit(&payload.community_id, |channels| {
                    for channel in channels.iter_mut() {
                        if let Some(moved) = order.iter().find(|moved| moved.id == channel.id) {
                            channel.position = moved.position;
                        }
                    }
                });
            }
            ServerEvent::CommunityUpdated(payload) => {
                let payload = payload.clone();
                self.community_edit(&payload.community_id, |community| {
                    community.name = payload.name.clone();
                    community.description = payload.description.clone();
                    community.avatar = payload.avatar.clone();
                    community.banner = payload.banner.clone();
                });
            }
            // Back in the community: a later removal is announced again.
            ServerEvent::MemberAddedToCommunity(payload) if payload.user_id == self.me_id() => {
                self.w5a.removed_communities.remove(&payload.community_id);
            }
            ServerEvent::CommunityDeleted(payload) => {
                let mine = self.w5a.deleting.contains(&payload.community_id);
                self.w5a_drop_community(
                    &payload.community_id,
                    (!mine).then_some(RemovalCause::Deleted),
                );
            }
            _ => {}
        }
    }

    /// A channel as the server has it now: replaced in its list, or added.
    fn w5a_put_channel(&mut self, community_id: &str, channel: wire::ChannelDto) {
        self.channels_edit(community_id, |channels| {
            match channels.iter_mut().find(|known| known.id == channel.id) {
                Some(known) => *known = channel,
                None => channels.push(channel),
            }
        });
    }
}

/// The text fields of a community edit: what each was, and what it was set to.
#[derive(Default)]
struct CommunityText {
    name: Option<(String, String)>,
    description: Option<(Option<String>, Option<String>)>,
}

impl Core {
    /// Fetches a W5-A query, or `None` when the key isn't W5-A's.
    pub(crate) async fn w5a_fetch(&self, key: &QueryKey) -> Option<Result<CacheValue, CoreError>> {
        view_for(key)?;
        Some(self.w5a_fetch_value(key).await)
    }

    async fn w5a_fetch_value(&self, key: &QueryKey) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        let id = key.segments.get(1).cloned().unwrap_or_default();
        let failed = |error| self.backend_failed(error);
        let value = match key.op() {
            k::COMMUNITY => W5aValue::Community(
                backend
                    .community_controller_find_one(id)
                    .await
                    .map_err(failed)?,
            ),
            k::PRIVATE_MEMBERS => W5aValue::PrivateMembers(
                backend
                    .channel_membership_controller_find_all_for_channel(id)
                    .await
                    .map_err(failed)?,
            ),
            k::ALIAS_GROUPS => W5aValue::AliasGroups(
                backend
                    .alias_groups_controller_get_community_alias_groups(id)
                    .await
                    .map_err(failed)?,
            ),
            k::ALIAS_GROUP => W5aValue::AliasGroup(
                backend
                    .alias_groups_controller_get_alias_group(id)
                    .await
                    .map_err(failed)?,
            ),
            k::EMOJIS => {
                return Ok(CacheValue::Emojis(
                    backend
                        .custom_emoji_controller_list_community_emojis(id)
                        .await
                        .map_err(failed)?,
                ));
            }
            k::WEBHOOKS => W5aValue::Webhooks(
                backend
                    .webhooks_controller_find_all_for_channel(id)
                    .await
                    .map_err(failed)?,
            ),
            k::INVITES => W5aValue::Invites(
                backend
                    .invite_controller_get_invites()
                    .await
                    .map_err(failed)?,
            ),
            op => {
                return Err(CoreError::Failed {
                    message: format!("no fetch for {op}"),
                });
            }
        };
        Ok(CacheValue::W5a(value))
    }

    /// Starts a change on `view`: the services, the session, and the change's number.
    pub(crate) fn w5a_begin(
        &self,
        view: &OpKey,
        what: &str,
    ) -> Result<(Services, u64, u64), CoreError> {
        let (services, epoch) = self.begin(what)?;
        let change = self.write(|state, _| state.w5a_op_begin(view));
        Ok((services, epoch, change))
    }

    /// Refuses a change before it's sent, showing why on `view`.
    pub(crate) fn w5a_refuse<T>(&self, view: &OpKey, error: CoreError) -> Result<T, CoreError> {
        self.write(|state, _| state.w5a_op_refused(view, &error));
        Err(error)
    }

    /// Ends a change: in this session only, `apply` with the answer, or `undo` and the server's
    /// message on `view`. An answer for an ended session changes nothing and fails.
    pub(crate) fn w5a_settle<T>(
        &self,
        epoch: u64,
        view: &OpKey,
        change: u64,
        result: BackendResult<T>,
        apply: impl FnOnce(&mut State, u64, &T),
        undo: impl FnOnce(&mut State),
    ) -> Result<T, CoreError> {
        let result = result.map_err(|error: BackendError| {
            let shown = error.view();
            (shown, self.backend_failed(error))
        });
        let landed = self.write(|state, now| {
            if state.session_epoch != epoch {
                return false;
            }
            match &result {
                Ok(value) => {
                    state.w5a_op_end(view, change, None);
                    apply(state, now, value);
                }
                Err((shown, _)) => {
                    state.w5a_op_end(view, change, Some(shown.clone()));
                    undo(state);
                }
            }
            true
        });
        if !landed {
            return Err(CoreError::Failed {
                message: "signed out".into(),
            });
        }
        result.map_err(|(_, error)| error)
    }

    /// Uploads a file for a change on `view`, its progress in that view's `AdminOp::upload`, and
    /// returns its id.
    pub(crate) async fn w5a_upload(
        &self,
        services: &Services,
        view: &OpKey,
        change: u64,
        file: DraftFile,
        resource_type: ResourceType,
        resource_id: &str,
    ) -> BackendResult<String> {
        let total = file.bytes.len() as u64;
        self.write(|state, _| {
            state.w5a_entry(view).upload = Some((
                change,
                UploadView {
                    name: file.name.clone(),
                    size_bytes: total,
                    sent_bytes: 0,
                    failed: None,
                },
            ));
            state.view_changed(view.view.clone());
        });
        let core = self.clone();
        let progress_view = view.clone();
        let progress: UploadProgress = Arc::new(move |sent| {
            core.write(|state, _| {
                let entry = state.w5a_entry(&progress_view);
                if let Some((of, upload)) = &mut entry.upload
                    && *of == change
                {
                    upload.sent_bytes = sent.min(total);
                    state.view_changed(progress_view.view.clone());
                }
            });
        });
        let upload = FileUpload {
            filename: file.name,
            mime_type: file.mime_type,
            bytes: Arc::new(file.bytes),
            resource_type,
            resource_id: Some(resource_id.to_owned()),
        };
        services
            .backend
            .file_upload_controller_upload_file(upload, progress)
            .await
            .map(|uploaded| uploaded.id)
    }

    /// The overview tab (`ViewKey::CommunitySettings`). The rail's row fills it while the
    /// community itself loads.
    pub fn community_settings(&self, community_id: String) -> CommunitySettingsView {
        self.write(|state, now| {
            let key = keys::scoped(k::COMMUNITY, &community_id);
            state.w5a_ensure(&key, now, false);
            let view = ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            };
            let community = state.w5a_community(&key).cloned().or_else(|| {
                state
                    .cache
                    .communities(&keys::op(keys::COMMUNITIES))?
                    .iter()
                    .find(|community| community.id == community_id)
                    .cloned()
            });
            let mut settings = CommunitySettingsView {
                state: state.query_load_state(&key),
                op: state.w5a_op(&view),
                community_id,
                ..Default::default()
            };
            if let Some(community) = community {
                settings.name = community.name;
                settings.description = non_empty(community.description.as_ref());
                settings.avatar_file_id = non_empty(community.avatar.as_ref());
                settings.banner_file_id = non_empty(community.banner.as_ref());
            }
            settings
        })
    }

    /// Changes the name, description, avatar or banner. Images go up first (progress in the
    /// view's `op.upload`), then one update. The text shows at once and goes back if the server
    /// refuses; images show once it agrees.
    pub async fn update_community(
        &self,
        community_id: String,
        patch: CommunityPatch,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            },
            AdminActionKind::UpdateCommunity,
            Some(community_id.clone()),
        );
        let name = patch
            .name
            .as_deref()
            .map(|name| name.trim().parse::<wire::UpdateCommunityDtoName>())
            .transpose()
            .map_err(|_| invalid("name"));
        let description = patch
            .description
            .as_deref()
            .map(|text| text.trim().parse::<wire::UpdateCommunityDtoDescription>())
            .transpose()
            .map_err(|_| invalid("description"));
        let (name, description) = match (name, description) {
            (Ok(name), Ok(description)) => (name, description),
            (Err(error), _) | (_, Err(error)) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "updating a community")?;
        let written = self.write(|state, _| {
            let current = state
                .w5a_community(&keys::scoped(k::COMMUNITY, &community_id))
                .cloned()
                .or_else(|| {
                    state
                        .cache
                        .communities(&keys::op(keys::COMMUNITIES))?
                        .iter()
                        .find(|community| community.id == community_id)
                        .cloned()
                });
            let mut written = CommunityText::default();
            if let Some(current) = current {
                if let Some(name) = &name {
                    written.name = Some((current.name.clone(), name.to_string()));
                }
                if let Some(description) = &description {
                    written.description =
                        Some((current.description.clone(), Some(description.to_string())));
                }
            }
            state.community_edit(&community_id, |community| {
                if let Some((_, new)) = &written.name {
                    community.name = new.clone();
                }
                if let Some((_, new)) = &written.description {
                    community.description = new.clone();
                }
            });
            written
        });
        let undo = |state: &mut State| {
            state.community_edit(&community_id, |community| {
                if let Some((old, new)) = &written.name
                    && community.name == *new
                {
                    community.name = old.clone();
                }
                if let Some((old, new)) = &written.description
                    && community.description == *new
                {
                    community.description = old.clone();
                }
            });
        };

        let mut images: [Option<String>; 2] = [None, None];
        let mut upload_failed = None;
        for (slot, image, resource_type) in [
            (0, &patch.avatar, ResourceType::CommunityAvatar),
            (1, &patch.banner, ResourceType::CommunityBanner),
        ] {
            match image {
                None => {}
                Some(ImageChange::Remove) => images[slot] = Some(String::new()),
                Some(ImageChange::Set { file }) => match self
                    .w5a_upload(
                        &services,
                        &view,
                        change,
                        file.clone(),
                        resource_type,
                        &community_id,
                    )
                    .await
                {
                    Ok(id) => images[slot] = Some(id),
                    Err(error) => {
                        upload_failed = Some(error);
                        break;
                    }
                },
            }
        }
        let [avatar, banner] = images;
        let result = match upload_failed {
            Some(error) => Err(error),
            None => {
                services
                    .backend
                    .community_controller_update(
                        community_id.clone(),
                        wire::UpdateCommunityDto {
                            avatar,
                            banner,
                            description,
                            name,
                        },
                    )
                    .await
            }
        };
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, now, updated| {
                let key = keys::scoped(k::COMMUNITY, &community_id);
                state.note_direct_update(&key);
                state.cache.set(
                    key.clone(),
                    CacheValue::W5a(W5aValue::Community(updated.clone())),
                    now,
                );
                state.view_changed(view.view.clone());
                state.community_edit(&community_id, |community| *community = updated.clone());
            },
            undo,
        )
        .map(|_| ())
    }

    /// Deletes the community for everyone. It goes from this core at once; `communityDeleted`
    /// then removes it from the others.
    pub async fn delete_community(&self, community_id: String) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            },
            AdminActionKind::DeleteCommunity,
            Some(community_id.clone()),
        );
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a community")?;
        self.write(|state, _| state.w5a.deleting.insert(community_id.clone()));
        let result = services
            .backend
            .community_controller_remove(community_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.w5a_drop_community(&community_id, None),
            |state| {
                state.w5a.deleting.remove(&community_id);
            },
        )
    }

    /// Makes a channel; returns its id. It joins the community's list once the server agrees.
    pub async fn create_channel(
        &self,
        community_id: String,
        draft: ChannelDraft,
    ) -> Result<String, CoreError> {
        let view = OpKey::new(
            ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            },
            AdminActionKind::CreateChannel,
            None,
        );
        let body = (|| {
            Ok(wire::CreateChannelDto {
                community_id: uuid(&community_id, "the community")?,
                is_private: draft.is_private,
                name: draft
                    .name
                    .trim()
                    .parse()
                    .map_err(|_| invalid("channel name"))?,
                position: None,
                slowmode_seconds: Some(i64::from(draft.slowmode_seconds)),
                type_: wire_kind(draft.kind).ok_or_else(|| invalid("channel kind"))?,
            })
        })();
        let body = match body {
            Ok(body) => body,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "creating a channel")?;
        let result = services.backend.channels_controller_create(body).await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, channel| state.w5a_put_channel(&community_id, channel.clone()),
            |_| {},
        )
        .map(|channel| channel.id)
    }

    /// Changes a channel's name, privacy and slow mode (its kind stays). Only what differs from
    /// the cached channel is sent; it shows at once and goes back if the server refuses.
    /// Changing privacy needs MANAGE_CHANNEL_PERMISSIONS too.
    pub async fn update_channel(
        &self,
        channel_id: String,
        draft: ChannelDraft,
    ) -> Result<(), CoreError> {
        let cached = self.read(|state| state.cached_channel(&channel_id));
        let community_id = cached
            .as_ref()
            .map(|(_, channel)| channel.community_id.clone())
            .unwrap_or_default();
        let view = OpKey::new(
            ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            },
            AdminActionKind::UpdateChannel,
            Some(channel_id.clone()),
        );
        let name = draft.name.trim().to_owned();
        let slowmode = i64::from(draft.slowmode_seconds);
        let old = cached.map(|(_, channel)| channel);
        let differs = |same: bool| old.is_none() || !same;
        let body = wire::UpdateChannelDto {
            name: match differs(old.as_ref().is_some_and(|old| old.name == name)) {
                true => match name.parse() {
                    Ok(name) => Some(name),
                    Err(_) => return self.w5a_refuse(&view, invalid("channel name")),
                },
                false => None,
            },
            is_private: differs(
                old.as_ref()
                    .is_some_and(|old| old.is_private == draft.is_private),
            )
            .then_some(draft.is_private),
            slowmode_seconds: differs(
                old.as_ref()
                    .is_some_and(|old| old.slowmode_seconds == slowmode),
            )
            .then_some(slowmode),
            position: None,
        };
        let (services, epoch, change) = self.w5a_begin(&view, "updating a channel")?;
        let written = (
            body.name.as_ref().map(|_| name.clone()),
            body.is_private,
            body.slowmode_seconds,
        );
        self.write(|state, _| {
            state.channels_edit(&community_id, |channels| {
                if let Some(channel) = channels.iter_mut().find(|c| c.id == channel_id) {
                    if let Some(name) = &written.0 {
                        channel.name = name.clone();
                    }
                    if let Some(private) = written.1 {
                        channel.is_private = private;
                    }
                    if let Some(slowmode) = written.2 {
                        channel.slowmode_seconds = slowmode;
                    }
                }
            })
        });
        let result = services
            .backend
            .channels_controller_update(channel_id.clone(), body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, channel| state.w5a_put_channel(&channel.community_id, channel.clone()),
            |state| {
                let Some(old) = &old else { return };
                state.channels_edit(&community_id, |channels| {
                    if let Some(channel) = channels.iter_mut().find(|c| c.id == channel_id) {
                        if written.0.as_ref().is_some_and(|name| channel.name == *name) {
                            channel.name = old.name.clone();
                        }
                        if written.1 == Some(channel.is_private) {
                            channel.is_private = old.is_private;
                        }
                        if written.2 == Some(channel.slowmode_seconds) {
                            channel.slowmode_seconds = old.slowmode_seconds;
                        }
                    }
                })
            },
        )
        .map(|_| ())
    }

    /// Deletes a channel: it leaves the list at once, and comes back if the server refuses.
    pub async fn delete_channel(&self, channel_id: String) -> Result<(), CoreError> {
        let cached = self.read(|state| state.cached_channel(&channel_id));
        let community_id = cached
            .as_ref()
            .map(|(_, channel)| channel.community_id.clone())
            .unwrap_or_default();
        let view = OpKey::new(
            ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            },
            AdminActionKind::DeleteChannel,
            Some(channel_id.clone()),
        );
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a channel")?;
        let index = self.write(|state, _| {
            let key = keys::scoped(keys::CHANNELS, &community_id);
            let index = state
                .cache
                .channels(&key)
                .and_then(|channels| channels.iter().position(|c| c.id == channel_id));
            state.channels_edit(&community_id, |channels| {
                channels.retain(|channel| channel.id != channel_id)
            });
            index
        });
        let result = services
            .backend
            .channels_controller_remove(channel_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.w5a_drop_channel(&community_id, &channel_id),
            |state| {
                let (Some((_, channel)), Some(index)) = (cached, index) else {
                    return;
                };
                state.channels_edit(&community_id, |channels| {
                    if !channels.iter().any(|c| c.id == channel.id) {
                        channels.insert(index.min(channels.len()), channel);
                    }
                })
            },
        )
    }

    /// Moves a channel one place up or down among those of its kind. The swap shows at once; the
    /// server's answer is the community's list in its new order.
    pub async fn move_channel(
        &self,
        channel_id: String,
        step: ChannelMove,
    ) -> Result<(), CoreError> {
        let cached = self.read(|state| state.cached_channel(&channel_id));
        let community_id = cached
            .as_ref()
            .map(|(_, channel)| channel.community_id.clone())
            .unwrap_or_default();
        let view = OpKey::new(
            ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            },
            AdminActionKind::MoveChannel,
            Some(channel_id.clone()),
        );
        let body = match uuid(&community_id, "the channel's community") {
            Ok(id) => wire::MoveChannelDto { community_id: id },
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "moving a channel")?;
        // (id, from, to) for the channel and the one it swaps with.
        let swapped: Vec<(String, i64, i64)> = self.write(|state, _| {
            let key = keys::scoped(keys::CHANNELS, &community_id);
            let Some(channels) = state.cache.channels(&key) else {
                return Vec::new();
            };
            let Some(me) = channels.iter().find(|c| c.id == channel_id) else {
                return Vec::new();
            };
            let same_kind = channels
                .iter()
                .filter(|c| c.type_ == me.type_ && c.id != me.id);
            let neighbour = match step {
                ChannelMove::Up => same_kind
                    .filter(|c| c.position < me.position)
                    .max_by_key(|c| c.position),
                ChannelMove::Down => same_kind
                    .filter(|c| c.position > me.position)
                    .min_by_key(|c| c.position),
            };
            let Some(other) = neighbour else {
                return Vec::new();
            };
            let swapped = vec![
                (me.id.clone(), me.position, other.position),
                (other.id.clone(), other.position, me.position),
            ];
            state.channels_edit(&community_id, |channels| {
                for (id, _, to) in &swapped {
                    if let Some(channel) = channels.iter_mut().find(|c| c.id == *id) {
                        channel.position = *to;
                    }
                }
            });
            swapped
        });
        let result = match step {
            ChannelMove::Up => {
                services
                    .backend
                    .channels_controller_move_up(channel_id.clone(), body)
                    .await
            }
            ChannelMove::Down => {
                services
                    .backend
                    .channels_controller_move_down(channel_id.clone(), body)
                    .await
            }
        };
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, channels| {
                let order = channels.clone();
                state.channels_edit(&community_id, |cached| *cached = order);
            },
            |state| {
                state.channels_edit(&community_id, |channels| {
                    for (id, from, to) in &swapped {
                        if let Some(channel) = channels.iter_mut().find(|c| c.id == *id)
                            && channel.position == *to
                        {
                            channel.position = *from;
                        }
                    }
                })
            },
        )
        .map(|_| ())
    }

    /// A private channel's members (`ViewKey::PrivateMembers`).
    pub fn private_members(&self, channel_id: String) -> PrivateMembersView {
        self.write(|state, now| {
            let key = keys::scoped(k::PRIVATE_MEMBERS, &channel_id);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::PrivateMembers {
                channel_id: channel_id.clone(),
            };
            PrivateMembersView {
                state: state.query_load_state(&key),
                members: state
                    .w5a_private_members(&key)
                    .map(|members| {
                        members
                            .iter()
                            .map(|member| PrivateMemberRow {
                                user: member
                                    .user
                                    .as_ref()
                                    .map(user_view)
                                    .unwrap_or_else(|| state.user_or_stub(&member.user_id)),
                                joined_at_ms: member.joined_at.timestamp_millis(),
                                added_by: member.added_by.clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                op: state.w5a_op(&view),
                channel_id,
            }
        })
    }

    pub async fn add_private_member(
        &self,
        channel_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::PrivateMembers {
                channel_id: channel_id.clone(),
            },
            AdminActionKind::AddPrivateMember,
            Some(user_id.clone()),
        );
        let body = match (uuid(&channel_id, "the channel"), uuid(&user_id, "the user")) {
            (Ok(channel), Ok(user)) => wire::CreateChannelMembershipDto {
                channel_id: channel,
                user_id: user,
            },
            (Err(error), _) | (_, Err(error)) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "adding a private channel member")?;
        let result = services
            .backend
            .channel_membership_controller_create(body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, member| {
                let key = keys::scoped(k::PRIVATE_MEMBERS, &channel_id);
                state.w5a_private_members_edit(&key, |members| {
                    if !members.iter().any(|known| known.user_id == member.user_id) {
                        members.push(member.clone());
                    }
                });
                // The answer names no user: read the list again for theirs.
                state.w5a_reread(&key);
            },
            |_| {},
        )
        .map(|_| ())
    }

    /// Removes a member from a private channel: gone at once, back if the server refuses.
    pub async fn remove_private_member(
        &self,
        channel_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::PrivateMembers {
                channel_id: channel_id.clone(),
            },
            AdminActionKind::RemovePrivateMember,
            Some(user_id.clone()),
        );
        let (services, epoch, change) =
            self.w5a_begin(&view, "removing a private channel member")?;
        let key = keys::scoped(k::PRIVATE_MEMBERS, &channel_id);
        let removed = self.write(|state, _| {
            state
                .w5a_private_members_edit(&key, |members| {
                    let index = members.iter().position(|m| m.user_id == user_id)?;
                    Some((index, members.remove(index)))
                })
                .flatten()
        });
        let result = services
            .backend
            .channel_membership_controller_remove(channel_id.clone(), user_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.w5a_reread(&key),
            |state| {
                let Some((index, member)) = removed else {
                    return;
                };
                state.w5a_private_members_edit(&key, |members| {
                    if !members.iter().any(|m| m.user_id == member.user_id) {
                        members.insert(index.min(members.len()), member);
                    }
                });
            },
        )
    }

    /// Users on the instance who aren't members yet, to add (`userControllerSearchUsers` with the
    /// community, not the web's admin-only user list). Never this user.
    pub async fn search_users_to_add(
        &self,
        community_id: String,
        query: String,
    ) -> Result<Vec<UserView>, CoreError> {
        let (services, epoch) = self.begin("searching users to add")?;
        let users = services
            .backend
            .user_controller_search_users(
                Some(community_id),
                Some(ADD_SEARCH_LIMIT),
                query.trim().to_owned(),
            )
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.same_session(epoch)?;
        let me = self.read(|state| state.me_id().to_owned());
        Ok(users
            .iter()
            .filter(|user| user.id != me)
            .map(user_view)
            .collect())
    }

    /// Adds a user to the community. The member list reads again.
    pub async fn add_member(&self, community_id: String, user_id: String) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::CommunitySettings {
                community_id: community_id.clone(),
            },
            AdminActionKind::AddMember,
            Some(user_id.clone()),
        );
        let body = match (
            uuid(&community_id, "the community"),
            uuid(&user_id, "the user"),
        ) {
            (Ok(community), Ok(user)) => wire::CreateMembershipDto {
                community_id: community,
                user_id: user,
            },
            (Err(error), _) | (_, Err(error)) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "adding a member")?;
        let result = services.backend.membership_controller_create(body).await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| {
                state.w5a_reread(&keys::scoped(keys::MEMBERS, &community_id));
            },
            |_| {},
        )
        .map(|_| ())
    }
}
