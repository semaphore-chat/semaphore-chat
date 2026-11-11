//! W2: sessions and change numbers, direct messages, friends, notifications and the notify decision.

mod common;

use common::*;
use tokio::sync::oneshot;

const PARENT: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c0001";

// --- Sessions and change numbers ---

/// A change numbered in one session must not be mistaken for one numbered in the next: before W2,
/// sign-out reset the counter, so the old session's answer settled the new session's change.
#[tokio::test]
async fn an_answer_from_before_sign_out_does_not_settle_a_change_after_sign_in() {
    let rig = Rig::new().signed_in().await;
    rig.backend.reading.set_meta(PARENT, false, 2);
    rig.core.thread_info(PARENT.into());
    rig.core.run_until_idle().await;

    let (release_old, gate) = oneshot::channel();
    *rig.backend.reading.subscribe_gate.lock().unwrap() = Some(gate);
    let old = rig.core.set_thread_subscribed(PARENT.into(), true);
    let (_old_result, ()) = tokio::join!(old, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        rig.core
            .sign_in("http://server".into(), "me".into(), "pw".into())
            .await
            .unwrap();
        rig.core.run_until_idle().await;
        rig.core.thread_info(PARENT.into());
        rig.core.run_until_idle().await;

        let (release_new, gate) = oneshot::channel();
        *rig.backend.reading.subscribe_gate.lock().unwrap() = Some(gate);
        let new = rig.core.set_thread_subscribed(PARENT.into(), false);
        let (new_result, ()) = tokio::join!(new, async {
            tokio::task::yield_now().await;
            release_old.send(()).unwrap();
            for _ in 0..5 {
                tokio::task::yield_now().await;
            }
            assert!(
                !rig.core.thread_info(PARENT.into()).subscribed,
                "the old session's answer settled this session's change"
            );
            release_new.send(()).unwrap();
        });
        new_result.unwrap();
    });
}
