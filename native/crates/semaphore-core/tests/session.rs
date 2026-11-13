//! U13's additions: list load states, a refused session ending as `AuthLost` does, why a session
//! ended, and typing.

mod common;

use common::*;
use semaphore_core::CoreEvent;
use semaphore_core::backend::BackendError;
use semaphore_core::model::{
    LoadState, RegistrationMode, RestoreOutcome, SessionState, SignOutReason, ViewKey,
};
use semaphore_wire::enums::ErrorCode;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;

fn error(status: u16, code: &str) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown(code.into()),
        message: format!("{status} {code}"),
        retryable: status >= 500,
        retry_after_ms: None,
    }
}

fn community_requests(rig: &Rig) -> u64 {
    rig.backend.community_requests.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_list_is_loading_then_ready() {
    let rig = Rig::new().signed_in().await;
    // Sign-in already asked for communities, so they are on their way or here.
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.load_state(ViewKey::Communities), LoadState::Ready);
    // Communities bring their channels with them.
    let channels = |id: &str| ViewKey::Channels {
        community_id: id.into(),
    };
    assert_eq!(rig.core.load_state(channels("comm")), LoadState::Ready);
    // Nothing has asked for this one yet.
    assert_eq!(rig.core.load_state(channels("other")), LoadState::Loading);
    rig.core.channels("other".into());
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.load_state(channels("other")), LoadState::Ready);
    // Anything without a list of its own reads as ready.
    assert_eq!(rig.core.load_state(ViewKey::Voice), LoadState::Ready);
}

#[tokio::test]
async fn a_failed_list_says_so_and_waits_for_a_retry() {
    let rig = Rig::new();
    *rig.backend.communities_error.lock().unwrap() = Some(error(500, "INTERNAL"));
    let rig = rig.signed_in().await;
    rig.core.run_until_idle().await;
    let LoadState::Failed { error } = rig.core.load_state(ViewKey::Communities) else {
        panic!("expected a failure");
    };
    assert!(error.message.contains("INTERNAL"), "{error:?}");
    let before = community_requests(&rig);
    // A UI reading every frame must not turn one failure into a request per frame.
    for _ in 0..5 {
        rig.core.communities();
        rig.core.run_until_idle().await;
    }
    assert_eq!(community_requests(&rig), before);
    // Still signed in: a 500 says nothing about the session.
    assert!(matches!(rig.core.session(), SessionState::SignedIn { .. }));

    *rig.backend.communities_error.lock().unwrap() = None;
    rig.events.take();
    rig.core.retry_failed();
    rig.core.run_until_idle().await;
    assert_eq!(community_requests(&rig), before + 1);
    assert_eq!(rig.core.load_state(ViewKey::Communities), LoadState::Ready);
    assert!(rig.events.take().iter().any(|event| matches!(
        event,
        semaphore_core::CoreEvent::ViewChanged {
            view: ViewKey::Communities
        }
    )));
}

#[tokio::test]
async fn a_new_connection_retries_what_failed() {
    let rig = Rig::new();
    *rig.backend.communities_error.lock().unwrap() = Some(error(0, "UNKNOWN"));
    let rig = rig.signed_in().await;
    rig.core.run_until_idle().await;
    assert!(matches!(
        rig.core.load_state(ViewKey::Communities),
        LoadState::Failed { .. }
    ));
    *rig.backend.communities_error.lock().unwrap() = None;
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.load_state(ViewKey::Communities), LoadState::Ready);
}

#[tokio::test]
async fn a_401_after_the_backend_refreshed_ends_the_session_as_auth_lost_does() {
    let rig = Rig::new();
    *rig.backend.communities_error.lock().unwrap() = Some(error(401, "UNAUTHENTICATED"));
    let rig = rig.signed_in().await;
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    assert_eq!(rig.core.last_sign_out(), Some(SignOutReason::Expired));
    assert!(
        rig.realtime.calls().contains(&"disconnect".to_owned()),
        "{:?}",
        rig.realtime.calls()
    );
    // Nothing of the session is left to show.
    assert!(rig.core.communities().is_empty());
}

#[tokio::test]
async fn a_403_is_not_a_lost_session() {
    let rig = Rig::new();
    *rig.backend.communities_error.lock().unwrap() = Some(error(403, "FORBIDDEN"));
    let rig = rig.signed_in().await;
    rig.core.run_until_idle().await;
    assert!(matches!(rig.core.session(), SessionState::SignedIn { .. }));
    assert_eq!(rig.core.last_sign_out(), None);
}

#[tokio::test]
async fn auth_lost_and_sign_out_say_why_and_a_sign_in_forgets_it() {
    let rig = Rig::new().signed_in().await;
    rig.core
        .ingest(semaphore_core::realtime::RealtimeEvent::AuthLost { reason: None });
    assert_eq!(rig.core.last_sign_out(), Some(SignOutReason::Expired));

    rig.core
        .sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    assert_eq!(rig.core.last_sign_out(), None);
    rig.core.sign_out().await.unwrap();
    assert_eq!(rig.core.last_sign_out(), Some(SignOutReason::SignedOut));
}

#[tokio::test]
async fn typing_goes_over_the_socket_for_channels_only() {
    let rig = Rig::new().signed_in().await;
    rig.core.send_typing(channel(), true).await.unwrap();
    rig.core.send_typing(channel(), false).await.unwrap();
    rig.core
        .send_typing(
            semaphore_core::model::Conversation::Thread {
                parent_message_id: "m".into(),
            },
            true,
        )
        .await
        .unwrap();
    let emitted = rig.realtime.emitted.lock().unwrap().clone();
    let names: Vec<&str> = emitted.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["typingStart", "typingStop"]);
    assert_eq!(emitted[0].1["channelId"], CHANNEL);
}

#[tokio::test]
async fn restore_without_a_stored_session_asks_for_a_sign_in() {
    let rig = Rig::new();
    let outcome = rig
        .core
        .restore_session("http://server/".into())
        .await
        .unwrap();
    assert_eq!(outcome, RestoreOutcome::NoSession);
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    assert_eq!(rig.backend.refreshes.load(Ordering::SeqCst), 0);
    // The URL is normalised as sign-in's is.
    assert_eq!(
        rig.backend.server_url.lock().unwrap().as_deref(),
        Some("http://server")
    );
}

#[tokio::test]
async fn restore_signs_in_with_the_stored_session_and_connects() {
    let rig = Rig::new();
    *rig.backend.stored_session.lock().unwrap() = true;
    let outcome = rig
        .core
        .restore_session("http://server".into())
        .await
        .unwrap();
    assert_eq!(outcome, RestoreOutcome::SignedIn);
    assert!(matches!(rig.core.session(), SessionState::SignedIn { .. }));
    assert_eq!(rig.backend.refreshes.load(Ordering::SeqCst), 1);
    assert!(rig.realtime.calls().contains(&"connect".to_owned()));
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.load_state(ViewKey::Communities), LoadState::Ready);
}

#[tokio::test]
async fn a_refused_stored_session_signs_out_with_the_reason() {
    for status in [401, 403] {
        let rig = Rig::new();
        *rig.backend.stored_session.lock().unwrap() = true;
        *rig.backend.refresh_error.lock().unwrap() = Some(error(status, "UNAUTHENTICATED"));
        let outcome = rig
            .core
            .restore_session("http://server".into())
            .await
            .unwrap();
        assert_eq!(outcome, RestoreOutcome::Refused, "{status}");
        assert_eq!(rig.core.session(), SessionState::SignedOut);
        assert_eq!(rig.core.last_sign_out(), Some(SignOutReason::Expired));
        assert!(!rig.realtime.calls().contains(&"connect".to_owned()));
    }
}

#[tokio::test]
async fn an_unreachable_server_keeps_the_session_for_a_retry() {
    let rig = Rig::new();
    *rig.backend.stored_session.lock().unwrap() = true;
    *rig.backend.refresh_error.lock().unwrap() = Some(error(0, "UNKNOWN"));
    let outcome = rig
        .core
        .restore_session("http://server".into())
        .await
        .unwrap();
    let RestoreOutcome::Unreachable { error } = outcome else {
        panic!("expected unreachable, got {outcome:?}");
    };
    assert_eq!(error.code, "UNKNOWN");
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    // Not a refusal: the sign-in screen has nothing to explain.
    assert_eq!(rig.core.last_sign_out(), None);

    *rig.backend.refresh_error.lock().unwrap() = Some(error_503());
    assert!(matches!(
        rig.core
            .restore_session("http://server".into())
            .await
            .unwrap(),
        RestoreOutcome::Unreachable { .. }
    ));
    *rig.backend.refresh_error.lock().unwrap() = None;
    assert_eq!(
        rig.core
            .restore_session("http://server".into())
            .await
            .unwrap(),
        RestoreOutcome::SignedIn
    );
}

fn error_503() -> BackendError {
    error(503, "SERVICE_UNAVAILABLE")
}

/// What a probe reads: every field the app cares about.
fn public_settings(name: &str, registration: &str) -> Value {
    json!({
        "name": name,
        "maxFileSizeBytes": 1024,
        "passwordResetEnabled": false,
        "registrationMode": registration,
        "desktopBrowserLogin": true,
        "gifSearchEnabled": false,
    })
}

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
async fn a_restored_session_probes_the_server_for_its_settings() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", public_settings("Couch Co-op", "OPEN"));
    *rig.backend.stored_session.lock().unwrap() = true;
    rig.events.take();
    // Held, so the restore's own announcements can be told apart from its probe's answer.
    let release = rig.backend.w3.hold("public_settings");
    let restore = rig.core.restore_session("http://server".into());
    let (outcome, signed_in) = tokio::join!(restore, async {
        for _ in 0..1000 {
            if rig.backend.w3.count("public_settings") > 0 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let signed_in = rig.events.take();
        release.send(()).unwrap();
        signed_in
    });
    assert_eq!(outcome.unwrap(), RestoreOutcome::SignedIn);
    assert_eq!(
        session_views(&rig.events.take()),
        1,
        "the probe's answer announced the session once"
    );
    // The whole session has the server's settings, not an empty record: capabilities, version and
    // the register screen read them.
    let info = rig
        .core
        .server_info()
        .expect("the restored server was probed");
    assert_eq!(info.url, "http://server");
    assert_eq!(info.name.as_deref(), Some("Couch Co-op"));
    assert_eq!(
        rig.core.register_requirements().mode,
        RegistrationMode::Open
    );
    assert!(rig.core.register_requirements().can_register);
    assert!(matches!(rig.core.session(), SessionState::SignedIn { .. }));
    // The restore itself announced its own transitions before the probe was asked.
    assert!(!signed_in.is_empty());
}

#[tokio::test]
async fn a_closed_restored_server_closes_registration() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", public_settings("Closed Shop", "CLOSED"));
    *rig.backend.stored_session.lock().unwrap() = true;
    rig.core
        .restore_session("http://server".into())
        .await
        .unwrap();
    assert_eq!(
        rig.core.register_requirements().mode,
        RegistrationMode::Closed
    );
    assert!(!rig.core.register_requirements().can_register);
}

#[tokio::test]
async fn a_probe_that_fails_leaves_the_restored_session_signed_in() {
    let rig = Rig::new();
    *rig.backend.stored_session.lock().unwrap() = true;
    rig.backend
        .w3
        .fail_next("public_settings", error(500, "INTERNAL"));
    let outcome = rig
        .core
        .restore_session("http://server".into())
        .await
        .unwrap();
    assert_eq!(outcome, RestoreOutcome::SignedIn);
    assert!(matches!(rig.core.session(), SessionState::SignedIn { .. }));
    assert_eq!(rig.core.server_info(), None);
    assert!(rig.realtime.calls().contains(&"connect".to_owned()));
}

#[tokio::test]
async fn a_restore_probe_answering_after_sign_out_writes_nothing() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", public_settings("Couch Co-op", "OPEN"));
    *rig.backend.stored_session.lock().unwrap() = true;
    let release = rig.backend.w3.hold("public_settings");
    rig.events.take();
    let restore = rig.core.restore_session("http://server".into());
    let (outcome, ()) = tokio::join!(restore, async {
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
    assert_eq!(
        outcome.unwrap(),
        RestoreOutcome::SignedIn,
        "the restore's own outcome is unchanged by the sign-out"
    );
    assert_eq!(rig.core.server_info(), None);
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    assert_eq!(session_views(&rig.events.take()), 0);
}
