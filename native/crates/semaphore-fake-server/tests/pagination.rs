//! Test 6: pagination reaches every message exactly once, in order.

mod common;

use common::*;
use serde_json::Value;

#[tokio::test]
async fn pagination_reaches_every_message_once() {
    let server = start("long-history").await;
    let base = server.base_url();
    let client = http();
    let channel = "channel-2914";

    // The scenario's top-level messages, for the expected count.
    let all: Value = serde_json::from_str(
        &semaphore_fake_server::load_named("long-history").expect("the scenario"),
    )
    .expect("valid JSON");
    let expected = all["messagesByChannel"][channel]
        .as_array()
        .expect("a channel")
        .iter()
        .filter(|message| message["parentMessageId"].is_null())
        .count();

    let mut seen: Vec<Value> = Vec::new();
    let mut token: Option<String> = None;
    let mut pages = 0;
    loop {
        pages += 1;
        assert!(pages < 100, "pagination did not terminate");
        let path = match &token {
            Some(token) => {
                format!("/api/messages/channel/{channel}?limit=97&continuationToken={token}")
            }
            None => format!("/api/messages/channel/{channel}?limit=97"),
        };
        let (status, page) = get(&client, &base, &path).await;
        assert_eq!(status, 200, "{page}");
        seen.extend(
            page["messages"]
                .as_array()
                .expect("messages")
                .iter()
                .cloned(),
        );
        token = page["continuationToken"].as_str().map(str::to_owned);
        if token.is_none() {
            break;
        }
    }

    assert_eq!(seen.len(), expected, "every message exactly once");
    let unique: std::collections::BTreeSet<_> = seen
        .iter()
        .map(|message| message["id"].as_str().expect("an id").to_owned())
        .collect();
    assert_eq!(unique.len(), seen.len(), "no message twice");

    // Newest first across every page boundary, with no repeats.
    let mut last_time: Option<String> = None;
    for message in &seen {
        let time = message["sentAt"].as_str().expect("sentAt").to_owned();
        if let Some(previous) = &last_time {
            assert!(
                previous >= &time,
                "messages are newest first: {previous} then {time}"
            );
        }
        last_time = Some(time);
    }

    // Newest first, across page boundaries: fetch each id's sentAt once.
    let (_, full) = get(
        &client,
        &base,
        &format!("/api/messages/channel/{channel}?limit=100&direction=older"),
    )
    .await;
    let all_messages: Vec<Value> = full["messages"].as_array().expect("messages").clone();
    assert!(!all_messages.is_empty());
    assert_eq!(all_messages.len(), 100);

    // The first page's first message is the channel's newest.
    let (_, page) = get(
        &client,
        &base,
        &format!("/api/messages/channel/{channel}?limit=97"),
    )
    .await;
    assert_eq!(page["messages"][0]["id"], all_messages[0]["id"]);
}

#[tokio::test]
async fn newer_pages_continue_where_the_token_left_off() {
    let server = start("long-history").await;
    let base = server.base_url();
    let client = http();
    let channel = "channel-2914";

    // Walk back one page, then forward again from that token: the cursor is
    // exclusive and the result is the same messages, newest first.
    let first = "/api/messages/channel/channel-2914?limit=5";
    let (_, page_one) = get(&client, &base, first).await;
    let token = page_one["continuationToken"].as_str().expect("a token");
    let newer_path = format!(
        "/api/messages/channel/{channel}?limit=5&direction=newer&continuationToken={token}"
    );
    let (status, newer) = get(&client, &base, &newer_path).await;
    assert_eq!(status, 200, "{newer}");
    let ids: Vec<&str> = newer["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .map(|message| message["id"].as_str().expect("id"))
        .collect();
    let expected: Vec<&str> = page_one["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .take(4)
        .map(|message| message["id"].as_str().expect("id"))
        .collect();
    assert_eq!(ids, expected, "newer continues just above the older page");
}

#[tokio::test]
async fn around_returns_the_anchor_in_the_middle() {
    let server = start("long-history").await;
    let base = server.base_url();
    let client = http();

    let (_, page) = get(&client, &base, "/api/messages/channel/channel-2914?limit=5").await;
    let anchor = page["messages"][2]["id"]
        .as_str()
        .expect("an id")
        .to_owned();
    let (status, around) = get(
        &client,
        &base,
        &format!("/api/messages/channel/channel-2914/around/{anchor}?limit=5"),
    )
    .await;
    assert_eq!(status, 200, "{around}");
    let ids: Vec<&str> = around["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .map(|message| message["id"].as_str().expect("id"))
        .collect();
    assert_eq!(ids[2], anchor, "the anchor is in the middle");
}

#[tokio::test]
async fn member_pages_reach_everyone_once_and_a_short_page_ends_them() {
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();

    let mut seen = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..20 {
        let path = match &token {
            Some(token) => {
                format!("/api/membership/community/community-1?limit=5&continuationToken={token}")
            }
            None => "/api/membership/community/community-1?limit=5".to_owned(),
        };
        let (status, page) = get(&client, &base, &path).await;
        assert_eq!(status, 200, "{page}");
        seen.extend(
            page["members"]
                .as_array()
                .unwrap()
                .iter()
                .map(|member| member["id"].clone()),
        );
        token = page["continuationToken"].as_str().map(str::to_owned);
        if token.is_none() {
            break;
        }
    }
    assert_eq!(seen.len(), 12);
    seen.dedup();
    assert_eq!(seen.len(), 12);
}

#[tokio::test]
async fn around_in_a_dm_finds_the_anchor() {
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();
    let (status, page) = get(
        &client,
        &base,
        "/api/messages/group/dm-1/around/msg-203?limit=2",
    )
    .await;
    assert_eq!(status, 200, "{page}");
    assert!(
        page["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == "msg-203")
    );
}

/// Search pages a message at a time the backend's way: the page continues after the id the
/// `continuationToken` names, and a full page answers with its last id in
/// `X-Continuation-Token` (absent when the page isn't full, so the last page ends the walk).
#[tokio::test]
async fn search_pages_with_a_header_cursor() {
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();
    let channel = "channel-105";

    let mut seen: Vec<String> = Vec::new();
    let mut token: Option<String> = None;
    let mut pages = 0;
    loop {
        pages += 1;
        assert!(pages < 10, "search paging did not terminate");
        let path = match &token {
            Some(token) => format!(
                "/api/messages/search/channel/{channel}?q=plan&limit=2&continuationToken={token}"
            ),
            None => format!("/api/messages/search/channel/{channel}?q=plan&limit=2"),
        };
        let response = client
            .get(format!("{base}{path}"))
            .header("Authorization", TOKEN)
            .send()
            .await
            .expect("the fake answers");
        assert_eq!(response.status().as_u16(), 200, "{path}");
        let next = response
            .headers()
            .get("x-continuation-token")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body: Value = response.json().await.expect("a page");
        let ids: Vec<String> = body
            .as_array()
            .expect("a page of messages")
            .iter()
            .map(|message| message["id"].as_str().expect("an id").to_owned())
            .collect();
        if ids.len() == 2 {
            assert!(
                next.is_some(),
                "a full page carries the next cursor: {path}"
            );
        } else {
            assert!(next.is_none(), "a short page ends the walk: {path}");
        }
        seen.extend(ids);
        token = next;
        if token.is_none() {
            break;
        }
    }

    // Four messages match "plan" here: two full pages, then an empty one that ends the walk.
    assert_eq!(pages, 3);
    assert_eq!(seen.len(), 4, "{seen:?}");
    let unique: std::collections::BTreeSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), seen.len(), "no message twice: {seen:?}");
}
