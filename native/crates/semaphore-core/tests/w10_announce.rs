//! W10: a server probe announces itself, so the sign-in screen needn't wait for the next core
//! event, and a stale answer writes nothing.

mod common;

use common::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::ViewKey;
use serde_json::{Value, json};

/// What a probe reads: the fields the app cares about, all of them.
fn settings(name: &str) -> Value {
    json!({
        "name": name,
        "maxFileSizeBytes": 1024,
        "passwordResetEnabled": false,
        "registrationMode": "OPEN",
        "desktopBrowserLogin": true,
        "gifSearchEnabled": false,
    })
}

/// The session views `events` announced.
fn session_views(events: &[CoreEvent]) -> usize {
    events
        .iter()
        .filter(|event| {
            matches!(
                event,
                CoreEvent::ViewChanged {
                    view: ViewKey::Session
                }
            )
        })
        .count()
}

#[tokio::test]
async fn probe_announces_session_when_the_answer_changes() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings("Couch Co-op"));
    rig.events.take();
    let info = rig
        .core
        .probe_server("http://server/".into())
        .await
        .unwrap();
    // Normalised as sign-in normalises it.
    assert_eq!(info.url, "http://server");
    assert_eq!(info.name.as_deref(), Some("Couch Co-op"));
    assert_eq!(rig.core.server_info(), Some(info));
    assert_eq!(session_views(&rig.events.take()), 1);
}

#[tokio::test]
async fn probe_with_the_same_answer_announces_nothing() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings("Couch Co-op"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    rig.events.take();
    let again = rig.core.probe_server("http://server".into()).await.unwrap();
    assert_eq!(again.name.as_deref(), Some("Couch Co-op"));
    assert_eq!(session_views(&rig.events.take()), 0);
}

#[tokio::test]
async fn probe_answer_after_sign_out_announces_nothing() {
    let rig = Rig::new().signed_in().await;
    rig.backend
        .w3
        .answer("public_settings", settings("Couch Co-op"));
    let release = rig.backend.w3.hold("public_settings");
    rig.events.take();
    let probe = rig.core.probe_server("http://server".into());
    let (result, ()) = tokio::join!(probe, async {
        for _ in 0..1000 {
            if rig.backend.w3.count("public_settings") > 0 {
                break;
            }
            tokio::task::yield_now().await;
        }
        rig.core.sign_out().await.unwrap();
        // Whatever the sign-out itself announced is not this probe's.
        rig.events.take();
        release.send(()).unwrap();
    });
    assert!(result.is_ok(), "a stale answer still answers its caller");
    assert_eq!(rig.core.server_info(), None);
    assert_eq!(session_views(&rig.events.take()), 0);
}

#[tokio::test]
async fn probe_answer_for_a_server_no_longer_in_use_writes_nothing() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings("Server A"));
    let release = rig.backend.w3.hold("public_settings");
    let first = rig.core.probe_server("http://a".into());
    let (a, ()) = tokio::join!(first, async {
        for _ in 0..1000 {
            if rig.backend.w3.count("public_settings") > 0 {
                break;
            }
            tokio::task::yield_now().await;
        }
        // The user gives up on A and probes B, which answers at once.
        rig.backend
            .w3
            .answer("public_settings", settings("Server B"));
        let b = rig.core.probe_server("http://b".into()).await.unwrap();
        assert_eq!(b.url, "http://b");
        rig.events.take();
        release.send(()).unwrap();
    });
    assert_eq!(a.unwrap().url, "http://a", "A's answer still answers");

    let info = rig.core.server_info().expect("B was probed");
    assert_eq!(info.url, "http://b", "A's late answer didn't switch back");
    assert_eq!(info.name.as_deref(), Some("Server B"));
    assert_eq!(session_views(&rig.events.take()), 0);
}
