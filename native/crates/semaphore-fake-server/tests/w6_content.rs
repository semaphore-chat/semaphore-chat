//! W6-D over real HTTP and sockets: every community with its counts, force delete, and the
//! instance invites. Each answer decodes as its wire type (the contract's shape), and each test
//! names the backend behaviour it keeps.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{error}: {value}"))
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

async fn del(client: &reqwest::Client, base: &str, path: &str) -> (u16, Value) {
    request(client, reqwest::Method::DELETE, base, path, None, true).await
}

/// A request as an arbitrary bearer: the common helpers act as the scenario's owner.
async fn as_bearer(
    client: &reqwest::Client,
    method: reqwest::Method,
    base: &str,
    path: &str,
    token: &str,
) -> (u16, Value) {
    let response = client
        .request(method, format!("{base}{path}"))
        .header("Authorization", token)
        .send()
        .await
        .expect("the fake answers");
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

/// The list's names in the order the backend's cursor gives them: newest first, then by id.
fn titles(page: &wire::CommunityStatsListResponseDto) -> Vec<&str> {
    page.communities
        .iter()
        .map(|community| community.name.as_str())
        .collect()
}

#[tokio::test]
async fn every_route_answers_the_contracts_shape() {
    let (_server, client, base) = showcase().await;

    let (status, body) = get(&client, &base, "/api/community/admin/list").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::CommunityStatsListResponseDto = decode(&body);
    assert_eq!(
        titles(&page),
        ["Lumen Studio", "Couch Co-op", "Trailheads", "Synth Club"]
    );
    assert_eq!(page.continuation_token, None, "one page");
    let couch = id("c-couch");
    let row = page
        .communities
        .iter()
        .find(|community| community.id == couch)
        .expect("Couch Co-op");
    assert_eq!((row.member_count, row.channel_count), (12, 6));
    assert_eq!(
        row.description.as_deref(),
        Some("Friday nights, mostly Deep Rift.")
    );
    assert_eq!(row.banner.as_deref(), Some("sc-community-banner-couch"));
    assert_eq!(row.avatar.as_deref(), Some("sc-community-couch"));

    let (status, body) = get(&client, &base, &format!("/api/community/admin/{couch}")).await;
    assert_eq!(status, 200, "{body}");
    let detail: wire::CommunityStatsDetailDto = decode(&body);
    assert_eq!(detail.id, couch);
    assert_eq!(
        (
            detail.name.as_str(),
            detail.member_count,
            detail.channel_count
        ),
        ("Couch Co-op", 12, 6)
    );
    assert_eq!(detail.message_count, 21, "its six channels' messages");
    assert_eq!(detail.created_at.to_rfc3339(), "2025-08-18T13:00:00+00:00");

    // The instance invites are W5-A's routes; their answers still decode as the contract.
    let (status, body) = get(&client, &base, "/api/invite").await;
    assert_eq!(status, 200, "{body}");
    let invites: Vec<wire::InviteResponseDto> = decode(&body);
    assert!(invites.is_empty());
    let (status, body) = post(
        &client,
        &base,
        "/api/invite",
        json!({ "communityIds": [couch], "maxUses": 2 }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let invite: wire::InviteResponseDto = decode(&body);
    assert_eq!(invite.max_uses, Some(2));
    assert_eq!(
        invite.default_communities[0].community_id, couch,
        "into the community it names"
    );
    let (status, body) = get(&client, &base, "/api/invite").await;
    assert_eq!(status, 200, "{body}");
    let invites: Vec<wire::InviteResponseDto> = decode(&body);
    assert_eq!(invites.len(), 1, "read back");
    let (status, _) = del(&client, &base, &format!("/api/invite/{}", invite.code)).await;
    assert_eq!(status, 204);
    let (_, body) = get(&client, &base, "/api/invite").await;
    let invites: Vec<wire::InviteResponseDto> = decode(&body);
    assert!(invites.is_empty(), "gone");
}

#[tokio::test]
async fn the_list_pages_and_searches() {
    let (_server, client, base) = showcase().await;

    let (status, body) = get(&client, &base, "/api/community/admin/list?limit=2").await;
    assert_eq!(status, 200, "{body}");
    let first: wire::CommunityStatsListResponseDto = decode(&body);
    assert_eq!(titles(&first), ["Lumen Studio", "Couch Co-op"]);
    let token = first
        .continuation_token
        .clone()
        .expect("more remain: the last id is the token");
    assert_eq!(token, first.communities.last().unwrap().id);

    let (status, body) = get(
        &client,
        &base,
        &format!("/api/community/admin/list?limit=2&continuationToken={token}"),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let second: wire::CommunityStatsListResponseDto = decode(&body);
    assert_eq!(titles(&second), ["Trailheads", "Synth Club"]);
    assert_eq!(
        second.continuation_token, None,
        "the last page carries none"
    );

    // The backend's `clampLimit`: at least 1 row, at most 100.
    let (_, body) = get(&client, &base, "/api/community/admin/list?limit=0").await;
    let clamped: wire::CommunityStatsListResponseDto = decode(&body);
    assert_eq!(titles(&clamped), ["Lumen Studio"]);
    let (_, body) = get(&client, &base, "/api/community/admin/list?limit=500").await;
    let all: wire::CommunityStatsListResponseDto = decode(&body);
    assert_eq!(all.communities.len(), 4);

    // `search` is a case-insensitive substring of the name.
    let (status, body) = get(&client, &base, "/api/community/admin/list?search=SYN").await;
    assert_eq!(status, 200, "{body}");
    let found: wire::CommunityStatsListResponseDto = decode(&body);
    assert_eq!(titles(&found), ["Synth Club"]);
    let (_, body) = get(&client, &base, "/api/community/admin/list?search=zzz").await;
    let none: wire::CommunityStatsListResponseDto = decode(&body);
    assert!(none.communities.is_empty() && none.continuation_token.is_none());
}

#[tokio::test]
async fn a_malformed_id_is_a_bad_request_and_an_unknown_one_is_not_found() {
    let (_server, client, base) = showcase().await;
    let (status, body) = get(&client, &base, "/api/community/admin/not-a-uuid").await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");
    let (status, _) = del(&client, &base, "/api/community/admin/not-a-uuid").await;
    assert_eq!(status, 400);

    let missing = uuid::Uuid::from_u128(9).to_string();
    let (status, body) = get(&client, &base, &format!("/api/community/admin/{missing}")).await;
    assert_eq!(status, 404, "{body}");
    assert_eq!(body["errorCode"], "NOT_FOUND");
    assert_eq!(body["message"], "Community not found");
    let (status, body) = del(&client, &base, &format!("/api/community/admin/{missing}")).await;
    assert_eq!(status, 404, "{body}");
    assert_eq!(body["message"], "Community not found");
}

#[tokio::test]
async fn a_user_without_the_actions_is_refused() {
    let (server, client, base) = showcase().await;
    server.sign_in_as("pri", &id("u-priya"));
    let token = bearer_for(&client, &base, "pri").await;
    let couch = id("c-couch");

    for (method, path) in [
        (reqwest::Method::GET, "/api/community/admin/list".to_owned()),
        (
            reqwest::Method::GET,
            format!("/api/community/admin/{couch}"),
        ),
        (
            reqwest::Method::DELETE,
            format!("/api/community/admin/{couch}"),
        ),
    ] {
        let (status, answer) = as_bearer(&client, method, &base, &path, &token).await;
        assert_eq!(status, 403, "{path}: {answer}");
        assert_eq!(answer["errorCode"], "FORBIDDEN");
        assert_eq!(answer["message"], "Forbidden resource");
    }
    // Nothing was deleted.
    let (status, _) = get(&client, &base, &format!("/api/community/admin/{couch}")).await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn force_deleting_tells_its_members_and_takes_it_out_of_every_list() {
    let (server, client, base) = showcase().await;
    let synth = id("c-synth");
    let mut aiko = connect_as(&base, &id("u-aiko")).await;
    // Someone who isn't in it hears nothing.
    let mut samira = connect_as(&base, &id("u-samira")).await;

    let (status, _) = del(&client, &base, &format!("/api/community/admin/{synth}")).await;
    assert_eq!(status, 204);
    let heard = settle(&server, &mut [&mut aiko, &mut samira]).await;
    assert_eq!(names(&heard[0]), ["communityDeleted"]);
    assert_eq!(heard[0][0].1, json!({ "communityId": synth }));
    assert!(
        !matches!(
            ServerEvent::decode("communityDeleted", heard[0][0].1.clone()),
            ServerEvent::Unknown { .. } | ServerEvent::Malformed { .. }
        ),
        "the event decodes"
    );
    assert!(heard[1].is_empty(), "not a member: nothing");

    let (_, body) = get(&client, &base, "/api/community/admin/list").await;
    let page: wire::CommunityStatsListResponseDto = decode(&body);
    assert_eq!(titles(&page), ["Lumen Studio", "Couch Co-op", "Trailheads"]);
    let (status, _) = get(&client, &base, &format!("/api/community/admin/{synth}")).await;
    assert_eq!(status, 404);
    let (status, _) = del(&client, &base, &format!("/api/community/admin/{synth}")).await;
    assert_eq!(status, 404, "gone for good");

    // An invite that named it no longer does; the other community's stays.
    let (couch, trail) = (id("c-couch"), id("c-trail"));
    let (_, body) = post(
        &client,
        &base,
        "/api/invite",
        json!({ "communityIds": [couch, trail] }),
    )
    .await;
    let invite: wire::InviteResponseDto = decode(&body);
    assert_eq!(invite.default_communities.len(), 2);
    let (status, _) = del(&client, &base, &format!("/api/community/admin/{trail}")).await;
    assert_eq!(status, 204);
    let (_, body) = get(&client, &base, "/api/invite").await;
    let invites: Vec<wire::InviteResponseDto> = decode(&body);
    assert_eq!(
        invites
            .iter()
            .flat_map(|invite| invite.default_communities.iter())
            .map(|community| community.community_id.clone())
            .collect::<Vec<_>>(),
        [couch],
        "the deleted community is out of every invite"
    );
    assert_eq!(invite.code, invites[0].code);
}
