use super::*;
use crate::panel::PanelClock;
use semaphore_core::model::{LoadState, RemovalCause};
use std::prelude::rust_2024::test;

// 2026-11-05 16:12:00 UTC
const NOW: i64 = 1_793_895_120_000;
const SEC: i64 = 1_000;
const MIN: i64 = 60 * SEC;
const HOUR: i64 = 60 * MIN;
const DAY: i64 = 24 * HOUR;

/// Inputs every time formatter must survive.
const EDGES: [i64; 12] = [
    i64::MIN,
    i64::MIN + 1,
    -DAY,
    -1,
    0,
    1,
    NOW - 1,
    NOW,
    NOW + 1,
    253_402_300_800_000, // year 10000: past chrono's display range
    i64::MAX - 1,
    i64::MAX,
];

fn utc() -> TimeFormat {
    TimeFormat::fixed(NOW)
}

fn new_york() -> TimeFormat {
    TimeFormat {
        zone: FixedOffset::west_opt(5 * 3600),
        now: PanelClock::fixed(NOW),
    }
}

fn user(name: &str, display: Option<&str>) -> UserView {
    UserView {
        id: format!("u-{name}"),
        username: name.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

// ---- Reasons. ----

#[test]
fn reasons_are_trimmed_and_blank_ones_are_not_sent() {
    let cases: [(&str, Option<&str>); 7] = [
        ("", None),
        ("   ", None),
        ("\n\t ", None),
        ("spam", Some("spam")),
        ("  spam  ", Some("spam")),
        ("two\nlines", Some("two\nlines")),
        (" 荒らし 🚫 ", Some("荒らし 🚫")),
    ];
    for (raw, sent) in cases {
        assert_eq!(reason_for_send(raw).as_deref(), sent, "{raw:?}");
    }
}

#[test]
fn the_counter_counts_characters_not_bytes() {
    let family = "👨‍👩‍👧‍👦"; // one character, seven scalars
    let cases: [(String, usize); 7] = [
        (String::new(), 0),
        ("  a  ".into(), 1),
        ("café".into(), 4),
        ("cafe\u{301}".into(), 4), // e + combining acute
        (family.into(), 1),
        ("مرحبا".into(), 5),
        ("x".repeat(REASON_MAX), REASON_MAX),
    ];
    for (raw, count) in cases {
        assert_eq!(reason_len(&raw), count, "{raw:?}");
        assert_eq!(reason_counter(&raw), format!("{count}/{REASON_MAX}"));
    }
}

#[test]
fn the_cap_allows_exactly_512_and_refuses_513() {
    let cases: [(String, bool); 6] = [
        (String::new(), false),
        ("x".repeat(REASON_MAX - 1), false),
        ("x".repeat(REASON_MAX), false),
        ("x".repeat(REASON_MAX + 1), true),
        (format!("   {}   ", "x".repeat(REASON_MAX)), false),
        ("👨‍👩‍👧‍👦".repeat(REASON_MAX + 1), true),
    ];
    for (raw, over) in cases {
        assert_eq!(reason_error(&raw).is_some(), over, "{}", raw.len());
    }
    assert_eq!(
        reason_error(&"x".repeat(600)).unwrap(),
        "Keep the reason to 512 characters"
    );
}

#[test]
fn previews_fit_on_one_line_and_cut_between_characters() {
    let cases: [(&str, usize, &str); 8] = [
        ("short", 10, "short"),
        ("exactly ten", 11, "exactly ten"),
        ("exactly ten", 10, "exactly t\u{2026}"),
        ("a  b\n\nc", 10, "a b c"),
        ("word word word", 6, "word\u{2026}"),
        ("👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦", 2, "👨‍👩‍👧‍👦\u{2026}"),
        ("cafe\u{301}cafe\u{301}", 5, "cafe\u{301}\u{2026}"),
        ("anything", 0, ""),
    ];
    for (reason, max, preview) in cases {
        assert_eq!(reason_preview(reason, max), preview, "{reason:?} {max}");
    }
}

#[test]
fn a_preview_never_splits_a_character_or_exceeds_its_bound() {
    let samples = [
        "plain words here and there",
        "👨‍👩‍👧‍👦🏳️‍🌈🇯🇵 flags and families 👍🏽👍🏽",
        "e\u{301}e\u{301}e\u{301}e\u{301}e\u{301}e\u{301}",
        "עברית ועוד טקסט ארוך",
        "x",
        "",
        " \n ",
    ];
    for sample in samples {
        for max in 0..30 {
            let preview = reason_preview(sample, max);
            let count = preview.graphemes(true).count();
            assert!(count <= max, "{sample:?} {max}: {preview:?}");
            // Every character of the preview but the ellipsis is one of the original's.
            let body = preview.trim_end_matches('\u{2026}');
            for grapheme in body.graphemes(true) {
                assert!(
                    sample.graphemes(true).any(|g| g == grapheme) || grapheme == " ",
                    "{sample:?} {max}: {grapheme:?}"
                );
            }
        }
    }
}

// ---- Lengths and presets. ----

#[test]
fn lengths_read_like_the_web_presets() {
    let cases: [(u32, &str); 16] = [
        (0, "0 seconds"),
        (1, "1 second"),
        (59, "59 seconds"),
        (60, "60 seconds"),
        (90, "90 seconds"),
        (119, "119 seconds"),
        (120, "2 minutes"),
        (300, "5 minutes"),
        (600, "10 minutes"),
        (3_600, "1 hour"),
        (7_200, "2 hours"),
        (86_400, "1 day"),
        (604_800, "1 week"),
        (2_419_200, "4 weeks"),
        (2_592_000, "1 month"),
        (3_601, "3601 seconds"),
    ];
    for (seconds, label) in cases {
        assert_eq!(duration_label(seconds), label, "{seconds}");
    }
    assert_eq!(duration_label(u32::MAX), "4294967295 seconds");
    assert!(!duration_label(u32::MAX - 1).is_empty());
}

#[test]
fn the_preset_labels_are_the_webs() {
    let ban: Vec<_> = BAN_PRESETS_SECONDS
        .iter()
        .map(|s| duration_label(*s))
        .collect();
    assert_eq!(ban, ["1 hour", "1 day", "1 week", "1 month"]);
    let timeout: Vec<_> = TIMEOUT_PRESETS_SECONDS
        .iter()
        .map(|s| duration_label(*s))
        .collect();
    assert_eq!(
        timeout,
        [
            "60 seconds",
            "5 minutes",
            "10 minutes",
            "1 hour",
            "1 day",
            "1 week"
        ]
    );
}

#[test]
fn a_preset_is_picked_from_what_is_offered() {
    let offered = [60, 600, 3_600];
    type Case<'a> = (&'a [u32], Option<u32>, u32, Option<u32>);
    let cases: [Case; 7] = [
        (&offered, Some(3_600), 600, Some(3_600)),
        (&offered, None, 600, Some(600)),
        (&offered, Some(5), 600, Some(600)),
        (&offered, Some(5), 7, Some(60)),
        (&offered, Some(0), 600, Some(600)),
        (&[], Some(60), 60, None),
        (&[86_400], None, 600, Some(86_400)),
    ];
    for (presets, wanted, default, picked) in cases {
        assert_eq!(pick_preset(presets, wanted, default), picked);
    }
    assert_eq!(presets_or_default(&[], true), TIMEOUT_PRESETS_SECONDS);
    assert_eq!(presets_or_default(&[], false), BAN_PRESETS_SECONDS);
    assert_eq!(presets_or_default(&[42], false), [42]);
}

#[test]
fn the_ban_choice_starts_permanent_and_builds_the_request() {
    let choice = BanChoice::default();
    assert!(choice.permanent);
    assert_eq!(choice.seconds, BAN_DEFAULT_SECONDS);
    assert_eq!(
        choice.request("  "),
        BanRequest {
            reason: None,
            duration: BanDuration::Permanent
        }
    );
    let week = BanChoice {
        permanent: false,
        seconds: 604_800,
    };
    assert_eq!(
        week.request(" spam "),
        BanRequest {
            reason: Some("spam".into()),
            duration: BanDuration::Seconds { seconds: 604_800 }
        }
    );
    assert_eq!(
        timeout_request(600, ""),
        TimeoutRequest {
            seconds: 600,
            reason: None
        }
    );
}

// ---- Times. ----

#[test]
fn dates_use_the_given_zone() {
    assert_eq!(date_time(&utc(), NOW), "Nov 5, 2026 at 4:12 PM");
    assert_eq!(date_time(&new_york(), NOW), "Nov 5, 2026 at 11:12 AM");
    assert_eq!(
        date_time_seconds(&utc(), NOW + 7 * SEC),
        "Nov 5, 2026 at 4:12:07 PM"
    );
    // Midnight in UTC is still the day before in New York.
    let midnight = NOW + 7 * HOUR + 48 * MIN;
    assert_eq!(date_time(&utc(), midnight), "Nov 6, 2026 at 12:00 AM");
    assert_eq!(date_time(&new_york(), midnight), "Nov 5, 2026 at 7:00 PM");
    assert_eq!(date_time(&utc(), i64::MAX), "an unknown date");
}

#[test]
fn ban_status_reads_permanent_expired_or_when() {
    let cases: [(Option<i64>, &str); 9] = [
        (None, "Permanent"),
        (Some(NOW), "Expired"),
        (Some(NOW - 1), "Expired"),
        (Some(i64::MIN), "Expired"),
        (Some(NOW + 1), "Expires in less than a minute"),
        (Some(NOW + HOUR), "Expires in about 1 hour"),
        (Some(NOW + 3 * DAY), "Expires in 3 days"),
        (Some(NOW + 30 * DAY), "Expires in about 1 month"),
        (Some(NOW + 400 * DAY), "Expires in about 1 year"),
    ];
    for (expires, label) in cases {
        assert_eq!(ban_status(NOW, expires).label(), label, "{expires:?}");
    }
    assert!(
        ban_status(NOW, Some(i64::MAX))
            .label()
            .starts_with("Expires in ")
    );
}

#[test]
fn timeouts_count_down_and_never_read_zero() {
    let cases: [(i64, &str); 16] = [
        (i64::MIN, "Expired"),
        (-DAY, "Expired"),
        (-1, "Expired"),
        (0, "Expired"),
        (1, "1s left"),
        (999, "1s left"),
        (SEC, "1s left"),
        (59 * SEC, "59s left"),
        (MIN, "1m 00s left"),
        (4 * MIN + 5 * SEC, "4m 05s left"),
        (HOUR - 1, "1h 0m left"),
        (HOUR, "1h 0m left"),
        (DAY - SEC, "23h 59m left"),
        (DAY, "1d 0h left"),
        (28 * DAY, "28d 0h left"),
        (i64::MAX, "365000d 0h left"),
    ];
    for (left, label) in cases {
        let expires = NOW.saturating_add(left);
        assert_eq!(timeout_left(NOW, expires), label, "{left}");
    }
}

#[test]
fn until_labels_say_when_and_how_far() {
    assert_eq!(
        until_label(&utc(), NOW + 7 * DAY),
        "until Nov 12, 2026 at 4:12 PM (in 7 days)"
    );
    assert_eq!(until_label(&utc(), NOW), "until it expires");
    assert_eq!(until_label(&utc(), NOW - DAY), "until it expires");
    assert_eq!(ends_label(&utc(), 600), "Until Nov 5, 2026 at 4:22 PM");
    assert!(ends_label(&utc(), u32::MAX).starts_with("Until "));
    assert!(ends_label(&utc(), u32::MAX).contains(", 216"));
}

#[test]
fn time_formatters_never_panic_or_go_blank() {
    for now in EDGES {
        for then in EDGES {
            for text in [
                date_time(&utc(), then),
                date_time_seconds(&new_york(), then),
                relative(now, then),
                ban_status(now, Some(then)).label(),
                timeout_left(now, then),
                until_label(
                    &TimeFormat {
                        zone: None,
                        now: PanelClock::fixed(now),
                    },
                    then,
                ),
            ] {
                assert!(!text.is_empty(), "{now} {then}");
            }
        }
        for seconds in [0, 1, 60, u32::MAX] {
            let time = TimeFormat {
                zone: FixedOffset::east_opt(0),
                now: PanelClock::fixed(now),
            };
            assert!(!ends_label(&time, seconds).is_empty());
        }
    }
}

// ---- The log. ----

fn log_row(kind: ModerationActionKind) -> ModerationLogRow {
    ModerationLogRow {
        id: "l1".into(),
        action: kind,
        moderator: Some(user("harbor_mod", Some("Harbor"))),
        target: Some(user("quill", None)),
        reason: Some("spam".into()),
        created_at_ms: NOW,
        duration_seconds: None,
        target_message_id: None,
    }
}

#[test]
fn every_action_has_a_label_and_a_tone() {
    let cases = [
        (ModerationActionKind::Ban, "Ban User", Tone::Error),
        (ModerationActionKind::Unban, "Unban User", Tone::Success),
        (ModerationActionKind::Kick, "Kick User", Tone::Warning),
        (ModerationActionKind::Timeout, "Timeout User", Tone::Warning),
        (
            ModerationActionKind::RemoveTimeout,
            "Remove Timeout",
            Tone::Success,
        ),
        (
            ModerationActionKind::DeleteMessage,
            "Delete Message",
            Tone::Error,
        ),
        (
            ModerationActionKind::PinMessage,
            "Pin Message",
            Tone::Primary,
        ),
        (
            ModerationActionKind::UnpinMessage,
            "Unpin Message",
            Tone::Neutral,
        ),
        (ModerationActionKind::Unknown, "Other Action", Tone::Neutral),
    ];
    for (kind, label, tone) in cases {
        assert_eq!(action_label(kind), label);
        assert_eq!(action_tone(kind), tone);
    }
    assert!(!LOG_KINDS.contains(&ModerationActionKind::Unknown));
}

#[test]
fn log_details_join_what_the_entry_has() {
    let mut timeout = log_row(ModerationActionKind::Timeout);
    timeout.duration_seconds = Some(86_400);
    let mut bare = log_row(ModerationActionKind::PinMessage);
    bare.target = None;
    bare.reason = None;
    let mut blank_reason = log_row(ModerationActionKind::Kick);
    blank_reason.reason = Some("   ".into());
    let mut long = log_row(ModerationActionKind::Ban);
    long.reason = Some("ん".repeat(400));
    long.target = Some(user("maple_admin", Some("Maple")));
    let cases = [
        (
            log_row(ModerationActionKind::Ban),
            "Target: quill \u{2022} Reason: spam",
        ),
        (
            timeout,
            "Target: quill \u{2022} For 1 day \u{2022} Reason: spam",
        ),
        (bare, "No additional details"),
        (blank_reason, "Target: quill"),
    ];
    for (row, detail) in cases {
        assert_eq!(log_detail(&row), detail);
    }
    let detail = log_detail(&long);
    assert!(detail.starts_with("Target: Maple \u{2022} Reason: んん"));
    assert!(detail.ends_with('\u{2026}'));
    assert!(detail.graphemes(true).count() <= "Target: Maple • Reason: ".len() + 200);
}

#[test]
fn log_bylines_and_counts() {
    assert_eq!(
        log_by(Some(&user("harbor_mod", Some("Harbor")))),
        "by Harbor"
    );
    assert_eq!(log_by(Some(&user("quill", Some("  ")))), "by quill");
    assert_eq!(log_by(None), "by someone");
    let cases: [(usize, u32, &str); 5] = [
        (0, 0, "0 entries"),
        (1, 1, "1 entry"),
        (20, 57, "Showing 20 of 57"),
        (57, 57, "57 entries"),
        (60, 57, "57 entries"),
    ];
    for (shown, total, label) in cases {
        assert_eq!(log_count(shown, total), label);
    }
}

// ---- What may be done to a member. ----

fn target(
    (ban, kick, timeout, lift, roles): (bool, bool, bool, bool, bool),
    not_allowed: Option<NotAllowed>,
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
        timed_out_until_ms: lift.then_some(NOW + HOUR),
        ..ModerationTargetView::default()
    }
}

#[test]
fn blocked_actions_carry_cores_reason() {
    use MemberAction::*;
    use NotAllowed::*;
    const ALL: [MemberAction; 5] = [Kick, Timeout, RemoveTimeout, Ban, ChangeRoles];
    let admin = target((true, true, true, true, true), None);
    let outranked = target((false, false, false, false, false), Some(Rank));
    let me = target((false, false, false, false, false), Some(SelfTarget));
    let member = target((false, false, false, false, false), Some(Missing));
    let kick_only = target((false, true, false, false, false), None);
    let lifts_outranked = target((false, false, false, true, false), Some(Rank));
    for action in ALL {
        assert_eq!(blocked(&admin, action), None, "{action:?}");
        assert_eq!(blocked(&me, action), Some(SelfTarget), "{action:?}");
        assert_eq!(blocked(&member, action), Some(Missing), "{action:?}");
    }
    let cases = [
        (&outranked, Kick, Some(Rank)),
        (&outranked, Ban, Some(Rank)),
        (&outranked, Timeout, Some(Rank)),
        (&outranked, ChangeRoles, Some(Rank)),
        (&outranked, RemoveTimeout, Some(Missing)),
        (&kick_only, Kick, None),
        (&kick_only, Ban, Some(Missing)),
        (&kick_only, Timeout, Some(Missing)),
        (&kick_only, ChangeRoles, Some(Missing)),
        (&lifts_outranked, RemoveTimeout, None),
    ];
    for (target, action, reason) in cases {
        assert_eq!(blocked(target, action), reason, "{action:?}");
    }
    assert_eq!(blocked_reason(Rank), "They rank the same as or above you");
    assert_eq!(blocked_reason(SelfTarget), "You can't moderate yourself");
    assert_eq!(blocked_reason(Missing), "You don't have permission");
}

#[test]
fn per_action_reasons_win_over_the_shared_one() {
    use MemberAction::*;
    use NotAllowed::*;
    // Kick allowed; ban outranked; timeout missing; roles outranked; no shared reason.
    let mut mixed = target((false, true, false, false, false), None);
    mixed.ban_not_allowed = Some(Rank);
    mixed.timeout_not_allowed = Some(Missing);
    mixed.roles_not_allowed = Some(Rank);
    let cases = [
        (Kick, None),
        (Ban, Some(Rank)),
        (Timeout, Some(Missing)),
        (ChangeRoles, Some(Rank)),
        (RemoveTimeout, Some(Missing)),
    ];
    for (action, reason) in cases {
        assert_eq!(blocked(&mixed, action), reason, "{action:?}");
    }
    // A per-action reason beats the shared one; self beats everything.
    let mut outranked = target((false, false, false, false, false), Some(Rank));
    outranked.kick_not_allowed = Some(Missing);
    assert_eq!(blocked(&outranked, Kick), Some(Missing));
    assert_eq!(blocked(&outranked, Ban), Some(Rank));
    let mut me = target((false, false, false, false, false), Some(SelfTarget));
    me.ban_not_allowed = Some(Missing);
    assert_eq!(blocked(&me, Ban), Some(SelfTarget));
}

#[test]
fn log_details_show_the_message_only_when_known() {
    let mut row = log_row(ModerationActionKind::DeleteMessage);
    row.target_message_id = Some("1a2b3c4d5e6f".into());
    assert_eq!(
        log_detail(&row),
        "Target: quill \u{2022} Message: 1a2b3c4d\u{2026} \u{2022} Reason: spam"
    );
    row.target_message_id = Some("  ".into());
    assert_eq!(log_detail(&row), "Target: quill \u{2022} Reason: spam");
}

// ---- Being removed. ----

#[test]
fn the_removal_notice_names_the_cause() {
    let kicked = RemovalCause::Kicked { reason: None };
    let banned = RemovalCause::Banned {
        reason: Some("spam".into()),
        until_ms: None,
    };
    let banned_week = RemovalCause::Banned {
        reason: None,
        until_ms: Some(NOW + 7 * DAY),
    };
    let banned_past = RemovalCause::Banned {
        reason: None,
        until_ms: Some(NOW - 1),
    };
    let cases = [
        ("Gamers", &kicked, "You were removed from Gamers"),
        ("", &kicked, "You were removed from this community"),
        ("  ", &banned, "You were banned from this community"),
        ("Gamers", &banned_week, "You were banned from Gamers"),
        ("Gamers", &RemovalCause::Deleted, "Gamers was deleted"),
        ("", &RemovalCause::Deleted, "This community was deleted"),
        (
            "日本語の部屋 🎌",
            &kicked,
            "You were removed from 日本語の部屋 🎌",
        ),
    ];
    for (name, cause, title) in cases {
        assert_eq!(removed_title(name, cause), title);
    }
    let time = utc();
    assert_eq!(
        removed_body(&time, &banned_week),
        "You can't rejoin until Nov 12, 2026 at 4:12 PM (in 7 days)."
    );
    assert_eq!(
        removed_body(&time, &banned_past),
        "You can't rejoin until it expires."
    );
    assert_eq!(
        removed_body(&time, &banned),
        "The ban is permanent: you can't rejoin."
    );
    assert!(removed_body(&time, &kicked).contains("invite link"));
    assert_eq!(
        removed_body(&time, &RemovalCause::Deleted),
        "The community no longer exists."
    );
}
