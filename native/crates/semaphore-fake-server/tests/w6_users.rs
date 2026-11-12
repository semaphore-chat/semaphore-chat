//! W6-B: the admin users routes. Every answer decodes as its wire type (the contract's shape),
//! each refusal carries the backend's status, code and words, and paging with a small limit visits
//! every user once.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use semaphore_wire::enums::InstanceRole;
use semaphore_wire::types as wire;
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{error}: {value}"))
}

async fn patch(client: &reqwest::Client, base: &str, path: &str, body: Value) -> (u16, Value) {
    request(client, reqwest::Method::PATCH, base, path, Some(body), true).await
}

async fn del(client: &reqwest::Client, base: &str, path: &str) -> (u16, Value) {
    request(client, reqwest::Method::DELETE, base, path, None, true).await
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

async fn send_as(
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
    let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (status, value)
}

/// The refusal body: status, `errorCode` and message.
fn refused(body: &Value, status: u16, code: &str, message: &str) {
    assert_eq!(body["statusCode"], json!(status), "{body}");
    assert_eq!(body["errorCode"], json!(code), "{body}");
    assert_eq!(body["message"], json!(message), "{body}");
}

fn usernames(list: &wire::AdminUserListResponseDto) -> Vec<&str> {
    list.users
        .iter()
        .map(|user| user.username.as_str())
        .collect()
}

#[tokio::test]
async fn every_answer_decodes_and_paging_visits_every_user_once() {
    let (_server, client, base) = showcase().await;

    // The whole list, and the page size the web asks for.
    let (status, body) = get(&client, &base, "/api/users/admin/list").await;
    assert_eq!(status, 200, "{body}");
    let all: wire::AdminUserListResponseDto = decode(&body);
    assert!(all.continuation_token.is_none(), "one page holds them all");
    assert!(all.users.iter().any(|user| user.id == id("me")));
    assert!(all.users.iter().any(|user| user.username == "pri"));
    let everyone: Vec<String> = all.users.iter().map(|user| user.id.clone()).collect();

    // Each one on its own decodes too.
    for user_id in &everyone {
        let (status, body) = get(&client, &base, &format!("/api/users/admin/{user_id}")).await;
        assert_eq!(status, 200, "{user_id}: {body}");
        let user: wire::AdminUserEntity = decode(&body);
        assert_eq!(&user.id, user_id);
        assert!(user.email.is_some() && user.verified);
        assert_eq!(user.storage_quota_bytes, 53_687_091_200);
    }

    // Two at a time, until the token runs out: everyone, once.
    let mut seen: Vec<String> = Vec::new();
    let mut token: Option<String> = None;
    let mut pages = 0;
    loop {
        let path = match &token {
            Some(token) => format!("/api/users/admin/list?limit=2&continuationToken={token}"),
            None => "/api/users/admin/list?limit=2".to_owned(),
        };
        let (status, body) = get(&client, &base, &path).await;
        assert_eq!(status, 200, "{path}: {body}");
        let page: wire::AdminUserListResponseDto = decode(&body);
        assert!(page.users.len() <= 2, "{path}: {body}");
        for user in &page.users {
            assert!(!seen.contains(&user.id), "{} is listed twice", user.id);
            seen.push(user.id.clone());
        }
        pages += 1;
        token = page.continuation_token;
        if token.is_none() {
            break;
        }
    }
    assert!(pages > 1, "the showcase has more than one page of two");
    seen.sort();
    let mut expected = everyone;
    expected.sort();
    assert_eq!(seen, expected);

    // An unknown token is an empty page, not an error.
    let (status, body) = get(
        &client,
        &base,
        "/api/users/admin/list?limit=2&continuationToken=00000000-0000-4000-8000-00000000dead",
    )
    .await;
    assert_eq!(status, 200);
    let empty: wire::AdminUserListResponseDto = decode(&body);
    assert!(empty.users.is_empty());
}

#[tokio::test]
async fn the_owner_changes_a_user_and_every_answer_decodes() {
    let (_server, client, base) = showcase().await;
    let priya = id("u-priya");

    // The owner role, both ways.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/role"),
        json!({ "role": "OWNER" }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let user: wire::AdminUserEntity = decode(&body);
    assert_eq!(user.role, InstanceRole::Owner);
    let (status, body) = get(&client, &base, "/api/users/admin/list?role=OWNER").await;
    assert_eq!(status, 200);
    let owners: wire::AdminUserListResponseDto = decode(&body);
    assert!(owners.users.iter().any(|user| user.id == priya));
    assert!(
        owners
            .users
            .iter()
            .all(|user| user.role == InstanceRole::Owner)
    );
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/role"),
        json!({ "role": "USER" }),
    )
    .await;
    assert_eq!(status, 200);
    let user: wire::AdminUserEntity = decode(&body);
    assert_eq!(user.role, InstanceRole::User);

    // A ban sets the three fields, and the banned filter finds them.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/ban"),
        json!({ "banned": true }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let user: wire::AdminUserEntity = decode(&body);
    assert!(user.banned);
    assert!(user.banned_at.is_some());
    assert_eq!(user.banned_by_id.as_deref(), Some(id("me").as_str()));
    let (status, body) = get(&client, &base, "/api/users/admin/list?banned=true").await;
    assert_eq!(status, 200);
    let banned: wire::AdminUserListResponseDto = decode(&body);
    assert_eq!(usernames(&banned), ["pri"]);
    let (status, body) = get(&client, &base, "/api/users/admin/list?banned=false").await;
    assert_eq!(status, 200);
    assert!(!usernames(&decode::<wire::AdminUserListResponseDto>(&body)).contains(&"pri"));

    // An unban clears them.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/ban"),
        json!({ "banned": false }),
    )
    .await;
    assert_eq!(status, 200);
    let user: wire::AdminUserEntity = decode(&body);
    assert!(!user.banned && user.banned_at.is_none() && user.banned_by_id.is_none());

    // A password is accepted and answers the user.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/password"),
        json!({ "password": "a long enough password" }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let user: wire::AdminUserEntity = decode(&body);
    assert_eq!(user.id, priya);

    // A delete answers `{"success": true}`, and the user is gone from the list and the read.
    let (status, body) = del(&client, &base, &format!("/api/users/admin/{priya}")).await;
    assert_eq!(status, 200, "{body}");
    let success: wire::SuccessResponseDto = decode(&body);
    assert!(success.success);
    let (status, body) = get(&client, &base, "/api/users/admin/list").await;
    assert_eq!(status, 200);
    assert!(!usernames(&decode::<wire::AdminUserListResponseDto>(&body)).contains(&"pri"));
    let (status, body) = get(&client, &base, &format!("/api/users/admin/{priya}")).await;
    assert_eq!(status, 404, "{body}");
}

#[tokio::test]
async fn a_plain_user_is_refused_every_route() {
    let (_server, client, base) = showcase().await;
    let priya = id("u-priya");
    let bearer = bearer_for(&client, &base, "pri", &priya).await;
    for (method, path, body) in [
        (
            reqwest::Method::GET,
            "/api/users/admin/list".to_owned(),
            None,
        ),
        (
            reqwest::Method::GET,
            format!("/api/users/admin/{}", id("u-marcus")),
            None,
        ),
        (
            reqwest::Method::PATCH,
            format!("/api/users/admin/{}/role", id("u-marcus")),
            Some(json!({ "role": "OWNER" })),
        ),
        (
            reqwest::Method::PATCH,
            format!("/api/users/admin/{}/ban", id("u-marcus")),
            Some(json!({ "banned": true })),
        ),
        (
            reqwest::Method::PATCH,
            format!("/api/users/admin/{}/password", id("u-marcus")),
            Some(json!({ "password": "a long enough password" })),
        ),
        (
            reqwest::Method::DELETE,
            format!("/api/users/admin/{}", id("u-marcus")),
            None,
        ),
    ] {
        let (status, body) = send_as(&client, method, &base, &path, &bearer, body).await;
        assert_eq!(status, 403, "{path}: {body}");
        refused(&body, 403, "FORBIDDEN", "Forbidden resource");
    }
}

#[tokio::test]
async fn the_refusals_carry_the_backends_words() {
    let (_server, client, base) = showcase().await;
    let me = id("me");
    let priya = id("u-priya");

    // A path id that isn't a UUID.
    let (status, body) = get(&client, &base, "/api/users/admin/not-a-uuid").await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], json!("BAD_REQUEST"));

    // An unknown user.
    let (status, body) = get(
        &client,
        &base,
        "/api/users/admin/00000000-0000-4000-8000-00000000dead",
    )
    .await;
    assert_eq!(status, 404);
    refused(&body, 404, "NOT_FOUND", "User not found");

    // A page size the DTO refuses.
    for limit in ["0", "101"] {
        let (status, body) = get(
            &client,
            &base,
            &format!("/api/users/admin/list?limit={limit}"),
        )
        .await;
        assert_eq!(status, 400, "{limit}: {body}");
        assert_eq!(body["errorCode"], json!("VALIDATION_FAILED"));
    }

    // Nobody bans or deletes themselves.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{me}/ban"),
        json!({ "banned": true }),
    )
    .await;
    assert_eq!(status, 403);
    refused(&body, 403, "FORBIDDEN", "Cannot ban yourself");
    let (status, body) = del(&client, &base, &format!("/api/users/admin/{me}")).await;
    assert_eq!(status, 403);
    refused(
        &body,
        403,
        "FORBIDDEN",
        "Cannot delete your own account through admin panel",
    );

    // A password the DTO refuses, in the backend's words.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/password"),
        json!({ "password": "short" }),
    )
    .await;
    assert_eq!(status, 400);
    refused(
        &body,
        400,
        "VALIDATION_FAILED",
        "Password must be at least 8 characters",
    );
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/password"),
        json!({ "password": "x".repeat(129) }),
    )
    .await;
    assert_eq!(status, 400);
    refused(
        &body,
        400,
        "VALIDATION_FAILED",
        "Password must be at most 128 characters",
    );

    // The last owner stays.
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{me}/role"),
        json!({ "role": "USER" }),
    )
    .await;
    assert_eq!(status, 403);
    refused(
        &body,
        403,
        "FORBIDDEN",
        "Cannot demote the last owner. Promote another user first.",
    );

    // With a second owner, an owner can't be banned or deleted by anyone.
    let (status, _) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/role"),
        json!({ "role": "OWNER" }),
    )
    .await;
    assert_eq!(status, 200);
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/users/admin/{priya}/ban"),
        json!({ "banned": true }),
    )
    .await;
    assert_eq!(status, 403);
    refused(&body, 403, "FORBIDDEN", "Cannot ban an instance owner");
    let (status, body) = del(&client, &base, &format!("/api/users/admin/{priya}")).await;
    assert_eq!(status, 403);
    refused(&body, 403, "FORBIDDEN", "Cannot delete an instance owner");

    // Nothing of this changed the user.
    let (status, body) = get(&client, &base, &format!("/api/users/admin/{priya}")).await;
    assert_eq!(status, 200);
    let user: wire::AdminUserEntity = decode(&body);
    assert_eq!(user.role, InstanceRole::Owner);
    assert!(!user.banned);
}
