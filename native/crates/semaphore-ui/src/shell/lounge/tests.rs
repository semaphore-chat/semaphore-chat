//! The Lounge pieces: their words (pure) and what each view draws and reports.

use super::all_sheet::{foot_rows, sheet_row_id};
use super::dock::dock_item_id;
use super::lines::*;
use super::*;
use crate::dms::rig::{Rig, rig};
use crate::kit::text_state;
use crate::shell::MemberRow;
use core::prelude::v1::test;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use semaphore_core::model::{ChannelKind, ChannelPreset, ChannelRow, CommunityRow, UserView};
use semaphore_design::LoungeIcon;
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

// ---------------------------------------------------------------------------------------------
// The words

#[test]
fn counts_are_grouped_as_english_locale_strings() {
    assert_eq!(grouped(0), "0");
    assert_eq!(grouped(999), "999");
    assert_eq!(grouped(1000), "1,000");
    assert_eq!(grouped(1234567), "1,234,567");
    assert_eq!(mention_text(1), "1 mention");
    assert_eq!(mention_text(1200), "1,200 mentions");
    assert_eq!(notification_count_text(0), None);
    assert_eq!(notification_count_text(7).as_deref(), Some("7 unread"));
}

#[test]
fn a_sheet_rows_state_line_puts_the_call_first() {
    let state = |mentions, new_messages, in_your_call| CommunityState {
        mentions,
        new_messages,
        in_your_call,
    };
    assert_eq!(state_line(&state(3, true, true)), "You're in a call here");
    assert_eq!(state_line(&state(2, true, false)), "2 mentions");
    assert_eq!(state_line(&state(0, true, false)), "New messages");
    assert_eq!(state_line(&state(0, false, false)), "Quiet");
}

#[test]
fn the_filter_matches_part_of_a_name_in_any_case() {
    assert!(matches_filter("Friday LAN", "lan"));
    assert!(matches_filter("Friday LAN", "  FRI "));
    assert!(matches_filter("Friday LAN", ""));
    assert!(matches_filter("Friday LAN", "   "));
    assert!(!matches_filter("Friday LAN", "zebra"));
    assert_eq!(
        filter_announcement(" zebra ", 0),
        "No community called “zebra”"
    );
    assert_eq!(filter_announcement("lan", 1), "1 community");
    assert_eq!(filter_announcement("a", 1500), "1,500 communities");
}

fn community_row(id: &str, mentions: u32) -> CommunityRow {
    CommunityRow {
        id: id.into(),
        name: id.into(),
        avatar_file_id: None,
        unread_count: 5,
        mention_count: mentions,
    }
}

#[test]
fn the_inbox_counts_dm_unread_and_every_communitys_mentions_once() {
    let rows = [
        community_row("a", 2),
        community_row("b", 0),
        community_row("c", 3),
    ];
    assert_eq!(inbox_count(4, &rows), 9);
    assert_eq!(inbox_count(0, &[]), 0);
    assert_eq!(inbox_count(u32::MAX, &rows), u32::MAX, "never wraps");
}

#[test]
fn around_and_the_members_button_say_a_number_only_when_known() {
    assert_eq!(around_line(Some(9)).as_deref(), Some("9 around"));
    assert_eq!(around_line(None), None);
    assert_eq!(
        members_button_text(Some(12)),
        ("12 around".into(), "12 around, show members".into())
    );
    assert_eq!(
        members_button_text(None),
        ("Members".into(), "Members".into())
    );
}

#[test]
fn a_channel_rows_trailing_words_name_kind_privacy_and_mentions() {
    assert_eq!(channel_trailing_label(false, false, 0), "");
    assert_eq!(
        channel_trailing_label(true, true, 2),
        "announcement channel, private, 2 mentions"
    );
    assert_eq!(channel_trailing_label(false, true, 1), "private, 1 mention");
}

fn people(names: &[(&str, &str)]) -> Vec<RoomPerson> {
    names
        .iter()
        .map(|(id, name)| RoomPerson {
            id: (*id).into(),
            name: (*name).into(),
            file: None,
        })
        .collect()
}

#[test]
fn the_people_line_puts_you_first_and_counts_the_rest() {
    let squad = people(&[("d", "dropbear"), ("p", "pri"), ("me", "alexk")]);
    assert_eq!(
        people_line(&squad, Some("me"), true),
        "You, dropbear and pri"
    );
    assert_eq!(
        people_line(&squad, Some("me"), false),
        "You on another device, dropbear and pri"
    );
    assert_eq!(people_line(&squad[..1], None, true), "dropbear");
    assert_eq!(people_line(&squad[..2], None, true), "dropbear and pri");
    assert_eq!(people_line(&[], None, true), "");
    let many = people(&[
        ("a", "aiko"),
        ("b", "bo"),
        ("c", "cy"),
        ("d", "di"),
        ("e", ""),
    ]);
    assert_eq!(people_line(&many, None, true), "aiko, bo and 3 more");
    assert_eq!(people_line(&many[4..], None, true), "Unknown user");
}

#[test]
fn the_talking_line_leaves_you_out() {
    let room = people(&[
        ("d", "dropbear"),
        ("p", "pri"),
        ("me", "alexk"),
        ("k", "kwam3"),
    ]);
    let speaking = |ids: &[&str]| {
        ids.iter()
            .map(|id| (*id).to_owned())
            .collect::<HashSet<_>>()
    };
    assert_eq!(talking_line(&room, &speaking(&[]), Some("me")), None);
    assert_eq!(talking_line(&room, &speaking(&["me"]), Some("me")), None);
    assert_eq!(
        talking_line(&room, &speaking(&["d", "me"]), Some("me")).as_deref(),
        Some("dropbear is talking")
    );
    assert_eq!(
        talking_line(&room, &speaking(&["d", "p"]), Some("me")).as_deref(),
        Some("dropbear and pri are talking")
    );
    assert_eq!(
        talking_line(&room, &speaking(&["d", "p", "k"]), Some("me")).as_deref(),
        Some("dropbear, pri and 1 more are talking")
    );
}

#[test]
fn the_user_cards_call_state_says_deafened_before_the_mic() {
    let call = |mic, deafened| CallStatus {
        mic,
        deafened,
        key_label: None,
    };
    assert_eq!(
        call_state(&call(Mic::On, true)),
        (LoungeIcon::HeadphoneOff, "Deafened".into())
    );
    assert_eq!(
        call_state(&call(Mic::On, false)),
        (LoungeIcon::Mic, "Mic on".into())
    );
    assert_eq!(call_state(&call(Mic::Muted, false)).1, "Muted");
    assert_eq!(
        call_state(&call(Mic::ServerMuted, false)).1,
        "Muted by a moderator"
    );
    assert_eq!(call_state(&call(Mic::Blocked, false)).1, "Listening only");
    assert_eq!(call_state(&call(Mic::PushToTalk, false)).1, "Push to talk");
    let ptt = CallStatus {
        key_label: Some("V".into()),
        ..call(Mic::PushToTalk, false)
    };
    assert_eq!(call_state(&ptt).1, "Push to talk (V)");
}

fn user(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(Into::into),
        avatar_file_id: None,
    }
}

fn row(id: &str, name: &str, online: bool, role: Option<(&str, i32)>) -> MemberRow {
    MemberRow {
        user: user(id, name, None),
        status: None,
        online,
        display_role: role.map(|(name, position)| (name.into(), position)),
    }
}

fn voice(id: &str, name: &str, users: &[&str]) -> ChannelRow {
    ChannelRow {
        id: id.into(),
        community_id: "c".into(),
        name: name.into(),
        kind: ChannelKind::Voice,
        is_private: false,
        position: 0,
        unread_count: 0,
        mention_count: 0,
        voice_users: users.iter().map(|id| user(id, id, None)).collect(),
        slowmode_seconds: 0,
        permissions: None,
        preset: ChannelPreset::default(),
    }
}

#[test]
fn members_group_into_hosts_by_role_then_around_and_away_by_name() {
    let rows = vec![
        row("z", "zara", false, None),
        row("g", "gracie", true, Some(("Mods", 2))),
        row("s", "Samira", true, Some(("Admins", 9))),
        row("d", "dropbear", false, Some(("Mods", 2))),
        row("k", "kwam3", true, None),
        row("a", "aiko", true, None),
        row("b", "Bo", false, None),
    ];
    let groups = group_members(&rows, &[voice("vc", "AFK", &["k"])]);
    let names = |members: &[MemberSummary]| {
        members
            .iter()
            .map(|member| member.name.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&groups.hosts), ["Samira", "dropbear", "gracie"]);
    assert_eq!(names(&groups.around), ["aiko", "kwam3"]);
    assert_eq!(names(&groups.away), ["Bo", "zara"]);
    assert_eq!(groups.hosts[0].role.as_deref(), Some("Admins"));
    assert_eq!(groups.around[1].in_room.as_deref(), Some("AFK"));
    // Samira and gracie are online hosts; dropbear is an away host.
    assert_eq!(groups.online(), 4);
    assert_eq!(around_count(&groups, false), Some(4));
    assert_eq!(
        around_count(&groups, true),
        None,
        "a part of the list knows no total"
    );
}

#[test]
fn a_member_is_shown_by_display_name_unless_it_is_blank() {
    let mut named = row("p", "pri", true, None);
    named.user.display_name = Some("Priya".into());
    let mut blank = row("q", "quinn", true, None);
    blank.user.display_name = Some("  ".into());
    let groups = group_members(&[named, blank], &[]);
    let names: Vec<_> = groups.around.iter().map(|m| m.name.as_str()).collect();
    assert_eq!(names, ["Priya", "quinn"]);
}

#[test]
fn a_members_line_is_their_status_then_their_room() {
    let mut member = MemberSummary {
        id: "a".into(),
        name: "aiko".into(),
        file: None,
        role: None,
        online: true,
        status: None,
        in_room: None,
    };
    assert_eq!(member_line(&member), None);
    member.in_room = Some("Squad Up".into());
    assert_eq!(member_line(&member).as_deref(), Some("In Squad Up"));
    member.status = Some(" ".into());
    assert_eq!(
        member_line(&member).as_deref(),
        Some("In Squad Up"),
        "a blank status is none"
    );
    member.status = Some("brb".into());
    assert_eq!(member_line(&member).as_deref(), Some("brb"));
}

#[test]
fn the_sheets_foot_has_notifications_at_every_width_and_the_account_on_a_phone() {
    assert_eq!(foot_rows(false, false), [FootRow::Notifications]);
    assert_eq!(
        foot_rows(true, false),
        [FootRow::Create, FootRow::Notifications]
    );
    assert_eq!(
        foot_rows(true, true),
        [
            FootRow::Create,
            FootRow::Notifications,
            FootRow::Settings,
            FootRow::Profile,
            FootRow::SignOut
        ]
    );
}

// ---------------------------------------------------------------------------------------------
// The views

type Log = Rc<RefCell<Vec<String>>>;
type Body = Box<dyn Fn(&Log, &Entity<InputState>, &mut Window, &mut App) -> AnyElement>;

struct Host {
    body: Body,
    log: Log,
    filter: Entity<InputState>,
}

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .child((self.body)(&self.log, &self.filter, window, cx))
    }
}

fn host(
    cx: &mut TestAppContext,
    width: f32,
    body: impl Fn(&Log, &Entity<InputState>, &mut Window, &mut App) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, width, move |window, cx| {
        let filter = text_state(window, cx, false);
        cx.observe(&filter, |_, _, cx| cx.notify()).detach();
        Host {
            body: Box::new(body),
            log: shared,
            filter,
        }
    });
    (rig, log)
}

fn logs(log: &Log, line: impl Into<String>) -> Act {
    let log = log.clone();
    let line = line.into();
    Rc::new(move |_, _| log.borrow_mut().push(line.clone()))
}

fn entries(log: &Log) -> Vec<String> {
    log.borrow().clone()
}

fn dock_communities(count: usize) -> Vec<DockCommunity> {
    (1..=count)
        .map(|n| DockCommunity {
            id: format!("c{n}"),
            name: format!("Community {n}"),
            file: None,
            mentions: if n == 2 { 3 } else { 0 },
            new_messages: n == 3,
        })
        .collect()
}

#[gpui_kit::test]
fn the_dock_reports_inbox_all_and_each_community_by_its_id(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, _, _, _| {
        let (inbox, all) = (logs(log, "inbox"), logs(log, "all"));
        let log = log.clone();
        ShellDock::new(
            dock_communities(3),
            DockCurrent::Community("c1".into()),
            DockStatus::Ready,
        )
        .inbox_count(4)
        .on_inbox(move |window, cx| inbox(window, cx))
        .on_all(move |window, cx| all(window, cx))
        .on_community(move |id, _, _| log.borrow_mut().push(id.to_owned()))
        .into_any_element()
    });
    assert_eq!(dock_item_id("c2"), "community-c2");
    rig.click(cx, "community-c2");
    rig.click(cx, "dock-inbox");
    rig.click(cx, "dock-all");
    assert_eq!(entries(&log), ["c2", "inbox", "all"]);
}

#[gpui_kit::test]
fn a_loading_or_failed_dock_keeps_inbox_and_all(cx: &mut TestAppContext) {
    for status in [DockStatus::Loading, DockStatus::Error] {
        let (rig, _) = host(cx, 1280., move |_, _, _, _| {
            ShellDock::new(dock_communities(3), DockCurrent::None, status).into_any_element()
        });
        assert!(rig.has(cx, "dock-inbox"));
        assert!(rig.has(cx, "dock-all"));
        assert!(
            !rig.has(cx, "community-c1"),
            "{status:?} shows no community"
        );
    }
}

fn sheet_communities(count: usize) -> Vec<SheetCommunity> {
    let names = ["Couch Co-op", "Friday LAN", "Lumen Studio", "Wavelength"];
    (1..=count)
        .map(|n| SheetCommunity {
            id: format!("c{n}"),
            name: format!("{} {n}", names[n % names.len()]),
            file: None,
            mentions: 0,
            new_messages: false,
            in_your_call: false,
        })
        .collect()
}

#[gpui_kit::test]
fn the_sheet_lists_communities_and_reports_rows_and_the_foot(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, filter, _, _| {
        let (on_row, on_foot) = (log.clone(), log.clone());
        AllCommunitiesSheet::new("moss.social", sheet_communities(3), Face::Ready)
            .can_create(true)
            .filter(filter)
            .on_community(move |id, _, _| on_row.borrow_mut().push(id.to_owned()))
            .on_foot(move |row, _, _| on_foot.borrow_mut().push(row.id().to_owned()))
            .into_any_element()
    });
    assert!(
        !rig.has(cx, "all-communities-filter"),
        "no filter for three"
    );
    assert!(
        !rig.has(cx, "sheet-settings"),
        "the account rows are a phone's"
    );
    rig.click(cx, &sheet_row_id("c2"));
    rig.click(cx, "sheet-create-community");
    rig.click(cx, "sheet-notifications");
    assert_eq!(entries(&log), ["c2", "create-community", "notifications"]);
}

#[gpui_kit::test]
fn the_sheet_filters_above_eight_communities(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, 1280., |_, filter, _, _| {
        AllCommunitiesSheet::new("moss.social", sheet_communities(12), Face::Ready)
            .filter(filter)
            .into_any_element()
    });
    assert!(rig.has(cx, "all-communities-filter"));
    assert!(rig.has(cx, &sheet_row_id("c1")));
    rig.with(cx, |host, window, cx| {
        let filter = host.read(cx).filter.clone();
        filter.update(cx, |state, cx| state.set_value("lan", window, cx));
    });
    // "Friday LAN" is every fourth from c1: c1, c5, c9.
    assert!(rig.has(cx, &sheet_row_id("c5")));
    assert!(!rig.has(cx, &sheet_row_id("c2")));
}

#[gpui_kit::test]
fn the_phone_sheet_adds_settings_profile_and_sign_out(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 390., |log, filter, _, _| {
        let on_foot = log.clone();
        AllCommunitiesSheet::new("moss.social", sheet_communities(2), Face::Ready)
            .filter(filter)
            .phone_foot(true)
            .notification_count(3)
            .on_foot(move |row, _, _| on_foot.borrow_mut().push(row.id().to_owned()))
            .into_any_element()
    });
    rig.click(cx, "sheet-settings");
    rig.click(cx, "sheet-profile");
    rig.click(cx, "sheet-sign-out");
    assert_eq!(entries(&log), ["settings", "profile", "sign-out"]);
    assert!(
        !rig.has(cx, "sheet-create-community"),
        "create only when allowed"
    );
}

#[gpui_kit::test]
fn the_sheet_asks_to_close_with_its_reason(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, filter, _, _| {
        let closes = log.clone();
        AllCommunitiesSheet::new("moss.social", sheet_communities(2), Face::Ready)
            .filter(filter)
            .on_close(move |reason, _, _| closes.borrow_mut().push(format!("{reason:?}")))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| window.activate_window());
    rig.with(cx, |_, window, cx| window.press("escape", cx));
    assert_eq!(entries(&log), ["Escape"]);
}

fn items() -> Vec<ChannelItem> {
    ["general", "clips", "lfg"]
        .iter()
        .map(|name| ChannelItem {
            id: format!("ch-{name}"),
            name: (*name).into(),
            unread: false,
            mentions: 0,
            private: false,
            announcement: false,
        })
        .collect()
}

fn left_island(log: &Log) -> CommunityLeft {
    let (on_channel, on_settings, on_menu) =
        (log.clone(), logs(log, "settings"), logs(log, "menu"));
    let header = CommunityHeader::new(Some("Couch Co-op"))
        .around(Some(9))
        .can_settings(true)
        .menu_open(true)
        .on_menu(move |window, cx| on_menu(window, cx))
        .on_settings(move |window, cx| on_settings(window, cx));
    let channels = ChannelSection::new(items(), Face::Ready)
        .selected(Some("ch-general".into()))
        .on_channel(move |id, _, _| on_channel.borrow_mut().push(id.to_owned()));
    let (join, leave, open) = (logs(log, "join"), logs(log, "leave"), logs(log, "open"));
    let squad = VoiceRoomCard::new("vc-squad", "Squad Up", Vec::new())
        .on_join(move |window, cx| join(window, cx))
        .on_open(move |window, cx| open(window, cx));
    let here = VoiceRoomCard::new("vc-afk", "AFK", Vec::new())
        .you_are_here(true)
        .on_leave(move |window, cx| leave(window, cx));
    let closed = VoiceRoomCard::new("vc-mods", "Mods", Vec::new()).can_join(false);
    CommunityLeft::new(header, channels).rooms(vec![squad, here, closed])
}

#[gpui_kit::test]
fn the_left_island_reports_channels_rooms_and_the_menu(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, _, _, _| {
        left_island(log).into_any_element()
    });
    rig.click(cx, "channel-ch-clips");
    rig.click(cx, "room-join-vc-squad");
    rig.click(cx, "channel-vc-squad");
    rig.click(cx, "room-leave-vc-afk");
    rig.click(cx, "community-menu");
    rig.click(cx, "community-settings");
    assert_eq!(
        entries(&log),
        ["ch-clips", "join", "open", "leave", "menu", "settings"]
    );
    assert!(
        !rig.has(cx, "room-join-vc-afk"),
        "the room you are in offers Leave"
    );
    assert!(!rig.has(cx, "room-join-vc-mods"), "no Join without CONNECT");
}

#[gpui_kit::test]
fn a_header_without_settings_has_no_menu_button(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, 1280., |_, _, _, _| {
        CommunityHeader::new(Some("Couch Co-op"))
            .can_settings(false)
            .into_any_element()
    });
    assert!(rig.has(cx, "community-name"));
    assert!(!rig.has(cx, "community-menu"));
}

#[gpui_kit::test]
fn the_members_button_shows_until_the_members_are_beside_the_list(cx: &mut TestAppContext) {
    for shown in [false, true] {
        let (rig, log) = host(cx, 1280., move |log, _, _, _| {
            let show = logs(log, "show");
            CommunityHeader::new(Some("Couch Co-op"))
                .around(Some(12))
                .members_shown(shown)
                .on_show_members(move |window, cx| show(window, cx))
                .into_any_element()
        });
        assert_eq!(rig.has(cx, "community-members"), !shown);
        if !shown {
            rig.click(cx, "community-members");
            assert_eq!(entries(&log), ["show"]);
        }
    }
}

#[gpui_kit::test]
fn a_not_member_island_offers_only_the_way_out(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, _, _, _| {
        let leave = logs(log, "leave");
        left_island(log)
            .access(CommunityLeftAccess::NotMember)
            .on_leave(move |window, cx| leave(window, cx))
            .into_any_element()
    });
    assert!(!rig.has(cx, "channel-ch-general"));
    rig.click(cx, "community-leave");
    assert_eq!(entries(&log), ["leave"]);
}

#[gpui_kit::test]
fn the_channel_list_is_one_tab_stop_moved_with_the_arrows(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, _, _, _| {
        let on_channel = log.clone();
        ChannelSection::new(items(), Face::Ready)
            .selected(Some("ch-general".into()))
            .on_channel(move |id, _, _| on_channel.borrow_mut().push(id.to_owned()))
            .into_any_element()
    });
    rig.click(cx, "channel-ch-general");
    rig.with(cx, |_, window, _| window.activate_window());
    for key in ["down", "enter", "end", "enter", "home", "enter"] {
        rig.with(cx, |_, window, cx| window.press(key, cx));
    }
    assert_eq!(
        entries(&log),
        ["ch-general", "ch-clips", "ch-lfg", "ch-general"]
    );
}

#[gpui_kit::test]
fn a_failed_channel_load_offers_try_again(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, 1280., |_, _, _, _| {
        ChannelSection::new(items(), Face::Error("down".into())).into_any_element()
    });
    assert!(!rig.has(cx, "channel-ch-general"));
}

fn summary(id: &str, online: bool, role: Option<&str>) -> MemberSummary {
    MemberSummary {
        id: id.into(),
        name: id.into(),
        file: None,
        role: role.map(Into::into),
        online,
        status: None,
        in_room: None,
    }
}

#[gpui_kit::test]
fn a_member_row_opens_the_profile_and_a_right_click_the_menu(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, _, _, _| {
        let (profile, menu) = (log.clone(), log.clone());
        let groups = MemberGroups {
            hosts: vec![summary("samira", true, Some("admin"))],
            around: vec![summary("aiko", true, None)],
            away: vec![summary("zara", false, None)],
        };
        MembersIsland::new(groups, Face::Ready)
            .around(Some(2))
            .on_profile(move |id, _, _| profile.borrow_mut().push(format!("profile {id}")))
            .on_menu(move |id, _, _, _| menu.borrow_mut().push(format!("menu {id}")))
            .into_any_element()
    });
    rig.click(cx, "member-row-aiko");
    rig.with(cx, |_, window, cx| window.right_click("member-zara", cx));
    assert_eq!(entries(&log), ["profile aiko", "menu zara"]);
    assert!(rig.has(cx, "member-samira"));
}

#[gpui_kit::test]
fn the_user_cards_button_opens_the_account_menu(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, 1280., |log, _, _, _| {
        let account = logs(log, "account");
        UserCard::new(Some("alexk"))
            .call(Some(CallStatus {
                mic: Mic::Muted,
                deafened: false,
                key_label: None,
            }))
            .on_account(move |window, cx| account(window, cx))
            .into_any_element()
    });
    rig.click(cx, "user-card-menu");
    assert_eq!(entries(&log), ["account"]);
}
