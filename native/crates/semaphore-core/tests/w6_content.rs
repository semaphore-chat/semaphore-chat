//! W6-D in core, on `FakeBackend` (`common/w6_content.rs`): every community with its counts and
//! force delete, and the instance invites list, create and delete, with every refusal kept.

mod common;

use common::w6_content::*;
use common::*;
use semaphore_core::QueryKey;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminCommunityRow, InstanceInviteDraft, InviteCommunity,
    LoadState, RemovalCause, UserView,
};
use semaphore_core::platform::{CoreError, CoreEvent};
use serde_json::{Value, json};

const CREATED_AT_MS: i64 = 1_790_100_000_000;
const VALID_UNTIL_MS: i64 = 1_798_675_200_000;

/// The communities list's calls, split into operation and arguments.
fn lists(rig: &Rig) -> Vec<Vec<String>> {
    rig.backend
        .w4
        .calls()
        .into_iter()
        .filter(|call| call.starts_with("w6d_list "))
        .map(|call| call.split(' ').map(str::to_owned).collect())
        .collect()
}

fn codes(rig: &Rig) -> Vec<String> {
    rig.core
        .admin_invites()
        .rows
        .into_iter()
        .map(|row| row.code)
        .collect()
}

fn removed(rig: &Rig) -> Vec<(String, RemovalCause)> {
    rig.events
        .take()
        .into_iter()
        .filter_map(|event| match event {
            CoreEvent::CommunityRemoved {
                community_id,
                cause,
                ..
            } => Some((community_id, cause)),
            _ => None,
        })
        .collect()
}

/// Signs out and back in while `release` holds a call, then lets it answer.
async fn new_session_then(rig: &Rig, release: tokio::sync::oneshot::Sender<()>) {
    tokio::task::yield_now().await;
    rig.core.sign_out().await.unwrap();
    rig.core
        .sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    rig.core.run_until_idle().await;
    release.send(()).unwrap();
}

// ----- the communities list --------------------------------------------------------------------

#[tokio::test]
async fn paging_table() {
    // No next page: nothing is asked, and nothing says a page is on its way.
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(vec![community_stats_json(COMMUNITY, "Couch", 3, 2)], None),
    );
    rig.core.admin_communities(String::new());
    rig.settle().await;
    let view = rig.core.admin_communities(String::new());
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(view.rows.len(), 1);
    assert!(!view.more && !view.loading_more);
    rig.core
        .load_more_admin_communities(String::new())
        .await
        .unwrap();
    assert_eq!(lists(&rig).len(), 1, "no next page: nothing was asked");

    // Two pages: the search is trimmed for the key and sent, and the next page asks with its
    // token. A repeated id is added once.
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(
            vec![
                community_stats_json(COMMUNITY, "Couch", 3, 2),
                community_stats_json(COMMUNITY_B, "Lumen", 4, 3),
            ],
            Some(COMMUNITY_B),
        ),
    );
    rig.core.admin_communities("  lumen  ".into());
    rig.settle().await;
    assert_eq!(
        lists(&rig),
        [["w6d_list", "", "50", "lumen"]],
        "the first page: no token, 50 rows, the trimmed search"
    );
    let view = rig.core.admin_communities("lumen".into());
    assert_eq!(
        (
            view.search.as_str(),
            view.rows.len(),
            view.more,
            view.loading_more
        ),
        ("lumen", 2, true, false)
    );
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(
            vec![
                community_stats_json(COMMUNITY_B, "Lumen", 4, 3),
                community_stats_json(COMMUNITY_C, "Synth", 5, 1),
            ],
            None,
        ),
    );
    rig.core
        .load_more_admin_communities("lumen".into())
        .await
        .unwrap();
    assert_eq!(
        lists(&rig)[1],
        ["w6d_list", COMMUNITY_B, "50", "lumen"],
        "the next page: its token"
    );
    let view = rig.core.admin_communities("lumen".into());
    assert_eq!(
        view.rows
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        [COMMUNITY, COMMUNITY_B, COMMUNITY_C],
        "appended once each"
    );
    assert!(!view.more && !view.loading_more);
    // The empty search is its own list, untouched.
    assert_eq!(rig.core.admin_communities(String::new()).rows.len(), 0);

    // Concurrent calls: the second adds no page and asks nothing while the first is out.
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(
            vec![
                community_stats_json(COMMUNITY, "Couch", 3, 2),
                community_stats_json(COMMUNITY_B, "Lumen", 4, 3),
            ],
            Some(COMMUNITY_B),
        ),
    );
    rig.core.admin_communities(String::new());
    rig.settle().await;
    let gate = rig.backend.w4.hold("w6d_list");
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(vec![community_stats_json(COMMUNITY_C, "Synth", 5, 1)], None),
    );
    let (first, (second, loading, shown)) =
        tokio::join!(rig.core.load_more_admin_communities(String::new()), async {
            let second = rig.core.load_more_admin_communities(String::new());
            let (second, loading) = (second.await, rig.core.admin_communities(String::new()));
            let shown = loading.rows.len();
            let loading = loading.loading_more;
            gate.send(()).unwrap();
            (second, loading, shown)
        });
    first.unwrap();
    second.unwrap();
    assert!(loading, "the page was announced while it was out");
    assert_eq!(shown, 2, "the rows show while the page is on its way");
    assert_eq!(lists(&rig).len(), 2, "one page, not two");
    let view = rig.core.admin_communities(String::new());
    assert_eq!(view.rows.len(), 3);
    assert!(!view.loading_more);

    // A failed page: the error comes back, nothing is added, and no page is left loading.
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(
            vec![
                community_stats_json(COMMUNITY, "Couch", 3, 2),
                community_stats_json(COMMUNITY_B, "Lumen", 4, 3),
            ],
            Some(COMMUNITY_B),
        ),
    );
    rig.core.admin_communities(String::new());
    rig.settle().await;
    rig.backend
        .w4
        .fail_next("w6d_list", refusal(500, "INTERNAL_SERVER_ERROR"));
    assert!(
        rig.core
            .load_more_admin_communities(String::new())
            .await
            .is_err()
    );
    let view = rig.core.admin_communities(String::new());
    assert_eq!(view.rows.len(), 2, "the shown page stays");
    assert!(!view.loading_more);
    assert!(view.more, "the server still has more");
}

#[tokio::test]
async fn the_list_and_detail_map_every_field() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(
            vec![
                community_stats_json(COMMUNITY, "Couch", 12, 6),
                community_stats_json(COMMUNITY_B, "Ghost", -1, -2),
            ],
            None,
        ),
    );
    rig.core.admin_communities(String::new());
    rig.settle().await;
    let view = rig.core.admin_communities(String::new());
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(
        view.rows,
        vec![
            AdminCommunityRow {
                id: COMMUNITY.into(),
                name: "Couch".into(),
                description: Some("About Couch".into()),
                avatar_file_id: Some(format!("{COMMUNITY}-avatar")),
                member_count: 12,
                channel_count: 6,
                created_at_ms: CREATED_AT_MS,
            },
            AdminCommunityRow {
                id: COMMUNITY_B.into(),
                name: "Ghost".into(),
                description: Some("About Ghost".into()),
                avatar_file_id: Some(format!("{COMMUNITY_B}-avatar")),
                member_count: 0,
                channel_count: 0,
                created_at_ms: CREATED_AT_MS,
            },
        ],
        "counts below zero read as 0"
    );
    assert_eq!(lists(&rig), [["w6d_list", "", "50", ""]]);
    // Still fresh: a second read asks nothing.
    rig.core.admin_communities(String::new());
    rig.settle().await;
    assert_eq!(lists(&rig).len(), 1);

    rig.backend.w4.answer(
        "w6d_community",
        community_detail_json(COMMUNITY, "Couch", 12, 6, 79),
    );
    rig.core.admin_community(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.admin_community(COMMUNITY.into());
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(view.message_count, 79);
    assert_eq!(
        view.community,
        Some(AdminCommunityRow {
            id: COMMUNITY.into(),
            name: "Couch".into(),
            description: Some("About Couch".into()),
            avatar_file_id: Some(format!("{COMMUNITY}-avatar")),
            member_count: 12,
            channel_count: 6,
            created_at_ms: CREATED_AT_MS,
        })
    );
    assert_eq!(rig.backend.w4.count("w6d_community"), 1);

    // A count below zero reads as 0, like the list's.
    rig.backend.w4.answer(
        "w6d_community",
        community_detail_json(COMMUNITY_B, "Ghost", 0, 0, -5),
    );
    rig.core.admin_community(COMMUNITY_B.into());
    rig.settle().await;
    assert_eq!(
        rig.core.admin_community(COMMUNITY_B.into()).message_count,
        0
    );
}

#[tokio::test]
async fn force_delete_drops_the_community_without_announcing_it() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(
            vec![
                community_stats_json(COMMUNITY, "Couch", 3, 2),
                community_stats_json(COMMUNITY_B, "Lumen", 4, 3),
            ],
            None,
        ),
    );
    rig.core.admin_communities(String::new());
    rig.core.admin_communities("lumen".into());
    rig.backend.w4.answer(
        "w6d_community",
        community_detail_json(COMMUNITY, "Couch", 3, 2, 9),
    );
    rig.core.admin_community(COMMUNITY.into());
    rig.settle().await;
    rig.events.take();

    rig.core
        .force_delete_community(COMMUNITY.into())
        .await
        .unwrap();
    let expected = format!("w6d_delete {COMMUNITY}");
    assert_eq!(
        rig.backend.w4.calls().last().map(String::as_str),
        Some(expected.as_str())
    );
    for search in ["", "lumen"] {
        let view = rig.core.admin_communities(search.into());
        assert!(
            view.rows.iter().all(|row| row.id != COMMUNITY),
            "{search:?} still shows it"
        );
        assert_eq!(view.rows.len(), 1);
    }
    let detail = rig.core.admin_community(COMMUNITY.into());
    assert_eq!(detail.state, LoadState::Loading, "the detail is dropped");
    assert_eq!(detail.community, None);
    let op = rig.core.admin_community(COMMUNITY.into()).op;
    assert!(!op.busy && op.error.is_none());

    // The server's own event for it says nothing: this core deleted it.
    rig.core.ingest(event(
        "communityDeleted",
        json!({ "communityId": COMMUNITY }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(removed(&rig), [], "the deleter isn't told");
}

#[tokio::test]
async fn a_refused_force_delete_keeps_everything() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(
            vec![
                community_stats_json(COMMUNITY, "Couch", 3, 2),
                community_stats_json(COMMUNITY_B, "Lumen", 4, 3),
            ],
            None,
        ),
    );
    rig.core.admin_communities(String::new());
    rig.backend.w4.answer(
        "w6d_community",
        community_detail_json(COMMUNITY, "Couch", 3, 2, 9),
    );
    rig.core.admin_community(COMMUNITY.into());
    rig.settle().await;
    rig.events.take();

    rig.backend
        .w4
        .fail_next("w6d_delete", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .force_delete_community(COMMUNITY.into())
            .await
            .is_err()
    );
    let view = rig.core.admin_communities(String::new());
    assert_eq!(view.rows.len(), 2, "nothing was removed");
    assert!(!view.op.busy);
    let detail = rig.core.admin_community(COMMUNITY.into());
    assert_eq!(detail.state, LoadState::Ready);
    assert_eq!(
        detail.community.as_ref().map(|row| row.name.as_str()),
        Some("Couch")
    );
    let op = detail.op;
    assert_eq!(
        op.action,
        Some(AdminAction {
            kind: AdminActionKind::ForceDeleteCommunity,
            target_id: Some(COMMUNITY.into()),
        })
    );
    assert_eq!(
        op.error.as_ref().map(|error| error.code.as_str()),
        Some("FORBIDDEN")
    );

    // The refusal took it out of the communities this core is deleting: the server's own event
    // (another admin's delete) is announced again.
    rig.core.ingest(event(
        "communityDeleted",
        json!({ "communityId": COMMUNITY }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(
        removed(&rig),
        [(COMMUNITY.to_owned(), RemovalCause::Deleted)]
    );
}

// ----- the instance invites --------------------------------------------------------------------

#[tokio::test]
async fn draft_table() {
    let rig = Rig::new().signed_in().await;
    let refusals = [
        (
            InstanceInviteDraft {
                community_ids: vec!["not-a-uuid".into()],
                ..Default::default()
            },
            "the community isn't valid",
        ),
        (
            InstanceInviteDraft {
                community_ids: vec![COMMUNITY.into()],
                max_uses: Some(0),
                ..Default::default()
            },
            "Uses must be at least 1",
        ),
        (
            InstanceInviteDraft {
                community_ids: vec![COMMUNITY.into()],
                valid_until_ms: Some(1_000_000),
                ..Default::default()
            },
            "The expiry must be in the future",
        ),
        (
            InstanceInviteDraft {
                community_ids: vec![COMMUNITY.into()],
                valid_until_ms: Some(999_999),
                ..Default::default()
            },
            "The expiry must be in the future",
        ),
    ];
    for (draft, message) in refusals {
        let error = rig.core.create_instance_invite(draft).await.unwrap_err();
        match error {
            CoreError::Failed { message: got } => assert_eq!(got, message),
            other => panic!("expected a refusal, got {other:?}"),
        }
        let op = rig.core.admin_invites().op;
        assert!(!op.busy, "{message}");
        assert_eq!(
            op.error
                .as_ref()
                .map(|error| (error.code.as_str(), error.message.as_str())),
            Some(("VALIDATION_FAILED", message))
        );
    }
    assert_eq!(
        rig.backend.w4.count("create_invite"),
        0,
        "a refused draft is never sent"
    );

    // No community: an invite to the instance alone, sent with an empty list (the backend takes
    // it; Home's Quick invite with nothing to invite to).
    rig.backend
        .w4
        .answer("create_invite", instance_invite_json("instance-only", &[]));
    assert_eq!(
        rig.core
            .create_instance_invite(InstanceInviteDraft::default())
            .await
            .unwrap(),
        "instance-only"
    );
    let call = rig.backend.w4.calls().last().cloned().expect("the call");
    let body: Value = serde_json::from_str(call.strip_prefix("create_invite ").unwrap()).unwrap();
    assert_eq!(body, json!({ "communityIds": [] }));

    // A valid draft with no limits: only the communities go on the wire.
    rig.backend.w4.answer("invites", json!([]));
    rig.core.admin_invites();
    rig.core.run_until_idle().await;
    assert!(codes(&rig).is_empty());
    rig.backend
        .w4
        .answer("create_invite", instance_invite_json("open", &[COMMUNITY]));
    assert_eq!(
        rig.core
            .create_instance_invite(InstanceInviteDraft {
                community_ids: vec![COMMUNITY.into()],
                ..Default::default()
            })
            .await
            .unwrap(),
        "open"
    );
    let call = rig.backend.w4.calls().last().cloned().expect("the call");
    let body: Value = serde_json::from_str(call.strip_prefix("create_invite ").unwrap()).unwrap();
    assert_eq!(body, json!({ "communityIds": [COMMUNITY] }));
    assert_eq!(codes(&rig), ["open"], "the new invite shows at once");

    // A valid draft with limits: both go on the wire.
    rig.backend.w4.answer(
        "create_invite",
        instance_invite_json("limited", &[COMMUNITY, COMMUNITY_B]),
    );
    assert_eq!(
        rig.core
            .create_instance_invite(InstanceInviteDraft {
                community_ids: vec![COMMUNITY.into(), COMMUNITY_B.into()],
                max_uses: Some(5),
                valid_until_ms: Some(2_000_000),
            })
            .await
            .unwrap(),
        "limited"
    );
    let call = rig.backend.w4.calls().last().cloned().expect("the call");
    let body: Value = serde_json::from_str(call.strip_prefix("create_invite ").unwrap()).unwrap();
    assert_eq!(body["maxUses"], json!(5));
    assert_eq!(body["communityIds"], json!([COMMUNITY, COMMUNITY_B]));
    let until = body["validUntil"].as_str().expect("an expiry");
    let until: chrono::DateTime<chrono::Utc> = until.parse().unwrap();
    assert_eq!(until.timestamp_millis(), 2_000_000);
    assert_eq!(codes(&rig), ["limited", "open"], "newest first");
}

#[tokio::test]
async fn delete_invite_goes_at_once_and_comes_back_when_refused() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "invites",
        json!([
            instance_invite_json("a", &[COMMUNITY]),
            instance_invite_json("b", &[COMMUNITY]),
        ]),
    );
    rig.core.admin_invites();
    rig.settle().await;
    assert_eq!(codes(&rig), ["a", "b"]);

    let gate = rig.backend.w4.hold("delete_invite");
    rig.backend
        .w4
        .fail_next("delete_invite", refusal(403, "FORBIDDEN"));
    let (result, shown) = tokio::join!(rig.core.delete_instance_invite("a".into()), async {
        tokio::task::yield_now().await;
        let shown = codes(&rig);
        gate.send(()).unwrap();
        shown
    });
    assert_eq!(shown, ["b"], "gone at once");
    assert!(result.is_err());
    assert_eq!(codes(&rig), ["a", "b"], "back at its place");
    let view = rig.core.admin_invites();
    assert!(!view.op.busy);
    assert_eq!(
        view.op.action,
        Some(AdminAction {
            kind: AdminActionKind::DeleteInstanceInvite,
            target_id: Some("a".into()),
        })
    );
    assert_eq!(
        view.op.error.as_ref().map(|error| error.code.as_str()),
        Some("FORBIDDEN")
    );

    // A delete the server accepts leaves only the other invite.
    rig.core.delete_instance_invite("a".into()).await.unwrap();
    assert_eq!(codes(&rig), ["b"]);
    assert!(rig.core.admin_invites().op.error.is_none());
}

#[tokio::test]
async fn the_admin_invites_list_is_apart_from_the_community_invites_list() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.backend.w4.answer(
        "invites",
        json!([
            instance_invite_json("mine", &["comm"]),
            instance_invite_json("other", &[COMMUNITY]),
        ]),
    );
    rig.core.community_invites(COMMUNITY.into());
    rig.core.admin_invites();
    rig.settle().await;
    assert_eq!(
        rig.backend.w4.count("invites"),
        2,
        "the same operation, read once for each list"
    );

    // W5-A's list is a community's: the invite to "comm" isn't in it.
    let theirs = rig.core.community_invites(COMMUNITY.into());
    assert_eq!(
        theirs
            .invites
            .iter()
            .map(|row| row.code.as_str())
            .collect::<Vec<_>>(),
        ["other"]
    );
    // Mine is every instance invite, with its fields and its communities named from the rail.
    let mine = rig.core.admin_invites();
    assert_eq!(mine.state, LoadState::Ready);
    assert_eq!(codes(&rig), ["mine", "other"]);
    let row = &mine.rows[0];
    assert_eq!(
        row.created_by,
        Some(UserView {
            id: ME.into(),
            username: "me".into(),
            display_name: Some("Me".into()),
            avatar_file_id: None,
        })
    );
    assert_eq!((row.uses, row.max_uses), (2, Some(5)));
    assert_eq!(
        (row.created_at_ms, row.valid_until_ms),
        (CREATED_AT_MS, Some(VALID_UNTIL_MS))
    );
    assert!(!row.disabled);
    assert_eq!(
        row.communities,
        [InviteCommunity {
            id: "comm".into(),
            name: "Community".into(),
        }]
    );
    assert_eq!(
        mine.rows[1].communities,
        [InviteCommunity {
            id: COMMUNITY.into(),
            name: COMMUNITY.into(),
        }],
        "a community the rail doesn't list shows its id"
    );

    // Refetching one list changes nothing about the other.
    rig.core
        .invalidate(&QueryKey::new(&["inviteControllerGetInvites.admin"]));
    rig.core.admin_invites();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("invites"), 3);
    let theirs = rig.core.community_invites(COMMUNITY.into());
    assert_eq!(theirs.state, LoadState::Ready);
    assert_eq!(theirs.invites.len(), 1);
    assert_eq!(codes(&rig), ["mine", "other"]);
}

#[tokio::test]
async fn an_answer_after_sign_out_changes_nothing() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("invites", json!([]));
    rig.core.admin_invites();
    rig.settle().await;

    let gate = rig.backend.w4.hold("create_invite");
    rig.backend
        .w4
        .answer("create_invite", instance_invite_json("late", &[COMMUNITY]));
    let create = rig.core.create_instance_invite(InstanceInviteDraft {
        community_ids: vec![COMMUNITY.into()],
        ..Default::default()
    });
    let (result, ()) = tokio::join!(create, async {
        new_session_then(&rig, gate).await;
    });
    match result {
        Err(CoreError::Failed { message }) => assert_eq!(message, "signed out"),
        other => panic!("expected the ended session's answer to fail, got {other:?}"),
    }
    rig.core.admin_invites();
    rig.settle().await;
    assert!(
        codes(&rig).is_empty(),
        "the old session's invite isn't in this one's list"
    );
    assert!(rig.core.admin_invites().op.error.is_none());
}

#[tokio::test]
async fn a_new_connection_reads_the_lists_again() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6d_list",
        communities_page(vec![community_stats_json(COMMUNITY, "Couch", 3, 2)], None),
    );
    rig.backend.w4.answer(
        "w6d_community",
        community_detail_json(COMMUNITY, "Couch", 3, 2, 9),
    );
    rig.backend.w4.answer("invites", json!([]));
    rig.core.admin_communities(String::new());
    rig.core.admin_community(COMMUNITY.into());
    rig.core.admin_invites();
    rig.settle().await;
    let counts = |rig: &Rig| {
        (
            rig.backend.w4.count("w6d_list"),
            rig.backend.w4.count("w6d_community"),
            rig.backend.w4.count("invites"),
        )
    };
    assert_eq!(counts(&rig), (1, 1, 1), "one read each while fresh");

    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.core.run_until_idle().await;
    assert_eq!(counts(&rig), (2, 2, 2), "a new connection reads each again");
    assert_eq!(
        rig.core.admin_communities(String::new()).state,
        LoadState::Ready
    );
    assert_eq!(
        rig.core.admin_community(COMMUNITY.into()).state,
        LoadState::Ready
    );
    assert_eq!(rig.core.admin_invites().state, LoadState::Ready);
    // A community's own invites are another key (W5-A's), so they weren't read here.
    assert_eq!(rig.backend.w4.count("w6d_list"), 2);
}
