//! W6-C in core, on `FakeBackend` (`common/w6_storage.rs`): the per-user storage list (its filter,
//! paging and field mapping), quotas and recalculation, with every refusal kept and an answer for
//! an ended session changing nothing.

mod common;

use common::w6_storage::*;
use common::*;
use semaphore_core::model::{AdminActionKind, AdminOp, LoadState};
use serde_json::Value;

/// The message the change of `kind` shows on `view`'s op.
fn shown_error(op: &AdminOp, kind: AdminActionKind) -> String {
    let state = op
        .actions
        .iter()
        .find(|state| state.action.kind == kind)
        .expect("the change shows on its op");
    assert!(!state.busy);
    state
        .error
        .as_ref()
        .expect("the refusal shows")
        .message
        .clone()
}

/// Signed in with one list cached, answered with `users` and `total` for every list call.
async fn with_list(min_percent: u32, users: Vec<Value>, total: i64) -> Rig {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("w6c_list", list_json(users, total));
    rig.core.admin_storage(min_percent);
    rig.settle().await;
    rig
}

#[tokio::test]
async fn paging_table() {
    // Nothing to page: total 0.
    let rig = with_list(0, Vec::new(), 0).await;
    let view = rig.core.admin_storage(0);
    assert_eq!((view.rows.len(), view.total, view.more), (0, 0, false));
    rig.core.load_more_storage(0).await.unwrap();
    assert_eq!(rig.backend.w4.count("w6c_list"), 1, "nothing to fetch");

    // Exactly one page: 50 of 50.
    let rig = with_list(0, rows(50), 50).await;
    let view = rig.core.admin_storage(0);
    assert_eq!(
        (view.rows.len() as u64, view.total, view.more),
        (50, 50, false)
    );
    rig.core.load_more_storage(0).await.unwrap();
    assert_eq!(rig.backend.w4.count("w6c_list"), 1, "the list is complete");

    // 51 rows over two pages; a user repeated on the second page is kept once.
    let all = rows(51);
    let rig = with_list(0, all[..50].to_vec(), 51).await;
    let view = rig.core.admin_storage(0);
    assert_eq!((view.rows.len() as u64, view.more), (50, true));
    let second = vec![all[0].clone(), all[50].clone()];
    rig.backend.w4.answer("w6c_list", list_json(second, 51));
    rig.core.load_more_storage(0).await.unwrap();
    let view = rig.core.admin_storage(0);
    assert_eq!(view.rows.len(), 51, "no user is listed twice");
    assert_eq!(
        (view.rows[50].username.as_str(), view.more),
        ("user50", false)
    );
    assert_eq!(view.total, 51);
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&"w6c_list - 50 50".to_owned()),
        "the next page asks for what follows"
    );

    // Two next pages asked for at once make one call.
    let rig = with_list(0, rows(50), 51).await;
    let hold = rig.backend.w4.hold("w6c_list");
    let core = rig.core.clone();
    let first = tokio::spawn(async move { core.load_more_storage(0).await });
    while rig.backend.w4.count("w6c_list") < 2 {
        tokio::task::yield_now().await;
    }
    assert!(
        rig.core.admin_storage(0).loading_more,
        "the page on its way shows as loading"
    );
    rig.core.load_more_storage(0).await.unwrap();
    assert_eq!(
        rig.backend.w4.count("w6c_list"),
        2,
        "the second request was skipped"
    );
    hold.send(()).unwrap();
    first.await.unwrap().unwrap();
    assert!(!rig.core.admin_storage(0).loading_more);

    // Different filters are separate lists.
    let mut rig = with_list(0, vec![stats_json(PRIYA, "priya", 10, 100, 10.0, 1)], 1).await;
    rig.backend.w4.answer(
        "w6c_list",
        list_json(vec![stats_json(MARCUS, "marcus", 90, 100, 90.0, 2)], 1),
    );
    rig.core.admin_storage(90);
    rig.settle().await;
    assert_eq!(rig.core.admin_storage(0).rows[0].username, "priya");
    assert_eq!(rig.core.admin_storage(90).rows[0].username, "marcus");
    let calls = rig.backend.w4.calls();
    assert!(calls.contains(&"w6c_list - 0 50".to_owned()));
    assert!(calls.contains(&"w6c_list 90 0 50".to_owned()));

    // A page that fails leaves the rows already read.
    let rig = with_list(0, rows(50), 51).await;
    rig.backend
        .w4
        .fail_next("w6c_list", refusal(503, "UNAVAILABLE"));
    assert!(rig.core.load_more_storage(0).await.is_err());
    let view = rig.core.admin_storage(0);
    assert_eq!(view.rows.len(), 50, "the rows already read stay");
    assert!(!view.loading_more);
    assert!(view.more, "there is still a next page");
}

#[tokio::test]
async fn the_list_maps_every_field() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6c_list",
        list_json(
            vec![
                stats_json(PRIYA, "priya", 123, 1_000, 12.345, 7),
                stats_json(MARCUS, "marcus", -5, -7, -1.5, -9),
            ],
            -3,
        ),
    );
    rig.core.admin_storage(0);
    rig.settle().await;
    let view = rig.core.admin_storage(0);
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(view.min_percent, 0);
    assert_eq!(view.total, 0, "a negative total reads as zero");
    assert!(!view.more);

    let first = &view.rows[0];
    assert_eq!(
        (
            first.user_id.as_str(),
            first.username.as_str(),
            first.used_bytes,
            first.quota_bytes,
            first.percent_used,
            first.file_count,
        ),
        (PRIYA, "priya", 123, 1_000, 12.345, 7)
    );
    let second = &view.rows[1];
    assert_eq!(
        (
            second.used_bytes,
            second.quota_bytes,
            second.percent_used,
            second.file_count,
        ),
        (0, 0, 0.0, 0),
        "negative numbers read as zero"
    );
}

#[tokio::test]
async fn the_filter_reaches_the_request() {
    let mut rig = with_list(0, Vec::new(), 0).await;
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&"w6c_list - 0 50".to_owned()),
        "no filter (zero means everyone), the first page"
    );

    rig.core.admin_storage(90);
    rig.settle().await;
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&"w6c_list 90 0 50".to_owned()),
        "the filter is sent"
    );
    assert_eq!(rig.core.admin_storage(90).min_percent, 90);

    // A next page keeps the filter.
    rig.backend.w4.answer("w6c_list", list_json(rows(50), 51));
    rig.core.admin_storage(75);
    rig.settle().await;
    rig.core.load_more_storage(75).await.unwrap();
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&"w6c_list 75 50 50".to_owned()),
        "the next page keeps the filter"
    );
}

#[tokio::test]
async fn a_quota_change_replaces_the_row_in_every_list() {
    let mut rig = with_list(0, vec![stats_json(PRIYA, "priya", 100, 1_000, 10.0, 1)], 1).await;
    rig.core.admin_storage(50);
    rig.settle().await;

    rig.backend
        .w4
        .answer("w6c_quota", stats_json(PRIYA, "priya", 100, 200, 50.0, 1));
    rig.core.set_user_quota(PRIYA.into(), 200).await.unwrap();

    for min_percent in [0, 50] {
        let view = rig.core.admin_storage(min_percent);
        assert_eq!(view.rows[0].quota_bytes, 200, "list {min_percent}");
        assert_eq!(view.rows[0].quota_bytes, view.rows[0].used_bytes * 2);
        assert_eq!(view.rows[0].percent_used, 50.0);
    }
    assert_eq!(
        rig.backend
            .w4
            .calls()
            .into_iter()
            .find(|call| call.starts_with("w6c_quota"))
            .unwrap(),
        format!("w6c_quota {PRIYA} {{\"quotaBytes\":200}}")
    );

    let view = rig.core.admin_storage(0);
    assert!(!view.op.busy);
    let outcome = view
        .op
        .finished
        .iter()
        .find(|outcome| outcome.action.kind == AdminActionKind::SetUserQuota)
        .expect("the change ended on the list's op");
    assert_eq!(outcome.action.target_id.as_deref(), Some(PRIYA));
    assert!(outcome.error.is_none());
    assert!(
        rig.core.admin_storage(50).op.finished.is_empty(),
        "both changes live on the unfiltered view"
    );
}

#[tokio::test]
async fn a_refused_quota_change_shows_the_message() {
    let rig = with_list(0, vec![stats_json(PRIYA, "priya", 100, 1_000, 10.0, 1)], 1).await;

    // Too large for the wire type: refused before anything is sent.
    assert!(
        rig.core
            .set_user_quota(PRIYA.into(), u64::MAX)
            .await
            .is_err()
    );
    assert_eq!(rig.backend.w4.count("w6c_quota"), 0, "nothing was sent");
    assert_eq!(
        shown_error(&rig.core.admin_storage(0).op, AdminActionKind::SetUserQuota),
        "the quota is too large"
    );

    // The server refuses.
    rig.backend
        .w4
        .fail_next("w6c_quota", refusal(403, "FORBIDDEN"));
    assert!(rig.core.set_user_quota(PRIYA.into(), 500).await.is_err());
    let view = rig.core.admin_storage(0);
    assert_eq!(view.rows[0].quota_bytes, 1_000, "the server kept it");
    assert_eq!(view.rows[0].percent_used, 10.0);
    assert!(!view.op.busy);
    assert_eq!(
        shown_error(&view.op, AdminActionKind::SetUserQuota),
        "refused: FORBIDDEN"
    );
}

#[tokio::test]
async fn recalculate_replaces_the_row() {
    let rig = with_list(0, vec![stats_json(PRIYA, "priya", 100, 1_000, 10.0, 1)], 1).await;

    rig.backend.w4.answer(
        "w6c_recalculate",
        stats_json(PRIYA, "priya", 250, 1_000, 25.0, 3),
    );
    rig.core.recalculate_storage(PRIYA.into()).await.unwrap();

    let view = rig.core.admin_storage(0);
    assert_eq!(
        (
            view.rows[0].used_bytes,
            view.rows[0].percent_used,
            view.rows[0].file_count,
        ),
        (250, 25.0, 3)
    );
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&format!("w6c_recalculate {PRIYA}"))
    );
    assert!(!view.op.busy);
    let outcome = view
        .op
        .finished
        .iter()
        .find(|outcome| outcome.action.kind == AdminActionKind::RecalculateStorage)
        .expect("the change ended on the list's op");
    assert_eq!(outcome.action.target_id.as_deref(), Some(PRIYA));
    assert!(outcome.error.is_none());
}

#[tokio::test]
async fn an_answer_after_sign_out_changes_nothing() {
    let rig = with_list(0, vec![stats_json(PRIYA, "priya", 100, 1_000, 10.0, 1)], 1).await;

    let hold = rig.backend.w4.hold("w6c_quota");
    rig.backend
        .w4
        .answer("w6c_quota", stats_json(PRIYA, "priya", 100, 200, 50.0, 1));
    let quota = rig.core.set_user_quota(PRIYA.into(), 200);
    let (result, ()) = tokio::join!(quota, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        hold.send(()).unwrap();
    });
    assert_eq!(
        result
            .expect_err("the answer is for an ended session")
            .to_string(),
        "signed out"
    );
    let view = rig.core.admin_storage(0);
    assert!(view.rows.is_empty(), "the session's list is gone");
    assert_eq!(view.state, LoadState::Loading);
}

#[tokio::test]
async fn a_new_connection_reads_the_list_again() {
    let mut rig = with_list(0, vec![stats_json(PRIYA, "priya", 100, 1_000, 10.0, 1)], 1).await;
    assert_eq!(rig.backend.w4.count("w6c_list"), 1);
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6c_list"), 2);
    assert_eq!(rig.core.admin_storage(0).rows[0].username, "priya");
}
