//! W6-C over real HTTP: per-user storage, quotas and recalculation. Each answer decodes as its
//! wire type (the contract's shape), and each test names the backend behaviour it keeps.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{error}: {value}"))
}

/// A request as an arbitrary bearer: the common helpers act as the scenario's owner.
async fn as_bearer(
    client: &reqwest::Client,
    method: reqwest::Method,
    base: &str,
    path: &str,
    body: Option<Value>,
    token: &str,
) -> (u16, Value) {
    let mut builder = client
        .request(method, format!("{base}{path}"))
        .header("Authorization", token);
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder.send().await.expect("the fake answers");
    let status = response.status().as_u16();
    let text = response.text().await.expect("a body");
    let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (status, value)
}

/// Signs in over HTTP as `username` and returns its bearer.
async fn bearer_for(client: &reqwest::Client, base: &str, username: &str) -> String {
    let (status, body) = request(
        client,
        reqwest::Method::POST,
        base,
        "/api/auth/login",
        Some(json!({ "username": username, "password": "pw" })),
        false,
    )
    .await;
    assert_eq!(status, 200, "login as {username}: {body}");
    format!(
        "Bearer {}",
        body["accessToken"].as_str().expect("an access token")
    )
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

async fn patch(client: &reqwest::Client, base: &str, path: &str, body: Value) -> (u16, Value) {
    request(client, reqwest::Method::PATCH, base, path, Some(body), true).await
}

/// Sets used bytes for users through the fake's control.
async fn set_usage(client: &reqwest::Client, base: &str, usage: Value) {
    let (status, body) = post(client, base, "/__control/storage_usage", usage).await;
    assert_eq!(status, 200, "{body}");
}

fn usernames(list: &[wire::UserStorageStatsDto]) -> Vec<&str> {
    list.iter().map(|row| row.username.as_str()).collect()
}

#[tokio::test]
async fn every_route_answers_the_contracts_shape() {
    let (_server, client, base) = showcase().await;

    // The list: 13 users, the controller's page of 20, everyone at the default quota.
    let (status, body) = get(&client, &base, "/api/storage/users").await;
    assert_eq!(status, 200, "{body}");
    let list: wire::UserStorageListResponseDto = decode(&body);
    assert_eq!((list.users.len(), list.total), (13, 13));
    let row = list.users.first().expect("users are listed");
    assert_eq!(row.used_bytes, 0);
    assert_eq!(row.quota_bytes, 53_687_091_200);
    assert_eq!(row.percent_used, 0.0);
    assert_eq!(row.file_count, 0);
    assert!(!row.username.is_empty());

    // One user's row.
    let (status, body) = get(
        &client,
        &base,
        &format!("/api/storage/users/{}", id("u-priya")),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let stats: wire::UserStorageStatsDto = decode(&body);
    assert_eq!(stats.username, "pri");
    assert_eq!(stats.quota_bytes, 53_687_091_200);

    // A quota change answers the row it changed.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/storage/users/{}/quota", id("u-priya")),
        json!({ "quotaBytes": 1_000 }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let changed: wire::UserStorageStatsDto = decode(&body);
    assert_eq!((changed.quota_bytes, changed.percent_used), (1_000, 0.0));
    let (_, body) = get(
        &client,
        &base,
        &format!("/api/storage/users/{}", id("u-priya")),
    )
    .await;
    let stats: wire::UserStorageStatsDto = decode(&body);
    assert_eq!(stats.quota_bytes, 1_000, "the server kept it");

    // Recalculating answers the row too.
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/storage/users/{}/recalculate", id("u-priya")),
        json!({}),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let recalculated: wire::UserStorageStatsDto = decode(&body);
    assert_eq!(recalculated.user_id, id("u-priya"));
    assert_eq!(recalculated.quota_bytes, 1_000);
}

#[tokio::test]
async fn usage_filters_and_sorts_the_list() {
    let (_server, client, base) = showcase().await;
    let mut usage = serde_json::Map::new();
    usage.insert(id("u-priya"), json!(4_294_967_296i64)); // 8%
    usage.insert(id("u-marcus"), json!(48_000_000_000i64)); // 89.41%
    usage.insert(id("u-aiko"), json!(53_687_091_200i64)); // 100%
    set_usage(&client, &base, Value::Object(usage)).await;

    let (status, body) = get(&client, &base, "/api/storage/users").await;
    assert_eq!(status, 200, "{body}");
    let list: wire::UserStorageListResponseDto = decode(&body);
    assert_eq!(list.total, 13, "the total counts every user");
    assert_eq!(
        &usernames(&list.users)[..3],
        ["aiko", "dropbear", "pri"],
        "most used first; the zeros tie on id"
    );
    assert_eq!(list.users[0].percent_used, 100.0);
    assert_eq!(list.users[1].percent_used, 89.41);
    assert_eq!(list.users[2].percent_used, 8.0);
    assert_eq!(list.users[0].used_bytes, 53_687_091_200);

    // minPercentUsed keeps the users at or over it.
    let (status, body) = get(&client, &base, "/api/storage/users?minPercentUsed=50").await;
    assert_eq!(status, 200, "{body}");
    let filtered: wire::UserStorageListResponseDto = decode(&body);
    assert_eq!(usernames(&filtered.users), ["aiko", "dropbear"]);
    assert_eq!(filtered.total, 2, "the total counts the filtered users");

    // The page follows skip and take.
    let (status, body) = get(&client, &base, "/api/storage/users?skip=1&take=2").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::UserStorageListResponseDto = decode(&body);
    assert_eq!(usernames(&page.users), ["dropbear", "pri"]);
    assert_eq!(page.total, 13);
}

#[tokio::test]
async fn each_refusal_keeps_the_backends_answer() {
    let (_server, client, base) = showcase().await;
    let priya = format!("/api/storage/users/{}", id("u-priya"));

    // A path id that is no UUID.
    let (status, body) = get(&client, &base, "/api/storage/users/not-a-uuid").await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");
    assert_eq!(body["message"], "Validation failed (uuid is expected)");
    let (status, body) = patch(
        &client,
        &base,
        "/api/storage/users/not-a-uuid/quota",
        json!({ "quotaBytes": 1 }),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");

    // An id no user has.
    let unknown = format!("/api/storage/users/{}", id("u-nobody"));
    for (method, path, body) in [
        (reqwest::Method::GET, unknown.clone(), None),
        (
            reqwest::Method::PATCH,
            format!("{unknown}/quota"),
            Some(json!({ "quotaBytes": 1 })),
        ),
        (
            reqwest::Method::POST,
            format!("{unknown}/recalculate"),
            Some(json!({})),
        ),
    ] {
        let (status, answer) = request(&client, method, &base, &path, body, true).await;
        assert_eq!(status, 404, "{path}: {answer}");
        assert_eq!(answer["errorCode"], "NOT_FOUND");
        assert_eq!(answer["message"], "User not found");
    }

    // The quota is a number of at least 0.
    for (body, message) in [
        (
            json!({ "quotaBytes": -1 }),
            "quotaBytes must not be less than 0",
        ),
        (
            json!({ "quotaBytes": "many" }),
            "quotaBytes must be a number conforming to the specified constraints",
        ),
        (
            json!({}),
            "quotaBytes must be a number conforming to the specified constraints",
        ),
    ] {
        let (status, answer) = patch(&client, &base, &format!("{priya}/quota"), body).await;
        assert_eq!(status, 400, "{answer}");
        assert_eq!(answer["errorCode"], "VALIDATION_FAILED");
        assert_eq!(answer["message"], message);
    }
    // None of them changed the quota.
    let (_, body) = get(&client, &base, &priya).await;
    let stats: wire::UserStorageStatsDto = decode(&body);
    assert_eq!(stats.quota_bytes, 53_687_091_200);

    // Query numbers are `ParseIntPipe`'s.
    let (status, body) = get(&client, &base, "/api/storage/users?take=two").await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");
    assert_eq!(
        body["message"],
        "Validation failed (numeric string is expected)"
    );
}

#[tokio::test]
async fn a_plain_user_is_refused() {
    let (server, client, base) = showcase().await;
    server.sign_in_as("pri", &id("u-priya"));
    let token = bearer_for(&client, &base, "pri").await;
    let priya = format!("/api/storage/users/{}", id("u-priya"));

    for (method, path, body) in [
        (reqwest::Method::GET, "/api/storage/users".to_owned(), None),
        (
            reqwest::Method::GET,
            format!("/api/storage/users/{}", id("u-marcus")),
            None,
        ),
        (
            reqwest::Method::PATCH,
            format!("{priya}/quota"),
            Some(json!({ "quotaBytes": 1_000 })),
        ),
        (
            reqwest::Method::POST,
            format!("{priya}/recalculate"),
            Some(json!({})),
        ),
    ] {
        let (status, answer) = as_bearer(&client, method, &base, &path, body, &token).await;
        assert_eq!(status, 403, "{path}: {answer}");
        assert_eq!(answer["errorCode"], "FORBIDDEN");
        assert_eq!(answer["message"], "Forbidden resource");
    }

    // The owner passes every one of them.
    let (status, body) = get(&client, &base, "/api/storage/users").await;
    assert_eq!(status, 200, "{body}");
}
