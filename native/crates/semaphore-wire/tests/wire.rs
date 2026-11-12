//! The reader rules from `contract/wire-contract.md`, against recorded real payloads.
//!
//! The fixture is the one the web client replays: `message-wire-payloads.json` at the
//! contract's commit, copied here by `scripts/gen-api.sh`'s source of truth. It holds what
//! the server really sent, so these tests fail if a newer server could break a client.

use semaphore_wire::{
    AnchoredMessagesResponseDto, CommunitySearchResultDto, MessageDto, MessageReactionsDto,
    PaginatedMessagesResponseDto, ThreadRepliesResponseDto,
    enums::{ErrorCode, SpanType},
    events::ServerEvent,
};
use serde_json::{Value, json};

const RECORDED: &str = include_str!("data/message-wire-payloads.json");
const SOCKET_EVENTS: &str = include_str!("../../../contract/socket-events.json");

fn recorded() -> Value {
    serde_json::from_str(RECORDED).expect("the recorded payloads are valid JSON")
}

/// One real `MessageDto`, from a `newMessage` the server sent.
fn message_body() -> Value {
    let recorded = recorded();
    recorded["events"]
        .as_array()
        .expect("the fixture has events")
        .iter()
        .find(|event| event["event"] == "newMessage")
        .expect("the fixture has a newMessage")
        .get("payload")
        .and_then(|payload| payload.get("message"))
        .expect("a newMessage carries a message")
        .clone()
}

#[test]
fn every_recorded_payload_decodes() {
    let recorded = recorded();

    for event in recorded["events"].as_array().expect("events") {
        let name = event["event"].as_str().expect("an event name");
        let payload = event["payload"].clone();
        match ServerEvent::decode(name, payload) {
            ServerEvent::Unknown { .. } => panic!("{name} is a server event this build lost"),
            ServerEvent::Malformed { error, .. } => panic!("{name} did not decode: {error}"),
            _ => {}
        }
    }

    for response in recorded["responses"].as_array().expect("responses") {
        let component = response["component"].as_str().expect("a component name");
        let body = response["body"].clone();
        let decoded = match component {
            "AnchoredMessagesResponseDto" => {
                serde_json::from_value::<AnchoredMessagesResponseDto>(body).map(drop)
            }
            "CommunitySearchResultDto" => {
                serde_json::from_value::<CommunitySearchResultDto>(body).map(drop)
            }
            "MessageDto" => serde_json::from_value::<MessageDto>(body).map(drop),
            "MessageReactionsDto" => serde_json::from_value::<MessageReactionsDto>(body).map(drop),
            "PaginatedMessagesResponseDto" => {
                serde_json::from_value::<PaginatedMessagesResponseDto>(body).map(drop)
            }
            "ThreadRepliesResponseDto" => {
                serde_json::from_value::<ThreadRepliesResponseDto>(body).map(drop)
            }
            other => panic!("the fixture names an unhandled component: {other}"),
        };
        assert!(
            decoded.is_ok(),
            "{} did not decode as {component}: {:?}",
            response["label"],
            decoded.err()
        );
    }
}

#[test]
fn an_unknown_span_type_is_kept_and_round_trips() {
    // Canonicalise first: the recorded payload has nulls on optional fields, which a DTO
    // deliberately omits when it serialises.
    let message: MessageDto =
        serde_json::from_value(message_body()).expect("the recorded message decodes");
    let mut body = serde_json::to_value(&message).expect("a decoded message serialises");
    assert_eq!(body["spans"][0]["type"], "PLAINTEXT");

    body["spans"][0]["type"] = json!("HOLOGRAM");
    let decoded: MessageDto =
        serde_json::from_value(body.clone()).expect("an unknown span type keeps the message");
    assert_eq!(
        decoded.spans[0].type_,
        SpanType::Unknown(String::from("HOLOGRAM"))
    );
    assert_eq!(
        serde_json::to_value(&decoded).expect("the message serialises"),
        body
    );
}

#[test]
fn an_unknown_field_does_not_fail_a_message() {
    let mut body = message_body();
    body["someFutureField"] = json!({"nested": [1, 2, 3]});
    serde_json::from_value::<MessageDto>(body).expect("an unknown field keeps the message");
}

#[test]
fn a_missing_required_nullable_field_is_none() {
    let mut body = message_body();
    body.as_object_mut().expect("an object").remove("replyTo");
    let decoded: MessageDto = serde_json::from_value(body).expect("a missing nullable field");
    assert!(decoded.reply_to.is_none());

    let mut body = message_body();
    body["replyTo"] = Value::Null;
    let decoded: MessageDto = serde_json::from_value(body).expect("an explicit null");
    assert!(decoded.reply_to.is_none());
}

#[test]
fn decoding_never_fails() {
    match ServerEvent::decode("someFutureEvent", json!({})) {
        ServerEvent::Unknown { name, payload } => {
            assert_eq!(name, "someFutureEvent");
            assert_eq!(payload, json!({}));
        }
        other => panic!("an unknown event must be Unknown, got {other:?}"),
    }

    match ServerEvent::decode("newMessage", json!({ "message": 42 })) {
        ServerEvent::Malformed {
            name,
            payload,
            error,
        } => {
            assert_eq!(name, "newMessage");
            assert_eq!(payload["message"], json!(42));
            assert!(!error.is_empty(), "the deserializer's error is kept");
        }
        other => panic!("a wrong-typed payload must be Malformed, got {other:?}"),
    }
}

#[test]
fn every_contract_server_event_has_a_variant() {
    let contract: Value =
        serde_json::from_str(SOCKET_EVENTS).expect("socket-events.json is valid JSON");
    let server = contract["server"].as_object().expect("a server object");
    assert_eq!(server.len(), 72, "the contract pins 72 server events");

    for name in server.keys() {
        let decoded = ServerEvent::decode(name, Value::Null);
        assert!(
            !matches!(decoded, ServerEvent::Unknown { .. }),
            "{name} is in the contract but has no ServerEvent variant"
        );
    }
}

#[test]
fn an_unknown_error_code_is_kept() {
    let code: ErrorCode =
        serde_json::from_value(json!("SOMETHING_FROM_THE_FUTURE")).expect("an unknown error code");
    assert_eq!(
        code,
        ErrorCode::Unknown(String::from("SOMETHING_FROM_THE_FUTURE"))
    );
    assert_eq!(
        serde_json::to_value(&code).expect("serialises"),
        json!("SOMETHING_FROM_THE_FUTURE")
    );

    // `UNKNOWN` is a wire value of its own; it lands in the tolerant variant and comes back
    // out unchanged, so a client cannot tell it apart from an unparsed body.
    let wire_unknown: ErrorCode =
        serde_json::from_value(json!("UNKNOWN")).expect("the wire's UNKNOWN");
    assert_eq!(wire_unknown, ErrorCode::Unknown(String::from("UNKNOWN")));
    assert_eq!(
        serde_json::to_value(&wire_unknown).expect("serialises"),
        json!("UNKNOWN")
    );

    let known: ErrorCode = serde_json::from_value(json!("RATE_LIMITED")).expect("a known code");
    assert_eq!(known, ErrorCode::RateLimited);
    assert_eq!(known.as_str(), "RATE_LIMITED");
}
