//! W6-A over real HTTP: instance settings, instance stats, instance storage and LiveKit health.
//! Each answer decodes as its wire type (the contract's shape), and each test names the backend
//! behaviour it keeps.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use semaphore_wire::enums::RegistrationMode;
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

#[tokio::test]
async fn every_route_answers_the_contracts_shape() {
    let (_server, client, base) = showcase().await;

    let (status, body) = get(&client, &base, "/api/instance/settings").await;
    assert_eq!(status, 200, "{body}");
    let settings: wire::InstanceSettingsResponseDto = decode(&body);
    assert_eq!(settings.id, "instance-settings");
    assert_eq!(settings.name, "Semaphore Chat");
    assert_eq!(settings.description, None);
    assert_eq!(settings.registration_mode, RegistrationMode::InviteOnly);
    assert_eq!(settings.default_storage_quota_bytes, 53_687_091_200);
    assert_eq!(settings.max_file_size_bytes, 524_288_000);
    assert!(settings.vapid_public_key.is_none() && settings.vapid_subject.is_none());

    let (status, body) = get(&client, &base, "/api/instance/stats").await;
    assert_eq!(status, 200, "{body}");
    let stats: wire::InstanceStatsResponseDto = decode(&body);
    assert_eq!(
        (
            stats.total_users,
            stats.total_communities,
            stats.total_channels,
            stats.total_messages,
            stats.active_invites,
            stats.banned_users,
        ),
        (13, 4, 20, 79, 1, 0),
        "counted from the scenario"
    );

    let (status, body) = get(&client, &base, "/api/storage/instance").await;
    assert_eq!(status, 200, "{body}");
    let storage: wire::InstanceStorageStatsDto = decode(&body);
    assert_eq!(storage.server.disk_used_percent, 50.0);
    assert_eq!(
        storage.server.disk_used_bytes * 2,
        storage.server.disk_total_bytes
    );
    assert_eq!(storage.total_user_count, 13);
    assert_eq!(storage.default_quota_bytes, 53_687_091_200);
    assert_eq!(storage.max_file_size_bytes, 524_288_000);
    assert!(!storage.storage_by_type.is_empty());

    let (status, body) = get(&client, &base, "/api/livekit/health").await;
    assert_eq!(status, 200, "{body}");
    let health: wire::LivekitHealthResponseDto = decode(&body);
    assert_eq!((health.status.as_str(), health.configured), ("ok", true));
}

#[tokio::test]
async fn an_update_applies_only_the_fields_it_names() {
    let (_server, client, base) = showcase().await;
    let (status, body) = patch(
        &client,
        &base,
        "/api/instance/settings",
        json!({ "name": "Lumen Chat", "registrationMode": "OPEN" }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let updated: wire::InstanceSettingsResponseDto = decode(&body);
    assert_eq!(updated.name, "Lumen Chat");
    assert_eq!(updated.registration_mode, RegistrationMode::Open);
    assert_eq!(
        updated.default_storage_quota_bytes, 53_687_091_200,
        "not named: untouched"
    );
    assert_eq!(updated.max_file_size_bytes, 524_288_000, "not named");
    assert_eq!(updated.description, None, "not named");

    let (status, body) = get(&client, &base, "/api/instance/settings").await;
    assert_eq!(status, 200, "{body}");
    let read: wire::InstanceSettingsResponseDto = decode(&body);
    assert_eq!(
        (read.name.as_str(), read.registration_mode),
        ("Lumen Chat", RegistrationMode::Open)
    );

    let (status, body) = patch(
        &client,
        &base,
        "/api/instance/settings",
        json!({
            "description": "",
            "defaultStorageQuotaBytes": 1_073_741_824i64,
            "maxFileSizeBytes": 1_048_576i64,
        }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let updated: wire::InstanceSettingsResponseDto = decode(&body);
    assert_eq!(
        updated.description.as_deref(),
        Some(""),
        "an empty one clears it"
    );
    assert_eq!(updated.default_storage_quota_bytes, 1_073_741_824);
    assert_eq!(updated.max_file_size_bytes, 1_048_576);
    assert_eq!(updated.name, "Lumen Chat", "still the name it had");
}

#[tokio::test]
async fn an_update_out_of_bounds_is_a_validation_failure() {
    let (_server, client, base) = showcase().await;
    let cases = [
        (
            json!({ "name": "a".repeat(101) }),
            "name must be shorter than or equal to 100 characters",
        ),
        (
            json!({ "description": "a".repeat(501) }),
            "description must be shorter than or equal to 500 characters",
        ),
        (
            json!({ "defaultStorageQuotaBytes": 1_073_741_823i64 }),
            "defaultStorageQuotaBytes must not be less than 1073741824",
        ),
        (
            json!({ "maxFileSizeBytes": 1_048_575i64 }),
            "maxFileSizeBytes must not be less than 1048576",
        ),
        (
            json!({ "maxFileSizeBytes": 1_073_741_825i64 }),
            "maxFileSizeBytes must not be greater than 1073741824",
        ),
        (
            json!({ "registrationMode": "SOMETIMES" }),
            "registrationMode must be one of the following values: OPEN, INVITE_ONLY, CLOSED",
        ),
    ];
    for (body, message) in cases {
        let (status, answer) = patch(&client, &base, "/api/instance/settings", body).await;
        assert_eq!(status, 400, "{answer}");
        assert_eq!(answer["errorCode"], "VALIDATION_FAILED");
        assert_eq!(answer["message"], message);
    }
    // None of them changed anything.
    let (_, body) = get(&client, &base, "/api/instance/settings").await;
    let settings: wire::InstanceSettingsResponseDto = decode(&body);
    assert_eq!(settings.name, "Semaphore Chat");
    assert_eq!(settings.default_storage_quota_bytes, 53_687_091_200);
}

#[tokio::test]
async fn a_user_without_the_action_is_refused() {
    let (server, client, base) = showcase().await;
    server.sign_in_as("pri", &id("u-priya"));
    let token = bearer_for(&client, &base, "pri").await;

    for (method, path, body) in [
        (reqwest::Method::GET, "/api/instance/settings", None),
        (
            reqwest::Method::PATCH,
            "/api/instance/settings",
            Some(json!({ "name": "Mine" })),
        ),
        (reqwest::Method::GET, "/api/instance/stats", None),
        (reqwest::Method::GET, "/api/storage/instance", None),
    ] {
        let (status, answer) = as_bearer(&client, method, &base, path, body, &token).await;
        assert_eq!(status, 403, "{path}: {answer}");
        assert_eq!(answer["errorCode"], "FORBIDDEN");
        assert_eq!(answer["message"], "Forbidden resource");
    }

    // LiveKit health needs only a session.
    let (status, body) = as_bearer(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/livekit/health",
        None,
        &token,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let health: wire::LivekitHealthResponseDto = decode(&body);
    assert!(health.configured);
}

#[tokio::test]
async fn the_controls_set_the_disk_and_livekit() {
    let (_server, client, base) = showcase().await;
    // Only the fields a test cares about: the rest of the stats stay as they were.
    let (status, answer) = post(
        &client,
        &base,
        "/__control/instance_storage",
        json!({ "server": { "diskUsedPercent": 95.0 }, "usersOverQuota": 1234 }),
    )
    .await;
    assert_eq!(status, 200, "{answer}");
    let (_, body) = get(&client, &base, "/api/storage/instance").await;
    let read: wire::InstanceStorageStatsDto = decode(&body);
    assert_eq!(read.server.disk_used_percent, 95.0);
    assert_eq!(read.users_over_quota, 1234);

    let (status, answer) = post(
        &client,
        &base,
        "/__control/livekit_configured",
        json!({ "configured": false }),
    )
    .await;
    assert_eq!(status, 200, "{answer}");
    let (status, body) = get(&client, &base, "/api/livekit/health").await;
    assert_eq!(status, 200, "{body}");
    let health: wire::LivekitHealthResponseDto = decode(&body);
    assert!(!health.configured);
}
