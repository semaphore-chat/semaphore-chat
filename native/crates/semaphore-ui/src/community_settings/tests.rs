//! The checks first, table by table (boundaries, empty, unicode, exactly at and just over each
//! limit), then which tab an op belongs to, then the tabs in a window: what each control sends.

use super::rules::*;
use super::*;
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{AdminActionKind, AdminActionOutcome, AdminActionState};
use semaphore_core::model::{
    AdminOp, ChannelDraft, ChannelKind, ChannelMove, ChannelPreset, ChannelRow, CommunityCaps,
    CommunityPatch, CommunitySettingsView, DraftFile, ErrorView, InviteDraft, InviteRow,
    InvitesView, LoadState, MemberList, MemberView, UserView,
};
use std::time::Duration;

fn file(mime: &str, bytes: usize) -> DraftFile {
    DraftFile {
        name: "f".into(),
        mime_type: mime.into(),
        bytes: vec![0; bytes],
    }
}

fn error(message: &str) -> ErrorView {
    ErrorView {
        code: "X".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

// ---- Lengths and names. ----

#[test]
fn lengths_count_utf16_units_as_the_web_does() {
    for (text, units) in [
        ("", 0),
        ("abc", 3),
        ("é", 1),
        ("e\u{301}", 2),
        ("\u{1f44d}", 2),
        ("\u{1f44d}\u{1f3fd}", 4),
        ("\u{4e2d}\u{6587}", 2),
    ] {
        assert_eq!(js_len(text), units, "{text:?}");
    }
}

#[test]
fn community_names_need_two_to_a_hundred_characters() {
    let cases: Vec<(String, Result<(), &str>)> = vec![
        ("".into(), Err("Community name is required")),
        ("   ".into(), Err("Community name is required")),
        (
            "a".into(),
            Err("Community name must be at least 2 characters"),
        ),
        (
            " a ".into(),
            Err("Community name must be at least 2 characters"),
        ),
        (
            "é".into(),
            Err("Community name must be at least 2 characters"),
        ),
        ("ab".into(), Ok(())),
        ("\u{1f44d}".into(), Ok(())),
        ("x".repeat(100), Ok(())),
        (format!("  {}  ", "x".repeat(100)), Ok(())),
        (
            "x".repeat(101),
            Err("Community name must be at most 100 characters"),
        ),
        ("\u{1f44d}".repeat(50), Ok(())),
        (
            "\u{1f44d}".repeat(51),
            Err("Community name must be at most 100 characters"),
        ),
    ];
    for (name, want) in cases {
        assert_eq!(
            check_community_name(&name),
            want.map_err(str::to_owned),
            "{name:?}"
        );
    }
}

#[test]
fn descriptions_stop_at_five_hundred() {
    for (text, ok) in [
        (String::new(), true),
        ("x".repeat(500), true),
        (format!(" {} ", "x".repeat(500)), true),
        ("x".repeat(501), false),
        ("\u{1f44d}".repeat(250), true),
        ("\u{1f44d}".repeat(251), false),
    ] {
        assert_eq!(
            check_description(&text).is_ok(),
            ok,
            "{} units",
            js_len(&text)
        );
    }
}

#[test]
fn channel_names_are_required_and_at_most_a_hundred() {
    for (name, ok) in [
        ("".to_owned(), false),
        ("  ".to_owned(), false),
        ("general".to_owned(), true),
        ("x".repeat(100), true),
        ("x".repeat(101), false),
        ("\u{4e2d}".repeat(100), true),
        ("\u{1f389}".repeat(51), false),
    ] {
        assert_eq!(check_channel_name(&name).is_ok(), ok, "{name:?}");
    }
}

#[test]
fn group_names_are_letters_digits_hyphens_and_underscores() {
    let pattern = "Group name can only contain letters, numbers, hyphens, and underscores";
    let cases: Vec<(String, Result<(), &str>)> = vec![
        ("".into(), Err("Group name is required")),
        (" ".into(), Err("Group name is required")),
        ("designers".into(), Ok(())),
        ("a".into(), Ok(())),
        ("-_".into(), Ok(())),
        ("Team_2-B".into(), Ok(())),
        ("night owls".into(), Err(pattern)),
        (" designers".into(), Err(pattern)),
        ("a!".into(), Err(pattern)),
        ("équipe".into(), Err(pattern)),
        ("\u{1f44d}".into(), Err(pattern)),
        ("x".repeat(50), Ok(())),
        (
            "x".repeat(51),
            Err("Group name must not exceed 50 characters"),
        ),
    ];
    for (name, want) in cases {
        assert_eq!(
            check_group_name(&name),
            want.map_err(str::to_owned),
            "{name:?}"
        );
    }
}

#[test]
fn emoji_shortcodes_follow_the_web_pattern() {
    for (typed, ok) in [
        ("", false),
        ("a", false),
        ("ab", true),
        ("a1", true),
        ("12", false),
        ("__", false),
        ("_a", true),
        ("AB", false),
        ("Party", false),
        ("a-b", false),
        ("a b", false),
        ("über", false),
        (":party_blob:", true),
        ("  shipit  ", true),
        ("::", false),
    ] {
        assert_eq!(check_emoji_name(typed).is_ok(), ok, "{typed:?}");
    }
    assert!(check_emoji_name(&"a".repeat(32)).is_ok(), "exactly 32");
    assert!(check_emoji_name(&"a".repeat(33)).is_err(), "33");
    assert_eq!(shortcode(" :party: "), "party");
}

#[test]
fn emoji_files_are_small_png_gif_or_webp() {
    for (mime, bytes, ok) in [
        ("image/png", 0, true),
        ("image/png", EMOJI_MAX_BYTES, true),
        ("image/png", EMOJI_MAX_BYTES + 1, false),
        ("image/gif", 1000, true),
        ("image/webp", 1000, true),
        ("image/jpeg", 1000, false),
        ("image/svg+xml", 10, false),
        ("", 10, false),
        ("IMAGE/PNG", 10, false),
    ] {
        assert_eq!(
            check_emoji_file(&file(mime, bytes)).is_ok(),
            ok,
            "{mime} {bytes}"
        );
    }
}

#[test]
fn sound_names_emoji_and_files_follow_the_server() {
    for (name, ok) in [
        ("".to_owned(), false),
        ("   ".to_owned(), false),
        ("Air horn".to_owned(), true),
        ("drum-roll_2".to_owned(), true),
        ("Applause!".to_owned(), false),
        ("café".to_owned(), false),
        ("x".repeat(50), true),
        ("x".repeat(51), false),
        (format!("  {}  ", "x".repeat(50)), true),
    ] {
        assert_eq!(check_sound_name(&name).is_ok(), ok, "{name:?}");
    }
    for (emoji, ok) in [
        ("".to_owned(), true),
        ("\u{1f4ef}".to_owned(), true),
        ("\u{1f44d}".repeat(8), true),
        (format!("{}a", "\u{1f44d}".repeat(8)), false),
        ("\u{1f44d}\u{1f3fd}".repeat(4), true),
        ("\u{1f44d}\u{1f3fd}".repeat(5), false),
        ("x".repeat(16), true),
        ("x".repeat(17), false),
    ] {
        assert_eq!(check_sound_emoji(&emoji).is_ok(), ok, "{emoji:?}");
    }
    for (mime, bytes, ok) in [
        ("audio/mpeg", SOUND_MAX_BYTES, true),
        ("audio/mpeg", SOUND_MAX_BYTES + 1, false),
        ("audio/wav", 10, true),
        ("audio/ogg", 10, true),
        ("audio/webm", 10, true),
        ("audio/aac", 10, true),
        ("audio/flac", 10, false),
        ("video/mp4", 10, false),
        ("", 0, false),
    ] {
        assert_eq!(
            check_sound_file(&file(mime, bytes)).is_ok(),
            ok,
            "{mime} {bytes}"
        );
    }
    assert_eq!(
        check_sound_file(&file("audio/flac", SOUND_MAX_BYTES + 1)),
        Err("Sound is too large. Maximum size is 1MB.".into()),
        "size is said first, as the web does"
    );
}

#[test]
fn a_picked_sound_names_itself_after_its_file() {
    for (file_name, want) in [
        ("applause.mp3".to_owned(), "applause".to_owned()),
        ("a.b.c".to_owned(), "a.b".to_owned()),
        (".hidden".to_owned(), ".hidden".to_owned()),
        ("noext".to_owned(), "noext".to_owned()),
        ("".to_owned(), "".to_owned()),
        (format!("{}.wav", "x".repeat(60)), "x".repeat(50)),
        (
            format!("{}.wav", "\u{1f44d}".repeat(30)),
            "\u{1f44d}".repeat(25),
        ),
        (
            format!("{}é.wav", "x".repeat(49)),
            format!("{}é", "x".repeat(49)),
        ),
        (format!("{}\u{1f44d}.wav", "x".repeat(49)), "x".repeat(49)),
    ] {
        assert_eq!(sound_name_from_file(&file_name), want, "{file_name:?}");
    }
}

#[test]
fn webhook_names_are_one_to_eighty() {
    for (name, ok) in [
        ("".to_owned(), false),
        ("  ".to_owned(), false),
        ("CI Bot".to_owned(), true),
        ("x".repeat(80), true),
        ("x".repeat(81), false),
        ("\u{1f916}".repeat(40), true),
        ("\u{1f916}".repeat(41), false),
    ] {
        assert_eq!(check_webhook_name(&name).is_ok(), ok, "{name:?}");
    }
}

#[test]
fn community_images_are_checked_against_the_server_limit() {
    let max = 1024 * 1024;
    for (mime, bytes, limit, ok) in [
        ("image/png", 10, None, true),
        ("image/jpeg", max, Some(max as u64), true),
        ("image/gif", max + 1, Some(max as u64), false),
        ("image/webp", 50 * max, None, true),
        ("image/bmp", 10, None, false),
        ("application/pdf", 10, Some(max as u64), false),
    ] {
        assert_eq!(
            check_image(&file(mime, bytes), limit).is_ok(),
            ok,
            "{mime} {bytes}"
        );
    }
    assert_eq!(
        check_image(&file("image/png", 3 * max), Some(max as u64)),
        Err("That image is 3 MB; the limit is 1 MB".into())
    );
    assert_eq!(size_label(0), "0 KB");
    assert_eq!(size_label(1), "1 KB");
    assert_eq!(size_label(256 * 1024), "256 KB");
    assert_eq!(size_label(1536 * 1024), "1.5 MB");
}

// ---- Invites. ----

#[test]
fn max_uses_is_empty_or_a_whole_number_from_one() {
    let cases: Vec<(&str, Result<Option<u32>, &str>)> = vec![
        ("", Ok(None)),
        ("   ", Ok(None)),
        ("1", Ok(Some(1))),
        (" 25 ", Ok(Some(25))),
        ("007", Ok(Some(7))),
        ("4294967295", Ok(Some(u32::MAX))),
        ("4294967296", Err("Max uses is too large")),
        ("0", Err("Max uses must be at least 1")),
        ("00", Err("Max uses must be at least 1")),
        ("-1", Err("Max uses must be a whole number")),
        ("+3", Err("Max uses must be a whole number")),
        ("1.5", Err("Max uses must be a whole number")),
        ("1e3", Err("Max uses must be a whole number")),
        ("ten", Err("Max uses must be a whole number")),
        ("\u{663}", Err("Max uses must be a whole number")),
        ("1 0", Err("Max uses must be a whole number")),
    ];
    for (typed, want) in cases {
        assert_eq!(
            parse_max_uses(typed),
            want.map_err(str::to_owned),
            "{typed:?}"
        );
    }
}

#[test]
fn expiry_presets_count_from_now() {
    const HOUR: i64 = 3_600_000;
    let now = 1_000_000;
    for (preset, want) in [
        (ExpiryPreset::Never, None),
        (ExpiryPreset::Hour, Some(now + HOUR)),
        (ExpiryPreset::Day, Some(now + 24 * HOUR)),
        (ExpiryPreset::Week, Some(now + 7 * 24 * HOUR)),
        (ExpiryPreset::Month, Some(now + 30 * 24 * HOUR)),
    ] {
        assert_eq!(preset.valid_until(now), want, "{preset:?}");
    }
    assert_eq!(ExpiryPreset::Day.valid_until(i64::MAX - 1), Some(i64::MAX));
}

fn invite(uses: u32, max: Option<u32>, until: Option<i64>, disabled: bool) -> InviteRow {
    InviteRow {
        code: "c".into(),
        uses,
        max_uses: max,
        valid_until_ms: until,
        disabled,
        created_at_ms: 0,
    }
}

#[test]
fn an_invite_is_expired_used_up_disabled_or_active() {
    let now = 10_000;
    use InviteStatus::*;
    for (row, want) in [
        (invite(0, None, None, false), Active),
        (invite(9, Some(10), Some(now + 1), false), Active),
        (invite(0, None, Some(now), false), Active),
        (invite(0, None, Some(now - 1), false), Expired),
        (invite(10, Some(10), None, false), MaxedOut),
        (invite(11, Some(10), None, false), MaxedOut),
        (invite(5, Some(0), None, false), Active),
        (invite(0, None, None, true), Disabled),
        (invite(10, Some(10), Some(now - 1), true), Expired),
        (invite(10, Some(10), None, true), MaxedOut),
        (invite(u32::MAX, None, None, false), Active),
    ] {
        assert_eq!(invite_status(&row, now), want, "{row:?}");
    }
    assert_eq!(uses_label(&invite(3, Some(10), None, false)), "Uses: 3/10");
    assert_eq!(uses_label(&invite(3, None, None, false)), "Uses: 3");
    assert_eq!(uses_label(&invite(3, Some(0), None, false)), "Uses: 3");
}

#[test]
fn dates_are_written_in_the_users_zone() {
    use crate::messages::TimeFormat;
    use chrono::FixedOffset;

    // Zone minutes east of UTC, the instant, the local date, and the UTC date.
    let cases = [
        // 2026-11-04 14:59 UTC: 23:59 the same day in +09:00.
        (9 * 60, 1_793_804_340_000, "Nov 4, 2026", "Nov 4, 2026"),
        // 2026-11-04 15:01 UTC: already the 5th in +09:00.
        (9 * 60, 1_793_804_460_000, "Nov 5, 2026", "Nov 4, 2026"),
        // 2026-11-05 07:59 UTC: still the 4th in -08:00.
        (-8 * 60, 1_793_865_540_000, "Nov 4, 2026", "Nov 5, 2026"),
        // 2026-11-05 08:01 UTC: the 5th in -08:00.
        (-8 * 60, 1_793_865_660_000, "Nov 5, 2026", "Nov 5, 2026"),
        // 2026-12-31 15:30 UTC: New Year's Day in +09:00.
        (9 * 60, 1_798_731_000_000, "Jan 1, 2027", "Dec 31, 2026"),
        // 2026-11-05 18:31 UTC: 00:01 the 6th in +05:30.
        (5 * 60 + 30, 1_793_903_460_000, "Nov 6, 2026", "Nov 5, 2026"),
        // 2026-11-05 18:16 UTC: 00:01 the 6th in +05:45.
        (5 * 60 + 45, 1_793_902_560_000, "Nov 6, 2026", "Nov 5, 2026"),
    ];
    for (minutes, ms, local, utc) in cases {
        let zone = FixedOffset::east_opt(minutes * 60).expect("a zone");
        let time = TimeFormat {
            zone: Some(zone),
            now_ms: Some(ms),
        };
        assert_eq!(date_label(&time, ms), local, "{minutes} minutes east");
        assert_eq!(
            TimeFormat::fixed(ms).format_at(ms, "%b %-d, %Y"),
            utc,
            "{minutes} minutes east: the UTC date"
        );
    }
}

#[test]
fn invite_links_use_the_web_hash_route() {
    for (base, want) in [
        (
            "https://chat.example.com",
            "https://chat.example.com/#/join/aB3",
        ),
        (
            "https://chat.example.com/",
            "https://chat.example.com/#/join/aB3",
        ),
        (
            "  https://chat.example.com//  ",
            "https://chat.example.com/#/join/aB3",
        ),
        ("", "/#/join/aB3"),
    ] {
        assert_eq!(invite_url(base, "aB3"), want, "{base:?}");
    }
}

#[test]
fn deleting_needs_the_exact_name() {
    for (typed, name, ok) in [
        ("Northwind", "Northwind", true),
        ("  Northwind  ", "Northwind", true),
        ("northwind", "Northwind", false),
        ("Northwin", "Northwind", false),
        ("", "Northwind", false),
        ("", "", false),
        ("  ", "  ", false),
        ("Café", "Café", true),
        ("Cafe", "Café", false),
        ("Cafe\u{301}", "Caf\u{e9}", false),
        ("\u{1f680} Launch", "\u{1f680} Launch", true),
    ] {
        assert_eq!(confirms_name(typed, name), ok, "{typed:?} vs {name:?}");
    }
}

// ---- Tabs and caps. ----

#[test]
fn tabs_lock_without_their_permission() {
    let none = CommunityCaps::default();
    for tab in CommunityTab::ALL {
        let open = matches!(tab, CommunityTab::Overview | CommunityTab::Invites);
        assert_eq!(tab.locked(&none).is_none(), open, "{tab:?}");
    }
    let caps = CommunityCaps {
        delete_channel: true,
        read_sounds: true,
        ..CommunityCaps::default()
    };
    assert!(CommunityTab::Channels.locked(&caps).is_none());
    assert!(CommunityTab::Soundboard.locked(&caps).is_none());
    assert_eq!(
        CommunityTab::Members.locked(&caps),
        Some("You need the \u{201c}View members\u{201d} permission".into())
    );
    assert_eq!(first_open_tab(&none), CommunityTab::Overview);
}

// ---- Each change's own state. ----

fn entry(
    kind: AdminActionKind,
    target: Option<&str>,
    busy: bool,
    error_message: Option<&str>,
) -> AdminActionState {
    AdminActionState {
        action: act(kind, target),
        busy,
        upload: None,
        error: error_message.map(error),
    }
}

fn op_of(actions: Vec<AdminActionState>) -> AdminOp {
    AdminOp {
        busy: actions.iter().any(|state| state.busy),
        actions,
        ..AdminOp::default()
    }
}

#[test]
fn each_change_reads_only_its_own_entry() {
    use AdminActionKind::{DeleteChannel, MoveChannel};
    let op = op_of(vec![
        entry(MoveChannel, Some("a"), false, Some("can't move")),
        entry(DeleteChannel, Some("b"), true, None),
    ]);
    let (move_a, delete_b) = (act(MoveChannel, Some("a")), act(DeleteChannel, Some("b")));
    assert!(running(&op, &delete_b));
    assert!(!running(&op, &move_a));
    assert_eq!(
        failure(&op, &move_a).map(|e| e.message.as_str()),
        Some("can't move")
    );
    assert_eq!(failure(&op, &delete_b), None, "running, not failed");
    assert_eq!(
        failure(&op, &act(MoveChannel, Some("b"))),
        None,
        "another row"
    );
    assert!(!running(&op, &act(DeleteChannel, Some("a"))));
    assert_eq!(running_of(&op, &[DeleteChannel]).count(), 1);
    assert_eq!(running_of(&op, &[MoveChannel]).count(), 0);
    assert_eq!(
        failure_of(&op, &[MoveChannel, DeleteChannel]).map(|(action, _)| action.clone()),
        Some(move_a)
    );
    assert_eq!(failure_of(&op, &[DeleteChannel]), None);
    assert_eq!(failure_of(&AdminOp::default(), &[DeleteChannel]), None);
}

/// An op whose `finished` holds these ends, as (kind, target, seq, error).
fn ended(ends: &[(AdminActionKind, Option<&str>, u64, Option<&str>)]) -> AdminOp {
    AdminOp {
        finished: ends
            .iter()
            .map(|(kind, target, seq, message)| AdminActionOutcome {
                action: act(*kind, *target),
                seq: *seq,
                error: message.map(error),
            })
            .collect(),
        ..AdminOp::default()
    }
}

#[test]
fn a_change_ends_when_core_records_its_own_end() {
    use AdminActionKind::{AddCustomEmoji as Add, DeleteCustomEmoji as Delete};
    let running = op_of(vec![entry(Add, None, true, None)]);
    let mut running_after_old = running.clone();
    running_after_old.finished = ended(&[(Add, None, 3, Some("old"))]).finished;
    // (op when sent, ops seen in order, outcome after the last)
    let cases: Vec<(&str, AdminOp, Vec<AdminOp>, Outcome)> = vec![
        (
            "not started",
            AdminOp::default(),
            vec![AdminOp::default()],
            Outcome::Waiting,
        ),
        (
            "running",
            AdminOp::default(),
            vec![running.clone()],
            Outcome::Waiting,
        ),
        (
            "start and end in one batch: never seen running",
            AdminOp::default(),
            vec![ended(&[(Add, None, 1, None)])],
            Outcome::Succeeded,
        ),
        (
            "ended after running",
            AdminOp::default(),
            vec![running.clone(), ended(&[(Add, None, 4, None)])],
            Outcome::Succeeded,
        ),
        (
            "failed",
            AdminOp::default(),
            vec![running.clone(), ended(&[(Add, None, 2, Some("no"))])],
            Outcome::Failed,
        ),
        (
            "refused before it was sent",
            AdminOp::default(),
            vec![ended(&[(Add, None, 1, Some("too big"))])],
            Outcome::Failed,
        ),
        (
            "another action ending isn't this one's",
            AdminOp::default(),
            vec![ended(&[(Delete, Some("e1"), 5, None)])],
            Outcome::Waiting,
        ),
        (
            "the same kind on another target isn't this one's",
            AdminOp::default(),
            vec![ended(&[(Add, Some("x"), 5, None)])],
            Outcome::Waiting,
        ),
        (
            "an old failure, sent again: not this one's",
            running_after_old.clone(),
            vec![running_after_old.clone()],
            Outcome::Waiting,
        ),
        (
            "retried after a failure: its own success",
            running_after_old.clone(),
            vec![ended(&[(Add, None, 3, Some("old")), (Add, None, 9, None)])],
            Outcome::Succeeded,
        ),
        (
            "two overlapping: the other's end first, then its own",
            AdminOp::default(),
            vec![
                ended(&[(Delete, Some("e1"), 2, None)]),
                ended(&[(Delete, Some("e1"), 2, None), (Add, None, 3, Some("no"))]),
            ],
            Outcome::Failed,
        ),
    ];
    for (name, before, seen, want) in cases {
        let mut pending = Pending::new(act(Add, None), &before);
        let mut last = Outcome::Waiting;
        for op in &seen {
            last = pending.observe(op);
        }
        assert_eq!(last, want, "{name}");
    }
}

// ---- The tabs in a window. ----

fn caps() -> CommunityCaps {
    CommunityCaps {
        update_community: true,
        delete_community: true,
        create_channel: true,
        update_channel: true,
        delete_channel: true,
        read_members: true,
        add_members: true,
        assign_roles: true,
        kick: true,
        create_invite: true,
        delete_invite: true,
        ..CommunityCaps::default()
    }
}

fn settings() -> CommunitySettingsView {
    CommunitySettingsView {
        state: LoadState::Ready,
        community_id: "c1".into(),
        name: "Northwind".into(),
        description: Some("Makers".into()),
        ..CommunitySettingsView::default()
    }
}

fn overview(cx: &mut TestAppContext, caps: CommunityCaps) -> Rig<OverviewTab, OverviewEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut tab = OverviewTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_view(settings(), window, cx);
        tab
    })
}

#[gpui_kit::test]
fn update_sends_only_what_changed(cx: &mut TestAppContext) {
    let rig = overview(cx, caps());
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| {
            tab.preset(" Northwind Guild ", "Makers", window, cx)
        })
    });
    rig.click(cx, "community-save");
    assert_eq!(
        rig.events(),
        [OverviewEvent::Save {
            patch: Box::new(CommunityPatch {
                name: Some("Northwind Guild".into()),
                ..CommunityPatch::default()
            })
        }]
    );
}

#[gpui_kit::test]
fn an_invalid_or_unchanged_form_sends_nothing(cx: &mut TestAppContext) {
    let rig = overview(cx, caps());
    rig.click(cx, "community-save");
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| {
            tab.preset("N", "Makers", window, cx);
            tab.submit(cx);
        })
    });
    assert!(rig.events().is_empty());
}

#[gpui_kit::test]
fn overview_without_the_right_is_read_only(cx: &mut TestAppContext) {
    let rig = overview(
        cx,
        CommunityCaps {
            update_community: false,
            ..caps()
        },
    );
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| {
            tab.preset("Something else", "", window, cx);
            tab.submit(cx);
        })
    });
    assert!(rig.events().is_empty());
    assert!(rig.has(cx, "community-save-locked"));
}

#[gpui_kit::test]
fn delete_waits_for_the_typed_name(cx: &mut TestAppContext) {
    let rig = overview(cx, caps());
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| tab.open_delete("", window, cx))
    });
    assert!(rig.has(cx, "community-delete-confirm"));
    rig.click(cx, "community-delete-confirm");
    assert!(rig.events().is_empty(), "nothing typed");
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| tab.open_delete("northwind", window, cx))
    });
    rig.click(cx, "community-delete-confirm");
    assert!(rig.events().is_empty(), "wrong case");
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| tab.open_delete("Northwind", window, cx))
    });
    rig.click(cx, "community-delete-confirm");
    assert_eq!(rig.events(), [OverviewEvent::Delete]);
}

fn channel(id: &str, kind: ChannelKind, position: i32, private: bool) -> ChannelRow {
    ChannelRow {
        id: id.into(),
        community_id: "c1".into(),
        name: id.into(),
        kind,
        is_private: private,
        position,
        unread_count: 0,
        mention_count: 0,
        voice_users: Vec::new(),
        slowmode_seconds: 30,
        permissions: None,
        preset: ChannelPreset::Normal,
    }
}

fn channels_rig(cx: &mut TestAppContext, caps: CommunityCaps) -> Rig<ChannelsTab, ChannelsEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut tab = ChannelsTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_channels(
            LoadState::Ready,
            vec![
                channel("general", ChannelKind::Text, 0, false),
                channel("staff", ChannelKind::Text, 1, true),
                channel("lounge", ChannelKind::Voice, 2, false),
            ],
            cx,
        );
        tab
    })
}

#[gpui_kit::test]
fn channels_move_within_their_group(cx: &mut TestAppContext) {
    let rig = channels_rig(cx, caps());
    rig.click(cx, "channel-up-general");
    rig.click(cx, "channel-down-lounge");
    assert!(rig.events().is_empty(), "the ends don't move");
    rig.click(cx, "channel-down-general");
    assert_eq!(
        rig.events(),
        [ChannelsEvent::Move {
            channel_id: "general".into(),
            direction: ChannelMove::Down
        }]
    );
    rig.clear();
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| {
            tab.set_op(
                op_of(vec![entry(
                    AdminActionKind::MoveChannel,
                    Some("general"),
                    true,
                    None,
                )]),
                cx,
            )
        })
    });
    rig.click(cx, "channel-up-staff");
    assert!(rig.events().is_empty(), "one move at a time");
}

#[gpui_kit::test]
fn creating_a_channel_closes_its_dialog_once_done(cx: &mut TestAppContext) {
    let rig = channels_rig(cx, caps());
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| {
            tab.open_create(" design ", ChannelKind::Voice, true, window, cx)
        })
    });
    rig.click(cx, "channel-create-submit");
    assert_eq!(
        rig.events(),
        [ChannelsEvent::Create(ChannelDraft {
            name: "design".into(),
            kind: ChannelKind::Voice,
            is_private: true,
            slowmode_seconds: 0,
        })]
    );
    let create = |busy, message| {
        op_of(vec![entry(
            AdminActionKind::CreateChannel,
            None,
            busy,
            message,
        )])
    };
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| tab.set_op(create(true, None), cx))
    });
    assert!(rig.has(cx, "channel-create-submit"), "open while it runs");
    // Another row's move failing doesn't close or touch it.
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| {
            let mut op = create(true, None);
            op.actions.push(entry(
                AdminActionKind::MoveChannel,
                Some("staff"),
                false,
                Some("no"),
            ));
            tab.set_op(op, cx)
        })
    });
    assert!(rig.has(cx, "channel-create-submit"));
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| {
            tab.set_op(
                ended(&[(AdminActionKind::CreateChannel, None, 7, None)]),
                cx,
            )
        })
    });
    assert!(!rig.has(cx, "channel-create-submit"));
}

#[gpui_kit::test]
fn a_failed_create_keeps_its_dialog_and_says_why(cx: &mut TestAppContext) {
    let rig = channels_rig(cx, caps());
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| {
            tab.open_create("general", ChannelKind::Text, false, window, cx)
        })
    });
    rig.click(cx, "channel-create-submit");
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| {
            tab.set_op(
                op_of(vec![entry(
                    AdminActionKind::CreateChannel,
                    None,
                    false,
                    Some("taken"),
                )]),
                cx,
            )
        })
    });
    assert!(rig.has(cx, "channel-create-submit"));
}

#[gpui_kit::test]
fn editing_renames_and_keeps_the_rest(cx: &mut TestAppContext) {
    let rig = channels_rig(cx, caps());
    rig.click(cx, "channel-edit-staff");
    assert_eq!(
        rig.events(),
        [ChannelsEvent::OpenEdit {
            channel_id: "staff".into()
        }]
    );
    rig.clear();
    rig.click(cx, "channel-edit-submit");
    assert_eq!(
        rig.events(),
        [ChannelsEvent::Update {
            channel_id: "staff".into(),
            draft: ChannelDraft {
                name: "staff".into(),
                kind: ChannelKind::Text,
                is_private: true,
                slowmode_seconds: 30,
            }
        }]
    );
}

#[gpui_kit::test]
fn channel_actions_without_the_right_send_nothing(cx: &mut TestAppContext) {
    let rig = channels_rig(cx, CommunityCaps::default());
    for id in [
        "channel-down-general",
        "channel-edit-general",
        "channel-delete-general",
        "channel-create",
    ] {
        rig.click(cx, id);
    }
    assert!(rig.events().is_empty());
    assert!(rig.has(cx, "channel-create-locked"));
    assert!(rig.has(cx, "channel-edit-general-locked"));
}

#[gpui_kit::test]
fn deleting_a_channel_asks_first(cx: &mut TestAppContext) {
    let rig = channels_rig(cx, caps());
    rig.click(cx, "channel-delete-lounge");
    assert!(rig.events().is_empty());
    rig.click(cx, "channel-delete-confirm");
    assert_eq!(
        rig.events(),
        [ChannelsEvent::Delete {
            channel_id: "lounge".into()
        }]
    );
}

fn user(id: &str) -> UserView {
    UserView {
        id: id.into(),
        username: id.into(),
        display_name: None,
        avatar_file_id: None,
    }
}

fn members_rig(cx: &mut TestAppContext, caps: CommunityCaps) -> Rig<MembersTab, MembersEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut tab = MembersTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_me(Some("me".into()), cx);
        tab.set_members(
            Some(MemberList {
                members: ["me", "ana"]
                    .into_iter()
                    .map(|id| MemberView {
                        user: user(id),
                        status: None,
                        online: false,
                        display_role: None,
                        joined_at_ms: Some(1_793_491_200_000),
                    })
                    .collect(),
                truncated: false,
            }),
            cx,
        );
        tab
    })
}

#[gpui_kit::test]
fn member_rows_open_the_other_lanes_dialogs(cx: &mut TestAppContext) {
    let rig = members_rig(cx, caps());
    rig.click(cx, "member-roles-ana");
    rig.click(cx, "member-moderate-ana");
    rig.click(cx, "member-moderate-me");
    assert_eq!(
        rig.events(),
        [
            MembersEvent::ManageRoles {
                user_id: "ana".into()
            },
            MembersEvent::Moderate {
                user_id: "ana".into()
            },
        ],
        "not on my own row"
    );
    let rig = members_rig(cx, CommunityCaps::default());
    rig.click(cx, "member-roles-ana");
    rig.click(cx, "member-moderate-ana");
    assert!(rig.events().is_empty());
    assert!(rig.has(cx, "members-add-locked"));
}

#[gpui_kit::test]
fn search_waits_for_typing_to_stop_then_adds(cx: &mut TestAppContext) {
    let rig = members_rig(cx, caps());
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| {
            tab.query_changed("no", cx);
            tab.query_changed("nova", cx);
        })
    });
    assert!(rig.events().is_empty());
    cx.executor().advance_clock(Duration::from_millis(350));
    cx.run_until_parked();
    assert_eq!(
        rig.events(),
        [MembersEvent::Search {
            query: "nova".into()
        }]
    );
    rig.clear();
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| {
            tab.set_search_results("nova", Ok(vec![user("nova")]), cx)
        })
    });
    rig.click(cx, "member-add-nova");
    assert_eq!(
        rig.events(),
        [MembersEvent::Add {
            user_id: "nova".into()
        }]
    );
    for op in [
        op_of(vec![entry(
            AdminActionKind::AddMember,
            Some("nova"),
            true,
            None,
        )]),
        ended(&[(AdminActionKind::AddMember, Some("nova"), 1, None)]),
    ] {
        rig.with(cx, |view, _, cx| {
            view.update(cx, |tab, cx| tab.set_op(op, cx))
        });
    }
    rig.clear();
    rig.click(cx, "member-add-nova");
    assert!(rig.events().is_empty(), "added already");
}

fn invites_rig(cx: &mut TestAppContext, caps: CommunityCaps) -> Rig<InvitesTab, InvitesEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut tab = InvitesTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_clock(crate::panel::PanelClock::fixed(1_000), cx);
        tab.set_link_base("https://chat.example.com/", cx);
        tab.set_view(
            InvitesView {
                state: LoadState::Ready,
                community_id: "c1".into(),
                invites: vec![invite(0, None, None, false)],
                ..InvitesView::default()
            },
            cx,
        );
        tab
    })
}

#[gpui_kit::test]
fn an_invite_goes_out_with_its_limit_and_expiry(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, caps());
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| {
            tab.open_create("0", ExpiryPreset::Never, true, window, cx)
        })
    });
    rig.click(cx, "invite-create-submit");
    assert!(rig.events().is_empty(), "0 uses");
    rig.with(cx, |view, window, cx| {
        view.update(cx, |tab, cx| {
            tab.open_create(" 5 ", ExpiryPreset::Never, true, window, cx)
        })
    });
    rig.click(cx, "invite-expiry-hour");
    rig.click(cx, "invite-create-submit");
    assert_eq!(
        rig.events(),
        [InvitesEvent::Create(InviteDraft {
            max_uses: Some(5),
            valid_until_ms: Some(1_000 + 3_600_000),
        })]
    );
}

#[gpui_kit::test]
fn copying_an_invite_puts_its_link_on_the_clipboard(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, caps());
    rig.click(cx, "invite-copy-c");
    assert_eq!(
        cx.read_from_clipboard().and_then(|item| item.text()),
        Some("https://chat.example.com/#/join/c".into())
    );
    let rig = invites_rig(
        cx,
        CommunityCaps {
            create_invite: false,
            delete_invite: false,
            ..caps()
        },
    );
    rig.click(cx, "invite-create");
    rig.click(cx, "invite-delete-c");
    assert!(rig.events().is_empty());
    assert!(rig.has(cx, "invite-create-locked"));
}

#[gpui_kit::test]
fn the_shell_opens_the_first_tab_these_caps_allow(cx: &mut TestAppContext) {
    let rig: Rig<CommunitySettingsScreen, CommunityShellEvent> = rig(cx, 1200., |window, cx| {
        CommunitySettingsScreen::new("c1", window, cx)
    });
    rig.with(cx, |view, _, cx| {
        view.update(cx, |screen, cx| {
            screen.set_permissions(
                semaphore_core::model::CommunityPermissionsView {
                    state: LoadState::Ready,
                    caps: CommunityCaps {
                        read_members: true,
                        ..CommunityCaps::default()
                    },
                    ..Default::default()
                },
                cx,
            )
        })
    });
    assert_eq!(
        rig.with(cx, |view, _, cx| view.read(cx).tab()),
        CommunityTab::Overview
    );
    rig.click(cx, "community-tab-channels");
    assert!(rig.events().is_empty(), "locked");
    rig.click(cx, "community-tab-members");
    assert_eq!(
        rig.events(),
        [CommunityShellEvent::TabChanged(CommunityTab::Members)]
    );
    assert!(rig.has(cx, "community-members"));
}

#[gpui_kit::test]
fn overlapping_changes_show_on_their_own_rows(cx: &mut TestAppContext) {
    let rig = channels_rig(cx, caps());
    rig.with(cx, |view, _, cx| {
        view.update(cx, |tab, cx| {
            tab.set_op(
                op_of(vec![
                    entry(
                        AdminActionKind::MoveChannel,
                        Some("general"),
                        false,
                        Some("can't move"),
                    ),
                    entry(AdminActionKind::DeleteChannel, Some("lounge"), true, None),
                ]),
                cx,
            )
        })
    });
    assert!(
        rig.has(cx, "channel-error-general"),
        "the move's failure on its row"
    );
    assert!(
        !rig.has(cx, "channel-error-lounge"),
        "the running delete has no error"
    );
    assert!(!rig.has(cx, "channel-error-staff"));
    assert!(rig.has(cx, "channel-busy-lounge"));
    assert!(!rig.has(cx, "channel-busy-general"));
    rig.click(cx, "channel-delete-lounge");
    assert!(
        !rig.has(cx, "channel-delete-confirm"),
        "already being deleted"
    );
    rig.click(cx, "channel-delete-staff");
    assert!(
        rig.has(cx, "channel-delete-confirm"),
        "other rows still delete"
    );
}

#[test]
fn the_settings_entry_needs_a_change_not_just_reading() {
    let none = CommunityCaps::default();
    assert!(!opens_settings(&none));
    // What the default Member role holds: reading only.
    let reader = CommunityCaps {
        read_members: true,
        read_roles: true,
        read_alias_groups: true,
        read_sounds: true,
        delete_invite: true,
        ..none
    };
    assert!(!opens_settings(&reader));
    type Grant = fn(&mut CommunityCaps);
    let one: [(&str, Grant); 27] = [
        ("update_community", |c| c.update_community = true),
        ("delete_community", |c| c.delete_community = true),
        ("create_channel", |c| c.create_channel = true),
        ("update_channel", |c| c.update_channel = true),
        ("delete_channel", |c| c.delete_channel = true),
        ("manage_private_members", |c| {
            c.manage_private_members = true
        }),
        ("manage_channel_permissions", |c| {
            c.manage_channel_permissions = true
        }),
        ("create_role", |c| c.create_role = true),
        ("update_role", |c| c.update_role = true),
        ("delete_role", |c| c.delete_role = true),
        ("assign_roles", |c| c.assign_roles = true),
        ("add_members", |c| c.add_members = true),
        ("create_alias_group", |c| c.create_alias_group = true),
        ("update_alias_group", |c| c.update_alias_group = true),
        ("delete_alias_group", |c| c.delete_alias_group = true),
        ("manage_alias_members", |c| c.manage_alias_members = true),
        ("manage_emoji", |c| c.manage_emoji = true),
        ("create_sound", |c| c.create_sound = true),
        ("delete_sound", |c| c.delete_sound = true),
        ("manage_webhooks", |c| c.manage_webhooks = true),
        ("create_invite", |c| c.create_invite = true),
        ("ban", |c| c.ban = true),
        ("unban", |c| c.unban = true),
        ("kick", |c| c.kick = true),
        ("timeout", |c| c.timeout = true),
        ("view_bans", |c| c.view_bans = true),
        ("view_moderation_log", |c| c.view_moderation_log = true),
    ];
    for (name, set) in one {
        let mut caps = reader;
        set(&mut caps);
        assert!(opens_settings(&caps), "{name}");
    }
}
