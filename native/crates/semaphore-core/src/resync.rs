//! What to refetch after a gap, from the web client's `handleReconnect` table, including the reset
//! for a window detached from the live edge.
//!
//! The server has no event sequence numbers, so anything cached before a gap may have missed
//! events. `RealtimeEvent::Resumed` is the one exception: the socket survived, so nothing was lost.
//!
//! The web refetches every page of a window and swaps them in. Here a refetch merges by id instead,
//! so each surviving row keeps its `seq`, and a selection survives a reconnect.

use crate::cache::{QueryKey, keys};
use crate::client::{Core, Effect, State, window_key};
use crate::model::{Conversation, ViewKey};
use crate::platform::CoreError;
use crate::store::{MAX_ROWS, PAGE_SIZE, ResyncOutcome, THREAD_PAGE_SIZE};
use semaphore_wire::enums::MessagePageDirection;
use semaphore_wire::types::MessageDto;

/// `handleReconnect`'s queries, besides the message windows. `fixtures/cache/socket-rules.json`
/// is the web's list, and a test holds this to it.
pub const RECONNECT_INVALIDATES: &[&str] = &[
    "dmVoicePresenceControllerGetDmPresence",
    "notificationsControllerGetNotifications",
    "notificationsControllerGetUnreadCount",
    "readReceiptsControllerGetDmPeerReads",
    "readReceiptsControllerGetUnreadCounts",
    "voicePresenceControllerGetChannelPresence",
];

/// What the web keeps fresh some other way, and this client caches: both miss events during a gap.
const NATIVE_RECONNECT_INVALIDATES: &[&str] = &[keys::MEMBERS, keys::PRESENCE];

/// Fetched again at once on reconnect, used or not: no view's read asks for these (the call bar
/// and an incoming ring read DM call presence straight from the cache), so a stale one would stay.
const RECONNECT_FETCHES_NOW: &[&str] = &[keys::DM_VOICE_PRESENCE];

/// The most pages a resync reads looking for where the loaded rows begin: the web's page cap.
const MAX_RESYNC_PAGES: usize = MAX_ROWS / PAGE_SIZE as usize;

impl State {
    /// A connection came back after a gap. Returns what it marked.
    pub fn start_resync(&mut self) -> Vec<QueryKey> {
        let mut marked = Vec::new();
        // As TanStack Query's `invalidateQueries` does for queries with no active observer: they
        // go stale and are fetched when next read. Every view that reads one is told to read
        // again, so what is on screen is fetched now, and nothing else is.
        for op in RECONNECT_INVALIDATES
            .iter()
            .chain(NATIVE_RECONNECT_INVALIDATES)
            .filter(|op| !RECONNECT_FETCHES_NOW.contains(op))
        {
            marked.extend(self.mark_stale(&keys::op(op)));
        }
        for op in RECONNECT_FETCHES_NOW
            .iter()
            // W5-A's views without socket events, as that lane asked.
            .chain(crate::commands::community_admin::admin_keys::RECONNECT)
            // W6's views without socket events, per lane.
            .chain(
                crate::commands::instance_admin::RECONNECT
                    .iter()
                    .copied()
                    .flatten(),
            )
        {
            marked.extend(self.invalidate(&keys::op(op)));
        }
        let conversations: Vec<Conversation> = self.windows.keys().cloned().collect();
        for conversation in conversations {
            marked.push(window_key(&conversation));
            self.mark_window_stale(&conversation);
        }
        self.note_invalidated(marked.clone());
        marked
    }

    /// Marks matching queries stale without fetching them, and tells the views that read them.
    /// A fetch already on its way is marked dirty, so it is fetched again when it lands.
    fn mark_stale(&mut self, prefix: &QueryKey) -> Vec<QueryKey> {
        let marked = self.cache.invalidate_prefix(prefix);
        for key in &marked {
            if let Some(dirty) = self.fetching.get_mut(key) {
                *dirty = true;
            }
            for view in self.views_reading(key) {
                self.view_changed(view);
            }
        }
        marked
    }

    /// The views whose reads ask for the reconnect table's queries.
    fn views_reading(&self, key: &QueryKey) -> Vec<ViewKey> {
        let community_views = || {
            self.cache
                .keys_with_op(keys::CHANNELS)
                .into_iter()
                .filter_map(|key| key.segments.get(1).cloned())
                .map(|community_id| ViewKey::Channels { community_id })
        };
        match key.op() {
            keys::VOICE_PRESENCE => {
                let channel_id = key.segments.get(1).map(String::as_str).unwrap_or_default();
                let community = self
                    .cache
                    .keys_with_op(keys::CHANNELS)
                    .into_iter()
                    .find(|key| {
                        self.cache
                            .channels(key)
                            .is_some_and(|channels| channels.iter().any(|c| c.id == channel_id))
                    });
                let mut views = vec![ViewKey::Voice];
                views.extend(
                    community
                        .and_then(|key| key.segments.get(1).cloned())
                        .map(|community_id| ViewKey::Channels { community_id }),
                );
                views
            }
            keys::UNREAD => {
                let mut views = vec![ViewKey::Communities, ViewKey::Rail, ViewKey::DirectMessages];
                views.extend(community_views());
                views
            }
            keys::NOTIFICATION_COUNT => vec![ViewKey::Badge, ViewKey::Rail],
            keys::NOTIFICATIONS => vec![ViewKey::Notifications],
            keys::MEMBERS => key
                .segments
                .get(1)
                .cloned()
                .map(|community_id| ViewKey::Members { community_id })
                .into_iter()
                .collect(),
            keys::PRESENCE => {
                let mut views = vec![ViewKey::DirectMessages, ViewKey::Friends];
                views.extend(
                    self.cache
                        .keys_with_op(keys::MEMBERS)
                        .into_iter()
                        .filter_map(|key| key.segments.get(1).cloned())
                        .map(|community_id| ViewKey::Members { community_id }),
                );
                views
            }
            _ => Vec::new(),
        }
    }

    /// A window that may have missed events. A window detached from the live edge can't be recovered
    /// by a refetch, because its cursors no longer include the edge, so it's reset. One not on
    /// screen waits until it's opened.
    pub fn mark_window_stale(&mut self, conversation: &Conversation) {
        let on_screen = self.is_on_screen(conversation);
        let Some(window) = self.windows.get_mut(conversation) else {
            return;
        };
        if !window.is_loaded() {
            return;
        }
        window.stale = true;
        if !on_screen {
            return;
        }
        if window.is_detached_from_live_edge() {
            self.request_reset(conversation);
        } else {
            self.push_effect(Effect::ResyncWindow(conversation.clone()));
        }
    }

    /// Back to the live edge, unless a selection holds these rows: then when it lets go.
    pub fn request_reset(&mut self, conversation: &Conversation) {
        let Some(window) = self.windows.get_mut(conversation) else {
            return;
        };
        if window.is_held() {
            window.reset_deferred = true;
        } else {
            self.push_effect(Effect::ResetWindow(conversation.clone()));
        }
    }
}

impl Core {
    /// A page of a conversation, newest first. A thread's replies come oldest first with a forward
    /// cursor, so they're not a page of this kind: see [`Core::fetch_thread`].
    pub(crate) async fn fetch_page(
        &self,
        conversation: &Conversation,
        token: Option<String>,
    ) -> Result<(Vec<MessageDto>, Option<String>), CoreError> {
        self.fetch_page_toward(conversation, token, None).await
    }

    /// As [`Core::fetch_page`], in a direction. Rows come newest first either way.
    pub(crate) async fn fetch_page_toward(
        &self,
        conversation: &Conversation,
        token: Option<String>,
        direction: Option<MessagePageDirection>,
    ) -> Result<(Vec<MessageDto>, Option<String>), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("the backend"))?;
        let page = match conversation {
            Conversation::Channel { id } => {
                services
                    .backend
                    .messages_controller_find_all_for_channel(
                        id.clone(),
                        token,
                        direction,
                        Some(PAGE_SIZE),
                    )
                    .await
            }
            Conversation::DirectMessage { id } => {
                services
                    .backend
                    .messages_controller_find_all_for_group(
                        id.clone(),
                        token,
                        direction,
                        Some(PAGE_SIZE),
                    )
                    .await
            }
            Conversation::Thread { .. } => {
                return Err(CoreError::Failed {
                    message: "a thread has no pages".into(),
                });
            }
        }
        .map_err(|error| self.backend_failed(error))?;
        // An empty string and no token both mean the start.
        let token = page.continuation_token.filter(|token| !token.is_empty());
        Ok((page.messages, token))
    }

    /// Every reply in a thread, up to the row cap, oldest first.
    pub(crate) async fn fetch_thread(&self, parent: &str) -> Result<Vec<MessageDto>, CoreError> {
        let services = self.services().ok_or_else(|| unavailable("the backend"))?;
        let mut replies = Vec::new();
        let mut token = None;
        loop {
            let page = services
                .backend
                .threads_controller_get_replies(parent.to_owned(), token, Some(THREAD_PAGE_SIZE))
                .await
                .map_err(|error| self.backend_failed(error))?;
            replies.extend(page.replies);
            token = page.continuation_token.filter(|token| !token.is_empty());
            if token.is_none() || replies.len() >= MAX_ROWS {
                return Ok(replies);
            }
        }
    }

    /// Replaces a window with the live edge. Seqs don't carry over: this is the reset the model
    /// warns about, so nothing does it while a span is held.
    pub(crate) async fn reset_window(&self, conversation: Conversation) {
        if let Err(error) = self.load_live_edge(&conversation).await {
            log::warn!("resetting {conversation:?} failed: {error}");
        }
    }

    pub(crate) async fn load_live_edge(
        &self,
        conversation: &Conversation,
    ) -> Result<(), CoreError> {
        let begun = self.write(|state, _| {
            let window = state.windows.entry(conversation.clone()).or_default();
            if window.is_held() {
                window.reset_deferred = true;
                return None;
            }
            Some(window.begin_fetch())
        });
        let Some(epoch) = begun else {
            return Ok(());
        };
        let result = match conversation {
            Conversation::Thread { parent_message_id } => self
                .fetch_thread(parent_message_id)
                .await
                .map(|replies| (replies, None, true)),
            _ => self
                .fetch_page(conversation, None)
                .await
                .map(|(page, token)| (page, token, false)),
        };
        self.write(|state, _| {
            let Some(window) = state.windows.get_mut(conversation) else {
                return;
            };
            if let Ok((rows, token, is_thread)) = &result
                && window.epoch == epoch
            {
                if *is_thread {
                    window.apply_thread(rows.clone());
                } else {
                    window.apply_live_page(rows.clone(), token.clone());
                }
            }
            window.end_fetch();
        });
        result.map(|_| ())
    }

    /// Reads from the live edge down to where the loaded rows begin, then merges.
    pub(crate) async fn resync_window(&self, conversation: Conversation) {
        let begun = self.write(|state, _| {
            let window = state.windows.get_mut(&conversation)?;
            window.is_loaded().then(|| {
                let epoch = window.begin_fetch();
                (epoch, window.oldest_settled_id().map(str::to_owned))
            })
        });
        let Some((epoch, oldest)) = begun else {
            return;
        };
        let fetched = self.fetch_until(&conversation, oldest.as_deref()).await;
        self.write(|state, _| {
            let held = {
                let Some(window) = state.windows.get_mut(&conversation) else {
                    return;
                };
                if let Ok((rows, token, reaches_oldest)) = &fetched
                    && window.epoch == epoch
                {
                    match window.apply_resync(rows.clone(), *reaches_oldest) {
                        ResyncOutcome::Merged => false,
                        ResyncOutcome::NeedsReset if window.is_held() => true,
                        ResyncOutcome::NeedsReset => {
                            window.apply_live_page(rows.clone(), token.clone());
                            false
                        }
                    }
                } else {
                    false
                }
            };
            if held {
                // The gap is too big to bridge, and these rows can't go yet. Treat them as the
                // detached rows they are: nothing new lands here until the reset.
                if let Some(window) = state.windows.get_mut(&conversation) {
                    window.mark_detached();
                }
                state.request_reset(&conversation);
            }
            if let Some(window) = state.windows.get_mut(&conversation) {
                window.end_fetch();
            }
        });
        if let Err(error) = fetched {
            log::warn!("resync of {conversation:?} failed: {error}");
        }
    }

    /// `(rows newest first, the token after them, whether they reach the oldest loaded row)`.
    async fn fetch_until(
        &self,
        conversation: &Conversation,
        oldest: Option<&str>,
    ) -> Result<(Vec<MessageDto>, Option<String>, bool), CoreError> {
        if let Conversation::Thread { parent_message_id } = conversation {
            let mut replies = self.fetch_thread(parent_message_id).await?;
            replies.reverse();
            return Ok((replies, None, true));
        }
        let mut rows = Vec::new();
        let mut token = None;
        for _ in 0..MAX_RESYNC_PAGES {
            let (page, next) = self.fetch_page(conversation, token).await?;
            rows.extend(page);
            token = next;
            let reached = oldest.is_some_and(|id| rows.iter().any(|row| row.id == id));
            if reached || token.is_none() {
                return Ok((rows, token, true));
            }
        }
        Ok((rows, token, false))
    }
}

pub(crate) fn unavailable(what: &str) -> CoreError {
    CoreError::Unavailable { what: what.into() }
}

pub(crate) fn failed(error: crate::backend::BackendError) -> CoreError {
    CoreError::Failed {
        message: error.to_string(),
    }
}
