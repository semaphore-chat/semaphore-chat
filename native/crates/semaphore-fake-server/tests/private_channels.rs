//! Private channels as `ChannelAccessService.canViewChannel` and the message guards see them: a
//! private channel is visible to its community's members on its list and to the instance owner; a
//! private channel with no list is visible only to the owner. Its message history and sends are
//! guarded the same way (`RbacGuard`'s `READ_MESSAGE`/`CREATE_MESSAGE` on the channel).

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

/// A bearer for a session as another scenario user (`sign_in_as`, then a login).
async fn bearer_for(client: &reqwest::Client, base: &str, username: &str, user_id: &str) -> String {
    let (status, _) = post(
        client,
        base,
        "/__control/sign_in_as",
        json!({ "username": username, "userId": user_id }),
    )
    .await;
    assert_eq!(status, 200);
    let response = client
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "username": username, "password": "pw" }))
        .send()
        .await
        .unwrap();
    let body: Value = response.json().await.unwrap();
    format!("Bearer {}", body["accessToken"].as_str().expect("a token"))
}

async fn send(
    client: &reqwest::Client,
    method: reqwest::Method,
    base: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (u16, Value) {
    let mut builder = client
        .request(method, format!("{base}{path}"))
        .header("Authorization", bearer);
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder.send().await.unwrap();
    let status = response.status().as_u16();
    let text = response.text().await.unwrap();
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

fn channel_names(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|channel| channel["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn a_private_channel_is_visible_readable_and_postable_only_to_its_list_and_the_owner() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (status, made) = post(
        &client,
        &base,
        "/api/channels",
        json!({ "name": "secret", "communityId": couch, "type": "TEXT", "isPrivate": true }),
    )
    .await;
    assert_eq!(status, 201, "{made}");
    let secret = made["id"].as_str().unwrap().to_owned();
    let list_path = format!("/api/channels/community/{couch}");
    let history = format!("/api/messages/channel/{secret}");

    let samira = bearer_for(&client, &base, "samira", &id("u-samira")).await;
    let mateo = bearer_for(&client, &base, "mateo", &id("u-mateo")).await;

    // Its creator (the instance owner) sees it; a community member not on its list, and a
    // non-member, don't.
    let (_, list) = get(&client, &base, &list_path).await;
    assert!(
        channel_names(&list).contains(&"secret".to_owned()),
        "{list}"
    );
    let (_, list) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &list_path,
        &samira,
        None,
    )
    .await;
    assert!(
        !channel_names(&list).contains(&"secret".to_owned()),
        "{list}"
    );
    let (_, list) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &list_path,
        &mateo,
        None,
    )
    .await;
    assert!(
        channel_names(&list).is_empty(),
        "not in the community: {list}"
    );

    // The owner writes to it, and reads it back.
    let (status, body) = post(
        &client,
        &base,
        "/api/messages",
        json!({ "channelId": secret, "spans": [{ "type": "PLAINTEXT", "text": "for us" }], "attachments": [] }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let (status, body) = get(&client, &base, &history).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["messages"].as_array().unwrap().len(), 1, "{body}");

    // A member off the list, and a non-member, are refused both ways.
    for bearer in [&samira, &mateo] {
        let (status, body) =
            send(&client, reqwest::Method::GET, &base, &history, bearer, None).await;
        assert_eq!(status, 403, "{body}");
        assert_eq!(body["errorCode"], "FORBIDDEN");
        assert_eq!(body["message"], "Forbidden resource");
        let (status, body) = send(
            &client,
            reqwest::Method::POST,
            &base,
            "/api/messages",
            bearer,
            Some(json!({ "channelId": secret, "spans": [{ "type": "PLAINTEXT", "text": "hey" }], "attachments": [] })),
        )
        .await;
        assert_eq!(status, 403, "{body}");
    }

    // The socket's send is guarded like the REST route (`RbacGuard` on `sendMessage`).
    let mut mateo_socket = connect_as(&base, &id("u-mateo")).await;
    let (_, ack) = emit_event(
        &mut mateo_socket,
        1,
        "sendMessage",
        json!({ "channelId": secret, "spans": [{ "type": "PLAINTEXT", "text": "hey" }], "attachments": [] }),
    )
    .await;
    assert_eq!(ack["ok"], false, "{ack}");
    assert_eq!(ack["error"]["errorCode"], "FORBIDDEN");

    // Put a member on the list: it appears, reads and posts, as themselves.
    let (status, body) = post(
        &client,
        &base,
        "/api/channel-membership",
        json!({ "channelId": secret, "userId": id("u-samira") }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let (_, list) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &list_path,
        &samira,
        None,
    )
    .await;
    assert!(
        channel_names(&list).contains(&"secret".to_owned()),
        "{list}"
    );
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &history,
        &samira,
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["messages"][0]["spans"][0]["text"], "for us");
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/messages",
        &samira,
        Some(json!({
            "channelId": secret,
            "spans": [{ "type": "PLAINTEXT", "text": "hello from samira" }],
            "attachments": [],
        })),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["authorId"], id("u-samira").as_str());
    // Still not for a non-member.
    let (status, _) = send(&client, reqwest::Method::GET, &base, &history, &mateo, None).await;
    assert_eq!(status, 403);

    // No list at all: only the instance owner sees it.
    let (status, _) = delete(
        &client,
        &base,
        &format!(
            "/api/channel-membership/channel/{secret}/user/{}",
            id("u-samira")
        ),
        json!({}),
    )
    .await;
    assert_eq!(status, 204);
    let (status, _) = delete(
        &client,
        &base,
        &format!("/api/channel-membership/channel/{secret}/user/{}", id("me")),
        json!({}),
    )
    .await;
    assert_eq!(status, 204, "the owner may leave its list");
    let (_, list) = get(&client, &base, &list_path).await;
    assert!(
        channel_names(&list).contains(&"secret".to_owned()),
        "the owner still sees it: {list}"
    );
    let (_, list) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &list_path,
        &samira,
        None,
    )
    .await;
    assert!(
        !channel_names(&list).contains(&"secret".to_owned()),
        "no list, no member: {list}"
    );
    let (status, _) = get(&client, &base, &history).await;
    assert_eq!(status, 200, "the owner still reads it");
    let (status, _) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &history,
        &samira,
        None,
    )
    .await;
    assert_eq!(status, 403, "and a member without a list cannot");
    let _ = server;
}
