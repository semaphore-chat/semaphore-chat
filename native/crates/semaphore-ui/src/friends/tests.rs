//! The request dates, the 409 messages and the relationship chips, then the panel and the add
//! form in a window.

use super::panel::request_date;
use super::*;
use crate::dms::rig::rig;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{ErrorView, FriendRequestRow, FriendRow, LoadState, UserView};

const DAY: i64 = 24 * 60 * 60 * 1000;

fn user(key: &str) -> UserView {
    UserView {
        id: format!("u-{key}"),
        username: key.into(),
        display_name: None,
        avatar_file_id: None,
    }
}

fn request(key: &str, busy: bool) -> FriendRequestRow {
    FriendRequestRow {
        friendship_id: format!("r-{key}"),
        user: user(key),
        sent_at_ms: 0,
        busy,
    }
}

fn view() -> FriendsView {
    FriendsView {
        state: LoadState::Ready,
        friends: vec![
            FriendRow {
                friendship_id: "f-ava".into(),
                user: user("ava"),
                online: true,
                busy: false,
            },
            FriendRow {
                friendship_id: "f-ben".into(),
                user: user("ben"),
                online: false,
                busy: true,
            },
        ],
        incoming: vec![request("cleo", false), request("dev", true)],
        outgoing: vec![request("emma", false)],
    }
}

fn error(message: &str) -> ErrorView {
    ErrorView {
        code: "CONFLICT".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

#[test]
fn request_dates_read_like_the_web() {
    let now = 100 * DAY;
    let utc = crate::messages::TimeFormat::fixed(now);
    assert_eq!(request_date(&utc, now, now - 1000), "Today");
    assert_eq!(request_date(&utc, now, now - DAY - 1000), "Yesterday");
    assert_eq!(request_date(&utc, now, now - 3 * DAY), "3 days ago");
    // 1970-01-11 for 10 days after the epoch.
    assert_eq!(request_date(&utc, now, 10 * DAY), "1/11/1970");
}

#[test]
fn a_fixed_display_clock_decides_each_request_date() {
    let clock = PanelClock::fixed(100 * DAY);
    let now = clock.now_ms();
    // A minute, an hour and a day: one millisecond either side of the label.
    assert_eq!(
        request_date(&TimeFormat::fixed(now), now, now - 60_000),
        "Today"
    );
    assert_eq!(
        request_date(&TimeFormat::fixed(now), now, now - 3_600_000),
        "Today"
    );
    assert_eq!(
        request_date(&TimeFormat::fixed(now), now, now - DAY + 1),
        "Today"
    );
    assert_eq!(
        request_date(&TimeFormat::fixed(now), now, now - DAY),
        "Yesterday"
    );
}

#[test]
fn old_request_dates_are_written_in_the_users_zone() {
    use crate::messages::TimeFormat;
    use chrono::FixedOffset;

    // Zone minutes east of UTC, the instant, the local date, and the UTC date.
    let cases = [
        (9 * 60, 1_793_804_340_000, "11/4/2026", "11/4/2026"),
        (9 * 60, 1_793_804_460_000, "11/5/2026", "11/4/2026"),
        (-8 * 60, 1_793_865_540_000, "11/4/2026", "11/5/2026"),
        (-8 * 60, 1_793_865_660_000, "11/5/2026", "11/5/2026"),
        // 2026-12-31 15:30 UTC: New Year's Day in +09:00.
        (9 * 60, 1_798_731_000_000, "1/1/2027", "12/31/2026"),
        // 2026-11-05 18:31 UTC: 00:01 the 6th in +05:30.
        (5 * 60 + 30, 1_793_903_460_000, "11/6/2026", "11/5/2026"),
        // 2026-11-05 18:16 UTC: 00:01 the 6th in +05:45.
        (5 * 60 + 45, 1_793_902_560_000, "11/6/2026", "11/5/2026"),
    ];
    for (minutes, ms, local, utc_date) in cases {
        let zone = FixedOffset::east_opt(minutes * 60).expect("a zone");
        let time = TimeFormat {
            zone: Some(zone),
            now: PanelClock::fixed(ms + 8 * DAY),
        };
        assert_eq!(
            request_date(&time, ms + 8 * DAY, ms),
            local,
            "{minutes} minutes east"
        );
        assert_eq!(
            TimeFormat::fixed(ms).format_at(ms, "%-m/%-d/%Y"),
            utc_date,
            "{minutes} minutes east: the UTC date"
        );
    }
}

#[test]
fn conflicts_are_said_as_the_web_says_them() {
    assert_eq!(
        friendly_error(&error("Already friends with this user")),
        "You are already friends with this user."
    );
    assert_eq!(
        friendly_error(&error("Friend request already sent")),
        "You have already sent a friend request to this user."
    );
    assert_eq!(friendly_error(&error("Nope")), "Nope");
    assert_eq!(friendly_error(&error("")), "Failed to send friend request");
}

#[test]
fn everyone_already_known_gets_a_chip() {
    let tags = relationship_tags(&view());
    assert_eq!(tags.get("u-ava").map(|t| t.as_ref()), Some("Friends"));
    assert_eq!(
        tags.get("u-cleo").map(|t| t.as_ref()),
        Some("Request Received")
    );
    assert_eq!(tags.get("u-emma").map(|t| t.as_ref()), Some("Request Sent"));
    assert_eq!(tags.get("u-zed"), None);
}

fn panel(cx: &mut TestAppContext) -> crate::dms::rig::Rig<FriendsPanel, FriendsEvent> {
    rig(cx, 400., |_, cx| {
        let mut panel = FriendsPanel::new(cx);
        panel.set_view(view(), cx);
        panel
    })
}

#[gpui_kit::test]
fn a_friend_row_messages_them_and_its_menu_removes_them(cx: &mut TestAppContext) {
    let rig = panel(cx);
    rig.click(cx, "friend-f-ava");
    assert!(!rig.has(cx, "friend-menu"));
    rig.click(cx, "friend-more-f-ava");
    assert!(rig.has(cx, "friend-menu"), "the more button opens the menu");
    rig.click(cx, "friend-remove-f-ava");
    assert!(!rig.has(cx, "friend-menu"), "choosing closes it");
    assert_eq!(
        rig.events(),
        [
            FriendsEvent::Message {
                user_id: "u-ava".into()
            },
            FriendsEvent::Remove {
                friendship_id: "f-ava".into()
            }
        ]
    );
}

#[gpui_kit::test]
fn a_busy_friend_does_nothing(cx: &mut TestAppContext) {
    let rig = panel(cx);
    rig.click(cx, "friend-f-ben");
    rig.click(cx, "friend-more-f-ben");
    assert!(rig.events().is_empty());
    assert!(!rig.has(cx, "friend-menu"));
}

#[gpui_kit::test]
fn requests_accept_decline_and_cancel_by_friendship(cx: &mut TestAppContext) {
    let rig = panel(cx);
    // The tabs are clicked by id, as the slice rig does: `<tabs id>-<index>`.
    rig.click(cx, "friends-tabs-1");
    rig.click(cx, "request-accept-r-cleo");
    rig.click(cx, "request-decline-r-cleo");
    rig.click(cx, "request-accept-r-dev");
    rig.click(cx, "requests-tabs-1");
    rig.click(cx, "request-cancel-r-emma");
    assert_eq!(
        rig.events(),
        [
            FriendsEvent::Accept {
                friendship_id: "r-cleo".into()
            },
            FriendsEvent::Decline {
                friendship_id: "r-cleo".into()
            },
            FriendsEvent::Cancel {
                friendship_id: "r-emma".into()
            }
        ],
        "the busy request emits nothing"
    );
}

#[gpui_kit::test]
fn a_failed_panel_retries(cx: &mut TestAppContext) {
    let rig = panel(cx);
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_view(
                FriendsView {
                    state: LoadState::Failed {
                        error: error("down"),
                    },
                    ..FriendsView::default()
                },
                cx,
            )
        })
    });
    rig.click(cx, "friends-retry");
    rig.click(cx, "friends-add");
    assert_eq!(rig.events(), [FriendsEvent::Retry, FriendsEvent::AddFriend]);
}

#[gpui_kit::test]
fn the_form_sends_the_picked_user_and_never_a_known_one(cx: &mut TestAppContext) {
    let rig = rig(cx, 600., AddFriendForm::new);
    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| {
            form.set_friends(&view(), cx);
            let picker = form.picker.clone();
            picker.update(cx, |picker, cx| picker.query_changed("a", cx));
        })
    });
    cx.executor().advance_clock(crate::dms::picker::DEBOUNCE);
    cx.run_until_parked();
    assert_eq!(rig.events(), [AddFriendEvent::Search { query: "a".into() }]);
    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| {
            form.set_results("a", Ok(vec![user("ava"), user("zed")]), cx)
        })
    });
    rig.click(cx, "add-friend-user-u-ava");
    rig.click(cx, "add-friend-send");
    assert_eq!(
        rig.events().len(),
        1,
        "a friend can't be picked, so nothing to send"
    );
    rig.click(cx, "add-friend-user-u-zed");
    rig.click(cx, "add-friend-send");
    assert_eq!(
        rig.events().last(),
        Some(&AddFriendEvent::Send {
            user_id: "u-zed".into()
        })
    );
    rig.with(cx, |form, window, cx| {
        form.update(cx, |form, cx| {
            form.set_outcome(AddOutcome::Sent, window, cx)
        })
    });
    let picked = rig.with(cx, |form, _, cx| {
        form.read(cx).picker.read(cx).picked().len()
    });
    assert_eq!(picked, 0, "a sent request clears the pick");
}
