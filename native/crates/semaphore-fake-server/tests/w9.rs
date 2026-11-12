//! W9 over real HTTP: the onboarding status, accepting an invite with an existing account, and
//! read receipts (peer watermarks and who read a message). Each answer decodes as its wire type
//! (the contract's shape).
//!
//! The backend rules mirrored here are in `backend/src/{onboarding,membership,read-receipts}`.

mod common;

use common::*;
use semaphore_fake_server::FakeServer;
use semaphore_wire::types as wire;
use serde_json::{Value, json};

fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{error}: {value}"))
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

/// The fake's control switch for a fresh instance with no users.
async fn needs_setup(client: &reqwest::Client, base: &str) -> (u16, Value) {
    post(
        client,
        base,
        "/__control/onboarding",
        json!({ "needsSetup": true }),
    )
    .await
}

// --- GET /api/onboarding/status ----------------------------------------------------------------

#[tokio::test]
async fn the_setup_status_is_public_and_says_when_an_instance_has_no_users() {
    let (_server, client, base) = showcase().await;

    // The showcase's users exist, so nothing is to be set up.
    let (status, body) = request(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/onboarding/status",
        None,
        false,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let status: wire::OnboardingStatusDto = decode(&body);
    assert!(!status.needs_setup);
    assert!(status.has_users);
    assert_eq!(status.setup_token, None);

    // A control makes the instance fresh: no users, a setup token to spend on the web wizard.
    let (control, body) = needs_setup(&client, &base).await;
    assert_eq!(control, 200, "{body}");
    let (status, body) = request(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/onboarding/status",
        None,
        false,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let status: wire::OnboardingStatusDto = decode(&body);
    assert!(status.needs_setup);
    assert!(!status.has_users);
    assert!(status.setup_token.is_some_and(|token| !token.is_empty()));
}

// --- Registration modes -----------------------------------------------------------------------

/// Sets the mode the public settings advertise, and so what registration honours.
async fn set_mode(client: &reqwest::Client, base: &str, mode: &str) -> (u16, Value) {
    post(
        client,
        base,
        "/__control/public_settings",
        json!({ "registrationMode": mode }),
    )
    .await
}

/// A request as one session's bearer, for a test that signs in as someone else.
async fn call_as(
    client: &reqwest::Client,
    method: reqwest::Method,
    base: &str,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> (u16, Value) {
    let mut builder = client.request(method, format!("{base}{path}"));
    if let Some(token) = token {
        builder = builder.header("Authorization", format!("Bearer {token}"));
    }
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder.send().await.expect("the fake answers");
    let status = response.status().as_u16();
    let text = response.text().await.expect("a body");
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

async fn sign_up(client: &reqwest::Client, base: &str, name: &str, code: &str) -> (u16, Value) {
    request(
        client,
        reqwest::Method::POST,
        base,
        "/api/users",
        Some(json!({ "code": code, "username": name, "password": "Password123!" })),
        false,
    )
    .await
}

#[tokio::test]
async fn registration_honours_the_instance_mode() {
    let (server, client, base) = showcase().await;
    server.seed_invite(semaphore_fake_server::InviteSeed::new("GOOD"));

    // CLOSED: nobody, before any invite lookup.
    let (status, body) = set_mode(&client, &base, "CLOSED").await;
    assert_eq!(status, 200, "{body}");
    let (status, body) = sign_up(&client, &base, "closed-hopeful", "GOOD").await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (403, Some("FORBIDDEN"))
    );
    assert_eq!(body["message"], "Registration is closed on this server");

    // INVITE_ONLY: a code is required, and an unusable one is the invite's 404.
    set_mode(&client, &base, "INVITE_ONLY").await;
    let (status, body) = sign_up(&client, &base, "no-code", "").await;
    assert_eq!(
        (status, body["errorCode"].as_str()),
        (404, Some("NOT_FOUND"))
    );
    assert_eq!(body["message"], "No invite found for the provided code.");

    // OPEN: an account without a code, which joins no community.
    set_mode(&client, &base, "OPEN").await;
    let (status, user) = sign_up(&client, &base, "open-user", "").await;
    assert_eq!(status, 201, "{user}");
    assert_eq!(user["username"], "open-user");
    // The code was not spent by either refusal.
    let (_, invite) = request(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/invite/public/GOOD",
        None,
        false,
    )
    .await;
    assert_eq!(invite["uses"], 0, "{invite}");
}

// --- Joining an invite as an existing account -------------------------------------------------

#[tokio::test]
async fn accepting_an_invite_joins_its_communities_and_skips_the_ones_already_joined() {
    let (server, client, base) = showcase().await;
    // Another member: in `c-synth`, not in `c-couch`. The showcase is served with UUID ids.
    let couch = semaphore_fake_server::entity_uuid("c-couch");
    let synth = semaphore_fake_server::entity_uuid("c-synth");
    server.sign_in_as("mateo", &semaphore_fake_server::entity_uuid("u-mateo"));
    let (status, login) = call_as(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/auth/login",
        Some(json!({ "username": "mateo", "password": "Password123!" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "{login}");
    let token = login["accessToken"].as_str().expect("a token").to_owned();
    let mut seed = semaphore_fake_server::InviteSeed::new("JOINME");
    seed.max_uses = Some(2);
    seed.community_ids = vec![couch.clone(), synth.clone()];
    server.seed_invite(seed);

    let (_, body) = request(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/invite/public/JOINME",
        None,
        false,
    )
    .await;
    assert_eq!(body["uses"], 0, "{body}");
    let (status, body) = call_as(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/invite/JOINME/accept",
        None,
        Some(&token),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let answer: wire::AcceptInviteResponseDto = decode(&body);
    assert_eq!(answer.joined.len(), 1, "{body}");
    assert_eq!(answer.joined[0].id, couch);
    assert_eq!(answer.joined[0].name, "Couch Co-op");
    assert_eq!(answer.skipped.len(), 1, "{body}");
    assert_eq!(answer.skipped[0].id, synth);
    assert_eq!(
        answer.skipped[0].reason,
        semaphore_wire::enums::InviteSkipReason::AlreadyMember
    );
    // One use, however many communities were joined; and the name of the first, as the join
    // screen opens it.
    let (_, invite) = request(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/invite/public/JOINME",
        None,
        false,
    )
    .await;
    assert_eq!(invite["uses"], 1, "{invite}");

    // A code that can't be used answers the backend's message, and an unknown one too.
    let (status, body) = call_as(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/invite/GONE/accept",
        None,
        Some(&token),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "No invite found for the provided code.");

    // Without a session nothing is joined.
    let (status, body) = request(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/invite/JOINME/accept",
        None,
        false,
    )
    .await;
    assert_eq!(status, 401, "{body}");
    assert_eq!(body["errorCode"], "UNAUTHENTICATED");
}

// --- Read receipts ------------------------------------------------------------------------------

#[tokio::test]
async fn a_dms_peer_reads_are_the_other_members_watermarks() {
    let (_server, client, base) = showcase().await;
    let dm = semaphore_fake_server::entity_uuid("dm-priya");
    let pri = semaphore_fake_server::entity_uuid("u-priya");
    let me = semaphore_fake_server::entity_uuid("me");

    // Two members have read; one of them is the caller.
    post(
        &client,
        &base,
        "/__control/read_receipt",
        json!({ "dmGroupId": dm, "userId": pri, "at": "2026-09-22T19:30:00Z" }),
    )
    .await;
    post(
        &client,
        &base,
        "/__control/read_receipt",
        json!({ "dmGroupId": dm, "userId": me, "at": "2026-09-22T19:40:00Z" }),
    )
    .await;

    let (status, body) = get(
        &client,
        &base,
        &format!("/api/read-receipts/dm-peer-reads/{dm}"),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let reads: Vec<wire::DmPeerReadDto> = decode(&body);
    assert_eq!(reads.len(), 1, "the caller is left out");
    assert_eq!(reads[0].user_id, pri);

    // A DM the caller isn't in is refused, as the backend's membership check is.
    let other = semaphore_fake_server::entity_uuid("dm-marcus-aiko");
    let (status, body) = get(
        &client,
        &base,
        &format!("/api/read-receipts/dm-peer-reads/{other}"),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["message"], "You are not a member of this DM group");
}

#[tokio::test]
async fn message_readers_take_one_context_a_real_message_and_access() {
    let (_server, client, base) = showcase().await;
    let dm = semaphore_fake_server::entity_uuid("dm-priya");
    let pri = semaphore_fake_server::entity_uuid("u-priya");
    let message = semaphore_fake_server::message_uuid("sc-msg-59");
    let path = format!("/api/read-receipts/message/{message}/readers");

    // Exactly one of the two names the place.
    let (status, body) = get(&client, &base, &path).await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(
        body["message"],
        "Must provide exactly one of channelId or directMessageGroupId"
    );
    let (status, body) = get(
        &client,
        &base,
        &format!("{path}?channelId=c&directMessageGroupId={dm}"),
    )
    .await;
    assert_eq!(status, 400, "{body}");

    // A message the fake doesn't have.
    let (status, body) = get(
        &client,
        &base,
        &format!("/api/read-receipts/message/nope/readers?directMessageGroupId={dm}"),
    )
    .await;
    assert_eq!(
        (status, body["message"].as_str()),
        (400, Some("Message not found"))
    );

    // A message in another place.
    let (status, body) = get(
        &client,
        &base,
        &format!(
            "{path}?directMessageGroupId={}",
            semaphore_fake_server::entity_uuid("dm-priya-2")
        ),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(
        body["message"],
        "Message does not belong to the specified channel or DM group"
    );

    // A read before the message and one after it: only the second counts, and never the caller.
    post(
        &client,
        &base,
        "/__control/read_receipt",
        json!({ "dmGroupId": dm, "userId": pri, "at": "2026-09-21T20:00:00Z" }),
    )
    .await;
    post(
        &client,
        &base,
        "/__control/read_receipt",
        json!({ "dmGroupId": dm, "userId": semaphore_fake_server::entity_uuid("me"), "at": "2026-09-23T00:00:00Z" }),
    )
    .await;
    let (status, body) = get(&client, &base, &format!("{path}?directMessageGroupId={dm}")).await;
    assert_eq!(status, 200, "{body}");
    let readers: Vec<wire::MessageReaderDto> = decode(&body);
    assert!(readers.is_empty(), "{body}");

    post(
        &client,
        &base,
        "/__control/read_receipt",
        json!({ "dmGroupId": dm, "userId": pri, "at": "2026-09-23T00:01:00Z" }),
    )
    .await;
    let (_, body) = get(&client, &base, &format!("{path}?directMessageGroupId={dm}")).await;
    let readers: Vec<wire::MessageReaderDto> = decode(&body);
    assert_eq!(readers.len(), 1, "{body}");
    assert_eq!(readers[0].user_id, pri);
    assert_eq!(readers[0].username, "pri");
}

#[tokio::test]
async fn marking_a_dm_read_records_a_watermark_the_readers_route_sees() {
    let (server, client, base) = showcase().await;
    let dm = semaphore_fake_server::entity_uuid("dm-priya");
    let message = semaphore_fake_server::message_uuid("sc-msg-57");
    // As `me`, the fake's own mark-read stamps the receipt with its clock.
    let (status, receipt) = post(
        &client,
        &base,
        "/api/read-receipts/mark-read",
        json!({ "lastReadMessageId": message, "channelId": null, "directMessageGroupId": dm }),
    )
    .await;
    assert_eq!(status, 200, "{receipt}");
    assert_eq!(receipt["directMessageGroupId"], dm);

    // Another member sees the caller read it.
    server.sign_in_as("pri", &semaphore_fake_server::entity_uuid("u-priya"));
    let (status, login) = call_as(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/auth/login",
        Some(json!({ "username": "pri", "password": "Password123!" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "{login}");
    let token = login["accessToken"].as_str().expect("a token").to_owned();
    let (status, body) = call_as(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/read-receipts/message/{message}/readers?directMessageGroupId={dm}"),
        None,
        Some(&token),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let readers: Vec<wire::MessageReaderDto> = decode(&body);
    assert_eq!(readers.len(), 1, "{body}");
    assert_eq!(readers[0].user_id, semaphore_fake_server::entity_uuid("me"));
}
