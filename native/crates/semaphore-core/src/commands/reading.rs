//! Finding and following messages: thread info and subscriptions, search, the unread divider and
//! message links. Unit W1-core part B.

use crate::cache::{QueryKey, keys};
use crate::client::{Core, State};
use crate::model::{
    Conversation, DmPeerReadsView, ErrorView, LoadState, PeerReadView, SearchHit,
    SearchResultsView, SearchScope, SeenByView, ThreadInfo, UnreadMarker, UserView, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use crate::store::{Row, StoredMessage, project};
use semaphore_wire::types as wire;
use std::collections::{HashMap, HashSet};

/// The error code a missing thread or message comes back with.
pub const NOT_FOUND: &str = "NOT_FOUND";
/// How many hits one search page asks for: the server's own default.
pub const SEARCH_PAGE: u32 = 50;
/// How many readers a "seen by" names before counting the rest: the web's `MAX_TOOLTIP_READERS`.
pub const SEEN_BY_NAMES: usize = 15;

/// What these commands keep between calls. Forgotten at sign-out.
#[derive(Debug, Default)]
pub(crate) struct ReadingState {
    /// The divider for each conversation, as it was when it opened. `None`: no divider.
    markers: HashMap<Conversation, Option<Snapshot>>,
    /// Opened before the unread counts arrived: their snapshot waits for them.
    awaiting_counts: HashSet<Conversation>,
    /// A subscription change on its way, by parent: the value shown meanwhile, and which change.
    optimistic: HashMap<String, (bool, u64)>,
    /// The server signed in to, which message links must point at.
    pub server_url: Option<String>,
    /// Searches whose next page is on its way, by key.
    pub search_loading: HashSet<QueryKey>,
}

#[derive(Debug, Clone)]
struct Snapshot {
    after_message_id: String,
    unread_count: u32,
    mention_count: u32,
}

fn meta_key(parent_message_id: &str) -> QueryKey {
    keys::scoped(keys::THREAD_META, parent_message_id)
}

/// A failure as a UI shows it. Core's errors carry the server's code at the front of the
/// message (`NOT_FOUND (404): ...`), so a missing thread reads as `NOT_FOUND`, not `FAILED`.
fn with_server_code(mut error: ErrorView) -> ErrorView {
    if error.message.starts_with(&format!("{NOT_FOUND} (")) {
        error.code = NOT_FOUND.into();
        error.retryable = false;
    }
    error
}

impl State {
    /// A conversation is about to open: called before it becomes the one on screen. A thread
    /// reads its metadata, again if cached (no event says another device changed the subscription). A
    /// channel or DM newly opened takes its divider from the unread counts as they are now,
    /// before any read mark from this visit can change them.
    pub(crate) fn reading_opened(&mut self, conversation: &Conversation) {
        self.w2_auto_read(conversation);
        match conversation {
            Conversation::Thread { parent_message_id } => {
                let key = meta_key(parent_message_id);
                self.failed_queries.remove(&key);
                if self.cache.get(&key).is_some() {
                    self.invalidate(&key);
                } else {
                    self.ensure_query(key);
                }
            }
            _ if self.main_conversation.as_ref() == Some(conversation) => {}
            _ => self.snapshot_marker(conversation),
        }
    }

    /// The unread counts arrived: conversations opened before them take their divider now.
    pub(crate) fn reading_counts_arrived(&mut self) {
        let waiting: Vec<Conversation> = self.reading.awaiting_counts.drain().collect();
        for conversation in waiting {
            self.snapshot_marker(&conversation);
        }
    }

    fn snapshot_marker(&mut self, conversation: &Conversation) {
        let context_id = match conversation {
            Conversation::Channel { id } | Conversation::DirectMessage { id } => id,
            Conversation::Thread { .. } => return,
        };
        let Some(counts) = self.cache.unread_counts(&keys::op(keys::UNREAD)) else {
            self.reading.markers.remove(conversation);
            self.reading.awaiting_counts.insert(conversation.clone());
            return;
        };
        let snapshot = counts
            .iter()
            .find(|count| {
                count.channel_id.as_deref() == Some(context_id)
                    || count.direct_message_group_id.as_deref() == Some(context_id)
            })
            .filter(|count| count.unread_count > 0)
            .and_then(|count| {
                Some(Snapshot {
                    after_message_id: count.last_read_message_id.clone()?,
                    unread_count: count.unread_count.max(0) as u32,
                    mention_count: count.mention_count.max(0) as u32,
                })
            });
        self.reading.awaiting_counts.remove(conversation);
        self.reading.markers.insert(conversation.clone(), snapshot);
        self.view_changed(ViewKey::UnreadMarker {
            conversation: conversation.clone(),
        });
    }

    /// My own reply: the server subscribes the replier, and counted it. The count is read again,
    /// so the parent's row and the thread's header agree even without a count event.
    pub(crate) fn reading_my_reply(&mut self, parent_message_id: &str) {
        let key = meta_key(parent_message_id);
        self.note_direct_update(&key);
        if let Some(meta) = self.cache.thread_meta_mut(&key) {
            meta.is_subscribed = true;
        }
        self.view_changed(ViewKey::Thread {
            parent_message_id: parent_message_id.to_owned(),
        });
        if self.invalidate(&key).is_empty() {
            self.ensure_query(key);
        }
    }

    /// `threadReplyCountUpdated`: the header's count follows, and so does the parent's row
    /// wherever it's loaded (any window, a channel's cached pins).
    pub(crate) fn reading_reply_count(
        &mut self,
        parent_message_id: &str,
        reply_count: i64,
        last_reply_at: Option<chrono::DateTime<chrono::Utc>>,
    ) {
        let key = meta_key(parent_message_id);
        self.note_direct_update(&key);
        if let Some(meta) = self.cache.thread_meta_mut(&key) {
            meta.reply_count = reply_count;
            meta.last_reply_at = last_reply_at;
            self.view_changed(ViewKey::Thread {
                parent_message_id: parent_message_id.to_owned(),
            });
        }
        self.parent_rows_follow(parent_message_id, reply_count, last_reply_at);
    }

    /// The parent's row, wherever it's loaded, takes the count the header shows.
    fn parent_rows_follow(
        &mut self,
        parent_message_id: &str,
        reply_count: i64,
        last_reply_at: Option<chrono::DateTime<chrono::Utc>>,
    ) {
        let differs = self.find_message(parent_message_id).is_some_and(|dto| {
            dto.reply_count != reply_count || dto.last_reply_at != last_reply_at
        });
        if differs {
            self.edit_everywhere(parent_message_id, |dto| {
                dto.reply_count = reply_count;
                dto.last_reply_at = last_reply_at;
            });
        }
    }

    /// A thread's metadata changed in the cache.
    pub(crate) fn reading_meta_changed(&mut self, parent_message_id: String) {
        self.view_changed(ViewKey::Thread { parent_message_id });
    }

    /// A thread's metadata arrived from the server: the parent's row takes its count too.
    pub(crate) fn reading_meta_arrived(&mut self, parent_message_id: String) {
        let meta = self
            .cache
            .thread_meta(&meta_key(&parent_message_id))
            .map(|meta| (meta.reply_count, meta.last_reply_at));
        if let Some((reply_count, last_reply_at)) = meta {
            self.parent_rows_follow(&parent_message_id, reply_count, last_reply_at);
        }
        self.reading_meta_changed(parent_message_id);
    }
}

impl State {
    /// A DM's watermarks changed: its peer list, and every "seen by" of my messages there, may now
    /// name someone else.
    pub(crate) fn seen_by_changed(&mut self, dm_group_id: &str) {
        self.view_changed(ViewKey::DmPeerReads {
            dm_group_id: dm_group_id.to_owned(),
        });
        let conversation = Conversation::DirectMessage {
            id: dm_group_id.to_owned(),
        };
        // The peers' profiles come with the list, so a name arrives without the screen asking.
        let missing: Vec<String> = self
            .cache
            .dm_peer_reads(&keys::scoped(keys::DM_PEER_READS, dm_group_id))
            .map(|peers| {
                peers
                    .iter()
                    .filter(|peer| {
                        self.cache
                            .user(&keys::scoped(keys::USER, &peer.user_id))
                            .is_none()
                    })
                    .map(|peer| peer.user_id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for id in missing {
            self.ensure_query(keys::scoped(keys::USER, &id));
        }
        let me_id = self.me_id().to_owned();
        let mine: Vec<String> = self
            .windows
            .get(&conversation)
            .map(|window| {
                window
                    .rows()
                    .filter(|row| row.message.dto.author_id.as_deref() == Some(me_id.as_str()))
                    .map(|row| row.message.dto.id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for message_id in mine {
            self.view_changed(ViewKey::SeenBy {
                conversation: conversation.clone(),
                message_id,
            });
        }
    }
}

impl Core {
    /// A thread's header: whether I'm subscribed, how many replies. Fetches what's missing, and
    /// `ViewChanged { Thread }` says when to read again. A parent that's gone (removed, or never
    /// there) reads as `LoadState::Failed` with code `NOT_FOUND`, and isn't fetched again until
    /// the thread opens again or `Core::retry_failed`.
    pub fn thread_info(&self, parent_message_id: String) -> ThreadInfo {
        let key = meta_key(&parent_message_id);
        self.write(|state, _| {
            state.ensure_query(key.clone());
            let meta = state.cache.thread_meta(&key);
            let load = match (state.failed_queries.get(&key), meta) {
                (Some(error), _) => LoadState::Failed {
                    error: with_server_code(error.clone()),
                },
                (None, Some(_)) => LoadState::Ready,
                (None, None) => LoadState::Loading,
            };
            let optimistic = state
                .reading
                .optimistic
                .get(&parent_message_id)
                .map(|(subscribed, _)| *subscribed);
            ThreadInfo {
                state: load,
                subscribed: optimistic
                    .or(meta.map(|meta| meta.is_subscribed))
                    .unwrap_or(false),
                reply_count: meta.map_or(0, |meta| meta.reply_count.max(0) as u32),
                last_reply_at_ms: meta
                    .and_then(|meta| meta.last_reply_at)
                    .map(|at| at.timestamp_millis()),
            }
        })
    }

    /// Subscribes to a thread's replies, or stops. Shown at once; a failure puts it back, and
    /// either way the metadata is read again afterwards, as the web's `useThreadSubscription`.
    pub async fn set_thread_subscribed(
        &self,
        parent_message_id: String,
        subscribed: bool,
    ) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("thread subscriptions"))?;
        let change = self.write(|state, _| {
            let change = state.next_change();
            state
                .reading
                .optimistic
                .insert(parent_message_id.clone(), (subscribed, change));
            state.reading_meta_changed(parent_message_id.clone());
            change
        });
        let result = if subscribed {
            services
                .backend
                .threads_controller_subscribe(parent_message_id.clone())
                .await
        } else {
            services
                .backend
                .threads_controller_unsubscribe(parent_message_id.clone())
                .await
        }
        .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            let latest = state
                .reading
                .optimistic
                .get(&parent_message_id)
                .is_some_and(|(_, latest)| *latest == change);
            if !latest {
                // A later change is on its way: it settles the value.
                return;
            }
            state.reading.optimistic.remove(&parent_message_id);
            let key = meta_key(&parent_message_id);
            if result.is_ok() {
                state.note_direct_update(&key);
                if let Some(meta) = state.cache.thread_meta_mut(&key) {
                    meta.is_subscribed = subscribed;
                }
            }
            state.failed_queries.remove(&key);
            if state.invalidate(&key).is_empty() {
                state.ensure_query(key);
            }
            state.reading_meta_changed(parent_message_id.clone());
        });
        result
    }

    /// Messages matching `query` in a channel, a DM or a whole community, newest first, at most
    /// `limit` (the server's default if `None`). Not cached: each call asks the server. An empty
    /// or blank query finds nothing and asks nothing.
    pub async fn search_messages(
        &self,
        scope: SearchScope,
        query: String,
        limit: Option<u32>,
    ) -> Result<Vec<SearchHit>, CoreError> {
        let query = query.trim().to_owned();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let services = self.services().ok_or_else(|| unavailable("search"))?;
        let (found, _) = self
            .search_page(services, &scope, &query, limit, None)
            .await?;
        Ok(self.write(|state, _| project_hits(state, found, &scope)))
    }

    /// The first page of a search, cached: `SearchResultsView` says when each page lands, and
    /// [`Self::load_more_search`] reads the next. Newest first, at most [`SEARCH_PAGE`] a page.
    pub fn search_results(&self, scope: SearchScope, query: String) -> SearchResultsView {
        let query = query.trim().to_owned();
        self.write(|state, _| {
            if query.is_empty() {
                return SearchResultsView {
                    state: LoadState::Ready,
                    scope,
                    query,
                    hits: Vec::new(),
                    more: false,
                    loading_more: false,
                };
            }
            let key = search_key(&scope, &query);
            state.ensure_query(key.clone());
            let (hits, more) = match state.cache.search(&key) {
                Some(pages) => (pages.hits.clone(), pages.next.is_some()),
                None => (Vec::new(), false),
            };
            SearchResultsView {
                state: state.load_of(&key),
                scope,
                query,
                hits,
                more,
                loading_more: state.reading.search_loading.contains(&key),
            }
        })
    }

    /// The next page of `search_results`, when it says `more`. The answer lands in the page's own
    /// cache entry, so a search the user has moved on from can't mix its hits into another's; an
    /// answer for a session that ended writes nothing.
    pub async fn load_more_search(
        &self,
        scope: SearchScope,
        query: String,
    ) -> Result<(), CoreError> {
        let query = query.trim().to_owned();
        if query.is_empty() {
            return Ok(());
        }
        let key = search_key(&scope, &query);
        let view = ViewKey::Search {
            scope: scope.clone(),
            query: query.clone(),
        };
        let (services, epoch) = self.begin("search")?;
        let start = self.write(|state, _| {
            if state.reading.search_loading.contains(&key) {
                return None;
            }
            let cursor = match state.cache.search(&key) {
                Some(pages) => pages.next.clone()?,
                // Nothing cached, nothing more: nothing to read.
                None => return None,
            };
            state.reading.search_loading.insert(key.clone());
            state.view_changed(view.clone());
            Some(cursor)
        });
        let Some(cursor) = start else {
            return Ok(());
        };
        let page = self
            .search_page(&services, &scope, &query, Some(SEARCH_PAGE), Some(cursor))
            .await;
        let landed = self.write(|state, _| {
            // An answer for a session that ended writes nothing and fails.
            if state.session_epoch != epoch {
                return false;
            }
            state.reading.search_loading.remove(&key);
            state.view_changed(view.clone());
            let Ok((found, next)) = &page else {
                return true;
            };
            let hits = project_hits(state, found.clone(), &scope);
            if let Some(pages) = state.cache.search_mut(&key) {
                // A hit that moved onto this page keeps its place once.
                for hit in hits {
                    if !pages.hits.iter().any(|known| known.row.id == hit.row.id) {
                        pages.hits.push(hit);
                    }
                }
                pages.next = next.clone();
            }
            true
        });
        if !landed {
            return Err(CoreError::Failed {
                message: "signed out".into(),
            });
        }
        page.map(|_| ())
    }

    /// One page from the server: its rows (with a community hit's channel name) and the cursor
    /// for the page after it, when the page was full.
    async fn search_page(
        &self,
        services: &crate::client::Services,
        scope: &SearchScope,
        query: &str,
        limit: Option<u32>,
        cursor: Option<String>,
    ) -> Result<(Vec<(wire::MessageDto, Option<String>)>, Option<String>), CoreError> {
        let backend = &services.backend;
        let limit = limit.map(i64::from);
        let failed = |error| self.backend_failed(error);
        Ok(match scope {
            SearchScope::Channel { id } => {
                let page = backend
                    .messages_controller_search_channel_messages(
                        id.clone(),
                        query.to_owned(),
                        limit,
                        cursor,
                    )
                    .await
                    .map_err(failed)?;
                (
                    page.items
                        .into_iter()
                        .map(|message| (message, None))
                        .collect(),
                    page.next,
                )
            }
            SearchScope::DirectMessage { id } => {
                let page = backend
                    .messages_controller_search_direct_messages(
                        id.clone(),
                        query.to_owned(),
                        limit,
                        cursor,
                    )
                    .await
                    .map_err(failed)?;
                (
                    page.items
                        .into_iter()
                        .map(|message| (message, None))
                        .collect(),
                    page.next,
                )
            }
            SearchScope::Community { id } => {
                let page = backend
                    .messages_controller_search_community_messages(
                        id.clone(),
                        query.to_owned(),
                        limit,
                        cursor,
                    )
                    .await
                    .map_err(failed)?;
                (
                    page.items
                        .into_iter()
                        .map(community_hit)
                        .collect::<Result<_, _>>()?,
                    page.next,
                )
            }
        })
    }

    /// The first page of a cached search, as `fetch_value` asks for it.
    pub(crate) async fn fetch_search(
        &self,
        key: &QueryKey,
    ) -> Result<crate::cache::SearchPages, CoreError> {
        let Some(scope) = search_scope_of(key) else {
            return Err(CoreError::Failed {
                message: format!("not a search: {key:?}"),
            });
        };
        let query = key.segments.get(2).cloned().unwrap_or_default();
        let services = self.services().ok_or_else(|| unavailable("search"))?;
        let (found, next) = self
            .search_page(services, &scope, &query, Some(SEARCH_PAGE), None)
            .await?;
        Ok(crate::cache::SearchPages {
            hits: self.write(|state, _| project_hits(state, found, &scope)),
            next,
        })
    }

    /// Where the unread divider goes in a channel or DM: after the message last read when it
    /// opened, which stays put while it's open even as read marks move on. `None` with nothing
    /// unread then, for a thread, or once cleared. Read again on `ViewChanged { UnreadMarker }`,
    /// and on `MessagesChanged` while `after_seq` is `None`, since it fills in as rows load.
    pub fn unread_marker(&self, conversation: Conversation) -> Option<UnreadMarker> {
        self.read(|state| {
            let snapshot = state.reading.markers.get(&conversation)?.as_ref()?;
            let after_seq = state.windows.get(&conversation).and_then(|window| {
                window
                    .rows()
                    .find(|row| row.message.dto.id == snapshot.after_message_id)
                    .map(|row| row.seq)
            });
            Some(UnreadMarker {
                after_message_id: snapshot.after_message_id.clone(),
                after_seq,
                unread_count: snapshot.unread_count,
                mention_count: snapshot.mention_count,
            })
        })
    }

    /// Takes the divider away until the conversation next opens.
    pub fn clear_unread_marker(&self, conversation: Conversation) {
        self.write(|state, _| {
            state.reading.awaiting_counts.remove(&conversation);
            let had = state.reading.markers.insert(conversation.clone(), None);
            if had.flatten().is_some() {
                state.view_changed(ViewKey::UnreadMarker { conversation });
            }
        });
    }

    /// The other members of a DM and how far each has read, from
    /// `GET /read-receipts/dm-peer-reads/{id}`. `ViewKey::DmPeerReads { dm_group_id }` says when to
    /// read again; a peer's read arrives over `readReceiptUpdated` and is applied at once. A room
    /// whose receipts can't be read shows `Failed` and is read again by `Core::retry_failed`.
    pub fn dm_peer_reads(&self, dm_group_id: String) -> DmPeerReadsView {
        self.write(|state, _| {
            let key = keys::scoped(keys::DM_PEER_READS, &dm_group_id);
            state.ensure_query(key.clone());
            let peers = state.cache.dm_peer_reads(&key).cloned().unwrap_or_default();
            Self::ensure_readers_known(state, peers.iter().map(|peer| peer.user_id.as_str()));
            DmPeerReadsView {
                state: state.load_of(&key),
                dm_group_id,
                peers: peers
                    .into_iter()
                    .map(|peer| PeerReadView {
                        user: state.user_or_stub(&peer.user_id),
                        last_read_at_ms: peer.last_read_at.timestamp_millis(),
                    })
                    .collect(),
            }
        })
    }

    /// Who has read one message, for "seen by". A DM compares its peers' watermarks with the
    /// message's sent time (so the message has to be loaded: an unknown one names nobody); a channel
    /// asks `GET /read-receipts/message/{id}/readers`, which leaves this user out. A thread has no
    /// readers. Names are cut to `SEEN_BY_NAMES` with the rest counted in `more`, as the web's
    /// tooltip lists them.
    pub fn seen_by(&self, conversation: Conversation, message_id: String) -> SeenByView {
        self.write(|state, _| {
            let empty = SeenByView::default();
            match &conversation {
                Conversation::DirectMessage { id: dm_group_id } => {
                    let key = keys::scoped(keys::DM_PEER_READS, dm_group_id);
                    state.ensure_query(key.clone());
                    let load = state.load_of(&key);
                    let Some(sent_at_ms) = state
                        .find_message(&message_id)
                        .map(|dto| dto.sent_at.timestamp_millis())
                    else {
                        // Not loaded: there is no sent time to compare a watermark with.
                        return SeenByView {
                            state: LoadState::Ready,
                            ..empty
                        };
                    };
                    let peers = state.cache.dm_peer_reads(&key).cloned().unwrap_or_default();
                    let mut readers: Vec<(String, i64)> = peers
                        .into_iter()
                        .filter(|peer| peer.last_read_at.timestamp_millis() >= sent_at_ms)
                        .map(|peer| (peer.user_id, peer.last_read_at.timestamp_millis()))
                        .collect();
                    // Earliest reader first, so the list grows with who saw it first.
                    readers.sort_by_key(|(_, read_at)| *read_at);
                    Self::ensure_readers_known(state, readers.iter().map(|(id, _)| id.as_str()));
                    let count = u32::try_from(readers.len()).unwrap_or(u32::MAX);
                    let named: Vec<UserView> = readers
                        .iter()
                        .take(SEEN_BY_NAMES)
                        .map(|(id, _)| state.user_or_stub(id))
                        .collect();
                    SeenByView {
                        state: load,
                        more: count - u32::try_from(named.len()).unwrap_or(0),
                        readers: named,
                        count,
                    }
                }
                Conversation::Channel { .. } => {
                    let Some(key) = readers_key(&message_id, &conversation) else {
                        return empty;
                    };
                    state.ensure_query(key.clone());
                    let rows = state
                        .cache
                        .message_readers(&key)
                        .cloned()
                        .unwrap_or_default();
                    let readers: Vec<UserView> = rows
                        .into_iter()
                        .map(|reader| UserView {
                            id: reader.user_id,
                            username: reader.username,
                            display_name: reader.display_name,
                            avatar_file_id: reader.avatar_url,
                        })
                        .collect();
                    let count = u32::try_from(readers.len()).unwrap_or(u32::MAX);
                    let named: Vec<UserView> = readers.into_iter().take(SEEN_BY_NAMES).collect();
                    SeenByView {
                        state: state.load_of(&key),
                        more: count - u32::try_from(named.len()).unwrap_or(0),
                        readers: named,
                        count,
                    }
                }
                Conversation::Thread { .. } => SeenByView {
                    state: LoadState::Ready,
                    ..empty
                },
            }
        })
    }

    /// Asks for the profiles of readers that aren't cached, so a name arrives after the rows do.
    fn ensure_readers_known<'a>(state: &mut State, ids: impl Iterator<Item = &'a str>) {
        let missing: Vec<String> = ids
            .filter(|id| state.cache.user(&keys::scoped(keys::USER, id)).is_none())
            .map(str::to_owned)
            .collect();
        for id in missing {
            state.ensure_query(keys::scoped(keys::USER, &id));
        }
    }

    /// Follows a message link on this server: opens its conversation at the message, as
    /// `open_conversation_at` does, and returns the conversation. For a thread reply (a search hit
    /// or a pin) pass its parent: the jump goes to the parent and then opens the thread. A link
    /// elsewhere fails; a message that's gone fails with the server's `NOT_FOUND` at the front of
    /// the message.
    pub async fn open_message_link(
        &self,
        link: String,
        parent_message_id: Option<String>,
    ) -> Result<Conversation, CoreError> {
        let server_url = self
            .read(|state| state.reading.server_url.clone())
            .ok_or_else(|| unavailable("message links before signing in"))?;
        let parsed = crate::links::parse_message_link(&server_url, &link).ok_or_else(|| {
            CoreError::Failed {
                message: "not a message link on this server".into(),
            }
        })?;
        let conversation = parsed.conversation;
        match (parent_message_id, parsed.message_id) {
            (Some(parent_message_id), _) => {
                self.open_conversation_at(conversation.clone(), parent_message_id.clone())
                    .await?;
                // The user may have gone elsewhere while the page came: the thread belongs to the
                // link's conversation, so it opens only if that's still the one shown.
                let still_here =
                    self.read(|state| state.main_conversation.as_ref() == Some(&conversation));
                if still_here {
                    self.open_conversation(Conversation::Thread { parent_message_id })
                        .await?;
                }
            }
            (None, Some(message_id)) => {
                self.open_conversation_at(conversation.clone(), message_id)
                    .await?;
            }
            (None, None) => self.open_conversation(conversation.clone()).await?,
        }
        Ok(conversation)
    }
}

/// Where a hit is: its channel or DM, from the message, else the scope searched.
fn hit_conversation(dto: &wire::MessageDto, scope: &SearchScope) -> Option<Conversation> {
    match (&dto.channel_id, &dto.direct_message_group_id) {
        (Some(id), _) if !id.is_empty() => Some(Conversation::Channel { id: id.clone() }),
        (_, Some(id)) if !id.is_empty() => Some(Conversation::DirectMessage { id: id.clone() }),
        _ => match scope {
            SearchScope::Channel { id } => Some(Conversation::Channel { id: id.clone() }),
            SearchScope::DirectMessage { id } => {
                Some(Conversation::DirectMessage { id: id.clone() })
            }
            // A community hit with no channel has nowhere to jump to.
            SearchScope::Community { .. } => None,
        },
    }
}

/// The view a reading query feeds, and the reverse: `commands::view_for` and `key_for` ask here.
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    match key.op() {
        keys::DM_PEER_READS => Some(ViewKey::DmPeerReads {
            dm_group_id: key.segments.get(1)?.clone(),
        }),
        keys::MESSAGE_READERS => Some(ViewKey::SeenBy {
            conversation: readers_conversation(key)?,
            message_id: key.segments.get(1)?.clone(),
        }),
        _ => Some(ViewKey::Search {
            scope: search_scope_of(key)?,
            query: key.segments.get(2).cloned().unwrap_or_default(),
        }),
    }
}

pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    match view {
        ViewKey::Search { scope, query } => Some(search_key(scope, query)),
        ViewKey::DmPeerReads { dm_group_id } => {
            Some(keys::scoped(keys::DM_PEER_READS, dm_group_id))
        }
        ViewKey::SeenBy {
            conversation,
            message_id,
        } => readers_key(message_id, conversation),
        _ => None,
    }
}

/// The conversation a readers key names: its third segment says which kind, its fourth the id.
fn readers_conversation(key: &QueryKey) -> Option<Conversation> {
    let id = key.segments.get(3)?.clone();
    Some(match key.segments.get(2)?.as_str() {
        "channel" => Conversation::Channel { id },
        "dm" => Conversation::DirectMessage { id },
        _ => return None,
    })
}

/// The cache key of one message's readers in a channel or DM. Threads have none.
fn readers_key(message_id: &str, conversation: &Conversation) -> Option<QueryKey> {
    let (kind, id) = match conversation {
        Conversation::Channel { id } => ("channel", id),
        Conversation::DirectMessage { id } => ("dm", id),
        Conversation::Thread { .. } => return None,
    };
    Some(QueryKey::new(&[
        keys::MESSAGE_READERS,
        message_id,
        kind,
        id,
    ]))
}

/// The cache key of one search: its scope's operation, the id searched, and the query.
fn search_key(scope: &SearchScope, query: &str) -> QueryKey {
    match scope {
        SearchScope::Channel { id } => QueryKey::new(&[keys::SEARCH_CHANNEL, id, query]),
        SearchScope::DirectMessage { id } => QueryKey::new(&[keys::SEARCH_DM, id, query]),
        SearchScope::Community { id } => QueryKey::new(&[keys::SEARCH_COMMUNITY, id, query]),
    }
}

/// The scope a search key names, or `None` for another query.
fn search_scope_of(key: &QueryKey) -> Option<SearchScope> {
    let id = key.segments.get(1)?.clone();
    Some(match key.op() {
        keys::SEARCH_CHANNEL => SearchScope::Channel { id },
        keys::SEARCH_DM => SearchScope::DirectMessage { id },
        keys::SEARCH_COMMUNITY => SearchScope::Community { id },
        _ => return None,
    })
}

/// A page's rows as hits, asking for the authors that aren't loaded yet.
fn project_hits(
    state: &mut State,
    found: Vec<(wire::MessageDto, Option<String>)>,
    scope: &SearchScope,
) -> Vec<SearchHit> {
    let mut missing = Vec::new();
    let hits = found
        .into_iter()
        .filter_map(|(dto, channel_name)| {
            let conversation = hit_conversation(&dto, scope)?;
            let parent_message_id = dto.parent_message_id.clone();
            let row = Row {
                seq: 0,
                revision: 0,
                message: StoredMessage::from_server(dto),
            };
            let me_id = state.me_id().to_owned();
            let row = project(
                &row,
                &me_id,
                &mut |id| {
                    let user = (id == me_id)
                        .then(|| state.me.clone())
                        .flatten()
                        .or_else(|| {
                            state
                                .cache
                                .user(&keys::scoped(keys::USER, id))
                                .map(crate::client::user_view)
                        });
                    if user.is_none() {
                        missing.push(id.to_owned());
                    }
                    user
                },
                &HashMap::new(),
            );
            Some(SearchHit {
                row,
                conversation,
                parent_message_id,
                channel_name,
            })
        })
        .collect();
    // Authors arrive for the rows a UI shows; a search shows them by id until then.
    for id in missing {
        state.ensure_query(keys::scoped(keys::USER, &id));
    }
    hits
}

/// A community result is a message plus its channel's name.
fn community_hit(
    result: wire::CommunitySearchResultDto,
) -> Result<(wire::MessageDto, Option<String>), CoreError> {
    let channel_name = result.channel_name.clone();
    let mut value = serde_json::to_value(result).map_err(|error| CoreError::Failed {
        message: format!("search result: {error}"),
    })?;
    if let Some(object) = value.as_object_mut() {
        object.remove("channelName");
    }
    let message = serde_json::from_value(value).map_err(|error| CoreError::Failed {
        message: format!("search result: {error}"),
    })?;
    Ok((message, Some(channel_name)))
}
