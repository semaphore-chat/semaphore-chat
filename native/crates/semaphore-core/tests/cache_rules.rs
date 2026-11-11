//! The query cache's bookkeeping through `Core`: one fetch per key at a time, what reconnecting
//! refetches, bounds on keys made per keystroke, and member pages from a broken server.

mod common;

use common::*;
use semaphore_core::model::ViewKey;
use semaphore_core::platform::CoreEvent;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::time::Duration;

fn voice_channel(id: &str) -> serde_json::Value {
    json!({
        "id": id, "name": id, "communityId": "comm", "type": "VOICE", "position": 1,
        "slowmodeSeconds": 0, "preset": "PUBLIC", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

fn member(id: &str) -> serde_json::Value {
    json!({
        "id": id, "userId": id, "communityId": "comm", "joinedAt": "2026-09-22T18:00:00.000Z",
        "roles": [], "user": user_json(id),
    })
}

fn views_changed(events: &[CoreEvent]) -> Vec<ViewKey> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::ViewChanged { view } => Some(view.clone()),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn reads_while_a_fetch_runs_ask_once() {
    let rig = Rig::new().signed_in().await;
    rig.core.run_until_idle().await;
    let before = rig.backend.channel_requests.load(Ordering::SeqCst);

    rig.core.invalidate(&semaphore_core::cache::keys::scoped(
        semaphore_core::cache::keys::CHANNELS,
        "comm",
    ));
    for _ in 0..5 {
        rig.core.channels("comm".into());
    }
    rig.core.run_until_idle().await;

    assert_eq!(
        rig.backend.channel_requests.load(Ordering::SeqCst),
        before + 1
    );
    // Fresh now: reading again asks for nothing.
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.channel_requests.load(Ordering::SeqCst),
        before + 1
    );
}

#[tokio::test]
async fn a_member_list_reads_every_page_to_its_end() {
    let rig = Rig::new().signed_in().await;
    *rig.backend.members.lock().unwrap() = (0..250).map(|n| member(&format!("u{n}"))).collect();

    rig.core.members("comm".into());
    rig.core.run_until_idle().await;

    let list = rig.core.members("comm".into()).unwrap();
    assert_eq!(list.members.len(), 250);
    assert!(!list.truncated);
    assert_eq!(rig.backend.member_page_requests.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn reconnecting_while_a_fetch_runs_fetches_again_after_it() {
    let rig = Rig::new();
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(voice_channel("v"));
    let rig = rig.signed_in().await;
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;
    let unread = rig.backend.unread_requests.load(Ordering::SeqCst);

    // A fetch is on its way when the gap happens: its answer may predate it.
    rig.core.invalidate(&semaphore_core::cache::keys::op(
        semaphore_core::cache::keys::UNREAD,
    ));
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.core.run_until_idle().await;
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;

    assert_eq!(
        rig.backend.unread_requests.load(Ordering::SeqCst),
        unread + 2
    );
}

#[tokio::test]
async fn a_member_list_from_a_server_that_never_ends_stops() {
    let rig = Rig::new().signed_in().await;
    *rig.backend.endless_member_pages.lock().unwrap() = true;

    rig.core.members("comm".into());
    tokio::time::timeout(Duration::from_secs(5), rig.core.run_until_idle())
        .await
        .expect("the member read never finished");

    let list = rig
        .core
        .members("comm".into())
        .expect("a list, if a short one");
    assert!(list.members.is_empty());
    assert!(list.truncated, "the server said more follow");
    assert!(rig.backend.member_page_requests.load(Ordering::SeqCst) <= 2);
}

#[tokio::test]
async fn reconnecting_refetches_only_what_is_read_again() {
    let rig = Rig::new();
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(voice_channel("v"));
    let mut rig = rig.signed_in().await;
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;
    let presence = rig.backend.presence_requests.load(Ordering::SeqCst);
    let unread = rig.backend.unread_requests.load(Ordering::SeqCst);
    assert_eq!(presence, 1);
    rig.sync();

    // A gap: what the reconnect table names may have missed events.
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    let events = rig.settle().await;

    // Nothing is fetched yet, but the views that show it are told to read again...
    assert_eq!(
        rig.backend.presence_requests.load(Ordering::SeqCst),
        presence
    );
    assert_eq!(rig.backend.unread_requests.load(Ordering::SeqCst), unread);
    let views = views_changed(&events);
    assert!(
        views.contains(&ViewKey::Channels {
            community_id: "comm".into()
        }),
        "{views:?}"
    );
    assert!(views.contains(&ViewKey::Voice), "{views:?}");

    // ...and what is read again is fetched, once.
    rig.core.channels("comm".into());
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.presence_requests.load(Ordering::SeqCst),
        presence + 1
    );
    assert_eq!(
        rig.backend.unread_requests.load(Ordering::SeqCst),
        unread + 1
    );
}
