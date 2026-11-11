//! The DM stories: the sidebar where the shell docks it (or filling a phone), the header, the
//! create dialog over a stand-in page, and the sidebar inside the real shell. The people here are
//! shared with the friends and notification stories.

use super::picker::Found;
use super::{CreateDmDialog, DmHeader, DmHeaderState, DmSidebar, DmTab};
use crate::friends::FriendsPanel;
use crate::kit::{Variant, text};
use crate::messages::fixture::NOW_MS;
use crate::panel::PanelClock;
use crate::shell::stories_impl::{Options, shell_view};
use crate::shell::{CHANNEL_SIDEBAR_WIDTH, ContentProps, PHONE, RouteSidebarProps};
use crate::stories::Story;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    DmList, DmPreview, DmRow, ErrorView, FriendRequestRow, FriendRow, FriendsView, LoadState,
    UserView,
};
use std::collections::HashSet;
use std::rc::Rc;

pub(crate) const MINUTE: i64 = 60_000;
pub(crate) const HOUR: i64 = 60 * MINUTE;
pub(crate) const DAY: i64 = 24 * HOUR;

/// A user with the sandbox's coloured initials.
pub(crate) fn person(key: &str, username: &str, display: Option<&str>) -> UserView {
    let label = display.unwrap_or(username).replace(' ', "%20");
    UserView {
        id: format!("u-{key}"),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: Some(format!("avatar:{key}:{label}")),
    }
}

pub(crate) fn ava() -> UserView {
    person("ava", "ava", Some("Ava Chen"))
}
pub(crate) fn ben() -> UserView {
    person("ben", "ben", None)
}
pub(crate) fn cleo() -> UserView {
    person("cleo", "cleo", Some("Cleo Martin"))
}
pub(crate) fn dev() -> UserView {
    person("dev", "devraj", Some("Devraj Patel"))
}
pub(crate) fn emma() -> UserView {
    person("emma", "emma", Some("Emma Larsen"))
}
pub(crate) fn finn() -> UserView {
    person("finn", "finn_o", Some("Finn O'Brien"))
}
pub(crate) fn long_user() -> UserView {
    person(
        "max",
        "maximilian_featherstonehaugh_wolfeschlegel",
        Some("Maximilian Alexander Featherstonehaugh-Wolfeschlegelsteinhausen"),
    )
}

pub(crate) fn failed() -> LoadState {
    LoadState::Failed {
        error: ErrorView {
            code: "NETWORK".into(),
            message: "network unreachable".into(),
            retryable: true,
            retry_after_ms: None,
        },
    }
}

fn dm(id: &str, members: Vec<UserView>, last: Option<(&str, i64)>, unread: u32) -> DmRow {
    let author = members
        .first()
        .map(|user| user.id.clone())
        .unwrap_or_default();
    DmRow {
        id: id.into(),
        name: None,
        is_group: members.len() > 1,
        members,
        last_message: last.map(|(text, ago)| DmPreview {
            author_id: author,
            text: text.into(),
            sent_at_ms: NOW_MS - ago,
        }),
        unread,
        mentions: 0,
        online: false,
    }
}

pub(crate) fn mixed_rows() -> Vec<DmRow> {
    let mut named = dm(
        "dm-launch",
        vec![ava(), ben(), cleo()],
        Some(("Ship it on Thursday, then.", 25 * MINUTE)),
        4,
    );
    named.name = Some("Launch crew".into());
    named.mentions = 2;
    let mut many = dm(
        "dm-many",
        vec![dev(), emma(), finn(), ava(), ben()],
        Some(("I'll bring snacks", 3 * HOUR)),
        150,
    );
    many.mentions = 1;
    vec![
        dm(
            "dm-ava",
            vec![ava()],
            Some(("See you at standup", 40_000)),
            1,
        ),
        named,
        dm("dm-ben", vec![ben()], Some(("", 2 * HOUR)), 0),
        many,
        dm("dm-cleo", vec![cleo()], Some(("Thanks!", 2 * DAY)), 0),
        dm("dm-trio", vec![dev(), emma(), finn()], None, 0),
    ]
}

pub(crate) fn long_rows() -> Vec<DmRow> {
    let crowd: Vec<UserView> = (0..15)
        .map(|index| {
            person(
                &format!("crowd{index}"),
                &format!("member{index}"),
                Some(&format!("Somebody With A Long Name {index}")),
            )
        })
        .collect();
    let mut long_named = dm(
        "dm-long-name",
        vec![ava(), ben()],
        Some((
            "A message long enough that it has to stop at the edge of the row with an ellipsis \
             instead of wrapping onto a second line under the name",
            5 * MINUTE,
        )),
        12,
    );
    long_named.name =
        Some("A group whose name was chosen by someone who really liked long names a lot".into());
    vec![
        dm(
            "dm-max",
            vec![long_user()],
            Some((
                "Did you see the thread about the staging database resets?",
                MINUTE,
            )),
            1,
        ),
        long_named,
        dm("dm-crowd", crowd, Some(("Who's in?", HOUR)), 3),
    ]
}

pub(crate) fn sample_friends() -> FriendsView {
    let friend = |user: UserView, online: bool, busy: bool| FriendRow {
        friendship_id: format!("f-{}", user.id),
        user,
        online,
        busy,
    };
    let request = |user: UserView, ago: i64| FriendRequestRow {
        friendship_id: format!("r-{}", user.id),
        user,
        sent_at_ms: NOW_MS - ago,
        busy: false,
    };
    FriendsView {
        state: LoadState::Ready,
        friends: vec![
            friend(ava(), true, false),
            friend(ben(), false, false),
            friend(cleo(), true, true),
            friend(long_user(), false, false),
        ],
        incoming: vec![request(dev(), 2 * HOUR), request(emma(), 3 * DAY)],
        outgoing: vec![request(finn(), 20 * DAY)],
    }
}

/// Puts a sidebar in the shell's column at its width beside a stand-in, or fills a phone.
pub(crate) struct SidebarFrame {
    pub view: AnyView,
}

impl Render for SidebarFrame {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        if f32::from(window.viewport_size().width) < PHONE {
            return div()
                .size_full()
                .bg(sem.paper)
                .child(self.view.clone())
                .into_any_element();
        }
        div()
            .size_full()
            .flex()
            .bg(sem.background_default)
            .child(
                div()
                    .w(px(CHANNEL_SIDEBAR_WIDTH))
                    .flex_shrink_0()
                    .h_full()
                    .border_r_1()
                    .border_color(sem.divider)
                    .child(self.view.clone()),
            )
            .child(stand_in("Conversation", sem.text_disabled))
            .into_any_element()
    }
}

fn stand_in(label: &'static str, color: Hsla) -> Div {
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .flex()
        .items_center()
        .justify_center()
        .text_color(color)
        .child(text(Variant::Body2, label))
}

pub(crate) fn sidebar_framed(view: AnyView, cx: &mut App) -> AnyView {
    cx.new(|_| SidebarFrame { view }).into()
}

/// A page behind a dialog, so the backdrop has something to dim.
pub(crate) struct DialogFrame {
    pub dialog: AnyView,
}

impl Render for DialogFrame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .size_full()
            .relative()
            .bg(sem.background_default)
            .child(stand_in("Page", sem.text_disabled).size_full())
            .child(self.dialog.clone())
    }
}

pub(crate) fn dialog_framed(dialog: AnyView, cx: &mut App) -> AnyView {
    cx.new(|_| DialogFrame { dialog }).into()
}

fn sidebar(
    state: LoadState,
    rows: Vec<DmRow>,
    selected: Option<&str>,
    tab: DmTab,
    friends: FriendsView,
    cx: &mut App,
) -> Entity<DmSidebar> {
    let selected = selected.map(str::to_owned);
    cx.new(|cx| {
        let sidebar = DmSidebar::new(cx);
        sidebar.list().update(cx, |list, cx| {
            list.set_clock(PanelClock::fixed(NOW_MS), cx);
            list.set_list(DmList { state, rows }, cx);
            list.set_selected(selected, cx);
            list.set_in_call(Some("dm-cleo".into()), cx);
            list.set_online(HashSet::from(["u-ava".to_owned()]), cx);
        });
        sidebar
            .friends()
            .update(cx, |panel: &mut FriendsPanel, cx| {
                panel.set_clock(PanelClock::fixed(NOW_MS), cx);
                panel.set_view(friends, cx);
            });
        let mut sidebar = sidebar;
        sidebar.set_tab(tab, cx);
        sidebar
    })
}

fn sidebar_story(
    state: LoadState,
    rows: Vec<DmRow>,
    selected: Option<&str>,
    tab: DmTab,
    cx: &mut App,
) -> AnyView {
    let view = sidebar(state, rows, selected, tab, sample_friends(), cx);
    sidebar_framed(view.into(), cx)
}

/// The header over a stand-in conversation.
struct HeaderFrame {
    header: Entity<DmHeader>,
}

impl Render for HeaderFrame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(sem.background_default)
            .child(self.header.clone())
            .child(stand_in("Messages", sem.text_disabled))
    }
}

fn header_story(
    state: DmHeaderState,
    call: Option<crate::voice::DmCallState>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let phone = f32::from(window.viewport_size().width) < PHONE;
    let header = cx.new(|cx| {
        let mut header = DmHeader::new(cx);
        header.set_state(state, cx);
        header.set_back(phone, cx);
        header.set_members_button(call.is_some(), cx);
        header.set_call_state(call, cx);
        header.set_search(true, cx);
        header
    });
    cx.new(|_| HeaderFrame { header }).into()
}

fn create_story(
    query: &str,
    found: Found,
    picked: Vec<UserView>,
    busy: bool,
    group_name: &str,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let dialog = cx.new(|cx| {
        let mut dialog = CreateDmDialog::new(window, cx);
        let query = query.to_owned();
        dialog.picker().clone().update(cx, |picker, cx| {
            picker.preset(&query, found, picked, window, cx);
        });
        if !group_name.is_empty() {
            let name = group_name.to_owned();
            dialog
                .name
                .update(cx, |field, cx| field.set_value(name, window, cx));
        }
        dialog.set_busy(busy, cx);
        dialog
    });
    dialog_framed(dialog.into(), cx)
}

fn found_people() -> Found {
    Found::Ready(vec![ava(), ben(), cleo(), dev(), long_user()])
}

/// The DM sidebar in the real shell, on `/direct-messages`, with a header over the conversation.
fn in_shell(env: &crate::stories::StoryEnv, cx: &mut App) -> AnyView {
    let view = sidebar(
        LoadState::Ready,
        mixed_rows(),
        Some("dm-launch"),
        DmTab::Messages,
        sample_friends(),
        cx,
    );
    let header = cx.new(|cx| {
        let mut header = DmHeader::new(cx);
        header.set_state(DmHeaderState::Ready(mixed_rows()[1].clone()), cx);
        header
    });
    let slot_view = view.clone();
    let content_header = header.clone();
    shell_view(
        env,
        Options {
            dm_route: true,
            route_sidebar: Some(Rc::new(
                move |_: &RouteSidebarProps, _: &mut Window, _: &mut App| {
                    Some(slot_view.clone().into_any_element())
                },
            )),
            content: Some(Rc::new(
                move |_: &ContentProps, _: &mut Window, cx: &mut App| {
                    let sem = cx.sem();
                    div()
                        .size_full()
                        .flex()
                        .flex_col()
                        .child(content_header.clone())
                        .child(stand_in("Messages", sem.text_disabled))
                        .into_any_element()
                },
            )),
            ..Options::default()
        },
        cx,
    )
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("dms-list-loading", |_, _, cx| {
            sidebar_story(LoadState::Loading, Vec::new(), None, DmTab::Messages, cx)
        }),
        Story::new("dms-list-empty", |_, _, cx| {
            sidebar_story(LoadState::Ready, Vec::new(), None, DmTab::Messages, cx)
        }),
        Story::new("dms-list-failed", |_, _, cx| {
            sidebar_story(failed(), Vec::new(), None, DmTab::Messages, cx)
        }),
        Story::new("dms-list-mixed", |_, _, cx| {
            sidebar_story(
                LoadState::Ready,
                mixed_rows(),
                Some("dm-ben"),
                DmTab::Messages,
                cx,
            )
        }),
        Story::new("dms-list-long", |_, _, cx| {
            sidebar_story(LoadState::Ready, long_rows(), None, DmTab::Messages, cx)
        }),
        Story::new("dms-sidebar-friends", |_, _, cx| {
            sidebar_story(LoadState::Ready, mixed_rows(), None, DmTab::Friends, cx)
        }),
        Story::new("dms-header-loading", |_, window, cx| {
            header_story(DmHeaderState::Loading, None, window, cx)
        }),
        Story::new("dms-header-ready", |_, window, cx| {
            header_story(
                DmHeaderState::Ready(mixed_rows()[0].clone()),
                Some(crate::voice::DmCallState::Idle),
                window,
                cx,
            )
        }),
        Story::new("dms-header-in-call", |_, window, cx| {
            header_story(
                DmHeaderState::Ready(mixed_rows()[0].clone()),
                Some(crate::voice::DmCallState::InThisCall),
                window,
                cx,
            )
        }),
        Story::new("dms-header-joining", |_, window, cx| {
            header_story(
                DmHeaderState::Ready(mixed_rows()[0].clone()),
                Some(crate::voice::DmCallState::Joining),
                window,
                cx,
            )
        }),
        Story::new("dms-header-other-call", |_, window, cx| {
            header_story(
                DmHeaderState::Ready(mixed_rows()[0].clone()),
                Some(crate::voice::DmCallState::InOtherCall),
                window,
                cx,
            )
        }),
        Story::new("dms-header-unavailable", |_, window, cx| {
            header_story(DmHeaderState::Unavailable, None, window, cx)
        }),
        Story::new("dms-header-long", |_, window, cx| {
            header_story(
                DmHeaderState::Ready(long_rows()[2].clone()),
                Some(crate::voice::DmCallState::Idle),
                window,
                cx,
            )
        }),
        Story::new("dms-create-empty", |_, window, cx| {
            create_story("", Found::Idle, Vec::new(), false, "", window, cx)
        }),
        Story::new("dms-create-results", |_, window, cx| {
            create_story("a", found_people(), vec![ava()], false, "", window, cx)
        }),
        Story::new("dms-create-group", |_, window, cx| {
            create_story(
                "e",
                Found::Ready(vec![emma(), dev()]),
                vec![ava(), ben(), long_user()],
                false,
                "Weekend plans",
                window,
                cx,
            )
        }),
        Story::new("dms-create-busy", |_, window, cx| {
            create_story("", Found::Idle, vec![ava(), ben()], true, "", window, cx)
        }),
        Story::new("dms-create-search-failed", |_, window, cx| {
            create_story(
                "ava",
                Found::Failed("network unreachable".into()),
                Vec::new(),
                false,
                "",
                window,
                cx,
            )
        }),
        Story::new("dms-create-no-results", |_, window, cx| {
            create_story(
                "zzz",
                Found::Ready(Vec::new()),
                Vec::new(),
                false,
                "",
                window,
                cx,
            )
        }),
        Story::new("dms-in-shell", |env, _, cx| in_shell(env, cx)),
    ]
}
