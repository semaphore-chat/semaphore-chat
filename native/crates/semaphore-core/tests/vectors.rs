//! The web client's cache rules, as exported data. `scripts/gen-cache-vectors.sh` writes both files,
//! at the commit in `contract/PIN`. Nothing here restates the rules: a vector is what the web's own
//! code returned when its own tests ran it, whole, so it checks more than those tests assert.

use semaphore_core::events::rule;
use semaphore_core::model::ErrorView;
use semaphore_core::resync::RECONNECT_INVALIDATES;
use semaphore_core::store::{SendStatus, StoredMessage, Window};
use semaphore_wire::types::MessageDto;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/cache")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(&path).expect("read fixture"))
        .expect("parse fixture")
}

fn stored(row: &Value) -> StoredMessage {
    // One web test casts a partial `replyTo` with `as never`. A real one always has `sentAt`.
    let mut row = row.clone();
    if let Some(reply_to) = row["replyTo"].as_object_mut() {
        reply_to
            .entry("sentAt")
            .or_insert("2026-09-22T18:00:00.000Z".into());
    }
    let row = &row;
    let dto: MessageDto =
        serde_json::from_value(row.clone()).expect("a vector row is a MessageDto");
    let send = match row.get("sendStatus").and_then(Value::as_str) {
        Some("pending") => SendStatus::Pending,
        Some("failed") => SendStatus::Failed(any_error()),
        Some(other) => panic!("unexpected sendStatus {other}"),
        None => SendStatus::Settled,
    };
    StoredMessage {
        dto,
        client_id: row
            .get("clientId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        send,
    }
}

fn any_error() -> ErrorView {
    ErrorView {
        code: "UNKNOWN".into(),
        message: "Failed to send".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

fn flat_rows(data: &Value) -> Vec<&Value> {
    data["pages"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|page| page["messages"].as_array().into_iter().flatten())
        .collect()
}

/// The web's `InfiniteData`, or `undefined`, or no pages at all, as a window.
fn window_from(data: &Value) -> Window {
    if data.is_null() || data["pages"].as_array().is_some_and(Vec::is_empty) {
        return Window::unloaded();
    }
    let detached = match &data["pageParams"][0] {
        Value::Null => false,
        Value::String(param) => !param.is_empty(),
        other => panic!("unexpected page param {other}"),
    };
    Window::with_rows(flat_rows(data).into_iter().map(stored).collect(), detached)
}

/// The fields a vector can tell apart, normalised through the same wire type.
fn comparable(message: &StoredMessage) -> Value {
    let status = match message.send {
        SendStatus::Settled => Value::Null,
        SendStatus::Pending => "pending".into(),
        SendStatus::Failed(_) => "failed".into(),
    };
    serde_json::json!({
        "dto": serde_json::to_value(&message.dto).unwrap(),
        "clientId": message.client_id,
        "sendStatus": status,
    })
}

fn assert_seqs_ascend(window: &Window, test: &str) {
    let seqs: Vec<i64> = window.rows().map(|row| row.seq).collect();
    assert!(
        seqs.windows(2).all(|pair| pair[0] < pair[1]),
        "{test}: seqs out of order: {seqs:?}"
    );
}

fn assert_matches(window: &Window, expected: &Value, test: &str) {
    assert_seqs_ascend(window, test);
    // A page runs newest first, and a window oldest first.
    let mut actual: Vec<Value> = window.rows().map(|row| comparable(&row.message)).collect();
    actual.reverse();
    let expected: Vec<Value> = flat_rows(expected)
        .into_iter()
        .map(|row| comparable(&stored(row)))
        .collect();
    assert_eq!(actual, expected, "{test}");
}

#[test]
fn every_web_cache_updater_test_passes_as_a_vector() {
    let file = fixture("message-cache-updaters.json");
    let calls = file["calls"].as_array().expect("calls");
    let mut tests = BTreeSet::new();
    for call in calls {
        let test = call["test"].as_str().unwrap();
        tests.insert(test.to_owned());
        let op = call["op"].as_str().unwrap();
        let args = call["args"].as_array().unwrap();
        let mut window = window_from(&args[0]);
        let expected = &call["result"];
        let changed = match op {
            "isDetachedFromLiveEdge" => {
                assert_eq!(
                    Value::Bool(window.is_detached_from_live_edge()),
                    *expected,
                    "{test}"
                );
                continue;
            }
            "findMessageInInfinite" => {
                let found = window.find(args[1].as_str().unwrap());
                match expected {
                    Value::Null => assert!(found.is_none(), "{test}"),
                    row => assert_eq!(
                        comparable(found.expect(test)),
                        comparable(&stored(row)),
                        "{test}"
                    ),
                }
                continue;
            }
            "prependMessageToInfinite" => window.prepend(stored(&args[1])),
            "prependOrReconcileOptimistic" => window.reconcile_echo(stored(&args[1]).dto),
            "updateMessageInInfinite" => {
                let message = stored(&args[1]);
                window.update(message.dto, message.client_id)
            }
            "deleteMessageFromInfinite" => window.delete(args[1].as_str().unwrap()),
            "replaceOptimisticMessage" => {
                window.replace_optimistic(args[1].as_str().unwrap(), stored(&args[2]))
            }
            "removeOptimisticMessage" => window.remove_optimistic(args[1].as_str().unwrap()),
            "markOptimisticFailed" => window.mark_failed(args[1].as_str().unwrap(), any_error()),
            "markOptimisticPending" => window.mark_pending(args[1].as_str().unwrap()),
            other => panic!("{test}: a new updater, {other}, has no Rust counterpart"),
        };
        // The same reference back means the web changed nothing, and this must not either.
        if call["sameRef"] == Value::Bool(true) {
            assert!(!changed, "{test}: the web left this alone");
        }
        assert_matches(&window, expected, test);
    }
    // The pinned commit's file. A re-export with fewer means a test stopped reaching the updaters.
    assert_eq!(tests.len(), 52, "web test cases exported");
    assert_eq!(calls.len(), 52, "calls those test cases made");
}

fn names(list: &Value) -> BTreeSet<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_owned())
        .collect()
}

fn set(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|item| (*item).to_owned()).collect()
}

#[test]
fn the_event_rules_match_the_web_handlers() {
    let file = fixture("socket-rules.json");
    let events = file["events"].as_object().unwrap();
    let mut mismatches = BTreeMap::new();
    for (name, web) in events {
        let core = rule(name).unwrap_or_default();
        let actual = [
            ("invalidate", set(core.invalidate)),
            ("set", set(core.set)),
            ("remove", set(core.remove)),
            ("reset", set(core.reset)),
        ];
        for (kind, actual) in actual {
            let web = names(&web[kind]);
            if actual != web {
                mismatches.insert(format!("{name}.{kind}"), (actual, web));
            }
        }
    }
    assert!(mismatches.is_empty(), "core != web: {mismatches:#?}");
    assert_eq!(events.len(), 45, "server events in the contract");
}

#[test]
fn the_reconnect_table_matches_the_web_handler() {
    let file = fixture("socket-rules.json");
    let web = &file["reconnect"];
    assert_eq!(set(RECONNECT_INVALIDATES), names(&web["invalidate"]));
    // What it does with windows is checked against a real Core in client.rs. This pins the rule
    // it checks: a live window is invalidated, and a detached one reset.
    assert_eq!(web["invalidatedWindows"], serde_json::json!(["live"]));
    assert_eq!(web["resetWindows"], serde_json::json!(["detached"]));
}
