//! U13's additions: list load states, a refused session ending as `AuthLost` does, why a session
//! ended, and typing.

mod common;

use common::*;
use semaphore_core::backend::BackendError;
use semaphore_core::model::{LoadState, SessionState, SignOutReason, ViewKey};
use semaphore_wire::enums::ErrorCode;
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
