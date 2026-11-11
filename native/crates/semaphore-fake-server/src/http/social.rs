//! Friends (W2): the list, pending requests, status, and the request, accept, decline, cancel and
//! remove calls. As `backend/src/friends`: `userA` is the sender, a request to someone who already
//! asked me accepts theirs, only the receiver accepts or declines and only the sender cancels,
//! the last three delete the row, and nothing is sent over the socket.

use super::dms::bad_id;
use super::json_response;
use crate::social::valid_id;
use crate::{Data, Inner, lock};
use axum::Router;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post};
use semaphore_wire::enums::{FriendshipDirection, FriendshipStatus};
use semaphore_wire::types::{
    FriendListItemDto, FriendshipDto, FriendshipStatusDto, FriendshipWithUsersDto,
};
use serde_json::{Value, json};
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/friends", get(friends))
        .route("/api/friends/requests", get(requests))
        .route("/api/friends/status/{userId}", get(status))
        .route("/api/friends/request/{userId}", post(send_request))
        .route("/api/friends/accept/{id}", post(accept))
        .route("/api/friends/decline/{id}", delete(decline))
        .route("/api/friends/cancel/{id}", delete(cancel))
        .route("/api/friends/{id}", delete(remove))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/friends") => "FriendsController_getFriends",
        ("GET", "/api/friends/requests") => "FriendsController_getPendingRequests",
        ("GET", "/api/friends/status/{userId}") => "FriendsController_getFriendshipStatus",
        ("POST", "/api/friends/request/{userId}") => "FriendsController_sendFriendRequest",
        ("POST", "/api/friends/accept/{id}") => "FriendsController_acceptFriendRequest",
        ("DELETE", "/api/friends/decline/{id}") => "FriendsController_declineFriendRequest",
        ("DELETE", "/api/friends/cancel/{id}") => "FriendsController_cancelFriendRequest",
        ("DELETE", "/api/friends/{id}") => "FriendsController_removeFriend",
        _ => return None,
    })
}

fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("a friendship serializes")
}

fn friendship_dto(row: &FriendshipWithUsersDto) -> FriendshipDto {
    FriendshipDto {
        created_at: row.created_at,
        id: row.id.clone(),
        status: row.status.clone(),
        user_a_id: row.user_a_id.clone(),
        user_b_id: row.user_b_id.clone(),
    }
}

fn success() -> Response {
    json_response(StatusCode::OK, json!({ "success": true }))
}

fn friendship_known(data: &Data, id: &str) -> bool {
    data.social.friendships.iter().any(|row| row.id == id)
}

/// `getFriends`: the accepted rows, with the other user's profile and the friendship's id.
async fn friends(State(inner): State<Arc<Inner>>) -> Response {
    let me = &inner.scenario.me.id;
    let data = lock(&inner.data);
    let items: Vec<FriendListItemDto> = data
        .social
        .friendships
        .iter()
        .filter(|row| {
            row.status == FriendshipStatus::Accepted
                && (&row.user_a_id == me || &row.user_b_id == me)
        })
        .map(|row| {
            let other = if &row.user_a_id == me {
                &row.user_b
            } else {
                &row.user_a
            };
            FriendListItemDto {
                avatar_url: other.avatar_url.clone(),
                banner_url: other.banner_url.clone(),
                bio: other.bio.clone(),
                display_name: other.display_name.clone(),
                friendship_id: row.id.clone(),
                id: other.id.clone(),
                last_seen: other.last_seen,
                role: other.role.clone(),
                status: other.status.clone(),
                username: other.username.clone(),
            }
        })
        .collect();
    json_response(StatusCode::OK, to_value(&items))
}

/// `getPendingRequests`: what I sent (I am `userA`) and what I received (`userB`).
async fn requests(State(inner): State<Arc<Inner>>) -> Response {
    let me = &inner.scenario.me.id;
    let data = lock(&inner.data);
    let pending = |sent: bool| -> Vec<&FriendshipWithUsersDto> {
        data.social
            .friendships
            .iter()
            .filter(|row| {
                row.status == FriendshipStatus::Pending
                    && if sent {
                        &row.user_a_id == me
                    } else {
                        &row.user_b_id == me
                    }
            })
            .collect()
    };
    json_response(
        StatusCode::OK,
        json!({ "sent": to_value(&pending(true)), "received": to_value(&pending(false)) }),
    )
}

/// `getFriendshipStatus`: the status of the row between me and them, and for a pending one whose
/// request it was. No row is `null` in all three.
async fn status(State(inner): State<Arc<Inner>>, Path(user_id): Path<String>) -> Response {
    if !valid_id(&user_id, inner.scenario.user(&user_id).is_some()) {
        return bad_id(&inner, "a UUID");
    }
    let me = &inner.scenario.me.id;
    let data = lock(&inner.data);
    let row = data.social.friendships.iter().find(|row| {
        (&row.user_a_id == me && row.user_b_id == user_id)
            || (row.user_a_id == user_id && &row.user_b_id == me)
    });
    let body = match row {
        None => FriendshipStatusDto {
            direction: None,
            friendship_id: None,
            status: None,
        },
        Some(row) => FriendshipStatusDto {
            direction: (row.status == FriendshipStatus::Pending).then(|| {
                if &row.user_a_id == me {
                    FriendshipDirection::Sent
                } else {
                    FriendshipDirection::Received
                }
            }),
            friendship_id: Some(row.id.clone()),
            status: Some(row.status.clone()),
        },
    };
    json_response(StatusCode::OK, to_value(&body))
}

/// `sendFriendRequest`.
async fn send_request(State(inner): State<Arc<Inner>>, Path(user_id): Path<String>) -> Response {
    if !valid_id(&user_id, inner.scenario.user(&user_id).is_some()) {
        return bad_id(&inner, "a UUID");
    }
    let me = inner.scenario.me.clone();
    if me.id == user_id {
        return inner.error(
            403,
            "FORBIDDEN",
            "Cannot send friend request to yourself",
            false,
        );
    }
    let Some(other) = inner.scenario.user(&user_id).cloned() else {
        return inner.error(404, "NOT_FOUND", "User not found", false);
    };
    let now = inner.now();
    let mut data = lock(&inner.data);
    let existing = data.social.friendships.iter().position(|row| {
        (row.user_a_id == me.id && row.user_b_id == user_id)
            || (row.user_a_id == user_id && row.user_b_id == me.id)
    });
    if let Some(index) = existing {
        let row = &mut data.social.friendships[index];
        match row.status {
            FriendshipStatus::Accepted => {
                drop(data);
                return inner.error(409, "CONFLICT", "Already friends with this user", false);
            }
            FriendshipStatus::Pending => {
                // They asked me first: this accepts it.
                if row.user_a_id == user_id {
                    row.status = FriendshipStatus::Accepted;
                    return json_response(StatusCode::CREATED, to_value(&friendship_dto(row)));
                }
                drop(data);
                return inner.error(409, "CONFLICT", "Friend request already sent", false);
            }
            // Not made by the fake: a blocked row falls through to a new request, as the backend.
            _ => {}
        }
    }
    let row = FriendshipWithUsersDto {
        created_at: now,
        id: data.social.new_id("friendship"),
        status: FriendshipStatus::Pending,
        user_a: me.clone(),
        user_a_id: me.id.clone(),
        user_b: other,
        user_b_id: user_id,
    };
    let body = to_value(&friendship_dto(&row));
    data.social.friendships.push(row);
    json_response(StatusCode::CREATED, body)
}

enum Who {
    Receiver,
    Sender,
}

/// The shared checks of accept, decline and cancel: the row exists, the right party is asking and
/// it is still pending. `Ok` is the row's index.
fn pending_for(
    inner: &Inner,
    data: &Data,
    id: &str,
    who: Who,
    verb: &str,
) -> Result<usize, Response> {
    let me = &inner.scenario.me.id;
    let Some(index) = data.social.friendships.iter().position(|row| row.id == id) else {
        return Err(inner.error(404, "NOT_FOUND", "Friend request not found", false));
    };
    let row = &data.social.friendships[index];
    let party = match who {
        Who::Receiver => &row.user_b_id,
        Who::Sender => &row.user_a_id,
    };
    if party != me {
        return Err(inner.error(
            403,
            "FORBIDDEN",
            format!("Cannot {verb} this friend request"),
            false,
        ));
    }
    if row.status != FriendshipStatus::Pending {
        return Err(inner.error(409, "CONFLICT", "Friend request is not pending", false));
    }
    Ok(index)
}

async fn accept(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    let mut data = lock(&inner.data);
    if !valid_id(&id, friendship_known(&data, &id)) {
        drop(data);
        return bad_id(&inner, "a UUID");
    }
    match pending_for(&inner, &data, &id, Who::Receiver, "accept") {
        Ok(index) => {
            let row = &mut data.social.friendships[index];
            row.status = FriendshipStatus::Accepted;
            json_response(StatusCode::CREATED, to_value(&friendship_dto(row)))
        }
        Err(response) => response,
    }
}

async fn decline(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    delete_pending(&inner, &id, Who::Receiver, "decline")
}

async fn cancel(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    delete_pending(&inner, &id, Who::Sender, "cancel")
}

fn delete_pending(inner: &Inner, id: &str, who: Who, verb: &str) -> Response {
    let mut data = lock(&inner.data);
    if !valid_id(id, friendship_known(&data, id)) {
        drop(data);
        return bad_id(inner, "a UUID");
    }
    match pending_for(inner, &data, id, who, verb) {
        Ok(index) => {
            data.social.friendships.remove(index);
            success()
        }
        Err(response) => response,
    }
}

/// `removeFriend`: either side of an accepted friendship.
async fn remove(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    let me = inner.scenario.me.id.clone();
    let mut data = lock(&inner.data);
    if !valid_id(&id, friendship_known(&data, &id)) {
        drop(data);
        return bad_id(&inner, "a UUID");
    }
    let Some(index) = data.social.friendships.iter().position(|row| row.id == id) else {
        drop(data);
        return inner.error(404, "NOT_FOUND", "Friendship not found", false);
    };
    let row = &data.social.friendships[index];
    if row.user_a_id != me && row.user_b_id != me {
        drop(data);
        return inner.error(403, "FORBIDDEN", "Cannot remove this friendship", false);
    }
    if row.status != FriendshipStatus::Accepted {
        drop(data);
        return inner.error(409, "CONFLICT", "Not friends with this user", false);
    }
    data.social.friendships.remove(index);
    success()
}
