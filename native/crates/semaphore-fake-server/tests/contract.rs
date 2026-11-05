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
                        "additionalProperties" => {}
                        _ => {
                            result.insert(key.clone(), value.clone());
                        }
                    }
                }
                // A bare object with no properties of its own (a composed wrapper,
                // or a map) must not close itself: `additionalProperties` only
                // knows about properties declared in the same schema object.
                if result.contains_key("properties")
                    || (result.get("type").and_then(Value::as_str) == Some("object")
                        && !result.contains_key("allOf")
                        && !result.contains_key("oneOf")
                        && !result.contains_key("anyOf"))
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
