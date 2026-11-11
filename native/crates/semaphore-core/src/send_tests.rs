//! `read_ack` on everything a server, or a broken one, can put in a send's ack.

use super::*;
use serde_json::json;

fn unreadable() -> SendOutcome {
    SendOutcome::Failed(failure("UNKNOWN", "Failed to send", true))
}

fn refusal(code: &str, message: &str, retryable: bool, retry_after_ms: Option<u64>) -> SendOutcome {
    SendOutcome::Failed(ErrorView {
        code: code.to_owned(),
        message: message.to_owned(),
        retryable,
        retry_after_ms,
    })
}

#[test]
fn a_good_ack_delivers_its_id() {
    assert_eq!(
        read_ack(&[json!({ "ok": true, "messageId": "m1" })]),
        SendOutcome::Delivered {
            message_id: "m1".into()
        }
    );
    // An older server acks with the bare id.
    assert_eq!(
        read_ack(&[json!("m2")]),
        SendOutcome::Delivered {
            message_id: "m2".into()
        }
    );
    // Arguments after the first are not read.
    assert_eq!(
        read_ack(&[json!("m3"), json!({ "ok": false })]),
        SendOutcome::Delivered {
            message_id: "m3".into()
        }
    );
}

#[test]
fn an_ack_that_cannot_be_read_is_a_retryable_failure() {
    for args in [
        vec![],
        vec![json!(null)],
        vec![json!(7)],
        vec![json!(true)],
        vec![json!([])],
        vec![json!({})],
        vec![json!({ "ok": "yes" })],
        // `ok` without an id, and a failure without its error: neither says what happened.
        vec![json!({ "ok": true })],
        vec![json!({ "ok": true, "messageId": null })],
        vec![json!({ "ok": false })],
        vec![json!({ "ok": false, "error": { "message": "no code" } })],
    ] {
        assert_eq!(read_ack(&args), unreadable(), "{args:?}");
    }
}

#[test]
fn a_refusal_carries_the_servers_verdict() {
    assert_eq!(
        read_ack(&[json!({
            "ok": false,
            "error": { "errorCode": "RATE_LIMITED", "message": "Slow down", "retryable": true, "retryAfterMs": 1500.7 }
        })]),
        refusal("RATE_LIMITED", "Slow down", true, Some(1500))
    );
    assert_eq!(
        read_ack(&[json!({
            "ok": false,
            "error": { "errorCode": "FORBIDDEN", "message": "Missing CREATE_MESSAGE", "retryable": false }
        })]),
        refusal("FORBIDDEN", "You can't send messages here", false, None)
    );
    for code in ["VALIDATION_FAILED", "INTERNAL", "UNKNOWN"] {
        assert_eq!(
            read_ack(&[json!({
                "ok": false,
                "error": { "errorCode": code, "message": "stack trace here", "retryable": false }
            })]),
            refusal(code, "Failed to send", false, None)
        );
    }
    // A code with no words gets generic ones.
    assert_eq!(
        read_ack(&[json!({
            "ok": false,
            "error": { "errorCode": "NOT_FOUND", "message": "", "retryable": false }
        })]),
        refusal("NOT_FOUND", "Failed to send", false, None)
    );
}

#[test]
fn a_retry_after_that_is_not_a_time_is_dropped() {
    for retry_after in [json!(-1), json!(-0.5)] {
        assert_eq!(
            read_ack(&[json!({
                "ok": false,
                "error": { "errorCode": "RATE_LIMITED", "message": "m", "retryable": true, "retryAfterMs": retry_after }
            })]),
            refusal("RATE_LIMITED", "m", true, None),
            "{retry_after}"
        );
    }
    assert_eq!(
        read_ack(&[json!({
            "ok": false,
            "error": { "errorCode": "RATE_LIMITED", "message": "m", "retryable": true, "retryAfterMs": 0 }
        })]),
        refusal("RATE_LIMITED", "m", true, Some(0))
    );
}

#[test]
fn a_message_deleted_while_sending_is_its_own_outcome() {
    assert_eq!(
        read_ack(&[json!({
            "ok": false,
            "error": { "errorCode": "MESSAGE_DELETED", "message": "gone", "retryable": false }
        })]),
        SendOutcome::DeletedWhileSending
    );
}

// --- bug:empty-id ---
#[test]
fn an_ack_with_an_empty_id_is_not_a_delivery() {
    // A row promoted to id "" would collide with every other such row and with nothing on the
    // server: the send can't be settled from it.
    assert_eq!(read_ack(&[json!("")]), unreadable());
    assert_eq!(
        read_ack(&[json!({ "ok": true, "messageId": "" })]),
        unreadable()
    );
}
// --- end bug:empty-id ---
