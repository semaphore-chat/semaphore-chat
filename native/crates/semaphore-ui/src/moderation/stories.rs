//! The moderation stories: the menu on each kind of target (allowed, outranked, self, without the
//! permission, mixed, timed out, loading, failed), every dialog empty, filled, busy and refused,
//! the Moderation tab in each list and log state and permission set, and the removal notice for
//! each cause. `rigs/shot/scripts/w5-moderation.steps` renders them on a desktop and a phone.

use super::{DialogKind, ModerationDialog, ModerationMenu, ModerationTab, RemovedNotice};
use crate::dms::stories::failed;
use crate::kit::{Variant, spacing, text};
use crate::messages::TimeFormat;
use crate::messages::fixture::NOW_MS;
use crate::panel::common::is_phone;
use crate::stories::{Story, StoryEnv};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionState, AdminOp, BanListView, BanRow, CommunityCaps,
    ErrorView, LoadState, ModerationActionKind, ModerationLogRow, ModerationLogView,
    ModerationTargetView, NotAllowed, RemovalCause, TimeoutListView, TimeoutRow, UserView,
};

const SEC: i64 = 1_000;
const MIN: i64 = 60 * SEC;
const HOUR: i64 = 60 * MIN;
const DAY: i64 = 24 * HOUR;
const COMMUNITY: &str = "community-1";
const LONG_NAME: &str = "an_extraordinarily_long_username_that_keeps_going";
const LONG_REASON: &str = "Repeated spam in #general after two warnings, including links to a \
    phishing site dressed up as our login page — see the reports from 11/3 and 11/4. Затем \
    продолжил в личных сообщениях. 同じリンクを何度も投稿しました。 🚫🔗👨‍👩‍👧‍👦 Please don't lift this \
    without talking to the admins first, and keep an eye on alternate accounts.";

fn time() -> TimeFormat {
    TimeFormat::fixed(NOW_MS)
}

fn user(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

fn quill() -> UserView {
    user("u-4", "quill", None)
}

fn harbor() -> UserView {
    user("u-5", "harbor_mod", Some("Harbor"))
}

fn maple() -> UserView {
    user("u-2", "maple_admin", Some("Maple"))
}

fn long_user() -> UserView {
    user(
        "u-long",
        LONG_NAME,
        Some("Somebody With A Display Name Far Too Long To Fit Anywhere"),
    )
}

/// A plain screen under an overlay, so the dialog and menu have something to sit on.
struct Frame {
    under: Option<AnyView>,
    over: AnyView,
}

impl Render for Frame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        div()
            .size_full()
            .relative()
            .bg(sem.background_default)
            .children(self.under.clone())
            .when(self.under.is_none(), |frame| {
                frame.child(
                    div()
                        .p(spacing(3.))
                        .flex()
                        .flex_col()
                        .gap(spacing(1.))
                        .child(text(Variant::H6, "Members").text_color(sem.text_primary))
                        .children(
                            ["maple_admin", "harbor_mod", "quill", "juniper"].map(|name| {
                                text(Variant::Body1, name).text_color(sem.text_secondary)
                            }),
                        ),
                )
            })
            .child(self.over.clone())
    }
}

fn framed(over: AnyView, cx: &mut App) -> AnyView {
    cx.new(|_| Frame { under: None, over }).into()
}

// ---- The menu. ----

fn ready(
    (ban, kick, timeout, lift, roles): (bool, bool, bool, bool, bool),
    not_allowed: Option<NotAllowed>,
    timed_out: bool,
) -> ModerationTargetView {
    ModerationTargetView {
        state: LoadState::Ready,
        user_id: "u-4".into(),
        can_ban: ban,
        can_kick: kick,
        can_timeout: timeout,
        can_remove_timeout: lift,
        can_change_roles: roles,
        not_allowed,
        timed_out_until_ms: timed_out.then_some(NOW_MS + 9 * MIN + 59 * SEC),
        ..ModerationTargetView::default()
    }
}

fn menu(target: ModerationTargetView, who: UserView, window: &mut Window, cx: &mut App) -> AnyView {
    let phone = is_phone(window);
    let menu = cx.new(|cx| {
        let mut menu =
            ModerationMenu::new(who, point(px(if phone { 40. } else { 240. }), px(96.)), cx);
        menu.set_time(time(), cx);
        menu.set_target(target, cx);
        menu
    });
    framed(menu.into(), cx)
}

// ---- Per-action state. ----

fn entry_state(
    kind: AdminActionKind,
    user_id: &str,
    busy: bool,
    error: Option<&str>,
) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: Some(user_id.into()),
        },
        busy,
        upload: None,
        error: error.map(|message| ErrorView {
            code: "FORBIDDEN".into(),
            message: message.into(),
            retryable: false,
            retry_after_ms: None,
        }),
    }
}

fn op(actions: Vec<AdminActionState>) -> AdminOp {
    AdminOp {
        busy: actions.iter().any(|state| state.busy),
        actions,
        ..AdminOp::default()
    }
}

/// On quill: a ban on its way, and the timeout tried just before it refused.
fn ban_running_timeout_failed() -> AdminOp {
    op(vec![
        entry_state(
            AdminActionKind::Timeout,
            "u-4",
            false,
            Some("Timeout duration exceeds the maximum allowed"),
        ),
        entry_state(AdminActionKind::Ban, "u-4", true, None),
    ])
}

// ---- The dialogs. ----

#[derive(Clone, Copy)]
enum State {
    Empty,
    Filled,
    Busy,
    Refused,
}

fn dialog(
    kind: DialogKind,
    state: State,
    tweak: fn(&mut ModerationDialog, &mut Window, &mut Context<ModerationDialog>),
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let dialog = cx.new(|cx| {
        let mut dialog = ModerationDialog::new(window, cx);
        dialog.set_time(time(), cx);
        dialog.open_kind(kind, quill(), window, cx);
        match state {
            State::Empty => {}
            State::Filled => dialog.set_reason(LONG_REASON, window, cx),
            State::Busy => {
                dialog.set_reason("Spamming links in #general", window, cx);
                dialog.set_busy(true, cx);
            }
            State::Refused => {
                dialog.set_reason("Spamming links in #general", window, cx);
                dialog.set_error(
                    Some("You cannot moderate a user with an equal or higher role".into()),
                    cx,
                );
            }
        }
        tweak(&mut dialog, window, cx);
        dialog
    });
    framed(dialog.into(), cx)
}

fn no_tweak(_: &mut ModerationDialog, _: &mut Window, _: &mut Context<ModerationDialog>) {}

fn temporary_week(
    dialog: &mut ModerationDialog,
    _: &mut Window,
    cx: &mut Context<ModerationDialog>,
) {
    dialog.set_ban_choice(false, 604_800, cx);
}

fn hour(dialog: &mut ModerationDialog, _: &mut Window, cx: &mut Context<ModerationDialog>) {
    dialog.set_timeout_seconds(3_600, cx);
}

// ---- The tab. ----

fn caps(view_bans: bool, view_log: bool) -> CommunityCaps {
    CommunityCaps {
        ban: true,
        unban: true,
        kick: true,
        timeout: true,
        view_bans,
        view_moderation_log: view_log,
        ..CommunityCaps::default()
    }
}

fn ban_row(
    who: UserView,
    by: UserView,
    reason: Option<&str>,
    ago: i64,
    expires: Option<i64>,
    can_lift: bool,
) -> BanRow {
    BanRow {
        user: who,
        moderator: by,
        reason: reason.map(str::to_owned),
        created_at_ms: NOW_MS - ago,
        expires_at_ms: expires.map(|at| NOW_MS + at),
        can_lift,
    }
}

fn bans_ready(rows: Vec<BanRow>) -> BanListView {
    BanListView {
        state: LoadState::Ready,
        community_id: COMMUNITY.into(),
        bans: rows,
        ..BanListView::default()
    }
}

fn some_bans() -> BanListView {
    bans_ready(vec![
        ban_row(
            user("u-9", "spambot_3000", Some("Free Nitro")),
            harbor(),
            Some("Phishing links"),
            2 * DAY,
            None,
            true,
        ),
        ban_row(
            user("u-10", "tamsin", None),
            harbor(),
            Some("Cool-off after the argument in #events"),
            HOUR,
            Some(3 * DAY),
            true,
        ),
        ban_row(
            user("u-11", "ozzie", Some("Oz")),
            maple(),
            None,
            9 * DAY,
            Some(-HOUR),
            false,
        ),
    ])
}

fn timeout_row(
    who: UserView,
    by: UserView,
    reason: Option<&str>,
    left: i64,
    can_lift: bool,
) -> TimeoutRow {
    TimeoutRow {
        user: who,
        moderator: by,
        reason: reason.map(str::to_owned),
        created_at_ms: NOW_MS - 10 * MIN,
        expires_at_ms: NOW_MS + left,
        can_lift,
    }
}

fn timeouts_ready(rows: Vec<TimeoutRow>) -> TimeoutListView {
    TimeoutListView {
        state: LoadState::Ready,
        community_id: COMMUNITY.into(),
        timeouts: rows,
        ..TimeoutListView::default()
    }
}

fn some_timeouts() -> TimeoutListView {
    timeouts_ready(vec![
        timeout_row(
            quill(),
            harbor(),
            Some("Flooding the chat"),
            9 * MIN + 5 * SEC,
            true,
        ),
        timeout_row(
            user("u-12", "sable", Some("Sable Ito")),
            maple(),
            None,
            23 * HOUR + 59 * MIN,
            false,
        ),
        timeout_row(
            user("u-13", "juniper", None),
            harbor(),
            None,
            40 * SEC,
            true,
        ),
        timeout_row(
            user("u-14", "wren", None),
            harbor(),
            None,
            6 * DAY + 3 * HOUR,
            true,
        ),
    ])
}

fn entry(
    index: usize,
    action: ModerationActionKind,
    target: Option<UserView>,
    reason: Option<&str>,
    duration: Option<u32>,
) -> ModerationLogRow {
    ModerationLogRow {
        id: format!("log-{index}"),
        action,
        moderator: Some(if index.is_multiple_of(2) {
            harbor()
        } else {
            maple()
        }),
        target,
        reason: reason.map(str::to_owned),
        created_at_ms: NOW_MS - index as i64 * 47 * MIN - 13 * SEC,
        duration_seconds: duration,
        target_message_id: None,
    }
}

fn every_kind() -> Vec<ModerationLogRow> {
    use ModerationActionKind::*;
    vec![
        entry(
            0,
            Ban,
            Some(user("u-9", "spambot_3000", Some("Free Nitro"))),
            Some("Phishing links"),
            None,
        ),
        entry(
            1,
            Unban,
            Some(user("u-15", "finch", None)),
            Some("Appeal accepted"),
            None,
        ),
        entry(2, Kick, Some(user("u-16", "rook", None)), None, None),
        entry(
            3,
            Timeout,
            Some(quill()),
            Some("Flooding the chat"),
            Some(600),
        ),
        entry(4, RemoveTimeout, Some(quill()), None, None),
        {
            let mut deleted = entry(
                5,
                DeleteMessage,
                Some(user("u-12", "sable", Some("Sable Ito"))),
                Some("Slur"),
                None,
            );
            deleted.target_message_id = Some("9f8e7d6c5b4a".into());
            deleted
        },
        entry(6, PinMessage, None, None, None),
        entry(7, UnpinMessage, None, None, None),
        {
            let mut unknown = entry(8, Unknown, None, None, None);
            unknown.moderator = None;
            unknown
        },
        entry(
            9,
            Ban,
            Some(user("u-10", "tamsin", None)),
            Some("Cool-off"),
            Some(259_200),
        ),
    ]
}

fn log(rows: Vec<ModerationLogRow>, total: u32) -> ModerationLogView {
    ModerationLogView {
        state: LoadState::Ready,
        community_id: COMMUNITY.into(),
        rows,
        filter: None,
        total,
        loading_more: false,
    }
}

fn tab(
    caps: CommunityCaps,
    bans: BanListView,
    timeouts: TimeoutListView,
    log: ModerationLogView,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    cx.new(|cx| {
        let mut tab = ModerationTab::new(window, cx);
        tab.set_time(time(), cx);
        tab.set_caps(caps, cx);
        tab.set_bans(bans, cx);
        tab.set_timeouts(timeouts, cx);
        tab.set_log(log, cx);
        tab
    })
    .into()
}

fn full_tab(window: &mut Window, cx: &mut App) -> AnyView {
    tab(
        caps(true, true),
        some_bans(),
        some_timeouts(),
        log(every_kind(), 57),
        window,
        cx,
    )
}

fn failed_bans() -> BanListView {
    BanListView {
        state: failed(),
        ..BanListView::default()
    }
}

fn long_bans() -> BanListView {
    let mut rows = vec![ban_row(
        long_user(),
        long_user(),
        Some(LONG_REASON),
        DAY,
        Some(400 * DAY),
        true,
    )];
    rows.extend((0u32..29).map(|index| {
        ban_row(
            user(
                &format!("u-b{index}"),
                &format!("banned_member_{index:02}"),
                None,
            ),
            harbor(),
            index.is_multiple_of(3).then_some("Raid account"),
            index as i64 * HOUR,
            index.is_multiple_of(2).then_some(index as i64 * DAY + HOUR),
            !index.is_multiple_of(4),
        )
    }));
    bans_ready(rows)
}

fn long_timeouts() -> TimeoutListView {
    let mut rows = vec![timeout_row(
        long_user(),
        long_user(),
        Some(LONG_REASON),
        27 * DAY,
        true,
    )];
    rows.extend((0u32..14).map(|index| {
        timeout_row(
            user(
                &format!("u-t{index}"),
                &format!("quiet_member_{index:02}"),
                None,
            ),
            harbor(),
            None,
            (index as i64 + 1) * 17 * MIN,
            !index.is_multiple_of(3),
        )
    }));
    timeouts_ready(rows)
}

fn long_log() -> ModerationLogView {
    let mut rows = vec![entry(
        0,
        ModerationActionKind::Ban,
        Some(long_user()),
        Some(LONG_REASON),
        Some(2_592_000),
    )];
    rows[0].moderator = Some(long_user());
    rows.extend(every_kind().into_iter().skip(1));
    log(rows, 1_250)
}

// ---- The notice. ----

fn removed(name: &'static str, cause: RemovalCause, cx: &mut App) -> AnyView {
    let notice = cx.new(|cx| {
        let mut notice = RemovedNotice::new(cx);
        notice.set_time(time(), cx);
        notice.show(COMMUNITY, name, cause, cx);
        notice
    });
    framed(notice.into(), cx)
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(crate) fn stories() -> Vec<Story> {
    use DialogKind::*;
    use State::*;
    let all: Vec<(&'static str, Build)> = vec![
        // ---- The menu. ----
        ("moderation-menu-admin", |_, w, cx| {
            menu(
                ready((true, true, true, false, true), None, false),
                quill(),
                w,
                cx,
            )
        }),
        ("moderation-menu-outranked", |_, w, cx| {
            menu(
                ready(
                    (false, false, false, false, false),
                    Some(NotAllowed::Rank),
                    false,
                ),
                maple(),
                w,
                cx,
            )
        }),
        ("moderation-menu-self", |_, w, cx| {
            menu(
                ready(
                    (false, false, false, false, false),
                    Some(NotAllowed::SelfTarget),
                    false,
                ),
                harbor(),
                w,
                cx,
            )
        }),
        ("moderation-menu-member", |_, w, cx| {
            menu(
                ready(
                    (false, false, false, false, false),
                    Some(NotAllowed::Missing),
                    false,
                ),
                quill(),
                w,
                cx,
            )
        }),
        ("moderation-menu-mixed", |_, w, cx| {
            menu(
                ready((false, true, true, false, false), None, false),
                quill(),
                w,
                cx,
            )
        }),
        ("moderation-menu-timed-out", |_, w, cx| {
            menu(
                ready((true, true, true, true, true), None, true),
                quill(),
                w,
                cx,
            )
        }),
        ("moderation-menu-loading", |_, w, cx| {
            menu(ModerationTargetView::default(), quill(), w, cx)
        }),
        ("moderation-menu-failed", |_, w, cx| {
            menu(
                ModerationTargetView {
                    state: failed(),
                    ..ModerationTargetView::default()
                },
                quill(),
                w,
                cx,
            )
        }),
        ("moderation-menu-long-name", |_, w, cx| {
            menu(
                ready((true, true, true, true, true), None, true),
                long_user(),
                w,
                cx,
            )
        }),
        ("moderation-menu-ban-running-timeout-failed", |_, w, cx| {
            let mut target = ready((true, true, true, false, true), None, false);
            target.op = ban_running_timeout_failed();
            menu(target, quill(), w, cx)
        }),
        // ---- The dialogs. ----
        (
            "moderation-ban-running-beside-failed-timeout",
            |_, w, cx| {
                dialog(
                    Ban,
                    Empty,
                    |dialog, window, cx| {
                        dialog.set_reason("Spamming links in #general", window, cx);
                        dialog.set_op(ban_running_timeout_failed(), cx);
                    },
                    w,
                    cx,
                )
            },
        ),
        ("moderation-timeout-refused-by-core", |_, w, cx| {
            dialog(
                Timeout,
                Empty,
                |dialog, window, cx| {
                    dialog.set_reason("Flooding", window, cx);
                    dialog.confirm(cx);
                    dialog.set_op(ban_running_timeout_failed(), cx);
                },
                w,
                cx,
            )
        }),
        ("moderation-ban-empty", |_, w, cx| {
            dialog(Ban, Empty, no_tweak, w, cx)
        }),
        ("moderation-ban-filled", |_, w, cx| {
            dialog(Ban, Filled, temporary_week, w, cx)
        }),
        ("moderation-ban-busy", |_, w, cx| {
            dialog(Ban, Busy, no_tweak, w, cx)
        }),
        ("moderation-ban-error", |_, w, cx| {
            dialog(Ban, Refused, no_tweak, w, cx)
        }),
        ("moderation-ban-over-limit", |_, w, cx| {
            dialog(
                Ban,
                Empty,
                |dialog, window, cx| {
                    dialog.set_ban_choice(false, 3_600, cx);
                    dialog.set_reason(&"x".repeat(600), window, cx);
                },
                w,
                cx,
            )
        }),
        ("moderation-kick-empty", |_, w, cx| {
            dialog(Kick, Empty, no_tweak, w, cx)
        }),
        ("moderation-kick-filled", |_, w, cx| {
            dialog(Kick, Filled, no_tweak, w, cx)
        }),
        ("moderation-kick-busy", |_, w, cx| {
            dialog(Kick, Busy, no_tweak, w, cx)
        }),
        ("moderation-kick-error", |_, w, cx| {
            dialog(Kick, Refused, no_tweak, w, cx)
        }),
        ("moderation-timeout-empty", |_, w, cx| {
            dialog(Timeout, Empty, no_tweak, w, cx)
        }),
        ("moderation-timeout-filled", |_, w, cx| {
            dialog(Timeout, Filled, hour, w, cx)
        }),
        ("moderation-timeout-busy", |_, w, cx| {
            dialog(Timeout, Busy, no_tweak, w, cx)
        }),
        ("moderation-timeout-error", |_, w, cx| {
            dialog(Timeout, Refused, no_tweak, w, cx)
        }),
        ("moderation-unban-empty", |_, w, cx| {
            dialog(Unban, Empty, no_tweak, w, cx)
        }),
        ("moderation-unban-filled", |_, w, cx| {
            dialog(Unban, Filled, no_tweak, w, cx)
        }),
        ("moderation-unban-busy", |_, w, cx| {
            dialog(Unban, Busy, no_tweak, w, cx)
        }),
        ("moderation-unban-error", |_, w, cx| {
            dialog(Unban, Refused, no_tweak, w, cx)
        }),
        ("moderation-remove-timeout-empty", |_, w, cx| {
            dialog(RemoveTimeout, Empty, no_tweak, w, cx)
        }),
        ("moderation-remove-timeout-filled", |_, w, cx| {
            dialog(RemoveTimeout, Filled, no_tweak, w, cx)
        }),
        ("moderation-remove-timeout-busy", |_, w, cx| {
            dialog(RemoveTimeout, Busy, no_tweak, w, cx)
        }),
        ("moderation-remove-timeout-error", |_, w, cx| {
            dialog(RemoveTimeout, Refused, no_tweak, w, cx)
        }),
        // ---- The tab. ----
        ("moderation-tab", |_, w, cx| full_tab(w, cx)),
        ("moderation-tab-lifting", |_, w, cx| {
            let mut bans = some_bans();
            bans.op = op(vec![entry_state(AdminActionKind::Unban, "u-9", true, None)]);
            let mut timeouts = some_timeouts();
            timeouts.op = op(vec![entry_state(
                AdminActionKind::RemoveTimeout,
                "u-4",
                false,
                Some("You cannot moderate a user with an equal or higher role"),
            )]);
            tab(
                caps(true, true),
                bans,
                timeouts,
                log(every_kind(), 57),
                w,
                cx,
            )
        }),
        ("moderation-tab-loading", |_, w, cx| {
            tab(
                caps(true, true),
                BanListView::default(),
                TimeoutListView::default(),
                ModerationLogView::default(),
                w,
                cx,
            )
        }),
        ("moderation-tab-empty", |_, w, cx| {
            tab(
                caps(true, true),
                bans_ready(Vec::new()),
                timeouts_ready(Vec::new()),
                log(Vec::new(), 0),
                w,
                cx,
            )
        }),
        ("moderation-tab-failed", |_, w, cx| {
            tab(
                caps(true, true),
                failed_bans(),
                TimeoutListView {
                    state: failed(),
                    ..TimeoutListView::default()
                },
                ModerationLogView {
                    state: failed(),
                    ..ModerationLogView::default()
                },
                w,
                cx,
            )
        }),
        ("moderation-tab-long", |_, w, cx| {
            tab(
                caps(true, true),
                long_bans(),
                long_timeouts(),
                long_log(),
                w,
                cx,
            )
        }),
        ("moderation-tab-log-filtered-empty", |_, w, cx| {
            let mut view = log(Vec::new(), 0);
            view.filter = Some(ModerationActionKind::UnpinMessage);
            tab(caps(false, true), some_bans(), some_timeouts(), view, w, cx)
        }),
        ("moderation-tab-log-filtered", |_, w, cx| {
            let rows = every_kind()
                .into_iter()
                .filter(|row| row.action == ModerationActionKind::Ban)
                .collect();
            let mut view = log(rows, 2);
            view.filter = Some(ModerationActionKind::Ban);
            tab(caps(false, true), some_bans(), some_timeouts(), view, w, cx)
        }),
        ("moderation-tab-log-loading-more", |_, w, cx| {
            let mut view = log(every_kind().into_iter().take(3).collect(), 57);
            view.loading_more = true;
            tab(caps(false, true), some_bans(), some_timeouts(), view, w, cx)
        }),
        ("moderation-tab-log-end", |_, w, cx| {
            tab(
                caps(false, true),
                some_bans(),
                some_timeouts(),
                log(every_kind(), 10),
                w,
                cx,
            )
        }),
        ("moderation-tab-logs-only", |_, w, cx| {
            tab(
                caps(false, true),
                some_bans(),
                some_timeouts(),
                log(every_kind(), 57),
                w,
                cx,
            )
        }),
        ("moderation-tab-lists-only", |_, w, cx| {
            tab(
                caps(true, false),
                some_bans(),
                some_timeouts(),
                log(every_kind(), 57),
                w,
                cx,
            )
        }),
        ("moderation-tab-no-access", |_, w, cx| {
            tab(
                caps(false, false),
                some_bans(),
                some_timeouts(),
                log(every_kind(), 57),
                w,
                cx,
            )
        }),
        // ---- The notice. ----
        ("moderation-removed-kicked", |_, _, cx| {
            removed(
                "Night Owls",
                RemovalCause::Kicked {
                    reason: Some("Please read the rules before coming back.".into()),
                },
                cx,
            )
        }),
        ("moderation-removed-kicked-no-reason", |_, _, cx| {
            removed("Night Owls", RemovalCause::Kicked { reason: None }, cx)
        }),
        ("moderation-removed-banned-permanent", |_, _, cx| {
            removed(
                "Night Owls",
                RemovalCause::Banned {
                    reason: Some("Phishing links".into()),
                    until_ms: None,
                },
                cx,
            )
        }),
        ("moderation-removed-banned-temporary", |_, _, cx| {
            removed(
                "Night Owls",
                RemovalCause::Banned {
                    reason: Some(LONG_REASON.into()),
                    until_ms: Some(NOW_MS + 3 * DAY),
                },
                cx,
            )
        }),
        ("moderation-removed-deleted", |_, _, cx| {
            removed("Night Owls", RemovalCause::Deleted, cx)
        }),
        ("moderation-removed-no-name", |_, _, cx| {
            removed(
                "",
                RemovalCause::Banned {
                    reason: None,
                    until_ms: None,
                },
                cx,
            )
        }),
        ("moderation-removed-long-name", |_, _, cx| {
            removed(
                "The Extremely Long Community Name That Keeps Going Past Any Sensible Width",
                RemovalCause::Kicked { reason: None },
                cx,
            )
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
