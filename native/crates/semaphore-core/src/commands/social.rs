//! Friends, friend requests and idle presence. Unit W2-core.
//!
//! The server sends no event for any friendship change, so the list is read again after each
//! change made here, on reconnect, and when read while older than [`FRIENDS_STALE_MS`]. A change
//! isn't shown before the server agrees: its row shows `busy` meanwhile, and the server's answer
//! settles it. One busy mark per friendship, numbered, so an earlier change finishing doesn't
//! clear a later one's.

use crate::cache::{CacheValue, FriendsData, keys};
use crate::client::{Core, State, user_view};
use crate::model::{FriendRequestRow, FriendRow, FriendsView, FriendshipState, UserView, ViewKey};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::enums::{FriendshipDirection, FriendshipStatus};
use semaphore_wire::types as wire;

/// No input for this long makes the user idle, as the web's `useActivityDetector`. A hidden or
/// minimised window is idle at once. The app watches input and calls [`Core::set_idle`].
pub const IDLE_AFTER_MS: u64 = 5 * 60 * 1000;

/// Friends read longer ago than this are read again when shown: nothing else says they changed.
pub const FRIENDS_STALE_MS: u64 = 30_000;

#[derive(Clone, Copy)]
enum FriendChange {
    Send,
    Accept,
    Decline,
    Cancel,
    Remove,
}

impl State {
    fn request_row(
        &self,
        request: &wire::FriendshipWithUsersDto,
        other: &wire::UserEntity,
    ) -> FriendRequestRow {
        FriendRequestRow {
            friendship_id: request.id.clone(),
            user: user_view(other),
            sent_at_ms: request.created_at.timestamp_millis(),
            busy: self.w2.busy_friendships.contains_key(&request.id),
        }
    }

    fn friend_online(&self, user_id: &str) -> bool {
        self.cache
            .presence(&keys::op(keys::PRESENCE))
            .and_then(|presence| presence.get(user_id))
            .copied()
            .unwrap_or(false)
    }

    /// Presence changed: friends show it.
    pub(crate) fn w2_presence_changed(&mut self) {
        if self.cache.friends(&keys::op(keys::FRIENDS)).is_some() {
            self.view_changed(ViewKey::Friends);
        }
        self.w2_dms_touched();
    }

    /// What a change the server agreed to does to the cached lists before they're read again.
    fn apply_friend_change(&mut self, change: FriendChange, friendship_id: &str) {
        let key = keys::op(keys::FRIENDS);
        self.note_direct_update(&key);
        let Some(data) = self.cache.friends_mut(&key) else {
            return;
        };
        match change {
            FriendChange::Send => {}
            FriendChange::Accept | FriendChange::Decline => {
                data.requests
                    .received
                    .retain(|request| request.id != friendship_id);
            }
            FriendChange::Cancel => {
                data.requests
                    .sent
                    .retain(|request| request.id != friendship_id);
            }
            FriendChange::Remove => {
                data.friends
                    .retain(|friend| friend.friendship_id != friendship_id);
            }
        }
    }
}

impl Core {
    pub(crate) async fn fetch_friends(&self) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        let (friends, requests) = futures_join(
            backend.friends_controller_get_friends(),
            backend.friends_controller_get_pending_requests(),
        )
        .await;
        Ok(CacheValue::Friends(FriendsData {
            friends: friends.map_err(|error| self.backend_failed(error))?,
            requests: requests.map_err(|error| self.backend_failed(error))?,
        }))
    }

    /// Friends and pending requests. `ViewKey::Friends` says when to read again.
    pub fn friends(&self) -> FriendsView {
        self.write(|state, now| {
            let key = keys::op(keys::FRIENDS);
            let old = state.cache.get(&key).is_some_and(|entry| {
                !entry.stale && now.saturating_sub(entry.fetched_at_ms) > FRIENDS_STALE_MS
            });
            if old {
                state.invalidate(&key);
            }
            state.ensure_query(key.clone());
            state.ensure_query(keys::op(keys::PRESENCE));
            let load = state.query_load_state(&key);
            let Some(data) = state.cache.friends(&key) else {
                return FriendsView {
                    state: load,
                    ..FriendsView::default()
                };
            };
            FriendsView {
                state: load,
                friends: data
                    .friends
                    .iter()
                    .map(|friend| FriendRow {
                        friendship_id: friend.friendship_id.clone(),
                        user: UserView {
                            id: friend.id.clone(),
                            username: friend.username.clone(),
                            display_name: friend.display_name.clone(),
                            avatar_file_id: friend.avatar_url.clone(),
                        },
                        online: state.friend_online(&friend.id),
                        busy: state
                            .w2
                            .busy_friendships
                            .contains_key(&friend.friendship_id),
                    })
                    .collect(),
                incoming: data
                    .requests
                    .received
                    .iter()
                    .map(|request| state.request_row(request, &request.user_a))
                    .collect(),
                outgoing: data
                    .requests
                    .sent
                    .iter()
                    .map(|request| state.request_row(request, &request.user_b))
                    .collect(),
            }
        })
    }

    /// Where this user stands with another.
    pub async fn friendship_status(&self, user_id: String) -> Result<FriendshipState, CoreError> {
        let (services, epoch) = self.begin("friends")?;
        let status = services
            .backend
            .friends_controller_get_friendship_status(user_id)
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.same_session(epoch)?;
        let Some(id) = status.friendship_id.filter(|id| !id.is_empty()) else {
            return Ok(FriendshipState::None);
        };
        Ok(match (status.status, status.direction) {
            (Some(FriendshipStatus::Accepted), _) => FriendshipState::Friends { friendship_id: id },
            (Some(FriendshipStatus::Pending), Some(FriendshipDirection::Sent)) => {
                FriendshipState::RequestSent { friendship_id: id }
            }
            (Some(FriendshipStatus::Pending), Some(FriendshipDirection::Received)) => {
                FriendshipState::RequestReceived { friendship_id: id }
            }
            _ => FriendshipState::None,
        })
    }

    async fn friend_change(&self, change: FriendChange, id: String) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("friends")?;
        // A request is addressed to a user; the others name the friendship, which shows busy.
        let mark = self.write(|state, _| {
            if matches!(change, FriendChange::Send) {
                return None;
            }
            let number = state.next_change();
            state.w2.busy_friendships.insert(id.clone(), number);
            state.view_changed(ViewKey::Friends);
            Some(number)
        });
        let backend = &services.backend;
        let result = match change {
            FriendChange::Send => backend
                .friends_controller_send_friend_request(id.clone())
                .await
                .map(|_| ()),
            FriendChange::Accept => backend
                .friends_controller_accept_friend_request(id.clone())
                .await
                .map(|_| ()),
            FriendChange::Decline => {
                backend
                    .friends_controller_decline_friend_request(id.clone())
                    .await
            }
            FriendChange::Cancel => {
                backend
                    .friends_controller_cancel_friend_request(id.clone())
                    .await
            }
            FriendChange::Remove => backend.friends_controller_remove_friend(id.clone()).await,
        }
        .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            if let Some(number) = mark
                && state.w2.busy_friendships.get(&id) == Some(&number)
            {
                state.w2.busy_friendships.remove(&id);
            }
            if result.is_ok() {
                state.apply_friend_change(change, &id);
            }
            let key = keys::op(keys::FRIENDS);
            state.failed_queries.remove(&key);
            if state.invalidate(&key).is_empty() {
                state.ensure_query(key);
            }
            state.view_changed(ViewKey::Friends);
        });
        result
    }

    /// Asks someone to be friends. If they already asked this user, the server makes them friends.
    pub async fn send_friend_request(&self, user_id: String) -> Result<(), CoreError> {
        self.friend_change(FriendChange::Send, user_id).await
    }

    pub async fn accept_friend_request(&self, friendship_id: String) -> Result<(), CoreError> {
        self.friend_change(FriendChange::Accept, friendship_id)
            .await
    }

    pub async fn decline_friend_request(&self, friendship_id: String) -> Result<(), CoreError> {
        self.friend_change(FriendChange::Decline, friendship_id)
            .await
    }

    /// Takes back a request this user sent.
    pub async fn cancel_friend_request(&self, friendship_id: String) -> Result<(), CoreError> {
        self.friend_change(FriendChange::Cancel, friendship_id)
            .await
    }

    pub async fn remove_friend(&self, friendship_id: String) -> Result<(), CoreError> {
        self.friend_change(FriendChange::Remove, friendship_id)
            .await
    }

    /// The user went idle, or came back. Sent to the server at once and with every later
    /// heartbeat. The server shows no one as idle; it only stops push notifications meanwhile.
    pub fn set_idle(&self, idle: bool) {
        self.queue_idle(idle);
    }
}

/// Both at once, without a dependency on an executor: core runs on whatever the host has.
async fn futures_join<A, B>(a: A, b: B) -> (A::Output, B::Output)
where
    A: std::future::Future,
    B: std::future::Future,
{
    let mut a = std::pin::pin!(a);
    let mut b = std::pin::pin!(b);
    let (mut out_a, mut out_b) = (None, None);
    std::future::poll_fn(|cx| {
        if out_a.is_none()
            && let std::task::Poll::Ready(value) = a.as_mut().poll(cx)
        {
            out_a = Some(value);
        }
        if out_b.is_none()
            && let std::task::Poll::Ready(value) = b.as_mut().poll(cx)
        {
            out_b = Some(value);
        }
        if out_a.is_some() && out_b.is_some() {
            std::task::Poll::Ready(())
        } else {
            std::task::Poll::Pending
        }
    })
    .await;
    (
        out_a.expect("polled to completion"),
        out_b.expect("polled to completion"),
    )
}
