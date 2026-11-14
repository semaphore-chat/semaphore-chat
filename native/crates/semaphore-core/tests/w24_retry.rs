//! W24: a failed query waits out a backoff before it's asked again (`semaphore_core::retry`).
//!
//! Against a v0.9.0 server the capabilities list failed to decode, no view showed it, and every
//! read (every frame the channel list drew) asked again: ~2.4 requests a second until the server
//! answered 429, and on through the 429s.

mod common;

use common::w5a::channel_json;
use common::*;
use semaphore_core::backend::BackendError;
use semaphore_core::cache::{QueryKey, keys};
use semaphore_core::model::{LoadState, ViewKey};
use semaphore_core::platform::CoreEvent;
use semaphore_core::retry::{CAP_MS, PERMANENT_MS};
use semaphore_wire::enums::ErrorCode;
use std::sync::atomic::Ordering;

fn caps_key() -> QueryKey {
    keys::scoped(keys::CAPABILITIES, "comm")
}

fn rate_limited(retry_after_ms: Option<u64>) -> BackendError {
    BackendError {
        status: 429,
        code: ErrorCode::Unknown("RATE_LIMITED".into()),
        message: "ThrottlerException: Too Many Requests".into(),
        retryable: true,
        retry_after_ms,
    }
}

fn capability_list() -> serde_json::Value {
    serde_json::json!({
        "communityId": "comm",
        "channels": [{
            "channelId": "c-1", "view": true, "post": true, "attach": true, "react": true,
            "threadReply": true, "connect": true, "speak": true, "video": true, "share": true,
            "managePermissions": false, "postingRoleNames": [], "timedOutUntil": null,
            "pin": true, "deleteAny": false, "seeRemoved": false,
        }],
    })
}

async fn rig() -> Rig {
    let rig = Rig::new();
    // Before sign-in, which reads the community's channels.
    *rig.backend.channels.lock().unwrap() = vec![channel_json("c-1", "general", "TEXT", 0)];
    rig.signed_in().await
}

fn requests(rig: &Rig) -> u64 {
    rig.backend.capability_requests.load(Ordering::SeqCst)
}

/// Reads the channel list (as a frame does) and lets core finish.
async fn read(rig: &Rig) {
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;
}

fn now(rig: &Rig) -> u64 {
    rig.clock.0.load(Ordering::SeqCst)
}

/// How long the capabilities query waits from now.
fn wait(rig: &Rig) -> u64 {
    rig.core.query_retry_at(&caps_key()).expect("failed") - now(rig)
}

#[tokio::test]
async fn a_permanent_failure_is_not_asked_again_on_reads_until_five_minutes_pass() {
    let rig = rig().await;
    // No list scripted: a 404, as permanent as a response that won't decode.
    read(&rig).await;
    assert_eq!(requests(&rig), 1);
    assert_eq!(wait(&rig), PERMANENT_MS);
    // The channel list itself is fine: capabilities fail open.
    let state = rig.core.load_state(ViewKey::Channels {
        community_id: "comm".into(),
    });
    assert!(matches!(state, LoadState::Ready), "{state:?}");

    for _ in 0..50 {
        read(&rig).await;
    }
    assert_eq!(requests(&rig), 1, "no request per read");
    rig.clock.advance(PERMANENT_MS - 1);
    read(&rig).await;
    assert_eq!(requests(&rig), 1, "a millisecond early");
    rig.clock.advance(1);
    read(&rig).await;
    assert_eq!(requests(&rig), 2, "due: the next read asks");
    assert_eq!(wait(&rig), PERMANENT_MS, "and fails again");
}

#[tokio::test]
async fn rate_limiting_backs_off_exponentially_with_jitter_to_a_cap() {
    let rig = rig().await;
    *rig.backend.capabilities_error.lock().unwrap() = Some(rate_limited(None));
    let mut waits = Vec::new();
    for _ in 0..9 {
        read(&rig).await;
        waits.push(wait(&rig));
        // Reads in the meantime ask nothing.
        read(&rig).await;
        rig.clock.advance(wait(&rig));
    }
    assert_eq!(requests(&rig), 9);
    let full = [
        1_000, 2_000, 4_000, 8_000, 16_000, 32_000, CAP_MS, CAP_MS, CAP_MS,
    ];
    for (attempt, (wait, full)) in waits.iter().zip(full).enumerate() {
        assert!(
            *wait <= full && *wait >= full - full / 4,
            "attempt {}: waited {wait}, full {full}",
            attempt + 1
        );
    }
}

#[tokio::test]
async fn the_same_failures_get_the_same_schedule_under_the_fake_clock() {
    let mut schedules = Vec::new();
    for _ in 0..2 {
        let rig = rig().await;
        *rig.backend.capabilities_error.lock().unwrap() = Some(rate_limited(None));
        let mut waits = Vec::new();
        for _ in 0..5 {
            read(&rig).await;
            waits.push(wait(&rig));
            rig.clock.advance(wait(&rig));
        }
        schedules.push(waits);
    }
    assert_eq!(schedules[0], schedules[1]);
}

#[tokio::test]
async fn a_servers_retry_after_is_honoured_when_longer() {
    let rig = rig().await;
    *rig.backend.capabilities_error.lock().unwrap() = Some(rate_limited(Some(7_000)));
    read(&rig).await;
    assert_eq!(wait(&rig), 7_000, "longer than the first 1 s");
    rig.clock.advance(6_999);
    read(&rig).await;
    assert_eq!(requests(&rig), 1);
    rig.clock.advance(1);
    read(&rig).await;
    assert_eq!(requests(&rig), 2);
}

#[tokio::test]
async fn a_success_forgets_the_failures() {
    let rig = rig().await;
    *rig.backend.capabilities_error.lock().unwrap() = Some(rate_limited(None));
    for _ in 0..4 {
        read(&rig).await;
        rig.clock.advance(wait(&rig));
    }
    *rig.backend.capabilities_error.lock().unwrap() = None;
    *rig.backend.capabilities.lock().unwrap() = Some(capability_list());
    read(&rig).await;
    assert_eq!(rig.core.query_retry_at(&caps_key()), None);
    let row = rig.core.channels("comm".into()).remove(0);
    assert!(row.permissions.is_some());

    // The next failure starts from the first wait again.
    *rig.backend.capabilities_error.lock().unwrap() = Some(rate_limited(None));
    rig.core.invalidate(&caps_key());
    rig.core.run_until_idle().await;
    assert!(wait(&rig) <= 1_000, "{}", wait(&rig));
}

#[tokio::test]
async fn an_invalidation_lets_a_failed_query_be_asked_at_once() {
    let rig = rig().await;
    read(&rig).await;
    assert_eq!(requests(&rig), 1);
    // A role change, say: the data it failed on has changed.
    rig.core.invalidate(&QueryKey::new(&[keys::CAPABILITIES]));
    *rig.backend.capabilities.lock().unwrap() = Some(capability_list());
    read(&rig).await;
    assert_eq!(requests(&rig), 2);
    assert_eq!(rig.core.query_retry_at(&caps_key()), None);
}

#[tokio::test]
async fn a_new_connection_and_retry_failed_forget_the_waits() {
    let rig = rig().await;
    read(&rig).await;
    rig.core.ingest(connected());
    read(&rig).await;
    assert_eq!(requests(&rig), 2, "a new connection");

    rig.core.retry_failed();
    read(&rig).await;
    assert_eq!(requests(&rig), 3, "the user's retry");
}

/// Fails the communities list (read at sign-in, and shown by a view) with `error`, now.
async fn fail_communities(rig: &Rig, error: BackendError) {
    *rig.backend.communities_error.lock().unwrap() = Some(error);
    rig.core.invalidate(&keys::op(keys::COMMUNITIES));
    rig.core.communities();
    rig.core.run_until_idle().await;
}

#[tokio::test]
async fn a_failed_view_recovers_on_the_retry_timer_without_being_read() {
    let rig = Rig::new().signed_in().await;
    fail_communities(&rig, rate_limited(Some(3_000))).await;
    let before = rig.backend.community_requests.load(Ordering::SeqCst);
    assert!(matches!(
        rig.core.load_state(ViewKey::Communities),
        LoadState::Failed { .. }
    ));
    // The rig's other failed views (reads it doesn't script) are permanent: this is the soonest.
    assert_eq!(
        rig.core.retry_due_queries(),
        Some(3_000),
        "the host sleeps this long"
    );
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.community_requests.load(Ordering::SeqCst),
        before
    );

    *rig.backend.communities_error.lock().unwrap() = None;
    rig.clock.advance(3_000);
    rig.events.take();
    // No read: the timer alone fetches it.
    rig.core.retry_due_queries();
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.community_requests.load(Ordering::SeqCst),
        before + 1
    );
    assert!(rig.events.take().contains(&CoreEvent::ViewChanged {
        view: ViewKey::Communities
    }));
    assert!(matches!(
        rig.core.load_state(ViewKey::Communities),
        LoadState::Ready
    ));
    assert_eq!(rig.core.query_retry_at(&keys::op(keys::COMMUNITIES)), None);
}

#[tokio::test]
async fn a_failed_view_keeps_its_error_while_the_timer_retries_and_fails_again() {
    let rig = Rig::new().signed_in().await;
    fail_communities(&rig, rate_limited(None)).await;
    let key = keys::op(keys::COMMUNITIES);
    let first = rig.core.query_retry_at(&key).expect("failed");
    rig.clock.advance(first - now(&rig));
    rig.core.retry_due_queries();
    rig.core.run_until_idle().await;
    assert!(matches!(
        rig.core.load_state(ViewKey::Communities),
        LoadState::Failed { .. }
    ));
    let second = rig.core.query_retry_at(&key).expect("failed again") - now(&rig);
    assert!(
        (1_500..=2_000).contains(&second),
        "the second wait: {second}"
    );
}

#[tokio::test]
async fn the_timer_leaves_a_failed_query_no_view_shows_to_its_next_read() {
    let rig = rig().await;
    *rig.backend.capabilities_error.lock().unwrap() = Some(rate_limited(None));
    read(&rig).await;
    rig.clock.advance(CAP_MS);
    rig.core.retry_due_queries();
    rig.core.run_until_idle().await;
    assert_eq!(requests(&rig), 1, "the timer didn't ask");
    read(&rig).await;
    assert_eq!(requests(&rig), 2, "the next read did");
}
