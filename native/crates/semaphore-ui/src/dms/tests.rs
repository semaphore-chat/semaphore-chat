//! What rows say, the user picker's model and the create rules, then the views in a window:
//! clicks and the search debounce on the test clock.

use super::names::*;
use super::picker::{DEBOUNCE, Found, PickerModel};
use super::rig::rig;
use super::*;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{DmPreview, LoadState, UserView};
use std::time::Duration;

fn user(key: &str, display: Option<&str>) -> UserView {
    UserView {
        id: format!("u-{key}"),
        username: key.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

fn group(members: &[&str]) -> DmRow {
    DmRow {
        id: "g".into(),
        is_group: true,
        members: members.iter().map(|key| user(key, None)).collect(),
        ..DmRow::default()
    }
}

fn one(key: &str, display: Option<&str>) -> DmRow {
    DmRow {
        id: format!("dm-{key}"),
        members: vec![user(key, display)],
        ..DmRow::default()
    }
}

// ---- What a row says. ----

#[test]
fn a_one_to_one_is_named_after_the_other_person() {
    assert_eq!(dm_name(&one("ava", Some("Ava Chen"))).full, "Ava Chen");
    assert_eq!(
        dm_name(&one("ben", None)).full,
        "ben",
        "the username without a display name"
    );
    assert_eq!(
        dm_name(&one("ben", Some("  "))).full,
        "ben",
        "a blank display name"
    );
}

#[test]
fn a_group_lists_up_to_three_names_then_folds_the_rest() {
    let three = dm_name(&group(&["a", "b", "c"]));
    assert_eq!((three.names.as_str(), three.extra), ("a, b, c", 0));
    let five = dm_name(&group(&["a", "b", "c", "d", "e"]));
    assert_eq!(five.names, "a, b");
    assert_eq!(five.extra, 3);
    assert_eq!(five.full, "a, b, c, d, e");
    assert_eq!(dm_name(&group(&[])).full, "Group Chat");
}

#[test]
fn a_group_name_wins_over_its_members() {
    let mut row = group(&["a", "b", "c", "d"]);
    row.name = Some("Launch crew".into());
    let name = dm_name(&row);
    assert_eq!((name.names.as_str(), name.extra), ("Launch crew", 0));
    assert_eq!(dm_title(&row), "Launch crew");
}

#[test]
fn the_composer_names_the_person_or_the_group() {
    assert_eq!(
        dm_placeholder(&one("ava", Some("Ava Chen"))),
        "Message @Ava Chen"
    );
    assert_eq!(dm_placeholder(&group(&["a", "b"])), "Message the group");
    let mut named = group(&["a", "b"]);
    named.name = Some("Weekend plan".into());
    assert_eq!(dm_placeholder(&named), "Message Weekend plan");
    named.name = Some("  ".into());
    assert_eq!(
        dm_placeholder(&named),
        "Message the group",
        "a blank name is none"
    );
}

#[test]
fn previews_say_what_the_web_says() {
    let mut row = one("ava", None);
    assert_eq!(dm_preview(&row), "No messages yet");
    row.last_message = Some(DmPreview {
        author_id: "u-ava".into(),
        text: "line one\n\nline   two".into(),
        sent_at_ms: 0,
    });
    assert_eq!(dm_preview(&row), "line one line two");
    row.last_message.as_mut().unwrap().text = String::new();
    assert_eq!(dm_preview(&row), "Message", "an attachment alone");
}

#[test]
fn times_read_like_format_last_message_time() {
    let now = 1_000_000_000_000;
    assert_eq!(last_message_time(now, now - 30_000), "Just now");
    assert_eq!(last_message_time(now, now - 5 * 60_000), "5m ago");
    assert_eq!(last_message_time(now, now - 3 * 3_600_000), "3h ago");
    assert_eq!(last_message_time(now, now - 50 * 3_600_000), "2d ago");
    assert_eq!(
        last_message_time(now, now + 60_000),
        "Just now",
        "a clock ahead"
    );
}

#[test]
fn a_fixed_display_clock_decides_each_dm_age() {
    let clock = PanelClock::fixed(1_793_895_120_000);
    let now = clock.now_ms();
    // A minute, an hour and a day: one millisecond either side of the label.
    assert_eq!(last_message_time(now, now - 59_999), "Just now");
    assert_eq!(last_message_time(now, now - 60_000), "1m ago");
    assert_eq!(last_message_time(now, now - 3_599_999), "59m ago");
    assert_eq!(last_message_time(now, now - 3_600_000), "1h ago");
    assert_eq!(last_message_time(now, now - 86_399_999), "23h ago");
    assert_eq!(last_message_time(now, now - 86_400_000), "1d ago");
}

#[test]
fn one_unread_is_a_dot_more_is_a_count_and_the_open_one_has_none() {
    assert_eq!(unread_mark(0, 0, false), None);
    assert_eq!(unread_mark(1, 0, false), Some(UnreadMark::Dot));
    assert_eq!(unread_mark(4, 2, false), Some(UnreadMark::Count(4)));
    assert_eq!(
        unread_mark(0, 3, false),
        Some(UnreadMark::Count(3)),
        "mentions alone"
    );
    assert_eq!(unread_mark(150, 0, true), None, "the open conversation");
    let mut row = one("ava", Some("Ava"));
    row.unread = 3;
    assert_eq!(row_label(&row, false), "Ava, 3 unread");
    assert_eq!(row_label(&row, true), "Ava");
}

// ---- The picker's model. ----

#[test]
fn picker_results_for_an_older_query_are_dropped() {
    let mut model = PickerModel::new(true);
    assert!(model.set_text("a"));
    assert_eq!(model.debounce_elapsed().as_deref(), Some("a"));
    assert!(model.set_text("av"));
    assert_eq!(model.debounce_elapsed().as_deref(), Some("av"));
    assert!(!model.accept("a", Ok(vec![user("ben", None)])));
    assert_eq!(model.found(), &Found::Loading);
    assert!(model.accept("av", Ok(vec![user("ava", None)])));
    assert_eq!(model.options().len(), 1);
}

#[test]
fn picker_only_searches_again_when_the_trimmed_text_changes() {
    let mut model = PickerModel::new(false);
    assert!(model.set_text(" ava "));
    assert_eq!(model.debounce_elapsed().as_deref(), Some("ava"));
    assert!(!model.set_text("ava  "), "only spaces changed");
    assert_eq!(model.debounce_elapsed(), None);
    assert!(!model.set_text("   "), "empty asks nothing");
    assert_eq!(model.found(), &Found::Idle);
}

#[test]
fn picker_leaves_out_excluded_picked_and_repeated_users() {
    let mut model = PickerModel::new(true);
    model.set_excluded(["u-me".to_owned()]);
    model.set_text("x");
    model.debounce_elapsed();
    let found = vec![
        user("me", None),
        user("ava", None),
        user("ben", None),
        user("ava", None),
    ];
    model.accept("x", Ok(found));
    model.pick(user("ben", None));
    model.pick(user("ben", None));
    model.pick(user("me", None));
    let ids: Vec<String> = model.options().into_iter().map(|u| u.id).collect();
    assert_eq!(ids, ["u-ava"]);
    assert_eq!(
        model.picked().len(),
        1,
        "no repeat pick, nor the excluded one"
    );
}

#[test]
fn a_single_picker_replaces_its_pick() {
    let mut model = PickerModel::new(false);
    model.pick(user("ava", None));
    model.pick(user("ben", None));
    assert_eq!(model.picked(), &[user("ben", None)]);
    model.unpick("u-ben");
    assert!(model.picked().is_empty());
}

// ---- The create rules. ----

#[test]
fn only_a_group_carries_a_name_and_a_blank_one_is_none() {
    assert_eq!(create_request(Vec::new(), "x"), None);
    assert_eq!(
        create_request(vec!["a".into()], "Ignored"),
        Some(CreateDmEvent::Create {
            user_ids: vec!["a".into()],
            name: None,
        })
    );
    assert_eq!(
        create_request(vec!["a".into(), "b".into()], "  Crew "),
        Some(CreateDmEvent::Create {
            user_ids: vec!["a".into(), "b".into()],
            name: Some("Crew".into()),
        })
    );
    assert_eq!(
        create_request(vec!["a".into(), "b".into()], "   "),
        Some(CreateDmEvent::Create {
            user_ids: vec!["a".into(), "b".into()],
            name: None,
        })
    );
}

// ---- The views. ----

fn ready(rows: Vec<DmRow>) -> DmList {
    DmList {
        state: LoadState::Ready,
        rows,
    }
}

#[gpui_kit::test]
fn a_row_click_opens_its_conversation(cx: &mut TestAppContext) {
    let rig = rig(cx, 360., |_, cx| {
        let mut list = DmListView::new(cx);
        list.set_list(ready(vec![one("ava", None), one("ben", None)]), cx);
        list
    });
    rig.click(cx, "dm-row-dm-ben");
    assert_eq!(
        rig.events(),
        [DmListEvent::Open {
            dm_id: "dm-ben".into()
        }]
    );
}

#[gpui_kit::test]
fn the_empty_list_offers_a_new_conversation_and_a_failed_one_a_retry(cx: &mut TestAppContext) {
    let rig = rig(cx, 360., |_, cx| {
        let mut list = DmListView::new(cx);
        list.set_list(ready(Vec::new()), cx);
        list
    });
    rig.click(cx, "dm-list-start");
    assert_eq!(rig.events(), [DmListEvent::NewMessage]);
    rig.with(cx, |list, _, cx| {
        list.update(cx, |list, cx| {
            list.set_list(
                DmList {
                    state: LoadState::Failed {
                        error: semaphore_core::model::ErrorView {
                            code: "NETWORK".into(),
                            message: "down".into(),
                            retryable: true,
                            retry_after_ms: None,
                        },
                    },
                    rows: Vec::new(),
                },
                cx,
            )
        })
    });
    rig.clear();
    rig.click(cx, "dm-list-retry");
    assert_eq!(rig.events(), [DmListEvent::Retry]);
}

#[gpui_kit::test]
fn the_sidebar_plus_asks_for_a_new_conversation_and_tabs_switch(cx: &mut TestAppContext) {
    let rig = rig(cx, 800., |_, cx| DmSidebar::new(cx));
    rig.click(cx, "dm-new");
    rig.click(cx, "dm-tab-friends");
    assert_eq!(
        rig.events(),
        [
            DmSidebarEvent::List(DmListEvent::NewMessage),
            DmSidebarEvent::TabChanged(DmTab::Friends)
        ]
    );
    assert!(!rig.has(cx, "dm-new"), "no + on the Friends tab");
    assert!(rig.has(cx, "friends-panel"));
    rig.click(cx, "friends-add");
    assert_eq!(
        rig.events().last(),
        Some(&DmSidebarEvent::Friends(
            crate::friends::FriendsEvent::AddFriend
        ))
    );
}

#[gpui_kit::test]
fn the_header_back_arrow_and_buttons_emit_only_when_offered(cx: &mut TestAppContext) {
    let rig = rig(cx, 800., |_, cx| {
        let mut header = DmHeader::new(cx);
        header.set_state(DmHeaderState::Ready(one("ava", None)), cx);
        header.set_back(true, cx);
        header
    });
    assert!(!rig.has(cx, "dm-call-voice"), "no call button by default");
    assert!(!rig.has(cx, "dm-header-search"), "no search by default");
    rig.click(cx, "dm-header-back");
    rig.with(cx, |header, _, cx| {
        header.update(cx, |header, cx| {
            header.set_call_state(Some(crate::voice::DmCallState::Idle), cx);
            header.set_search(true, cx);
        })
    });
    rig.click(cx, "dm-call-voice");
    rig.click(cx, "dm-call-video");
    rig.click(cx, "dm-header-search");
    assert_eq!(
        rig.events(),
        [
            DmHeaderEvent::Back,
            DmHeaderEvent::Call { video: false },
            DmHeaderEvent::Call { video: true },
            DmHeaderEvent::Search
        ]
    );
    rig.with(cx, |header, _, cx| {
        header.update(cx, |header, cx| {
            header.set_state(DmHeaderState::Unavailable, cx)
        })
    });
    assert!(
        !rig.has(cx, "dm-call-voice") && !rig.has(cx, "dm-header-search"),
        "nothing to call or search when unavailable"
    );
}

#[gpui_kit::test]
fn the_dialog_searches_after_the_debounce_and_creates_a_named_group(cx: &mut TestAppContext) {
    let rig = rig(cx, 800., CreateDmDialog::new);
    let picker = rig.with(cx, |dialog, _, cx| dialog.read(cx).picker().clone());
    rig.with(cx, |_, _, cx| {
        picker.update(cx, |picker, cx| {
            picker.query_changed("av", cx);
            // Keystrokes after the first can report the same text: the search still goes out.
            picker.query_changed("av", cx);
        })
    });
    cx.executor()
        .advance_clock(DEBOUNCE - Duration::from_millis(1));
    cx.run_until_parked();
    assert!(rig.events().is_empty(), "inside the debounce");
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    assert_eq!(rig.events(), [CreateDmEvent::Search { query: "av".into() }]);
    rig.with(cx, |_, _, cx| {
        picker.update(cx, |picker, cx| {
            picker.set_results("av", Ok(vec![user("ava", None), user("avi", None)]), cx)
        })
    });
    rig.click(cx, "create-dm-user-u-ava");
    assert!(!rig.has(cx, "create-dm-name"), "no name field for one user");
    rig.click(cx, "create-dm-user-u-avi");
    assert!(rig.has(cx, "create-dm-name"), "a name field for a group");
    rig.clear();
    rig.click(cx, "create-dm-create");
    assert_eq!(
        rig.events(),
        [CreateDmEvent::Create {
            user_ids: vec!["u-ava".into(), "u-avi".into()],
            name: None,
        }]
    );
    rig.with(cx, |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| dialog.set_busy(true, cx))
    });
    rig.clear();
    rig.click(cx, "create-dm-create");
    assert!(
        rig.events().is_empty(),
        "nothing while a create is on its way"
    );
    rig.click(cx, "create-dm-cancel");
    assert_eq!(rig.events(), [CreateDmEvent::Cancel]);
}
