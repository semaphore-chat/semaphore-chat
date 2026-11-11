//! Finding and following messages: thread info and subscriptions, search, the unread divider and
//! message links. Unit W1-core part B.

use crate::cache::{QueryKey, keys};
use crate::client::{Core, State};
use crate::model::{
    Conversation, ErrorView, LoadState, SearchHit, SearchScope, ThreadInfo, UnreadMarker, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use crate::store::{Row, StoredMessage, project};
use semaphore_wire::types as wire;
use std::collections::{HashMap, HashSet};

/// The error code a missing thread or message comes back with.
pub const NOT_FOUND: &str = "NOT_FOUND";

/// What these commands keep between calls. Forgotten at sign-out.
#[derive(Debug, Default)]
pub(crate) struct ReadingState {
    /// The divider for each conversation, as it was when it opened. `None`: no divider.
    markers: HashMap<Conversation, Option<Snapshot>>,
    /// Opened before the unread counts arrived: their snapshot waits for them.
    awaiting_counts: HashSet<Conversation>,
    /// A subscription change on its way, by parent: the value shown meanwhile, and which change.
    optimistic: HashMap<String, (bool, u64)>,
    next_change: u64,
    /// The server signed in to, which message links must point at.
    pub server_url: Option<String>,
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

    /// My own reply: the server subscribes the replier.
    pub(crate) fn reading_my_reply(&mut self, parent_message_id: &str) {
        let key = meta_key(parent_message_id);
        self.note_direct_update(&key);
        if let Some(meta) = self.cache.thread_meta_mut(&key) {
            meta.is_subscribed = true;
        }
        self.view_changed(ViewKey::Thread {
            parent_message_id: parent_message_id.to_owned(),
        });
    }

    /// `threadReplyCountUpdated`: the header's count follows.
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
    }

    /// A thread's metadata changed in the cache.
    pub(crate) fn reading_meta_changed(&mut self, parent_message_id: String) {
        self.view_changed(ViewKey::Thread { parent_message_id });
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
            state.reading.next_change += 1;
            let change = state.reading.next_change;
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
        let backend = &services.backend;
        let limit = limit.map(i64::from);
        let found: Vec<(wire::MessageDto, Option<String>)> = match &scope {
            SearchScope::Channel { id } => backend
                .messages_controller_search_channel_messages(id.clone(), query, limit)
                .await
                .map_err(|error| self.backend_failed(error))?
                .into_iter()
                .map(|message| (message, None))
                .collect(),
            SearchScope::DirectMessage { id } => backend
                .messages_controller_search_direct_messages(id.clone(), query, limit)
                .await
                .map_err(|error| self.backend_failed(error))?
                .into_iter()
                .map(|message| (message, None))
                .collect(),
            SearchScope::Community { id } => backend
                .messages_controller_search_community_messages(id.clone(), query, limit)
                .await
                .map_err(|error| self.backend_failed(error))?
                .into_iter()
                .map(community_hit)
                .collect::<Result<_, _>>()?,
        };
        Ok(self.write(|state, _| {
            let mut missing = Vec::new();
            let hits = found
                .into_iter()
                .filter_map(|(dto, channel_name)| {
                    let conversation = hit_conversation(&dto, &scope)?;
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
                            let user =
                                (id == me_id)
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
        }))
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
