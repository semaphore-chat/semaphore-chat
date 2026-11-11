//! Test 1: every implemented route, event payload and ack matches the pinned contract.
//!
//! Every object is closed (`additionalProperties: false`) and every `nullable` is
//! translated, like `backend/test/message-wire-contract.e2e-spec.ts` does, so a field the
//! contract does not declare fails here first.

mod common;

use common::*;
use serde_json::{Value, json};

struct Schemas {
    root: Value,
}

impl Schemas {
    fn load() -> Self {
        Self {
            root: serde_json::from_str(include_str!("../../../contract/openapi.json"))
                .expect("openapi.json is valid JSON"),
        }
    }

    fn resolve(&self, reference: &str) -> Value {
        let pointer = reference
            .split_once('#')
            .map(|(_, pointer)| pointer)
            .unwrap_or(reference);
        self.root
            .pointer(pointer)
            .unwrap_or_else(|| panic!("unresolved $ref {reference}"))
            .clone()
    }

    fn inline(&self, schema: &Value, depth: usize) -> Value {
        if depth > 64 {
            return json!({});
        }
        if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
            let resolved = self.resolve(reference);
            let mut out = self.inline(&resolved, depth + 1);
            if let Value::Object(map) = schema {
                for (key, value) in map {
                    if key == "$ref" {
                        continue;
                    }
                    if key == "nullable" && value.as_bool() == Some(true) {
                        return json!({ "anyOf": [out, { "type": "null" }] });
                    }
                    if let Value::Object(object) = &mut out {
                        object.insert(key.clone(), value.clone());
                    }
                }
            }
            return out;
        }

        let nullable = schema
            .get("nullable")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mut out = match schema {
            Value::Object(map) => {
                let mut result = serde_json::Map::new();
                for (key, value) in map {
                    match key.as_str() {
                        "nullable" => {}
                        "properties" => {
                            if let Value::Object(properties) = value {
                                let mut resolved = serde_json::Map::new();
                                for (name, property) in properties {
                                    resolved.insert(name.clone(), self.inline(property, depth + 1));
                                }
                                result.insert("properties".to_owned(), Value::Object(resolved));
                            }
                        }
                        "items" => {
                            result.insert("items".to_owned(), self.inline(value, depth + 1));
                        }
                        "allOf" | "oneOf" | "anyOf" => {
                            if let Value::Array(items) = value {
                                result.insert(
                                    key.clone(),
                                    Value::Array(
                                        items
                                            .iter()
                                            .map(|item| self.inline(item, depth + 1))
                                            .collect(),
                                    ),
                                );
                            }
                        }
                        // A map says what its values are. Closing it would refuse them all.
                        "additionalProperties" => {
                            if value.is_object() {
                                result.insert(key.clone(), self.inline(value, depth + 1));
                            }
                        }
                        _ => {
                            result.insert(key.clone(), value.clone());
                        }
                    }
                }
                // A bare object with no properties of its own (a composed wrapper,
                // or a map) must not close itself: `additionalProperties` only
                // knows about properties declared in the same schema object.
                if !result.contains_key("additionalProperties")
                    && (result.contains_key("properties")
                        || (result.get("type").and_then(Value::as_str) == Some("object")
                            && !result.contains_key("allOf")
                            && !result.contains_key("oneOf")
                            && !result.contains_key("anyOf")))
                {
                    result.insert("additionalProperties".to_owned(), Value::Bool(false));
                }
                Value::Object(result)
            }
            other => other.clone(),
        };
        if nullable {
            out = json!({ "anyOf": [out, { "type": "null" }] });
        }
        out
    }

    fn component(&self, name: &str) -> Value {
        self.inline(
            &json!({ "$ref": format!("#/components/schemas/{name}") }),
            0,
        )
    }

    fn array_of(&self, name: &str) -> Value {
        self.inline(
            &json!({ "type": "array", "items": { "$ref": format!("#/components/schemas/{name}") } }),
            0,
        )
    }

    fn reference(&self, reference: &str) -> Value {
        self.inline(&json!({ "$ref": reference }), 0)
    }
}

fn assert_valid(_schemas: &Schemas, schema: &Value, value: &Value, what: &str) {
    let validator = jsonschema::validator_for(schema)
        .unwrap_or_else(|error| panic!("{what}: the schema is invalid: {error}"));
    let errors: Vec<String> = validator
        .iter_errors(value)
        .map(|error| {
            format!(
                "{error} at {:?} (schema {:?})",
                error.instance_path, error.schema_path
            )
        })
        .collect();
    if !errors.is_empty() {
        panic!(
            "{what} does not match the contract:\n{}\nvalue: {value}",
            errors.join("\n")
        );
    }
}

struct Case {
    method: reqwest::Method,
    path: String,
    body: Option<Value>,
    status: u16,
    schema: Value,
}

#[tokio::test]
async fn every_implemented_route_matches_openapi() {
    let schemas = Schemas::load();
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();

    let login_body = login(&client, &base).await;
    assert_valid(
        &schemas,
        &schemas.component("LoginResponseDto"),
        &login_body,
        "login",
    );

    let cases = vec![
        Case {
            method: reqwest::Method::POST,
            path: "/api/auth/refresh".to_owned(),
            body: Some(json!({ "refreshToken": "fake-refresh-token" })),
            status: 200,
            schema: schemas.component("LoginResponseDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/auth/logout".to_owned(),
            body: Some(json!({})),
            status: 201,
            schema: schemas.component("LogoutResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/users/profile".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("UserEntity"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/community/mine".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("CommunityResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/channels/community/community-1".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("ChannelDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/channels/community/community-1/mentionable".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("ChannelDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/channels/community/community-1/permissions/me".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("CommunityChannelCapabilitiesDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/read-receipts/unread-counts".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("UnreadCountDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/messages/channel/channel-13?limit=20".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("PaginatedMessagesResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/messages/channel/channel-13/around/msg-14?limit=10".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("AnchoredMessagesResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/messages/group/dm-1?limit=10".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("PaginatedMessagesResponseDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/messages".to_owned(),
            body: Some(json!({
                "channelId": "channel-13",
                "spans": [{ "type": "PLAINTEXT", "text": "contract create" }],
                "attachments": [],
            })),
            status: 201,
            schema: schemas.component("MessageDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/messages/dm".to_owned(),
            body: Some(json!({
                "directMessageGroupId": "dm-1",
                "spans": [{ "type": "PLAINTEXT", "text": "contract dm" }],
                "attachments": [],
            })),
            status: 201,
            schema: schemas.component("MessageDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/messages/reactions".to_owned(),
            body: Some(json!({ "messageId": "msg-14", "emoji": "🔥" })),
            status: 201,
            schema: schemas.component("MessageReactionsDto"),
        },
        Case {
            method: reqwest::Method::DELETE,
            path: "/api/messages/reactions".to_owned(),
            body: Some(json!({ "messageId": "msg-14", "emoji": "🔥" })),
            status: 200,
            schema: schemas.component("MessageReactionsDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/read-receipts/mark-read".to_owned(),
            body: Some(json!({
                "lastReadMessageId": "msg-14",
                "channelId": "channel-13",
            })),
            status: 200,
            schema: schemas.component("ReadReceiptDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/membership/community/community-1/search?query=a".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("MembershipResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/membership/community/community-1?limit=5".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("PaginatedMembershipsResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/users/user-1".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("UserEntity"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/presence/users/bulk".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("BulkPresenceResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/notifications/unread-count".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("UnreadCountResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/messages/group/dm-1/around/msg-203?limit=4".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("AnchoredMessagesResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/custom-emoji/community/community-1".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("CustomEmojiDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/livekit/connection-info".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("ConnectionInfoResponseDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/livekit/token".to_owned(),
            body: Some(json!({ "identity": "me", "roomId": "channel-103" })),
            status: 201,
            schema: schemas.component("TokenResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/channels/channel-103/voice-presence".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("ChannelVoicePresenceResponseDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/channels/channel-103/voice-presence/join".to_owned(),
            body: Some(json!({})),
            status: 201,
            schema: schemas.component("RefreshPresenceResponseDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/channels/channel-103/voice-presence/refresh".to_owned(),
            body: Some(json!({})),
            status: 201,
            schema: schemas.component("RefreshPresenceResponseDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/channels/channel-103/voice-presence/deafen".to_owned(),
            body: Some(json!({ "isDeafened": true })),
            status: 201,
            schema: schemas.component("RefreshPresenceResponseDto"),
        },
        Case {
            method: reqwest::Method::POST,
            path: "/api/channels/channel-103/voice-presence/leave".to_owned(),
            body: Some(json!({})),
            status: 201,
            schema: schemas.component("RefreshPresenceResponseDto"),
        },
        // W1 part B: threads and search.
        Case {
            method: reqwest::Method::GET,
            path: "/api/threads/msg-48/replies?limit=2".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("ThreadRepliesResponseDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/threads/msg-48/metadata".to_owned(),
            body: None,
            status: 200,
            schema: schemas.component("ThreadMetadataDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/messages/search/channel/channel-13?q=plan&limit=5".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("MessageDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/messages/search/group/dm-1?q=lunch".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("MessageDto"),
        },
        Case {
            method: reqwest::Method::GET,
            path: "/api/messages/search/community/community-1?q=plan".to_owned(),
            body: None,
            status: 200,
            schema: schemas.array_of("CommunitySearchResultDto"),
        },
    ];

    for case in cases {
        let (status, body) =
            request(&client, case.method, &base, &case.path, case.body, true).await;
        assert_eq!(status, case.status, "{}: {body}", case.path);
        assert_valid(
            &schemas,
            &case.schema,
            &body,
            &format!("{} {}", case.path, status),
        );
    }

    // Subscriptions answer 204 with no body; metadata follows them.
    for (method, subscribed) in [
        (reqwest::Method::POST, true),
        (reqwest::Method::DELETE, false),
    ] {
        let (status, body) = request(
            &client,
            method,
            &base,
            "/api/threads/msg-48/subscribe",
            None,
            true,
        )
        .await;
        assert_eq!(status, 204, "{body}");
        assert_eq!(body, Value::String(String::new()));
        let (_, meta) = get(&client, &base, "/api/threads/msg-48/metadata").await;
        assert_eq!(meta["isSubscribed"], subscribed, "{meta}");
    }
    // Paging replies: oldest first, the token the last one sent.
    let (_, first) = get(&client, &base, "/api/threads/msg-48/replies?limit=3").await;
    let token = first["continuationToken"].as_str().expect("more to come");
    let (_, rest) = get(
        &client,
        &base,
        &format!("/api/threads/msg-48/replies?limit=3&continuationToken={token}"),
    )
    .await;
    assert_eq!(first["replies"].as_array().unwrap().len(), 3);
    assert_eq!(rest["replies"][0]["id"], "msg-200");
    assert!(
        rest.get("continuationToken").is_none_or(Value::is_null),
        "{rest}"
    );
    // A missing parent, and a search with no query.
    for path in ["/api/threads/nope/metadata", "/api/threads/nope/replies"] {
        let (status, body) = get(&client, &base, path).await;
        assert_eq!(status, 404, "{path}: {body}");
        assert_eq!(body["errorCode"], "NOT_FOUND");
        assert_valid(
            &schemas,
            &schemas.component("ErrorResponseDto"),
            &body,
            path,
        );
    }
    let (status, body) = get(&client, &base, "/api/messages/search/channel/channel-13?q=").await;
    assert_eq!(status, 400, "{body}");
    // Fault injection reaches these routes like any other.
    for operation in [
        "ThreadsController_getReplies",
        "ThreadsController_getMetadata",
        "ThreadsController_subscribe",
        "ThreadsController_unsubscribe",
        "MessagesController_searchChannelMessages",
        "MessagesController_searchDirectMessages",
        "MessagesController_searchCommunityMessages",
    ] {
        server.fail_route(operation, 503, "SERVICE_UNAVAILABLE");
    }
    for (method, path) in [
        (reqwest::Method::GET, "/api/threads/msg-48/replies"),
        (reqwest::Method::GET, "/api/threads/msg-48/metadata"),
        (reqwest::Method::POST, "/api/threads/msg-48/subscribe"),
        (reqwest::Method::DELETE, "/api/threads/msg-48/subscribe"),
        (
            reqwest::Method::GET,
            "/api/messages/search/channel/channel-13?q=plan",
        ),
        (
            reqwest::Method::GET,
            "/api/messages/search/group/dm-1?q=plan",
        ),
        (
            reqwest::Method::GET,
            "/api/messages/search/community/community-1?q=plan",
        ),
    ] {
        let (status, body) = request(&client, method, &base, path, None, true).await;
        assert_eq!(status, 503, "{path}: {body}");
        assert_eq!(body["errorCode"], "SERVICE_UNAVAILABLE", "{path}");
    }

    // Files are binary; the contract declares opaque bytes.
    for path in [
        "/api/file/attach-screenshot-1",
        "/api/file/attach-screenshot-1/thumbnail",
    ] {
        let first = file_bytes(&client, &base, path).await;
        let second = file_bytes(&client, &base, path).await;
        assert_eq!(first, second, "{path} is deterministic");
        assert_eq!(&first[..8], b"\x89PNG\r\n\x1a\n", "{path} is a PNG");
    }

    // Errors use ErrorResponseDto too.
    let (status, body) = request(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/users/profile",
        None,
        false,
    )
    .await;
    assert_eq!(status, 401, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("ErrorResponseDto"),
        &body,
        "401",
    );

    let (status, body) = request(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/auth/login",
        Some(json!({ "username": "mike", "password": "wrong" })),
        false,
    )
    .await;
    assert_eq!(status, 401, "{body}");
    assert_eq!(body["errorCode"], "UNAUTHENTICATED");
    assert_valid(
        &schemas,
        &schemas.component("ErrorResponseDto"),
        &body,
        "login failure",
    );

    let (status, body) = get(&client, &base, "/api/not-a-route").await;
    assert_eq!(status, 501, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("ErrorResponseDto"),
        &body,
        "501",
    );

    assert_routes_are_implemented(&schemas, &client, &base).await;
}

async fn file_bytes(client: &reqwest::Client, base: &str, path: &str) -> Vec<u8> {
    let response = client
        .get(format!("{base}{path}"))
        .header("Authorization", TOKEN)
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("image/png")
    );
    response.bytes().await.expect("bytes").to_vec()
}

/// The sockets and the events they carry.
#[tokio::test]
async fn every_emit_and_ack_matches_socket_events() {
    let schemas = Schemas::load();
    let server = start("big-community").await;
    let base = server.base_url();
    let events: Value = serde_json::from_str(include_str!("../../../contract/socket-events.json"))
        .expect("socket-events.json is valid JSON");

    let mut socket = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;

    // sendMessage: one broadcast and one typed ack.
    let nonce = uuid(1);
    socket
        .send(&format!(
            "421{}",
            json!([
                "sendMessage",
                {
                    "channelId": "channel-13",
                    "spans": [{ "type": "PLAINTEXT", "text": "socket contract" }],
                    "attachments": [],
                    "clientNonce": nonce,
                }
            ])
        ))
        .await;
    let (broadcast, message) = expect_broadcast(&mut socket, "newMessage").await;
    assert_valid(
        &schemas,
        &schemas.reference(
            events["server"]["newMessage"]["payload"]["$ref"]
                .as_str()
                .expect("a payload ref"),
        ),
        &broadcast,
        "newMessage payload",
    );
    let ack = expect_ack(&mut socket, 1).await;
    assert_valid(
        &schemas,
        &schemas.reference(
            events["client"]["sendMessage"]["ack"]["$ref"]
                .as_str()
                .expect("an ack ref"),
        ),
        &ack,
        "sendMessage ack",
    );

    // The same payload through `emit`.
    server
        .emit("newMessage", json!({ "message": message }))
        .await;
    let (emitted, _) = expect_broadcast(&mut socket, "newMessage").await;
    assert_valid(
        &schemas,
        &schemas.reference(
            events["server"]["newMessage"]["payload"]["$ref"]
                .as_str()
                .expect("a payload ref"),
        ),
        &emitted,
        "emitted newMessage",
    );

    // sendDirectMessage carries its own event.
    socket
        .send(&format!(
            "422{}",
            json!([
                "sendDirectMessage",
                {
                    "directMessageGroupId": "dm-1",
                    "spans": [{ "type": "PLAINTEXT", "text": "socket dm" }],
                    "attachments": [],
                    "clientNonce": uuid(2),
                }
            ])
        ))
        .await;
    let (dm, _) = expect_broadcast(&mut socket, "newDirectMessage").await;
    assert_valid(
        &schemas,
        &schemas.reference(
            events["server"]["newDirectMessage"]["payload"]["$ref"]
                .as_str()
                .expect("a payload ref"),
        ),
        &dm,
        "newDirectMessage payload",
    );
    let _ = expect_ack(&mut socket, 2).await;

    // sendThreadReply carries the parent.
    socket
        .send(&format!(
            "423{}",
            json!([
                "sendThreadReply",
                {
                    "parentMessageId": "msg-48",
                    "spans": [{ "type": "PLAINTEXT", "text": "socket reply" }],
                    "attachments": [],
                    "clientNonce": uuid(3),
                }
            ])
        ))
        .await;
    let (reply, _) = expect_broadcast(&mut socket, "newThreadReply").await;
    assert_valid(
        &schemas,
        &schemas.reference(
            events["server"]["newThreadReply"]["payload"]["$ref"]
                .as_str()
                .expect("a payload ref"),
        ),
        &reply,
        "newThreadReply payload",
    );
    // Then the parent's badge, as the backend sends it.
    let (count, _) = expect_broadcast(&mut socket, "threadReplyCountUpdated").await;
    assert_valid(
        &schemas,
        &schemas.reference(
            events["server"]["threadReplyCountUpdated"]["payload"]["$ref"]
                .as_str()
                .expect("a payload ref"),
        ),
        &count,
        "threadReplyCountUpdated payload",
    );
    let _ = expect_ack(&mut socket, 3).await;

    // A failed send's typed ack is a SendAckDto too.
    server.fail_next_send("RATE_LIMITED", true, Some(250));
    socket
        .send(&format!(
            "424{}",
            json!([
                "sendMessage",
                {
                    "channelId": "channel-13",
                    "spans": [{ "type": "PLAINTEXT", "text": "fails" }],
                    "attachments": [],
                }
            ])
        ))
        .await;
    let failed = expect_ack(&mut socket, 4).await;
    assert_eq!(failed["ok"], false);
    assert_valid(
        &schemas,
        &schemas.reference(
            events["client"]["sendMessage"]["ack"]["$ref"]
                .as_str()
                .expect("an ack ref"),
        ),
        &failed,
        "failed sendMessage ack",
    );

    socket
        .send(&format!(
            "425{}",
            json!(["reauthenticate", { "token": "Bearer refreshed" }])
        ))
        .await;
    let reauthenticated = expect_ack(&mut socket, 5).await;
    assert_eq!(reauthenticated["ok"], true);
    assert_valid(
        &schemas,
        &schemas.reference(
            events["client"]["reauthenticate"]["ack"]["$ref"]
                .as_str()
                .expect("an ack ref"),
        ),
        &reauthenticated,
        "reauthenticate ack",
    );
}

async fn expect_broadcast(socket: &mut Socket, name: &str) -> (Value, Value) {
    let frame = socket.next_text().await;
    let (event, payload) = parse_event(&frame)
        .map(|(_, args)| {
            (
                args.first()
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                args.get(1).cloned().unwrap_or(Value::Null),
            )
        })
        .unwrap_or_else(|| panic!("expected {name}, got a non-event frame {frame:?}"));
    assert_eq!(event, name, "expected {name}, got {frame}");
    let message = payload
        .get("message")
        .or_else(|| payload.get("reply"))
        .cloned()
        .unwrap_or(Value::Null);
    (payload, message)
}

async fn expect_ack(socket: &mut Socket, id: u64) -> Value {
    let frame = socket.next_text().await;
    let (actual, value) = parse_ack(&frame).unwrap_or_else(|| panic!("not an ack: {frame}"));
    assert_eq!(actual, id, "wrong ack id: {frame}");
    value
}

fn uuid(n: u128) -> String {
    uuid::Uuid::from_u128(0x1234_5678_9abc_def0_0000_0000_0000_0000 + n).to_string()
}

/// A route the fake does not implement names itself in its 501.
async fn assert_routes_are_implemented(_schemas: &Schemas, client: &reqwest::Client, base: &str) {
    let (status, body) = get(client, base, "/api/roles/community/community-1").await;
    assert_eq!(status, 501, "{body}");
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("/api/roles/community/community-1"),
        "{body}"
    );
}

/// W1 part A: edit, delete, read one, pins, a moderator's removal and channel roles, each against
/// its schema, and each broadcast against socket-events.json.
#[tokio::test]
async fn message_actions_match_openapi_and_socket_events() {
    let schemas = Schemas::load();
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();
    let events: Value = serde_json::from_str(include_str!("../../../contract/socket-events.json"))
        .expect("socket-events.json is valid JSON");
    let mut socket = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
    let payload_schema = |name: &str| {
        schemas.reference(
            events["server"][name]["payload"]["$ref"]
                .as_str()
                .unwrap_or_else(|| panic!("a payload ref for {name}")),
        )
    };
    let call = |method: reqwest::Method, path: &'static str, body: Option<Value>| {
        let (client, base) = (client.clone(), base.clone());
        async move { request(&client, method, &base, path, body, true).await }
    };

    // Edit: the author's own message, formatting kept.
    let (status, body) = call(
        reqwest::Method::PATCH,
        "/api/messages/msg-18",
        Some(json!({
            "spans": [
                { "type": "PLAINTEXT", "text": "bold", "bold": true },
                { "type": "PLAINTEXT", "text": " plain" },
            ],
            "attachments": [],
        })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_valid(&schemas, &schemas.component("MessageDto"), &body, "edit");
    assert_eq!(body["spans"][0]["bold"], true, "{body}");
    assert!(body["editedAt"].is_string(), "{body}");
    let (event, _) = expect_broadcast(&mut socket, "updateMessage").await;
    assert_valid(
        &schemas,
        &payload_schema("updateMessage"),
        &event,
        "updateMessage",
    );

    // Someone else's can't be edited.
    let (status, body) = call(
        reqwest::Method::PATCH,
        "/api/messages/msg-14",
        Some(json!({ "spans": [{ "type": "PLAINTEXT", "text": "no" }], "attachments": [] })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("ErrorResponseDto"),
        &body,
        "edit refused",
    );

    let (status, body) = call(reqwest::Method::GET, "/api/messages/msg-18", None).await;
    assert_eq!(status, 200, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("MessageDto"),
        &body,
        "find one",
    );

    // Pin, list, unpin.
    let (status, body) = call(
        reqwest::Method::POST,
        "/api/moderation/pin/msg-14",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("SuccessMessageDto"),
        &body,
        "pin",
    );
    let (event, _) = expect_broadcast(&mut socket, "messagePinned").await;
    assert_valid(
        &schemas,
        &payload_schema("messagePinned"),
        &event,
        "messagePinned",
    );

    let (status, body) = call(
        reqwest::Method::GET,
        "/api/moderation/pins/channel-13",
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_valid(
        &schemas,
        &schemas.array_of("PinnedMessageDto"),
        &body,
        "pins",
    );
    let pinned: Vec<&str> = body
        .as_array()
        .expect("a list")
        .iter()
        .filter_map(|pin| pin["id"].as_str())
        .collect();
    assert_eq!(
        pinned.last(),
        Some(&"msg-14"),
        "newest pin last: {pinned:?}"
    );
    assert!(pinned.contains(&"msg-15"), "{pinned:?}");

    let (status, body) = call(
        reqwest::Method::DELETE,
        "/api/moderation/pin/msg-14",
        Some(json!({ "reason": "done" })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("SuccessMessageDto"),
        &body,
        "unpin",
    );
    let (event, _) = expect_broadcast(&mut socket, "messageUnpinned").await;
    assert_valid(
        &schemas,
        &payload_schema("messageUnpinned"),
        &event,
        "messageUnpinned",
    );

    // A moderator's removal keeps the message, removed, with who and why.
    let (status, body) = call(
        reqwest::Method::DELETE,
        "/api/moderation/message/msg-16",
        Some(json!({ "reason": "spam" })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("SuccessMessageDto"),
        &body,
        "remove",
    );
    let (event, _) = expect_broadcast(&mut socket, "deleteMessage").await;
    assert_valid(
        &schemas,
        &payload_schema("deleteMessage"),
        &event,
        "deleteMessage",
    );
    let (status, body) = call(reqwest::Method::GET, "/api/messages/msg-16", None).await;
    assert_eq!(status, 200, "{body}");
    assert_valid(&schemas, &schemas.component("MessageDto"), &body, "removed");
    assert!(body["deletedAt"].is_string(), "{body}");
    assert_eq!(body["deletedByReason"], "spam", "{body}");

    // A delete takes it away.
    let (status, body) = call(reqwest::Method::DELETE, "/api/messages/msg-29", None).await;
    assert_eq!(status, 204, "{body}");
    let (event, _) = expect_broadcast(&mut socket, "deleteMessage").await;
    assert_valid(
        &schemas,
        &payload_schema("deleteMessage"),
        &event,
        "deleteMessage",
    );
    let (status, body) = call(reqwest::Method::GET, "/api/messages/msg-29", None).await;
    assert_eq!(status, 404, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("ErrorResponseDto"),
        &body,
        "deleted",
    );

    let (status, body) = call(
        reqwest::Method::GET,
        "/api/roles/my/channel/channel-13",
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_valid(
        &schemas,
        &schemas.component("UserRolesResponseDto"),
        &body,
        "channel roles",
    );
}

/// W2: the DM, friends and notification routes against their schemas, and the events they and the
/// socket send against socket-events.json. On the showcase, whose ids are the UUIDs the schemas'
/// paths and bodies ask for.
#[tokio::test]
async fn dms_friends_and_notifications_match_openapi_and_socket_events() {
    use reqwest::Method as M;
    let schemas = Schemas::load();
    let server = start("showcase").await;
    let base = server.base_url();
    let client = http();
    let id = |readable: &str| semaphore_fake_server::entity_uuid(readable);
    let events: Value = serde_json::from_str(include_str!("../../../contract/socket-events.json"))
        .expect("socket-events.json is valid JSON");
    let payload_of =
        |name: &str| schemas.reference(events["server"][name]["payload"]["$ref"].as_str().unwrap());

    let check =
        |method: M, path: String, body: Option<Value>, status: u16, schema: Option<Value>| {
            let (client, base) = (client.clone(), base.clone());
            async move {
                let what = format!("{method} {path}");
                let (actual, value) = request(&client, method, &base, &path, body, true).await;
                assert_eq!(actual, status, "{what}: {value}");
                if let Some(schema) = schema {
                    assert_valid(&Schemas::load(), &schema, &value, &what);
                }
                value
            }
        };
    let error = schemas.component("ErrorResponseDto");

    // DMs.
    let groups = check(
        M::GET,
        "/api/direct-messages".into(),
        None,
        200,
        Some(schemas.array_of("DmGroupResponseDto")),
    )
    .await;
    assert_eq!(groups.as_array().unwrap().len(), 5);
    let trio = check(
        M::POST,
        "/api/direct-messages".into(),
        Some(json!({ "userIds": [id("u-priya"), id("u-samira")], "name": "Trio" })),
        201,
        Some(schemas.component("DmGroupResponseDto")),
    )
    .await;
    let trio_id = trio["id"].as_str().unwrap().to_owned();
    check(
        M::POST,
        "/api/direct-messages".into(),
        Some(json!({ "userIds": [id("u-priya")] })),
        201,
        Some(schemas.component("DmGroupResponseDto")),
    )
    .await;
    check(
        M::POST,
        format!("/api/direct-messages/{trio_id}/members"),
        Some(json!({ "userIds": [id("u-mateo")] })),
        201,
        Some(schemas.component("DmGroupResponseDto")),
    )
    .await;
    check(
        M::POST,
        format!("/api/direct-messages/{}/members", id("dm-priya")),
        Some(json!({ "userIds": [id("u-mateo")] })),
        403,
        Some(error.clone()),
    )
    .await;
    check(
        M::POST,
        "/api/direct-messages/x/members".into(),
        Some(json!({ "userIds": [] })),
        400,
        Some(error.clone()),
    )
    .await;
    check(
        M::DELETE,
        format!("/api/direct-messages/{trio_id}/members/me"),
        None,
        204,
        None,
    )
    .await;
    check(
        M::GET,
        "/api/users/search?q=a&limit=5".into(),
        None,
        200,
        Some(schemas.array_of("UserEntity")),
    )
    .await;

    // Friends.
    check(
        M::GET,
        "/api/friends".into(),
        None,
        200,
        Some(schemas.array_of("FriendListItemDto")),
    )
    .await;
    check(
        M::GET,
        "/api/friends/requests".into(),
        None,
        200,
        Some(schemas.component("PendingRequestsDto")),
    )
    .await;
    for user in ["u-chloe", "u-tomas", "u-priya", "u-mateo"] {
        check(
            M::GET,
            format!("/api/friends/status/{}", id(user)),
            None,
            200,
            Some(schemas.component("FriendshipStatusDto")),
        )
        .await;
    }
    check(
        M::POST,
        format!("/api/friends/request/{}", id("u-mateo")),
        None,
        201,
        Some(schemas.component("FriendshipDto")),
    )
    .await;
    check(
        M::POST,
        format!("/api/friends/request/{}", id("u-priya")),
        None,
        409,
        Some(error.clone()),
    )
    .await;
    check(
        M::POST,
        format!("/api/friends/request/{}", uuid(1)),
        None,
        404,
        Some(error.clone()),
    )
    .await;
    let pending = check(
        M::GET,
        "/api/friends/requests".into(),
        None,
        200,
        Some(schemas.component("PendingRequestsDto")),
    )
    .await;
    let mateo_request = pending["sent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["userBId"] == id("u-mateo").as_str())
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let success = Some(schemas.component("SuccessResponseDto"));
    check(
        M::DELETE,
        format!("/api/friends/cancel/{mateo_request}"),
        None,
        200,
        success.clone(),
    )
    .await;
    check(
        M::POST,
        format!("/api/friends/accept/{}", id("sc-friend-u-chloe")),
        None,
        201,
        Some(schemas.component("FriendshipDto")),
    )
    .await;
    check(
        M::DELETE,
        format!("/api/friends/{}", id("sc-friend-u-chloe")),
        None,
        200,
        success.clone(),
    )
    .await;
    check(
        M::DELETE,
        format!("/api/friends/decline/{}", id("sc-friend-out-u-tomas")),
        None,
        403,
        Some(error.clone()),
    )
    .await;
    {
        let other = start("showcase").await;
        let (client, base) = (http(), other.base_url());
        let (status, body) = request(
            &client,
            M::DELETE,
            &base,
            &format!("/api/friends/decline/{}", id("sc-friend-u-chloe")),
            None,
            true,
        )
        .await;
        assert_eq!(status, 200, "{body}");
        assert_valid(
            &schemas,
            &schemas.component("SuccessResponseDto"),
            &body,
            "decline",
        );
    }

    // Notifications.
    let list = check(
        M::GET,
        "/api/notifications?limit=50".into(),
        None,
        200,
        Some(schemas.component("NotificationListResponseDto")),
    )
    .await;
    assert_eq!(list["notifications"].as_array().unwrap().len(), 11);
    check(
        M::GET,
        "/api/notifications/unread-count".into(),
        None,
        200,
        Some(schemas.component("UnreadCountResponseDto")),
    )
    .await;
    check(
        M::GET,
        "/api/notifications?limit=0".into(),
        None,
        400,
        Some(error.clone()),
    )
    .await;
    let mut me = connect_as(&base, &id("me")).await;
    check(
        M::POST,
        format!(
            "/api/notifications/{}/read",
            id("sc-notif-sc-design-accent")
        ),
        None,
        200,
        Some(schemas.component("NotificationDto")),
    )
    .await;
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(names(&heard[0]), vec!["notificationRead"]);
    assert_valid(
        &schemas,
        &payload_of("notificationRead"),
        &heard[0][0].1,
        "notificationRead payload",
    );
    check(
        M::POST,
        format!(
            "/api/notifications/{}/dismiss",
            id("sc-notif-sc-dm-launch-copy")
        ),
        None,
        200,
        Some(schemas.component("NotificationDto")),
    )
    .await;
    check(
        M::POST,
        format!("/api/notifications/{}/read", uuid(2)),
        None,
        404,
        Some(error.clone()),
    )
    .await;
    check(
        M::POST,
        "/api/notifications/read-all".into(),
        None,
        200,
        Some(schemas.component("UnreadCountResponseDto")),
    )
    .await;
    check(
        M::GET,
        "/api/notifications/settings".into(),
        None,
        200,
        Some(schemas.component("UserNotificationSettingsDto")),
    )
    .await;
    check(
        M::PUT,
        "/api/notifications/settings".into(),
        Some(json!({ "defaultChannelLevel": "all", "soundType": "mention", "doNotDisturb": true, "dndStartTime": "21:30", "dndEndTime": "07:00", "dndTimezone": "Europe/Berlin" })),
        200,
        Some(schemas.component("UserNotificationSettingsDto")),
    )
    .await;
    let override_path = format!(
        "/api/notifications/channels/{}/override",
        semaphore_fake_server::entity_uuid("tr-general")
    );
    check(
        M::GET,
        override_path.clone(),
        None,
        200,
        Some(schemas.component("ChannelNotificationOverrideDto")),
    )
    .await;
    check(
        M::PUT,
        override_path.clone(),
        Some(json!({ "level": "mentions" })),
        200,
        Some(schemas.component("ChannelNotificationOverrideDto")),
    )
    .await;
    check(M::DELETE, override_path, None, 204, None).await;

    // Socket events. Priya's DM and mention reach me as new notifications; me reads a DM.
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let (sent, _) = emit_event(
        &mut priya,
        1,
        "sendDirectMessage",
        json!({
            "directMessageGroupId": id("dm-priya"),
            "spans": [{ "type": "PLAINTEXT", "text": "contract dm" }],
            "attachments": [],
            "clientNonce": uuid(11),
        }),
    )
    .await;
    assert_valid(
        &schemas,
        &payload_of("newDirectMessage"),
        &sent[0].1,
        "newDirectMessage",
    );
    emit_event(
        &mut priya,
        2,
        "sendMessage",
        json!({
            "channelId": semaphore_fake_server::entity_uuid("cc-general"),
            "spans": [{ "type": "USER_MENTION", "text": "@alexk", "userId": id("me") }],
            "attachments": [],
            "clientNonce": uuid(12),
        }),
    )
    .await;
    let heard = settle(&server, &mut [&mut me]).await;
    let notifications: Vec<_> = heard[0]
        .iter()
        .filter(|(name, _)| name == "newNotification")
        .collect();
    assert_eq!(notifications.len(), 2, "{heard:?}");
    for (_, payload) in &notifications {
        assert_valid(
            &schemas,
            &payload_of("newNotification"),
            payload,
            "newNotification",
        );
    }
    assert_eq!(notifications[0].1["type"], "DIRECT_MESSAGE");
    assert_eq!(notifications[1].1["type"], "USER_MENTION");

    let mark = json!({ "directMessageGroupId": id("dm-priya"), "lastReadMessageId": sent[0].1["message"]["id"] });
    assert_valid(
        &schemas,
        &schemas.reference(
            events["client"]["markAsRead"]["payload"]["$ref"]
                .as_str()
                .unwrap(),
        ),
        &mark,
        "markAsRead payload",
    );
    let (receipts, _) = emit_event(&mut me, 1, "markAsRead", mark).await;
    assert_eq!(
        names(&receipts),
        vec!["readReceiptUpdated", "readReceiptUpdated"]
    );
    for (_, payload) in &receipts {
        assert_valid(
            &schemas,
            &payload_of("readReceiptUpdated"),
            payload,
            "readReceiptUpdated",
        );
    }
    check(
        M::POST,
        "/api/read-receipts/mark-read".into(),
        Some(json!({ "directMessageGroupId": id("dm-priya"), "lastReadMessageId": sent[0].1["message"]["id"] })),
        200,
        Some(schemas.component("ReadReceiptDto")),
    )
    .await;
    let heard = settle(&server, &mut [&mut me]).await;
    assert_eq!(
        names(&heard[0]),
        vec!["readReceiptUpdated", "readReceiptUpdated"]
    );
    for (_, payload) in &heard[0] {
        assert_valid(
            &schemas,
            &payload_of("readReceiptUpdated"),
            payload,
            "REST readReceiptUpdated",
        );
    }
    let presence = json!({ "idle": true });
    assert_valid(
        &schemas,
        &schemas.reference(
            events["client"]["presenceOnline"]["payload"]["$ref"]
                .as_str()
                .unwrap(),
        ),
        &presence,
        "presenceOnline payload",
    );
}
