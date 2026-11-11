//! W2: DMs, friends and notifications. Each test names the backend behaviour it keeps; the
//! contract tests (`contract.rs`) check every shape against the pinned spec.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid, message_uuid};
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

fn ids_of(list: &Value, key: &str) -> Vec<String> {
    list.as_array()
        .expect("a list")
        .iter()
        .map(|item| item[key].as_str().expect("a string").to_owned())
        .collect()
}

// ----- DMs -------------------------------------------------------------------------------------

#[tokio::test]
async fn the_showcase_serves_its_dms_as_uuids_newest_activity_first() {
    let (_server, client, base) = showcase().await;
    let (status, groups) = get(&client, &base, "/api/direct-messages").await;
    assert_eq!(status, 200, "{groups}");
    let listed = ids_of(&groups, "id");
    assert_eq!(listed.len(), 5);
    for group in groups.as_array().unwrap() {
        assert!(uuid::Uuid::parse_str(group["id"].as_str().unwrap()).is_ok());
        for member in group["members"].as_array().unwrap() {
            assert!(uuid::Uuid::parse_str(member["id"].as_str().unwrap()).is_ok());
            assert!(uuid::Uuid::parse_str(member["userId"].as_str().unwrap()).is_ok());
        }
    }
    // dm-priya has the newest message, and its last message is the one the store holds.
    assert_eq!(listed[0], id("dm-priya"));
    assert_eq!(
        groups[0]["lastMessage"]["id"],
        message_uuid("sc-dm-pri-never")
    );
    // A 1:1 has `name: null` on the wire, not an absent field.
    assert!(groups[0].as_object().unwrap().contains_key("name"));
    assert_eq!(groups[0]["name"], Value::Null);
    assert_eq!(groups[0]["isGroup"], false);
    let launch = groups
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["id"] == id("dm-launch").as_str())
        .unwrap();
    assert_eq!(launch["isGroup"], true);
    assert_eq!(launch["members"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn a_new_message_moves_its_dm_to_the_top_and_becomes_its_last_message() {
    let (_server, client, base) = showcase().await;
    let (status, sent) = post(
        &client,
        &base,
        "/api/messages/dm",
        json!({
            "directMessageGroupId": id("dm-grace"),
            "spans": [{ "type": "PLAINTEXT", "text": "newest" }],
            "attachments": [],
        }),
    )
    .await;
    assert_eq!(status, 201, "{sent}");
    let (_, groups) = get(&client, &base, "/api/direct-messages").await;
    assert_eq!(groups[0]["id"], id("dm-grace"));
    assert_eq!(groups[0]["lastMessage"]["id"], sent["id"]);
}

#[tokio::test]
async fn creating_a_one_to_one_that_exists_returns_it_with_no_event() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;

    let (status, body) = post(
        &client,
        &base,
        "/api/direct-messages",
        json!({ "userIds": [id("u-priya")] }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["id"], id("dm-priya"));
    let (_, groups) = get(&client, &base, "/api/direct-messages").await;
    assert_eq!(groups.as_array().unwrap().len(), 5, "no group was added");
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    assert!(heard.iter().all(Vec::is_empty), "{heard:?}");
}

#[tokio::test]
async fn is_group_defaults_to_more_than_two_members_and_an_explicit_value_wins() {
    let (_server, client, base) = showcase().await;
    // Three with me: a group, with its name.
    let (status, group) = post(
        &client,
        &base,
        "/api/direct-messages",
        json!({ "userIds": [id("u-priya"), id("u-samira")], "name": "Trio" }),
    )
    .await;
    assert_eq!(status, 201, "{group}");
    assert_eq!(group["isGroup"], true);
    assert_eq!(group["name"], "Trio");
    assert!(uuid::Uuid::parse_str(group["id"].as_str().unwrap()).is_ok());
    assert_eq!(group["members"].as_array().unwrap().len(), 3);
    assert_eq!(
        group["members"][0]["userId"],
        id("me"),
        "the creator is first"
    );
    assert_eq!(group["lastMessage"], Value::Null);

    // The creator is not counted twice, and duplicates collapse: two people, so a 1:1.
    let (_, again) = post(
        &client,
        &base,
        "/api/direct-messages",
        json!({ "userIds": [id("me"), id("u-mateo"), id("u-mateo")] }),
    )
    .await;
    assert_eq!(again["isGroup"], false);
    assert_eq!(again["members"].as_array().unwrap().len(), 2);

    // `isGroup: true` makes a new group of two instead of reusing the 1:1.
    let (_, forced) = post(
        &client,
        &base,
        "/api/direct-messages",
        json!({ "userIds": [id("u-priya")], "isGroup": true }),
    )
    .await;
    assert_eq!(forced["isGroup"], true);
    assert_ne!(forced["id"], id("dm-priya"));

    let (status, body) = post(
        &client,
        &base,
        "/api/direct-messages",
        json!({ "userIds": ["not-a-uuid"] }),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "VALIDATION_FAILED");
}

#[tokio::test]
async fn adding_members_works_on_groups_and_is_forbidden_on_a_one_to_one() {
    let (_server, client, base) = showcase().await;
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/direct-messages/{}/members", id("dm-priya")),
        json!({ "userIds": [id("u-mateo")] }),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["errorCode"], "FORBIDDEN");

    // A member who is already in, and a user who does not exist, are skipped without an error.
    let launch = format!("/api/direct-messages/{}/members", id("dm-launch"));
    let (status, body) = post(
        &client,
        &base,
        &launch,
        json!({ "userIds": [id("u-mateo"), id("u-aiko"), uuid::Uuid::from_u128(7).to_string()] }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let members = ids_of(&body["members"], "userId");
    assert_eq!(members.len(), 5, "{members:?}");
    assert!(members.contains(&id("u-mateo")));

    let (status, body) = post(&client, &base, &launch, json!({ "userIds": "x" })).await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "VALIDATION_FAILED");
}

#[tokio::test]
async fn leaving_a_dm_removes_it_from_the_list_and_only_a_member_can() {
    let (_server, client, base) = showcase().await;
    let path = format!("/api/direct-messages/{}/members/me", id("dm-launch"));
    let (status, _) = delete(&client, &base, &path, Value::Null).await;
    assert_eq!(status, 204);
    let (_, groups) = get(&client, &base, "/api/direct-messages").await;
    assert!(!ids_of(&groups, "id").contains(&id("dm-launch")));
    // No longer a member: not theirs to leave, nor to add to.
    let (status, body) = delete(&client, &base, &path, Value::Null).await;
    assert_eq!(status, 403, "{body}");
    let (status, _) = post(
        &client,
        &base,
        &format!("/api/direct-messages/{}/members", id("dm-launch")),
        json!({ "userIds": [id("u-mateo")] }),
    )
    .await;
    assert_eq!(status, 403);
    let (status, body) = delete(
        &client,
        &base,
        &format!(
            "/api/direct-messages/{}/members/me",
            uuid::Uuid::from_u128(9)
        ),
        Value::Null,
    )
    .await;
    assert_eq!(status, 404, "{body}");
}

#[tokio::test]
async fn path_ids_that_are_not_uuids_are_a_400() {
    let (_server, client, base) = showcase().await;
    for (path, method) in [
        ("/api/direct-messages/nope/members", "POST"),
        ("/api/direct-messages/nope/members/me", "DELETE"),
        ("/api/friends/status/nope", "GET"),
        ("/api/friends/request/nope", "POST"),
        ("/api/friends/accept/nope", "POST"),
        ("/api/friends/decline/nope", "DELETE"),
        ("/api/friends/cancel/nope", "DELETE"),
        ("/api/friends/nope", "DELETE"),
        ("/api/notifications/nope/read", "POST"),
        ("/api/notifications/nope/dismiss", "POST"),
        ("/api/notifications/channels/nope/override", "GET"),
        ("/api/notifications/channels/nope/override", "PUT"),
        ("/api/notifications/channels/nope/override", "DELETE"),
    ] {
        let method = reqwest::Method::from_bytes(method.as_bytes()).unwrap();
        let body = (method != reqwest::Method::GET && method != reqwest::Method::DELETE)
            .then(|| json!({ "userIds": [], "level": "all" }));
        let (status, body) = request(&client, method.clone(), &base, path, body, true).await;
        assert_eq!(status, 400, "{method} {path}: {body}");
        assert_eq!(body["errorCode"], "BAD_REQUEST", "{path}");
    }
}

#[tokio::test]
async fn user_search_matches_names_leaves_out_a_communitys_members_and_limits() {
    let (_server, client, base) = showcase().await;
    let (status, found) = get(&client, &base, "/api/users/search?q=PRI").await;
    assert_eq!(status, 200, "{found}");
    assert_eq!(ids_of(&found, "id"), vec![id("u-priya")]);

    // Ordered by username; the searcher is not left out.
    let (_, found) = get(&client, &base, "/api/users/search?q=a&limit=50").await;
    let names: Vec<_> = ids_of(&found, "username");
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);
    assert!(ids_of(&found, "id").contains(&id("me")));
    let (_, limited) = get(&client, &base, "/api/users/search?q=a&limit=2").await;
    assert_eq!(limited.as_array().unwrap().len(), 2);

    // c-synth has u-mateo as a member and c-couch does not.
    let (_, outside) = get(
        &client,
        &base,
        &format!("/api/users/search?q=mateo&communityId={}", id("c-couch")),
    )
    .await;
    assert_eq!(ids_of(&outside, "id"), vec![id("u-mateo")]);
    let (_, inside) = get(
        &client,
        &base,
        &format!("/api/users/search?q=mateo&communityId={}", id("c-synth")),
    )
    .await;
    assert!(inside.as_array().unwrap().is_empty(), "{inside}");

    let (status, body) = get(&client, &base, "/api/users/search?q=a&limit=x").await;
    assert_eq!(status, 400, "{body}");
}

// ----- friends ---------------------------------------------------------------------------------

#[tokio::test]
async fn friends_requests_and_status_read_from_the_scenario() {
    let (_server, client, base) = showcase().await;
    let (status, friends) = get(&client, &base, "/api/friends").await;
    assert_eq!(status, 200, "{friends}");
    assert_eq!(friends.as_array().unwrap().len(), 5);
    let priya = friends
        .as_array()
        .unwrap()
        .iter()
        .find(|friend| friend["id"] == id("u-priya").as_str())
        .unwrap();
    assert_eq!(priya["friendshipId"], id("sc-friend-u-priya"));
    assert_eq!(priya["username"], "pri");

    let (_, pending) = get(&client, &base, "/api/friends/requests").await;
    assert_eq!(
        ids_of(&pending["received"], "id"),
        vec![id("sc-friend-u-chloe")]
    );
    assert_eq!(
        ids_of(&pending["sent"], "id"),
        vec![id("sc-friend-out-u-tomas")]
    );
    assert_eq!(pending["received"][0]["userAId"], id("u-chloe"));
    assert_eq!(
        pending["sent"][0]["userAId"],
        id("me"),
        "userA is the sender"
    );

    for (user, expected) in [
        ("u-chloe", json!(["PENDING", "received"])),
        ("u-tomas", json!(["PENDING", "sent"])),
        ("u-priya", json!(["ACCEPTED", null])),
        ("u-mateo", json!([null, null])),
    ] {
        let (status, body) =
            get(&client, &base, &format!("/api/friends/status/{}", id(user))).await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(
            json!([body["status"], body["direction"]]),
            expected,
            "{user}"
        );
        assert_eq!(body["friendshipId"].is_null(), user == "u-mateo", "{user}");
    }
}

#[tokio::test]
async fn a_request_to_someone_who_asked_me_accepts_theirs() {
    let (_server, client, base) = showcase().await;
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/friends/request/{}", id("u-chloe")),
        Value::Null,
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["id"], id("sc-friend-u-chloe"), "the same row");
    assert_eq!(body["status"], "ACCEPTED");
    assert_eq!(body["userAId"], id("u-chloe"), "they stay the sender");
    let (_, friends) = get(&client, &base, "/api/friends").await;
    assert_eq!(friends.as_array().unwrap().len(), 6);
    let (_, pending) = get(&client, &base, "/api/friends/requests").await;
    assert!(pending["received"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn sending_a_request_has_its_refusals() {
    let (_server, client, base) = showcase().await;
    let request = |user: String| {
        let (client, base) = (client.clone(), base.clone());
        async move {
            post(
                &client,
                &base,
                &format!("/api/friends/request/{user}"),
                Value::Null,
            )
            .await
        }
    };
    let (status, body) = request(id("me")).await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (403, Some("FORBIDDEN")),
        "{body}"
    );
    let (status, body) = request(id("u-priya")).await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (409, Some("CONFLICT")),
        "{body}"
    );
    let (status, body) = request(id("u-tomas")).await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (409, Some("CONFLICT")),
        "{body}"
    );
    let (status, body) = request(uuid::Uuid::from_u128(5).to_string()).await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (404, Some("NOT_FOUND")),
        "{body}"
    );

    let (status, body) = request(id("u-mateo")).await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["status"], "PENDING");
    assert_eq!(body["userAId"], id("me"));
    assert_eq!(body["userBId"], id("u-mateo"));
    assert!(uuid::Uuid::parse_str(body["id"].as_str().unwrap()).is_ok());
    let (_, status) = get(
        &client,
        &base,
        &format!("/api/friends/status/{}", id("u-mateo")),
    )
    .await;
    assert_eq!(status["direction"], "sent");
}

#[tokio::test]
async fn only_the_receiver_accepts_or_declines_and_only_the_sender_cancels() {
    let (_server, client, base) = showcase().await;
    let incoming = id("sc-friend-u-chloe");
    let outgoing = id("sc-friend-out-u-tomas");
    let call = |method: reqwest::Method, path: String| {
        let (client, base) = (client.clone(), base.clone());
        async move { request(&client, method, &base, &path, None, true).await }
    };
    use reqwest::Method as M;

    // The wrong party.
    for (method, path, row) in [
        (M::POST, "accept", &outgoing),
        (M::DELETE, "decline", &outgoing),
        (M::DELETE, "cancel", &incoming),
    ] {
        let (status, body) = call(method.clone(), format!("/api/friends/{path}/{row}")).await;
        assert_eq!(
            (status, body["errorCode"].as_str()),
            (403, Some("FORBIDDEN")),
            "{path}: {body}"
        );
    }
    let (status, body) = call(
        M::POST,
        format!("/api/friends/accept/{}", uuid::Uuid::from_u128(1)),
    )
    .await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (404, Some("NOT_FOUND")),
        "{body}"
    );

    // The right party. Declining and cancelling delete the row; success is a body.
    let (status, body) = call(M::DELETE, format!("/api/friends/decline/{incoming}")).await;
    assert_eq!((status, &body), (200, &json!({ "success": true })));
    let (status, body) = call(M::DELETE, format!("/api/friends/cancel/{outgoing}")).await;
    assert_eq!((status, &body), (200, &json!({ "success": true })));
    let (_, pending) = get(&client, &base, "/api/friends/requests").await;
    assert_eq!(pending, json!({ "sent": [], "received": [] }));
    let (status, _) = call(M::DELETE, format!("/api/friends/decline/{incoming}")).await;
    assert_eq!(status, 404, "the row is gone");
    let (_, status) = get(
        &client,
        &base,
        &format!("/api/friends/status/{}", id("u-chloe")),
    )
    .await;
    assert_eq!(status["status"], Value::Null);
}

#[tokio::test]
async fn accepting_moves_a_request_to_friends_and_a_second_accept_conflicts() {
    let (_server, client, base) = showcase().await;
    let path = format!("/api/friends/accept/{}", id("sc-friend-u-chloe"));
    let (status, body) = post(&client, &base, &path, Value::Null).await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["status"], "ACCEPTED");
    let (status, body) = post(&client, &base, &path, Value::Null).await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (409, Some("CONFLICT")),
        "{body}"
    );
    let (_, friends) = get(&client, &base, "/api/friends").await;
    assert!(ids_of(&friends, "id").contains(&id("u-chloe")));
}

#[tokio::test]
async fn removing_a_friend_deletes_the_row_and_only_accepted_ones_can_be_removed() {
    let (_server, client, base) = showcase().await;
    let (status, body) = delete(
        &client,
        &base,
        &format!("/api/friends/{}", id("sc-friend-out-u-tomas")),
        Value::Null,
    )
    .await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (409, Some("CONFLICT")),
        "{body}"
    );
    let (status, body) = delete(
        &client,
        &base,
        &format!("/api/friends/{}", id("sc-friend-u-priya")),
        Value::Null,
    )
    .await;
    assert_eq!((status, &body), (200, &json!({ "success": true })));
    let (_, friends) = get(&client, &base, "/api/friends").await;
    assert_eq!(friends.as_array().unwrap().len(), 4);
    let (status, _) = delete(
        &client,
        &base,
        &format!("/api/friends/{}", id("sc-friend-u-priya")),
        Value::Null,
    )
    .await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn friend_and_dm_group_changes_send_no_socket_events() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut chloe = connect_as(&base, &id("u-chloe")).await;
    let step = |method: reqwest::Method, path: String, body: Option<Value>| {
        let (client, base) = (client.clone(), base.clone());
        async move { request(&client, method, &base, &path, body, true).await }
    };
    use reqwest::Method as M;
    step(
        M::POST,
        format!("/api/friends/request/{}", id("u-mateo")),
        None,
    )
    .await;
    step(
        M::POST,
        format!("/api/friends/accept/{}", id("sc-friend-u-chloe")),
        None,
    )
    .await;
    step(
        M::DELETE,
        format!("/api/friends/{}", id("sc-friend-u-priya")),
        None,
    )
    .await;
    step(
        M::DELETE,
        format!("/api/friends/cancel/{}", id("sc-friend-out-u-tomas")),
        None,
    )
    .await;
    let (_, group) = step(
        M::POST,
        "/api/direct-messages".into(),
        Some(json!({ "userIds": [id("u-priya"), id("u-chloe")] })),
    )
    .await;
    step(
        M::POST,
        format!(
            "/api/direct-messages/{}/members",
            group["id"].as_str().unwrap()
        ),
        Some(json!({ "userIds": [id("u-mateo")] })),
    )
    .await;
    step(
        M::DELETE,
        format!(
            "/api/direct-messages/{}/members/me",
            group["id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    let heard = settle(&server, &mut [&mut me, &mut chloe]).await;
    assert!(heard.iter().all(Vec::is_empty), "{heard:?}");
}

// ----- notifications ---------------------------------------------------------------------------

#[tokio::test]
async fn the_list_is_newest_first_with_dismissed_rows_and_the_backends_total() {
    let (_server, client, base) = showcase().await;
    let (status, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(status, 200, "{list}");
    let rows = list["notifications"].as_array().unwrap();
    assert_eq!(rows.len(), 11);
    assert_eq!(list["total"], 11);
    assert_eq!(list["unreadCount"], 7);
    let times: Vec<_> = rows
        .iter()
        .map(|row| row["createdAt"].as_str().unwrap())
        .collect();
    let mut newest_first = times.clone();
    newest_first.sort_by(|a, b| b.cmp(a));
    assert_eq!(times, newest_first);
    assert_eq!(rows[0]["id"], id("sc-notif-sc-dm-pri-never"));
    let dismissed = rows
        .iter()
        .find(|row| row["dismissed"] == true)
        .expect("a dismissed row is listed");
    assert_eq!(dismissed["id"], id("sc-notif-sc-trail-ridge"));
    assert_eq!(dismissed["communityId"], id("c-trail"));
    assert_eq!(rows[0]["communityId"], Value::Null);
    assert_eq!(rows[0]["messageId"], message_uuid("sc-dm-pri-never"));
    assert_eq!(rows[0]["message"]["id"], message_uuid("sc-dm-pri-never"));
    for kind in [
        "DIRECT_MESSAGE",
        "USER_MENTION",
        "THREAD_REPLY",
        "CHANNEL_MESSAGE",
    ] {
        assert!(rows.iter().any(|row| row["type"] == kind), "no {kind}");
    }
    let thread = rows
        .iter()
        .find(|row| row["type"] == "THREAD_REPLY")
        .unwrap();
    assert_eq!(thread["parentMessageId"], message_uuid("sc-cc-friday"));

    // `total` is this page's size, as the backend's `notifications.length` is.
    let (_, page) = get(&client, &base, "/api/notifications?limit=3&offset=2").await;
    assert_eq!(page["total"], 3);
    assert_eq!(page["unreadCount"], 7);
    assert_eq!(page["notifications"][0]["id"], rows[2]["id"]);

    let (_, unread) = get(&client, &base, "/api/notifications?unreadOnly=true").await;
    assert_eq!(unread["notifications"].as_array().unwrap().len(), 7);
    // `@Type(() => Boolean)`: any non-empty text is true, "false" included.
    let (_, falsy) = get(&client, &base, "/api/notifications?unreadOnly=false").await;
    assert_eq!(falsy["notifications"].as_array().unwrap().len(), 7);
    let (_, empty) = get(&client, &base, "/api/notifications?unreadOnly=").await;
    assert_eq!(empty["notifications"].as_array().unwrap().len(), 11);

    for bad in ["limit=0", "limit=101", "limit=x", "offset=-1"] {
        let (status, body) = get(&client, &base, &format!("/api/notifications?{bad}")).await;
        assert_eq!(status, 400, "{bad}: {body}");
        assert_eq!(body["errorCode"], "VALIDATION_FAILED");
    }
}

#[tokio::test]
async fn the_unread_count_comes_from_the_same_store() {
    let (_server, client, base) = showcase().await;
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(count["count"], 7);
    let (status, _) = post(
        &client,
        &base,
        &format!("/api/notifications/{}/read", id("sc-notif-sc-dm-pri-never")),
        Value::Null,
    )
    .await;
    assert_eq!(status, 200);
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(count["count"], 6);
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(list["unreadCount"], 6);
    // Dismissing doesn't read: the count is unchanged.
    post(
        &client,
        &base,
        &format!(
            "/api/notifications/{}/dismiss",
            id("sc-notif-sc-dm-pri-lmao")
        ),
        Value::Null,
    )
    .await;
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(count["count"], 6);
}

#[tokio::test]
async fn reading_one_notification_sends_notification_read_to_that_user_only() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let row = id("sc-notif-sc-design-accent");
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/notifications/{row}/read"),
        Value::Null,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["read"], true);
    // The bare row: the update returns no author, message or community.
    for key in ["author", "message", "communityId"] {
        assert!(body.get(key).is_none(), "{key} in {body}");
    }
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    assert_eq!(
        heard[0],
        vec![(
            "notificationRead".to_owned(),
            json!({ "notificationId": row })
        )]
    );
    assert!(heard[1].is_empty(), "{heard:?}");

    let (status, body) = post(
        &client,
        &base,
        &format!("/api/notifications/{}/read", uuid::Uuid::from_u128(3)),
        Value::Null,
    )
    .await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (404, Some("NOT_FOUND")),
        "{body}"
    );
}

#[tokio::test]
async fn read_all_and_dismiss_send_nothing() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let dismissed = id("sc-notif-sc-dm-launch-copy");
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/notifications/{dismissed}/dismiss"),
        Value::Null,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        (body["dismissed"].clone(), body["read"].clone()),
        (json!(true), json!(false))
    );
    let (status, body) = post(&client, &base, "/api/notifications/read-all", Value::Null).await;
    assert_eq!((status, &body), (200, &json!({ "count": 7 })));
    let (_, body) = post(&client, &base, "/api/notifications/read-all", Value::Null).await;
    assert_eq!(body["count"], 0);
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(list["unreadCount"], 0);
    assert_eq!(
        list["notifications"].as_array().unwrap().len(),
        11,
        "dismissed rows stay"
    );
    let heard = settle(&server, &mut [&mut me]).await;
    assert!(heard[0].is_empty(), "{heard:?}");
}

#[tokio::test]
async fn settings_start_at_the_defaults_and_update_only_what_is_named() {
    // The showcase sets them; a scenario that doesn't gets the schema's defaults on first read.
    let server = start("big-community").await;
    let (client, base) = (http(), server.base_url());
    let (status, row) = get(&client, &base, "/api/notifications/settings").await;
    assert_eq!(status, 200, "{row}");
    assert_eq!(row["desktopEnabled"], true);
    assert_eq!(row["playSound"], true);
    assert_eq!(row["soundType"], "default");
    assert_eq!(row["defaultChannelLevel"], "mentions");
    assert_eq!(row["dmNotifications"], true);
    assert_eq!(row["doNotDisturb"], false);
    assert_eq!(row["dndStartTime"], Value::Null);
    assert!(uuid::Uuid::parse_str(row["id"].as_str().unwrap()).is_ok());
    let (_, again) = get(&client, &base, "/api/notifications/settings").await;
    assert_eq!(again["id"], row["id"], "stored by the first read");

    server.advance_clock(std::time::Duration::from_secs(60));
    let (status, updated) = put(
        &client,
        &base,
        "/api/notifications/settings",
        json!({ "playSound": false, "soundType": "dm", "dndStartTime": "22:00", "extra": 1 }),
    )
    .await;
    assert_eq!(status, 200, "{updated}");
    assert_eq!(updated["playSound"], false);
    assert_eq!(updated["soundType"], "dm");
    assert_eq!(updated["dndStartTime"], "22:00");
    assert_eq!(updated["desktopEnabled"], true, "untouched");
    assert_ne!(updated["updatedAt"], row["updatedAt"]);
    assert_eq!(updated["createdAt"], row["createdAt"]);
    let (_, read_back) = get(&client, &base, "/api/notifications/settings").await;
    assert_eq!(read_back, updated);

    for bad in [
        json!({ "defaultChannelLevel": "loud" }),
        json!({ "dndStartTime": "25:00" }),
        json!({ "playSound": "yes" }),
    ] {
        let (status, body) = put(&client, &base, "/api/notifications/settings", bad.clone()).await;
        assert_eq!(status, 400, "{bad}: {body}");
        assert_eq!(body["errorCode"], "VALIDATION_FAILED");
    }

    // The showcase's own row is served as it is, with its UUID id.
    let (_, showcase) = {
        let (_server, client, base) = showcase().await;
        get(&client, &base, "/api/notifications/settings").await
    };
    assert_eq!(showcase["id"], id("sc-notif-settings"));
    assert_eq!(showcase["userId"], id("me"));
}

#[tokio::test]
async fn channel_overrides_are_empty_until_set_and_deleting_is_idempotent() {
    let (_server, client, base) = showcase().await;
    let general = &format!("/api/notifications/channels/{}/override", id("cc-general"));
    let response = client
        .get(format!("{base}{general}"))
        .header("Authorization", TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(
        response.text().await.unwrap(),
        "",
        "no override is an empty body"
    );

    let (status, seeded) = get(
        &client,
        &base,
        &format!("/api/notifications/channels/{}/override", id("tr-general")),
    )
    .await;
    assert_eq!(status, 200, "{seeded}");
    assert_eq!(seeded["level"], "none");
    assert_eq!(seeded["id"], id("sc-notif-override-tr-general"));
    assert_eq!(seeded["userId"], id("me"));

    let (status, set) = put(&client, &base, general, json!({ "level": "all" })).await;
    assert_eq!(status, 200, "{set}");
    assert_eq!(set["level"], "all");
    assert_eq!(set["channelId"], id("cc-general"));
    server_time_check(&set);
    let (_, changed) = put(&client, &base, general, json!({ "level": "mentions" })).await;
    assert_eq!(changed["id"], set["id"], "an upsert keeps the row");
    assert_eq!(changed["level"], "mentions");
    let (_, read_back) = get(&client, &base, general).await;
    assert_eq!(read_back, changed);

    let (status, body) = put(&client, &base, general, json!({ "level": "loud" })).await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (400, Some("VALIDATION_FAILED")),
        "{body}"
    );
    let (status, body) = put(
        &client,
        &base,
        &format!(
            "/api/notifications/channels/{}/override",
            uuid::Uuid::from_u128(1)
        ),
        json!({ "level": "all" }),
    )
    .await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (404, Some("NOT_FOUND")),
        "{body}"
    );

    for _ in 0..2 {
        let (status, _) = delete(&client, &base, general, Value::Null).await;
        assert_eq!(status, 204);
    }
    let response = client
        .get(format!("{base}{general}"))
        .header("Authorization", TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.text().await.unwrap(), "");
}

fn server_time_check(row: &Value) {
    assert_eq!(row["createdAt"], row["updatedAt"]);
}

// ----- socket rules ----------------------------------------------------------------------------

fn dm_text(group: &str, text: &str, nonce: u128) -> Value {
    json!({
        "directMessageGroupId": group,
        "spans": [{ "type": "PLAINTEXT", "text": text }],
        "attachments": [],
        "clientNonce": uuid::Uuid::from_u128(nonce).to_string(),
    })
}

fn channel_mention(channel: &str, user: &str, nonce: u128) -> Value {
    json!({
        "channelId": id(channel),
        "spans": [
            { "type": "USER_MENTION", "text": "@them", "userId": user },
            { "type": "PLAINTEXT", "text": " look" },
        ],
        "attachments": [],
        "clientNonce": uuid::Uuid::from_u128(nonce).to_string(),
    })
}

#[tokio::test]
async fn a_dm_goes_to_its_members_and_notifies_the_others() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let mut mateo = connect_as(&base, &id("u-mateo")).await; // not in the group

    let launch = id("dm-launch");
    let (events, ack) = emit_event(
        &mut me,
        1,
        "sendDirectMessage",
        dm_text(&launch, "hi crew", 1),
    )
    .await;
    assert_eq!(ack["ok"], true, "{ack}");
    assert_eq!(
        names(&events),
        vec!["newDirectMessage"],
        "the sender gets the message, not a notification"
    );
    let heard = settle(&server, &mut [&mut samira, &mut mateo]).await;
    assert_eq!(
        names(&heard[0]),
        vec!["newDirectMessage", "newNotification"]
    );
    assert!(
        heard[1].is_empty(),
        "a non-member hears nothing: {:?}",
        heard[1]
    );
    let notification = &heard[0][1].1;
    assert_eq!(notification["type"], "DIRECT_MESSAGE");
    assert_eq!(notification["directMessageGroupId"], launch);
    assert_eq!(notification["authorId"], id("me"));
    assert_eq!(notification["channelId"], Value::Null);
    assert_eq!(notification["read"], false);
    assert_eq!(notification["message"]["spans"][0]["text"], "hi crew");

    // The rows are per recipient: none of them is the signed-in user's.
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(list["notifications"].as_array().unwrap().len(), 11);
}

#[tokio::test]
async fn a_dm_notification_is_skipped_when_dm_notifications_is_off() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let dm = id("dm-priya");

    let (events, _) = emit_event(&mut priya, 1, "sendDirectMessage", dm_text(&dm, "one", 1)).await;
    assert_eq!(names(&events), vec!["newDirectMessage"]);
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(
        names(&heard[0]),
        vec!["newDirectMessage", "newNotification"]
    );
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(list["notifications"].as_array().unwrap().len(), 12);
    assert_eq!(list["notifications"][0]["type"], "DIRECT_MESSAGE");
    assert_eq!(list["notifications"][0]["authorId"], id("u-priya"));

    put(
        &client,
        &base,
        "/api/notifications/settings",
        json!({ "dmNotifications": false }),
    )
    .await;
    emit_event(&mut priya, 2, "sendDirectMessage", dm_text(&dm, "two", 2)).await;
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(
        names(&heard[0]),
        vec!["newDirectMessage"],
        "the message still arrives"
    );
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(
        list["notifications"].as_array().unwrap().len(),
        12,
        "no row either"
    );
}

#[tokio::test]
async fn a_channel_mention_notifies_the_mentioned_user_never_the_author() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;

    // Priya mentions me.
    let (events, _) = emit_event(
        &mut priya,
        1,
        "sendMessage",
        channel_mention("cc-general", &id("me"), 1),
    )
    .await;
    assert_eq!(names(&events), vec!["newMessage"]);
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(names(&heard[0]), vec!["newMessage", "newNotification"]);
    let payload = &heard[0][1].1;
    assert_eq!(payload["type"], "USER_MENTION");
    assert_eq!(payload["channelId"], id("cc-general"));
    assert_eq!(payload["channelName"], "general");
    assert_eq!(payload["communityId"], id("c-couch"));
    assert_eq!(payload["authorId"], id("u-priya"));
    assert_eq!(payload["author"]["username"], "pri");
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(list["notifications"][0]["type"], "USER_MENTION");
    assert_eq!(list["notifications"][0]["id"], payload["notificationId"]);
    assert_eq!(list["notifications"][0]["communityId"], id("c-couch"));
    assert_eq!(list["unreadCount"], 8);

    // Me mentioning me: the author is never notified.
    let (events, _) = emit_event(
        &mut me,
        1,
        "sendMessage",
        channel_mention("cc-general", &id("me"), 2),
    )
    .await;
    assert_eq!(names(&events), vec!["newMessage"]);
    // Me mentioning priya: priya is, and I am not told of it (my own send's events end at its ack).
    let (events, _) = emit_event(
        &mut me,
        2,
        "sendMessage",
        channel_mention("cc-general", &id("u-priya"), 3),
    )
    .await;
    assert_eq!(names(&events), vec!["newMessage"]);
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    assert!(heard[0].is_empty(), "{:?}", heard[0]);
    assert_eq!(
        names(&heard[1]),
        vec!["newMessage", "newMessage", "newNotification"]
    );
    assert_eq!(heard[1][2].1["type"], "USER_MENTION");
    assert_eq!(heard[1][2].1["authorId"], id("me"));
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(
        list["unreadCount"], 8,
        "the signed-in user got one row, not three"
    );
}

#[tokio::test]
async fn a_mention_is_skipped_when_the_level_for_the_channel_is_none() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    put(
        &client,
        &base,
        &format!("/api/notifications/channels/{}/override", id("cc-general")),
        json!({ "level": "none" }),
    )
    .await;
    emit_event(
        &mut priya,
        1,
        "sendMessage",
        channel_mention("cc-general", &id("me"), 1),
    )
    .await;
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(names(&heard[0]), vec!["newMessage"]);
    let (_, list) = get(&client, &base, "/api/notifications").await;
    assert_eq!(list["notifications"].as_array().unwrap().len(), 11);

    // The default level applies where there is no override: none there silences it too.
    put(
        &client,
        &base,
        "/api/notifications/settings",
        json!({ "defaultChannelLevel": "none" }),
    )
    .await;
    emit_event(
        &mut priya,
        2,
        "sendMessage",
        channel_mention("cc-clips", &id("me"), 2),
    )
    .await;
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(names(&heard[0]), vec!["newMessage"]);
    // An override of all brings it back.
    put(
        &client,
        &base,
        &format!("/api/notifications/channels/{}/override", id("cc-clips")),
        json!({ "level": "all" }),
    )
    .await;
    emit_event(
        &mut priya,
        3,
        "sendMessage",
        channel_mention("cc-clips", &id("me"), 3),
    )
    .await;
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(names(&heard[0]), vec!["newMessage", "newNotification"]);
}

#[tokio::test]
async fn mark_as_read_reads_the_contexts_notifications_silently_and_sends_the_receipt() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let dm = id("dm-priya");
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(count["count"], 7);

    let (events, _) = emit_event(
        &mut me,
        1,
        "markAsRead",
        json!({ "directMessageGroupId": dm, "lastReadMessageId": message_uuid("sc-dm-pri-never") }),
    )
    .await;
    // To the user, then the DM room (the reader is in it): the second one names the reader.
    assert_eq!(
        names(&events),
        vec!["readReceiptUpdated", "readReceiptUpdated"]
    );
    let own = &events[0].1;
    assert_eq!(own["directMessageGroupId"], dm);
    assert_eq!(own["channelId"], Value::Null);
    assert_eq!(own["lastReadMessageId"], message_uuid("sc-dm-pri-never"));
    assert!(own["lastReadAt"].is_string());
    assert!(own.get("userId").is_none());
    assert_eq!(events[1].1["userId"], id("me"));
    assert_eq!(events[1].1["username"], "alexk");
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    assert!(heard[0].is_empty(), "no notificationRead: {:?}", heard[0]);
    assert_eq!(
        names(&heard[1]),
        vec!["readReceiptUpdated"],
        "the other member sees who read"
    );
    assert_eq!(heard[1][0].1["userId"], id("me"));

    // The three unread DM notifications of that group are read; the rest are not.
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(count["count"], 4);
    let (_, list) = get(&client, &base, "/api/notifications?unreadOnly=true").await;
    assert!(
        list["notifications"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["directMessageGroupId"] != dm.as_str()),
        "{list}"
    );

    // A channel: its mention is read, and only the self receipt goes out.
    let (_, page) = get(
        &client,
        &base,
        &format!("/api/messages/channel/{}?limit=1", id("ch-design")),
    )
    .await;
    let last = page["messages"][0]["id"].as_str().unwrap().to_owned();
    let (events, _) = emit_event(
        &mut me,
        2,
        "markAsRead",
        json!({ "channelId": id("ch-design"), "lastReadMessageId": last }),
    )
    .await;
    assert_eq!(names(&events), vec!["readReceiptUpdated"]);
    assert_eq!(events[0].1["channelId"], id("ch-design"));
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(count["count"], 3);
    let heard = settle(&server, &mut [&mut me]).await;
    assert!(heard[0].is_empty());
}

#[tokio::test]
async fn mark_as_read_with_no_context_or_a_foreign_message_is_refused() {
    let (_server, _client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    for payload in [
        json!({ "lastReadMessageId": message_uuid("sc-dm-pri-never") }),
        json!({ "channelId": id("ch-design"), "directMessageGroupId": id("dm-priya"), "lastReadMessageId": message_uuid("sc-dm-pri-never") }),
        json!({ "directMessageGroupId": id("dm-launch"), "lastReadMessageId": message_uuid("sc-dm-pri-never") }),
    ] {
        me.send(&format!("42{}", json!(["markAsRead", payload])))
            .await;
        let (name, body) = event(&me.next_text().await);
        assert_eq!(name, "exception");
        assert_eq!(body["errorCode"], "BAD_REQUEST");
    }
}

#[tokio::test]
async fn rest_mark_read_reads_notifications_and_sends_the_receipts_like_the_socket_event() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let dm = id("dm-priya");
    let (status, receipt) = post(
        &client,
        &base,
        "/api/read-receipts/mark-read",
        json!({ "directMessageGroupId": dm, "lastReadMessageId": message_uuid("sc-dm-pri-never") }),
    )
    .await;
    assert_eq!(status, 200, "{receipt}");
    assert_eq!(receipt["directMessageGroupId"], dm);
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    // To the user, then the DM room (the reader is in it); the other member sees who read.
    assert_eq!(
        names(&heard[0]),
        vec!["readReceiptUpdated", "readReceiptUpdated"]
    );
    assert!(heard[0][0].1.get("userId").is_none());
    assert_eq!(heard[0][1].1["userId"], id("me"));
    assert_eq!(names(&heard[1]), vec!["readReceiptUpdated"]);
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(
        count["count"], 4,
        "dm-priya's three unread notifications are read"
    );

    // A channel: only the self receipt, and its mention is read.
    let (_, page) = get(
        &client,
        &base,
        &format!("/api/messages/channel/{}?limit=1", id("ch-design")),
    )
    .await;
    let last = page["messages"][0]["id"].clone();
    post(
        &client,
        &base,
        "/api/read-receipts/mark-read",
        json!({ "channelId": id("ch-design"), "lastReadMessageId": last }),
    )
    .await;
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    assert_eq!(names(&heard[0]), vec!["readReceiptUpdated"]);
    assert!(heard[1].is_empty());
    let (_, count) = get(&client, &base, "/api/notifications/unread-count").await;
    assert_eq!(count["count"], 3);

    // The backend refuses a message that is not in that context.
    let (status, body) = post(
        &client,
        &base,
        "/api/read-receipts/mark-read",
        json!({ "channelId": id("ch-design"), "lastReadMessageId": message_uuid("sc-dm-pri-never") }),
    )
    .await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (400, Some("BAD_REQUEST")),
        "{body}"
    );
}

#[tokio::test]
async fn finding_one_dm_needs_membership() {
    let (_server, client, base) = showcase().await;
    let (status, group) = get(
        &client,
        &base,
        &format!("/api/direct-messages/{}", id("dm-launch")),
    )
    .await;
    assert_eq!(status, 200, "{group}");
    assert_eq!(group["id"], id("dm-launch"));
    assert_eq!(group["members"].as_array().unwrap().len(), 4);
    // Unknown group and a group left are both "not a member": the backend checks that first.
    let (status, body) = get(
        &client,
        &base,
        &format!("/api/direct-messages/{}", uuid::Uuid::from_u128(4)),
    )
    .await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (403, Some("FORBIDDEN")),
        "{body}"
    );
    delete(
        &client,
        &base,
        &format!("/api/direct-messages/{}/members/me", id("dm-launch")),
        Value::Null,
    )
    .await;
    let (status, _) = get(
        &client,
        &base,
        &format!("/api/direct-messages/{}", id("dm-launch")),
    )
    .await;
    assert_eq!(status, 403);
    let (status, body) = get(&client, &base, "/api/direct-messages/nope").await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (400, Some("BAD_REQUEST")),
        "{body}"
    );
}

#[tokio::test]
async fn presence_online_is_recorded_and_acknowledged() {
    let (server, _client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    me.send(&format!(
        "42{}",
        json!(["presenceOnline", { "idle": true }])
    ))
    .await;
    me.send(&format!(
        "423{}",
        json!(["presenceOnline", { "idle": false }])
    ))
    .await;
    let ack = parse_ack(&me.next_text().await).expect("an ack");
    assert_eq!(ack, (3, json!("ACK")));
    let idle: Vec<_> = server
        .requests()
        .into_iter()
        .filter_map(|record| match record {
            semaphore_fake_server::Record::Socket { event, payload, .. }
                if event == "presenceOnline" =>
            {
                payload
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        idle,
        vec![json!({ "idle": true }), json!({ "idle": false })]
    );
}

#[tokio::test]
async fn control_emit_reaches_every_socket_or_one_users() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let payload = json!({ "notificationId": id("sc-notif-sc-dm-pri-never") });
    let (status, _) = post(
        &client,
        &base,
        "/__control/emit",
        json!({ "event": "notificationRead", "payload": payload, "userId": id("u-priya") }),
    )
    .await;
    assert_eq!(status, 200);
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    assert!(heard[0].is_empty());
    assert_eq!(
        heard[1],
        vec![("notificationRead".to_owned(), payload.clone())]
    );

    post(
        &client,
        &base,
        "/__control/emit",
        json!({ "event": "notificationRead", "payload": payload }),
    )
    .await;
    let heard = settle(&server, &mut [&mut me, &mut priya]).await;
    assert_eq!(heard[0].len(), 1);
    assert_eq!(heard[1].len(), 1);
}

#[tokio::test]
async fn every_new_operation_can_be_failed_by_its_operation_id() {
    let (server, client, base) = showcase().await;
    use reqwest::Method as M;
    let some = uuid::Uuid::from_u128(1).to_string();
    let cases: Vec<(&str, M, String)> = vec![
        (
            "DirectMessagesController_findUserDmGroups",
            M::GET,
            "/api/direct-messages".into(),
        ),
        (
            "DirectMessagesController_createDmGroup",
            M::POST,
            "/api/direct-messages".into(),
        ),
        (
            "DirectMessagesController_addMembers",
            M::POST,
            format!("/api/direct-messages/{some}/members"),
        ),
        (
            "DirectMessagesController_leaveDmGroup",
            M::DELETE,
            format!("/api/direct-messages/{some}/members/me"),
        ),
        (
            "UserController_searchUsers",
            M::GET,
            "/api/users/search?q=a".into(),
        ),
        (
            "FriendsController_getFriends",
            M::GET,
            "/api/friends".into(),
        ),
        (
            "FriendsController_getPendingRequests",
            M::GET,
            "/api/friends/requests".into(),
        ),
        (
            "FriendsController_getFriendshipStatus",
            M::GET,
            format!("/api/friends/status/{some}"),
        ),
        (
            "FriendsController_sendFriendRequest",
            M::POST,
            format!("/api/friends/request/{some}"),
        ),
        (
            "FriendsController_acceptFriendRequest",
            M::POST,
            format!("/api/friends/accept/{some}"),
        ),
        (
            "FriendsController_declineFriendRequest",
            M::DELETE,
            format!("/api/friends/decline/{some}"),
        ),
        (
            "FriendsController_cancelFriendRequest",
            M::DELETE,
            format!("/api/friends/cancel/{some}"),
        ),
        (
            "FriendsController_removeFriend",
            M::DELETE,
            format!("/api/friends/{some}"),
        ),
        (
            "NotificationsController_getNotifications",
            M::GET,
            "/api/notifications".into(),
        ),
        (
            "NotificationsController_markAsRead",
            M::POST,
            format!("/api/notifications/{some}/read"),
        ),
        (
            "NotificationsController_markAllAsRead",
            M::POST,
            "/api/notifications/read-all".into(),
        ),
        (
            "NotificationsController_dismissNotification",
            M::POST,
            format!("/api/notifications/{some}/dismiss"),
        ),
        (
            "NotificationsController_getSettings",
            M::GET,
            "/api/notifications/settings".into(),
        ),
        (
            "NotificationsController_updateSettings",
            M::PUT,
            "/api/notifications/settings".into(),
        ),
        (
            "NotificationsController_getChannelOverride",
            M::GET,
            format!("/api/notifications/channels/{some}/override"),
        ),
        (
            "NotificationsController_setChannelOverride",
            M::PUT,
            format!("/api/notifications/channels/{some}/override"),
        ),
        (
            "NotificationsController_deleteChannelOverride",
            M::DELETE,
            format!("/api/notifications/channels/{some}/override"),
        ),
        (
            "NotificationsController_getUnreadCount",
            M::GET,
            "/api/notifications/unread-count".into(),
        ),
    ];
    for (operation, method, path) in cases {
        server.fail_route(operation, 503, "UNAVAILABLE");
        let body = (method == M::POST || method == M::PUT).then(|| json!({}));
        let (status, body) = request(&client, method.clone(), &base, &path, body, true).await;
        assert_eq!(status, 503, "{operation}: {method} {path}: {body}");
        assert_eq!(body["errorCode"], "UNAVAILABLE", "{operation}");
    }
}

// ----- Controls that act as another user (the slice rig's W2 steps) ----------------------------

#[tokio::test]
async fn control_post_dm_as_reaches_the_dms_members_and_notifies_them() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let (status, posted) = post(
        &client,
        &base,
        "/__control/post_dm_as",
        json!({ "dmGroupId": id("dm-priya"), "authorId": id("u-priya"), "text": "lunch?" }),
    )
    .await;
    assert_eq!(status, 200, "{posted}");
    let heard = settle(&server, &mut [&mut me, &mut priya, &mut samira]).await;
    assert_eq!(
        names(&heard[0]),
        vec!["newDirectMessage", "newNotification"]
    );
    assert_eq!(heard[0][0].1["message"]["id"], posted["id"]);
    assert_eq!(
        heard[0][0].1["message"]["directMessageGroupId"],
        id("dm-priya")
    );
    assert_eq!(heard[0][1].1["type"], "DIRECT_MESSAGE");
    // The author hears their own message, and not a notification; a non-member hears nothing.
    assert_eq!(names(&heard[1]), vec!["newDirectMessage"]);
    assert!(heard[2].is_empty(), "{:?}", heard[2]);
    let (_, groups) = get(&client, &base, "/api/direct-messages").await;
    assert_eq!(groups[0]["id"], id("dm-priya"));
    assert_eq!(groups[0]["lastMessage"]["id"], posted["id"]);

    // Unknown DMs and authors are refused.
    for body in [
        json!({ "dmGroupId": id("dm-nope"), "authorId": id("u-priya"), "text": "x" }),
        json!({ "dmGroupId": id("dm-priya"), "authorId": id("u-nope"), "text": "x" }),
        json!({ "dmGroupId": id("dm-priya"), "authorId": id("u-priya") }),
    ] {
        let (status, _) = post(&client, &base, "/__control/post_dm_as", body).await;
        assert_eq!(status, 400);
    }
}

#[tokio::test]
async fn control_post_as_with_a_mention_notifies_the_mentioned_user() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let (status, posted) = post(
        &client,
        &base,
        "/__control/post_as",
        json!({
            "channelId": id("cc-general"),
            "authorId": id("u-priya"),
            "text": "look at this ",
            "mentionUserId": id("me"),
        }),
    )
    .await;
    assert_eq!(status, 200, "{posted}");
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(names(&heard[0]), vec!["newMessage", "newNotification"]);
    let spans = heard[0][0].1["message"]["spans"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(spans[1]["type"], "USER_MENTION");
    assert_eq!(spans[1]["userId"], id("me"));
    assert_eq!(spans[1]["text"], "@alexk");
    assert_eq!(heard[0][1].1["type"], "USER_MENTION");
    assert_eq!(heard[0][1].1["messageId"], posted["id"]);
}

#[tokio::test]
async fn control_friend_request_as_is_a_received_request_me_can_accept() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let (status, made) = post(
        &client,
        &base,
        "/__control/friend_request_as",
        json!({ "fromId": id("u-zara"), "id": "w2-zara" }),
    )
    .await;
    assert_eq!(status, 200, "{made}");
    assert_eq!(made["id"], id("w2-zara"), "served as the readable id given");
    // As the backend: no socket event; the list shows it.
    let heard = settle(&server, &mut [&mut me]).await;
    assert!(heard[0].is_empty(), "{:?}", heard[0]);
    let (_, pending) = get(&client, &base, "/api/friends/requests").await;
    assert_eq!(
        ids_of(&pending["received"], "id"),
        vec![
            id("sc-friend-u-chloe"),
            made["id"].as_str().unwrap().to_owned()
        ]
    );
    assert_eq!(pending["received"][1]["userAId"], id("u-zara"));
    assert_eq!(pending["received"][1]["userBId"], id("me"));

    let path = format!("/api/friends/accept/{}", made["id"].as_str().unwrap());
    let (status, accepted) = post(&client, &base, &path, json!({})).await;
    assert_eq!(status, 201, "{accepted}");
    let (_, friends) = get(&client, &base, "/api/friends").await;
    assert!(ids_of(&friends, "id").contains(&id("u-zara")), "{friends}");

    // Twice, from me, or from nobody: refused.
    for from in [id("u-zara"), id("me"), id("u-nope")] {
        let (status, _) = post(
            &client,
            &base,
            "/__control/friend_request_as",
            json!({ "fromId": from }),
        )
        .await;
        assert_eq!(status, 400);
    }
}
