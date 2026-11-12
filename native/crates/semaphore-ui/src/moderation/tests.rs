//! The views in a window: what each control sends, what is off, and the busy/error contract.
//! The wording and the rules are in `format_tests.rs`.

use super::*;
use crate::dms::rig::{Rig, rig};
use crate::messages::TimeFormat;
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{TestAppContext, point, px};
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionState, AdminOp, BanDuration, BanListView, BanRequest,
    BanRow, CommunityCaps, ErrorView, LoadState, ModerationLogView, ModerationTargetView,
    NotAllowed, RemovalCause, TimeoutListView, TimeoutRequest, UserView,
};

const NOW: i64 = 1_793_895_120_000;

fn user(id: &str) -> UserView {
    UserView {
        id: id.into(),
        username: id.into(),
        display_name: None,
        avatar_file_id: None,
    }
}

fn target(allowed: bool, not_allowed: Option<NotAllowed>, timed_out: bool) -> ModerationTargetView {
    ModerationTargetView {
        state: LoadState::Ready,
        user_id: "ana".into(),
        can_ban: allowed,
        can_kick: allowed,
        can_timeout: allowed,
        can_remove_timeout: allowed && timed_out,
        can_change_roles: allowed,
        not_allowed,
        timed_out_until_ms: timed_out.then_some(NOW + 60_000),
        ..ModerationTargetView::default()
    }
}

fn menu_rig(
    cx: &mut TestAppContext,
    target: ModerationTargetView,
) -> Rig<ModerationMenu, ModerationMenuEvent> {
    rig(cx, 1200., move |_, cx| {
        let mut menu = ModerationMenu::new(user("ana"), point(px(100.), px(100.)), cx);
        menu.set_time(TimeFormat::fixed(NOW), cx);
        menu.set_target(target, cx);
        menu
    })
}

#[gpui_kit::test]
fn menu_items_open_the_matching_dialog_then_close(cx: &mut TestAppContext) {
    let rig = menu_rig(cx, target(true, None, false));
    for id in [
        "moderate-kick",
        "moderate-timeout",
        "moderate-ban",
        "moderate-roles",
    ] {
        rig.click(cx, id);
    }
    rig.click(cx, "moderate-profile");
    use ModerationMenuEvent::*;
    assert_eq!(
        rig.events(),
        [
            Kick { user: user("ana") },
            Close,
            Timeout { user: user("ana") },
            Close,
            Ban { user: user("ana") },
            Close,
            ChangeRoles {
                user_id: "ana".into()
            },
            Close,
            ViewProfile {
                user_id: "ana".into()
            },
            Close,
        ]
    );
}

#[gpui_kit::test]
fn refused_items_show_but_send_nothing(cx: &mut TestAppContext) {
    for reason in [
        NotAllowed::Rank,
        NotAllowed::SelfTarget,
        NotAllowed::Missing,
    ] {
        let rig = menu_rig(cx, target(false, Some(reason), false));
        for id in [
            "moderate-kick",
            "moderate-timeout",
            "moderate-ban",
            "moderate-roles",
        ] {
            assert!(rig.has(cx, id), "{id} is drawn, disabled");
            let semantics = rig.with(cx, {
                let id = id.to_owned();
                move |_, window, _| {
                    let found = window.try_find(id).expect("drawn");
                    (found.role(), found.disabled())
                }
            });
            assert_eq!(
                semantics,
                (Some(gpui_kit::Role::MenuItem), Some(true)),
                "{id}: a disabled menu item, to assistive technology too"
            );
            rig.click(cx, id);
        }
        assert_eq!(rig.events(), [], "{reason:?}");
    }
}

#[gpui_kit::test]
fn a_timed_out_member_offers_remove_timeout_instead(cx: &mut TestAppContext) {
    let rig = menu_rig(cx, target(true, None, true));
    assert!(!rig.has(cx, "moderate-timeout"));
    rig.click(cx, "moderate-remove-timeout");
    assert_eq!(
        rig.events(),
        [
            ModerationMenuEvent::RemoveTimeout { user: user("ana") },
            ModerationMenuEvent::Close
        ]
    );
}

#[gpui_kit::test]
fn a_running_action_is_not_offered_twice(cx: &mut TestAppContext) {
    let mut busy = target(true, None, false);
    busy.op = op(vec![
        entry(AdminActionKind::Ban, true, None),
        entry(AdminActionKind::Timeout, false, Some("refused")),
    ]);
    let rig = menu_rig(cx, busy);
    rig.click(cx, "moderate-ban");
    rig.click(cx, "moderate-timeout");
    assert_eq!(
        rig.events(),
        [
            ModerationMenuEvent::Timeout { user: user("ana") },
            ModerationMenuEvent::Close
        ]
    );
}

#[gpui_kit::test]
fn nothing_is_offered_until_the_target_loads(cx: &mut TestAppContext) {
    let rig = menu_rig(cx, ModerationTargetView::default());
    assert!(rig.has(cx, "moderation-menu-loading"));
    assert!(!rig.has(cx, "moderate-ban"));
    rig.with(cx, |menu, _, cx| {
        menu.update(cx, |menu, cx| menu.choose(format::MemberAction::Ban, cx))
    });
    assert_eq!(rig.events(), []);
}

fn dialog_rig(cx: &mut TestAppContext) -> Rig<ModerationDialog, ModerationDialogEvent> {
    rig(cx, 1200., |window, cx| {
        let mut dialog = ModerationDialog::new(window, cx);
        dialog.set_time(TimeFormat::fixed(NOW), cx);
        dialog
    })
}

fn open(
    rig: &Rig<ModerationDialog, ModerationDialogEvent>,
    cx: &mut TestAppContext,
    kind: DialogKind,
    reason: &str,
) {
    let reason = reason.to_owned();
    rig.with(cx, move |dialog, window, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.open_kind(kind, user("ana"), window, cx);
            dialog.set_reason(&reason, window, cx);
        })
    });
}

#[gpui_kit::test]
fn a_ban_starts_permanent_and_can_be_temporary(cx: &mut TestAppContext) {
    let rig = dialog_rig(cx);
    open(&rig, cx, DialogKind::Ban, "  ");
    rig.click(cx, "ban-confirm");
    open(&rig, cx, DialogKind::Ban, " spam ");
    rig.click(cx, "ban-temporary");
    rig.click(cx, "ban-length-604800");
    rig.click(cx, "ban-confirm");
    assert_eq!(
        rig.events(),
        [
            ModerationDialogEvent::Ban {
                user_id: "ana".into(),
                request: BanRequest {
                    reason: None,
                    duration: BanDuration::Permanent
                }
            },
            ModerationDialogEvent::Ban {
                user_id: "ana".into(),
                request: BanRequest {
                    reason: Some("spam".into()),
                    duration: BanDuration::Seconds { seconds: 604_800 }
                }
            },
        ]
    );
}

#[gpui_kit::test]
fn confirming_turns_busy_and_an_error_hands_it_back(cx: &mut TestAppContext) {
    let rig = dialog_rig(cx);
    open(&rig, cx, DialogKind::Kick, "noise");
    rig.click(cx, "kick-confirm");
    // Busy: neither a second confirm nor cancel does anything.
    rig.click(cx, "kick-confirm");
    rig.click(cx, "kick-cancel");
    assert_eq!(rig.events().len(), 1);
    assert!(rig.with(cx, |dialog, _, cx| dialog.read(cx).is_open()));
    // Refused: the message shows and it can be sent again.
    rig.with(cx, |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| dialog.set_error(Some("Nope".into()), cx))
    });
    rig.click(cx, "kick-confirm");
    assert_eq!(
        rig.events(),
        [
            ModerationDialogEvent::Kick {
                user_id: "ana".into(),
                reason: Some("noise".into())
            },
            ModerationDialogEvent::Kick {
                user_id: "ana".into(),
                reason: Some("noise".into())
            },
        ]
    );
    // Done: the owner closes it.
    rig.with(cx, |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| dialog.close(cx))
    });
    assert!(!rig.has(cx, "kick-confirm"));
}

fn entry(kind: AdminActionKind, busy: bool, error: Option<&str>) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: Some("ana".into()),
        },
        busy,
        upload: None,
        error: error.map(|message| ErrorView {
            code: "X".into(),
            message: message.into(),
            retryable: false,
            retry_after_ms: None,
        }),
    }
}

fn op(actions: Vec<AdminActionState>) -> AdminOp {
    AdminOp {
        actions,
        ..AdminOp::default()
    }
}

fn feed(rig: &Rig<ModerationDialog, ModerationDialogEvent>, cx: &mut TestAppContext, op: AdminOp) {
    rig.with(cx, move |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| dialog.set_op(op, cx))
    });
}

fn state(
    rig: &Rig<ModerationDialog, ModerationDialogEvent>,
    cx: &mut TestAppContext,
) -> (bool, bool, Option<String>) {
    rig.with(cx, |dialog, _, cx| {
        let dialog = dialog.read(cx);
        (
            dialog.is_open(),
            dialog.busy(),
            dialog.error().map(str::to_owned),
        )
    })
}

#[gpui_kit::test]
fn a_dialog_follows_its_own_entry_to_success(cx: &mut TestAppContext) {
    let rig = dialog_rig(cx);
    open(&rig, cx, DialogKind::Ban, "");
    rig.click(cx, "ban-confirm");
    // Running beside a failed timeout on the same member: busy, and no error of the timeout's.
    feed(
        &rig,
        cx,
        op(vec![
            entry(AdminActionKind::Timeout, false, Some("timeout refused")),
            entry(AdminActionKind::Ban, true, None),
        ]),
    );
    assert_eq!(state(&rig, cx), (true, true, None));
    // The ban's end is recorded: it worked.
    feed(
        &rig,
        cx,
        with_ends(
            op(vec![entry(
                AdminActionKind::Timeout,
                false,
                Some("timeout refused"),
            )]),
            &[(AdminActionKind::Ban, Some("ana"), 1, false)],
        ),
    );
    assert_eq!(state(&rig, cx), (false, false, None));
    assert_eq!(
        rig.events().last(),
        Some(&ModerationDialogEvent::Succeeded {
            kind: DialogKind::Ban,
            user_id: "ana".into()
        })
    );
}

#[gpui_kit::test]
fn a_dialog_shows_its_own_failure_and_can_try_again(cx: &mut TestAppContext) {
    let rig = dialog_rig(cx);
    // A failure from before the dialog opened isn't shown.
    feed(
        &rig,
        cx,
        op(vec![entry(AdminActionKind::Kick, false, Some("old"))]),
    );
    open(&rig, cx, DialogKind::Kick, "");
    assert_eq!(state(&rig, cx), (true, false, None));
    rig.click(cx, "kick-confirm");
    feed(&rig, cx, op(vec![entry(AdminActionKind::Kick, true, None)]));
    let refused = with_ends(
        op(vec![entry(AdminActionKind::Kick, false, Some("Nope"))]),
        &[(AdminActionKind::Kick, Some("ana"), 1, true)],
    );
    feed(&rig, cx, refused.clone());
    assert_eq!(state(&rig, cx), (true, false, Some("Nope".into())));
    // Another member's entry or another action's doesn't end it.
    rig.click(cx, "kick-confirm");
    feed(
        &rig,
        cx,
        with_ends(
            op(vec![
                entry(AdminActionKind::Kick, true, None),
                entry(AdminActionKind::Ban, false, Some("ban refused")),
            ]),
            &[
                (AdminActionKind::Kick, Some("ana"), 1, true),
                (AdminActionKind::Ban, Some("ana"), 2, true),
                (AdminActionKind::Kick, Some("bo"), 3, false),
            ],
        ),
    );
    assert_eq!(state(&rig, cx), (true, true, None));
    let kicks = rig
        .events()
        .iter()
        .filter(|event| matches!(event, ModerationDialogEvent::Kick { .. }))
        .count();
    assert_eq!(kicks, 2);
}

#[gpui_kit::test]
fn a_reason_over_the_cap_is_not_sent(cx: &mut TestAppContext) {
    let rig = dialog_rig(cx);
    open(
        &rig,
        cx,
        DialogKind::Timeout,
        &"x".repeat(format::REASON_MAX + 1),
    );
    rig.click(cx, "timeout-confirm");
    assert_eq!(rig.events(), []);
    open(
        &rig,
        cx,
        DialogKind::Timeout,
        &"x".repeat(format::REASON_MAX),
    );
    rig.click(cx, "timeout-length-3600");
    rig.click(cx, "timeout-confirm");
    assert_eq!(
        rig.events(),
        [ModerationDialogEvent::Timeout {
            user_id: "ana".into(),
            request: TimeoutRequest {
                seconds: 3_600,
                reason: Some("x".repeat(format::REASON_MAX))
            }
        }]
    );
}

#[gpui_kit::test]
fn cancel_closes_and_the_lift_confirms_send_their_reason(cx: &mut TestAppContext) {
    let rig = dialog_rig(cx);
    open(&rig, cx, DialogKind::Unban, "");
    rig.click(cx, "unban-cancel");
    assert!(!rig.with(cx, |dialog, _, cx| dialog.read(cx).is_open()));
    open(&rig, cx, DialogKind::Unban, "appeal");
    rig.click(cx, "unban-confirm");
    open(&rig, cx, DialogKind::RemoveTimeout, "");
    rig.click(cx, "remove-timeout-confirm");
    assert_eq!(
        rig.events(),
        [
            ModerationDialogEvent::Cancel,
            ModerationDialogEvent::Unban {
                user_id: "ana".into(),
                reason: Some("appeal".into())
            },
            ModerationDialogEvent::RemoveTimeout {
                user_id: "ana".into(),
                reason: None
            },
        ]
    );
}

#[gpui_kit::test]
fn opening_resets_to_the_web_defaults(cx: &mut TestAppContext) {
    let rig = dialog_rig(cx);
    open(&rig, cx, DialogKind::Timeout, "x");
    rig.with(cx, |dialog, window, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.set_timeout_seconds(86_400, cx);
            dialog.set_ban_choice(false, 3_600, cx);
            dialog.open_timeout(user("bo"), window, cx);
            assert_eq!(dialog.timeout_seconds(), format::TIMEOUT_DEFAULT_SECONDS);
            assert_eq!(dialog.ban_choice(), format::BanChoice::default());
            // A length that isn't offered falls back to the default.
            dialog.set_timeout_seconds(7, cx);
            assert_eq!(dialog.timeout_seconds(), format::TIMEOUT_DEFAULT_SECONDS);
            dialog.set_presets(Vec::new(), vec![60, 120], cx);
            dialog.set_timeout_seconds(120, cx);
            assert_eq!(dialog.timeout_seconds(), 120);
        })
    });
}

fn caps(view: bool) -> CommunityCaps {
    CommunityCaps {
        unban: true,
        view_bans: view,
        view_moderation_log: view,
        ..CommunityCaps::default()
    }
}

fn ban(id: &str, can_lift: bool) -> BanRow {
    BanRow {
        user: user(id),
        moderator: user("mod"),
        reason: None,
        created_at_ms: NOW,
        expires_at_ms: None,
        can_lift,
    }
}

fn tab_rig(
    cx: &mut TestAppContext,
    caps: CommunityCaps,
    log: ModerationLogView,
) -> Rig<ModerationTab, ModerationTabEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut tab = ModerationTab::new(window, cx);
        tab.set_time(TimeFormat::fixed(NOW), cx);
        tab.set_caps(caps, cx);
        tab.set_bans(
            BanListView {
                state: LoadState::Ready,
                community_id: "c".into(),
                bans: vec![ban("ana", true), ban("bo", false)],
                ..BanListView::default()
            },
            cx,
        );
        tab.set_timeouts(
            TimeoutListView {
                state: LoadState::Failed {
                    error: ErrorView {
                        code: "X".into(),
                        message: "down".into(),
                        retryable: true,
                        retry_after_ms: None,
                    },
                },
                ..TimeoutListView::default()
            },
            cx,
        );
        tab.set_log(log, cx);
        tab
    })
}

fn log_view(rows: usize, total: u32, loading_more: bool) -> ModerationLogView {
    ModerationLogView {
        state: LoadState::Ready,
        community_id: "c".into(),
        rows: (0..rows)
            .map(|index| semaphore_core::model::ModerationLogRow {
                id: index.to_string(),
                action: semaphore_core::model::ModerationActionKind::Kick,
                moderator: None,
                target: Some(user("ana")),
                reason: None,
                created_at_ms: NOW,
                duration_seconds: None,
                target_message_id: None,
            })
            .collect(),
        filter: None,
        total,
        loading_more,
    }
}

#[gpui_kit::test]
fn rows_lift_only_where_core_allows(cx: &mut TestAppContext) {
    let rig = tab_rig(cx, caps(true), log_view(2, 5, false));
    rig.click(cx, "unban-ana");
    rig.click(cx, "unban-bo");
    rig.click(cx, "timeouts-retry");
    rig.click(cx, "log-more");
    assert_eq!(
        rig.events(),
        [
            ModerationTabEvent::Unban { user: user("ana") },
            ModerationTabEvent::Retry,
            ModerationTabEvent::MoreLog,
        ]
    );
    assert!(rig.has(cx, "unban-bo-locked"));
}

#[gpui_kit::test]
fn the_log_says_when_it_is_loading_more_or_done(cx: &mut TestAppContext) {
    let rig = tab_rig(cx, caps(true), log_view(2, 5, true));
    assert!(rig.has(cx, "log-more-loading"));
    assert!(!rig.has(cx, "log-more"));
    let done = tab_rig(cx, caps(true), log_view(5, 5, false));
    assert!(!done.has(cx, "log-more"));
}

#[gpui_kit::test]
fn sections_this_user_cant_see_say_so(cx: &mut TestAppContext) {
    let rig = tab_rig(
        cx,
        CommunityCaps {
            view_moderation_log: true,
            ..CommunityCaps::default()
        },
        log_view(1, 1, false),
    );
    assert!(rig.has(cx, "bans-locked"));
    assert!(rig.has(cx, "timeouts-locked"));
    assert!(!rig.has(cx, "unban-ana"));
    assert!(rig.has(cx, "log-list"));
    let none = tab_rig(cx, caps(false), log_view(1, 1, false));
    assert!(!none.has(cx, "moderation-bans"));
    assert!(!none.has(cx, "log-list"));
}

#[gpui_kit::test]
fn the_removal_notice_shows_once(cx: &mut TestAppContext) {
    let rig: Rig<RemovedNotice, RemovedNoticeEvent> = rig(cx, 1200., |_, cx| {
        let mut notice = RemovedNotice::new(cx);
        notice.show(
            "c1",
            "Night Owls",
            RemovalCause::Kicked { reason: None },
            cx,
        );
        notice
    });
    // The dialog opens on the first frame.
    rig.with(cx, |_, _, _| ());
    rig.click(cx, "removed-ok");
    assert!(!rig.has(cx, "removed-ok"));
    assert_eq!(
        rig.events(),
        [RemovedNoticeEvent::Acknowledged {
            community_id: "c1".into()
        }]
    );
    assert!(!rig.with(cx, |notice, _, cx| notice.read(cx).is_shown()));
}

/// `op` with these ends recorded, as (kind, target, seq, failed).
fn with_ends(mut op: AdminOp, ends: &[(AdminActionKind, Option<&str>, u64, bool)]) -> AdminOp {
    op.finished = ends
        .iter()
        .map(
            |(kind, target, seq, failed)| semaphore_core::model::AdminActionOutcome {
                action: semaphore_core::model::AdminAction {
                    kind: *kind,
                    target_id: target.map(str::to_owned),
                },
                seq: *seq,
                error: failed.then(|| ErrorView {
                    code: "X".into(),
                    message: "failed".into(),
                    retryable: false,
                    retry_after_ms: None,
                }),
            },
        )
        .collect();
    op
}
