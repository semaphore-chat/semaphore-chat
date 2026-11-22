//! The Lounge shell's pieces in the real template (AppFrame and ThreeIslands), on the web stories'
//! sample data (`frontend/src/stories/fixtures/loungeCommunity.ts`, `loungeCommunities.ts`) and
//! under their ids (`shell-dock--twelve` is `shell-dock-twelve` here). Each fills the window, so
//! the UI review's phone, tablet and desktop sizes show the three width ranges. The dock's All
//! button, the members button and the header's menu work.

use super::lines::{CallStatus, MemberGroups, Mic};
use super::{
    AllCommunitiesSheet, ChannelItem, ChannelSection, CommunityHeader, CommunityLeft,
    CommunityLeftAccess, DockCommunity, DockCurrent, DockStatus, Face, MemberSummary,
    MembersIsland, Retry, RoomPerson, SheetCommunity, ShellDock, UserCard, VoiceRoomCard, column,
    text_line,
};
use crate::kit::{AppFrame, Avatar, PhonePane, ThreeIslands, WidthRange, text_state};
use crate::stories::Story;
use crate::theme::{self, DEFAULT_BASE, SemTheme, ThemeInput};
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, SPACE_LG, SPACE_MD, SPACE_XL};
use semaphore_design::{Intensity, Mode, person_colour};
use std::collections::HashSet;

// ---------------------------------------------------------------------------------------------
// Sample data

const NAMES: [&str; 12] = [
    "Couch Co-op",
    "Trailheads",
    "Lumen Studio",
    "Friday LAN",
    "Wavelength",
    "Retro Night",
    "Pixel Pushers",
    "Book Nook",
    "Synth Garden",
    "Design Guild",
    "Night Owls",
    "Tabletop Tuesdays",
];

const LONG_NAME: &str = "The Late-Night Speedrunners, Tinkerers and Occasional Bakers Society";
const LONG_CHANNEL: &str =
    "the-extremely-long-channel-name-that-somebody-thought-was-a-good-idea-at-the-time";
const YOU: &str = "u-alexk";

#[derive(Clone)]
struct Community {
    id: String,
    name: String,
    mentions: u32,
    new_messages: bool,
    in_call: bool,
}

/// `count` communities, c-1 (Couch Co-op) on; quiet.
fn communities(count: usize) -> Vec<Community> {
    (0..count)
        .map(|index| {
            let base = NAMES[index % NAMES.len()];
            let round = index / NAMES.len();
            Community {
                id: format!("c-{}", index + 1),
                name: if round == 0 {
                    base.to_owned()
                } else {
                    format!("{base} {}", round + 1)
                },
                mentions: 0,
                new_messages: false,
                in_call: false,
            }
        })
        .collect()
}

/// The mock-ups' mix: Couch Co-op your call, Lumen Studio 2 mentions, Friday LAN new messages,
/// Wavelength both (the count wins).
fn mockup(count: usize) -> Vec<Community> {
    let mut all = communities(count);
    for (index, community) in all.iter_mut().enumerate() {
        match index {
            0 => community.in_call = true,
            2 => community.mentions = 2,
            3 => community.new_messages = true,
            4 => {
                community.mentions = 3;
                community.new_messages = true;
            }
            _ => {}
        }
    }
    all
}

fn channel(id: &str, name: &str, unread: bool, mentions: u32) -> ChannelItem {
    ChannelItem {
        id: id.into(),
        name: name.into(),
        unread,
        mentions,
        private: false,
        announcement: false,
    }
}

fn channels() -> Vec<ChannelItem> {
    vec![
        channel("ch-general", "general", false, 0),
        channel("ch-clips", "clips", true, 2),
        channel("ch-lfg", "lfg", false, 0),
        channel("ch-memes", "memes", false, 0),
    ]
}

/// Five, with a private channel and unread without a mention beside a mention.
fn five_channels() -> Vec<ChannelItem> {
    let mut all = channels()[..2].to_vec();
    all.push(ChannelItem {
        announcement: true,
        ..channel("ch-news", "news", true, 0)
    });
    all.push(channel("ch-lfg", "lfg", true, 0));
    all.push(ChannelItem {
        private: true,
        ..channel("ch-mods", "mods", true, 1)
    });
    all.push(ChannelItem {
        private: true,
        ..channel("ch-staff", "staff-room", false, 0)
    });
    all
}

fn many_channels(count: usize) -> Vec<ChannelItem> {
    (0..count)
        .map(|i| ChannelItem {
            id: format!("ch-{}", i + 1),
            name: if i == 0 {
                "general".into()
            } else {
                format!("channel-{}", i + 1)
            },
            unread: i % 7 == 3,
            mentions: if i % 23 == 5 { (i % 4) as u32 + 1 } else { 0 },
            private: i % 11 == 9,
            announcement: i == 1,
        })
        .collect()
}

fn person(id: &str, name: &str) -> RoomPerson {
    RoomPerson {
        id: id.into(),
        name: name.into(),
        file: None,
    }
}

fn squad() -> Vec<RoomPerson> {
    vec![
        person("u-dropbear", "dropbear"),
        person("u-pri", "pri"),
        person(YOU, "alexk"),
    ]
}

fn twelve() -> Vec<RoomPerson> {
    let mut all = squad();
    for name in [
        "aiko",
        "gracie",
        "kwam3",
        "Samira",
        "chlo",
        "tomatillo",
        "Diego",
        "noahbody",
        "zara",
    ] {
        all.push(person(&format!("u-{}", name.to_lowercase()), name));
    }
    all
}

#[derive(Clone)]
struct Room {
    id: &'static str,
    name: String,
    people: Vec<RoomPerson>,
    here: bool,
    speaking: Vec<&'static str>,
    can_join: bool,
}

fn room(id: &'static str, name: &str, people: Vec<RoomPerson>) -> Room {
    Room {
        id,
        name: name.into(),
        people,
        here: false,
        speaking: Vec::new(),
        can_join: true,
    }
}

fn squad_here() -> Room {
    Room {
        here: true,
        speaking: vec!["u-dropbear"],
        ..room("vc-squad", "Squad Up", squad())
    }
}

fn afk() -> Room {
    room("vc-afk", "AFK", vec![person("u-kwam3", "kwam3")])
}

#[derive(Clone)]
struct You {
    line: Option<&'static str>,
    call: Option<CallStatus>,
}

fn in_call(mic: Mic, deafened: bool) -> You {
    You {
        line: Some("In Squad Up"),
        call: Some(CallStatus {
            mic,
            deafened,
            key_label: (mic == Mic::PushToTalk).then(|| "V".into()),
        }),
    }
}

fn member(id: &str, name: &str) -> MemberSummary {
    MemberSummary {
        id: id.into(),
        name: name.into(),
        file: None,
        role: None,
        online: true,
        status: None,
        in_room: None,
    }
}

fn with(
    mut member: MemberSummary,
    role: Option<&str>,
    status: Option<&str>,
    room: Option<&str>,
) -> MemberSummary {
    member.role = role.map(Into::into);
    member.status = status.map(Into::into);
    member.in_room = room.map(Into::into);
    member
}

fn away(id: &str, name: &str) -> MemberSummary {
    MemberSummary {
        online: false,
        ..member(id, name)
    }
}

fn mockup_members() -> MemberGroups {
    MemberGroups {
        hosts: vec![
            with(
                member("u-samira", "Samira"),
                Some("admin"),
                Some("keeping the server warm"),
                None,
            ),
            with(
                member("u-dropbear", "dropbear"),
                Some("mod"),
                Some("back at 9"),
                Some("Squad Up"),
            ),
            with(
                member("u-gracie", "gracie"),
                Some("mod"),
                Some("work tomorrow"),
                None,
            ),
        ],
        around: vec![
            with(
                member("u-aiko", "aiko"),
                None,
                Some("needs her headset back"),
                None,
            ),
            with(member(YOU, "alexk"), None, None, Some("Squad Up")),
            with(
                member("u-chlo", "chlo"),
                None,
                Some("listening to lo-fi"),
                None,
            ),
            with(member("u-kwam3", "kwam3"), None, None, Some("AFK")),
            with(
                member("u-pri", "pri"),
                None,
                Some("downloading 40gb update"),
                Some("Squad Up"),
            ),
            with(
                member("u-tomatillo", "tomatillo"),
                None,
                Some("playing Deep Rock"),
                None,
            ),
        ],
        away: vec![
            away("u-diego", "Diego"),
            away("u-noahbody", "noahbody"),
            away("u-zara", "zara"),
        ],
    }
}

/// `count` members: a few hosts, a third around, the rest away.
fn many_members(count: usize) -> MemberGroups {
    let mut groups = MemberGroups::default();
    for i in 0..count {
        let mut one = member(&format!("u-{}", i + 1), &format!("member-{}", i + 1));
        one.online = i % 3 == 0;
        if i % 5 == 0 {
            one.status = Some("around tonight".into());
        }
        if i < 4 {
            one.role = Some(if i == 0 { "admin" } else { "mod" }.into());
            groups.hosts.push(one);
        } else if one.online {
            groups.around.push(one);
        } else {
            groups.away.push(one);
        }
    }
    groups
}

// ---------------------------------------------------------------------------------------------
// The scene a story shows

#[derive(Clone)]
struct Members {
    groups: MemberGroups,
    around: Option<u32>,
    truncated: bool,
    face: Face,
}

#[derive(Clone)]
struct Scene {
    mode: Mode,
    communities: Vec<Community>,
    current: DockCurrent,
    inbox: u32,
    dock: DockStatus,
    /// The sheet starts open.
    sheet: bool,
    sheet_face: Face,
    can_create: bool,
    filter: &'static str,
    notifications: u32,
    header: Option<String>,
    around: Option<u32>,
    can_settings: bool,
    menu: bool,
    access: CommunityLeftAccess,
    channels: Vec<ChannelItem>,
    selected: Option<&'static str>,
    channel_face: Face,
    busy: Option<&'static str>,
    rooms: Vec<Room>,
    you: Option<You>,
    members: Option<Members>,
    members_button: bool,
    right_open: Option<bool>,
    pane: PhonePane,
}

fn base() -> Scene {
    Scene {
        mode: Mode::Dark,
        communities: mockup(5),
        current: DockCurrent::Community("c-1".into()),
        inbox: 9,
        dock: DockStatus::Ready,
        sheet: false,
        sheet_face: Face::Ready,
        can_create: true,
        filter: "",
        notifications: 0,
        header: Some("Couch Co-op".into()),
        around: Some(9),
        can_settings: true,
        menu: false,
        access: CommunityLeftAccess::Member,
        channels: channels(),
        selected: Some("ch-general"),
        channel_face: Face::Ready,
        busy: None,
        rooms: vec![squad_here(), afk()],
        you: Some(in_call(Mic::On, false)),
        members: None,
        members_button: false,
        right_open: None,
        pane: PhonePane::Left,
    }
}

fn members_scene() -> Members {
    Members {
        groups: mockup_members(),
        around: Some(9),
        truncated: false,
        face: Face::Ready,
    }
}

/// The community left island's stories: the members beside it, as the web's `Left members`.
fn left() -> Scene {
    Scene {
        members: Some(members_scene()),
        members_button: true,
        ..base()
    }
}

fn sheet() -> Scene {
    Scene {
        communities: mockup(12),
        sheet: true,
        ..base()
    }
}

fn members(groups: MemberGroups, around: Option<u32>) -> Scene {
    Scene {
        rooms: Vec::new(),
        members: Some(Members {
            groups,
            around,
            truncated: false,
            face: Face::Ready,
        }),
        right_open: Some(true),
        pane: PhonePane::Centre,
        ..base()
    }
}

// ---------------------------------------------------------------------------------------------
// The view

struct Demo {
    scene: Scene,
    filter: Entity<InputState>,
    sheet: bool,
    menu: bool,
    right_open: Option<bool>,
    left_scroll: ScrollHandle,
    right_scroll: ScrollHandle,
}

fn sample_centre(cx: &App) -> Div {
    let secondary = cx.sem().role.text_secondary;
    let lines = [
        (
            "u-dropbear",
            "dropbear",
            "found the clip from last night, it is even better slowed down",
        ),
        ("u-pri", "pri", "send it over, the couch demands it"),
        (
            "u-aiko",
            "aiko",
            "lfg for tonight? we are one short for the co-op run",
        ),
    ];
    column()
        .size_full()
        .gap(px(SPACE_LG))
        .p(px(SPACE_XL))
        .child(text_line(t::TEXT_TITLE, "general"))
        .children(lines.iter().map(|(id, who, line)| {
            div()
                .flex()
                .gap(px(SPACE_MD))
                .child(
                    Avatar::new(*who)
                        .colour(person_colour(Some(id)))
                        .decorative(true),
                )
                .child(
                    column()
                        .child(text_line(t::TEXT_NAME, *who))
                        .child(text_line(t::TEXT_BODY, *line).text_color(secondary)),
                )
        }))
}

impl Render for Demo {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let s = self.scene.clone();
        let range = WidthRange::current(window);
        let this = cx.entity().downgrade();
        let wide = range.is_wide();
        let right_shown = self.right_open.unwrap_or(wide);

        let open_all = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.sheet = true;
                    cx.notify();
                });
            }
        };
        let dock = ShellDock::new(
            s.communities
                .iter()
                .map(|community| DockCommunity {
                    id: community.id.clone(),
                    name: community.name.clone(),
                    file: None,
                    mentions: community.mentions,
                    new_messages: community.new_messages,
                })
                .collect(),
            s.current.clone(),
            s.dock,
        )
        .inbox_count(s.inbox)
        .on_all(open_all);

        let show_members = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.right_open = Some(true);
                    cx.notify();
                });
            }
        };
        let toggle_menu = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.menu = !demo.menu;
                    cx.notify();
                });
            }
        };
        let close_menu = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.menu = false;
                    cx.notify();
                });
            }
        };
        let mut header = CommunityHeader::new(s.header.clone())
            .around(s.around)
            .can_settings(s.can_settings)
            .menu_open(self.menu)
            .members_shown(wide && right_shown)
            .on_menu(toggle_menu)
            .on_menu_close(close_menu.clone())
            .on_settings(close_menu);
        if s.members_button && s.members.is_some() {
            header = header.on_show_members(show_members);
        }
        let channels = ChannelSection::new(s.channels.clone(), s.channel_face.clone())
            .selected(s.selected.map(Into::into))
            .busy(s.busy.map(Into::into))
            .has_rooms(!s.rooms.is_empty())
            .scroll(&self.left_scroll);
        let rooms = s
            .rooms
            .iter()
            .map(|room| {
                VoiceRoomCard::new(room.id, room.name.clone(), room.people.clone())
                    .you(Some(YOU.into()))
                    .you_are_here(room.here)
                    .can_join(room.can_join)
                    .speaking(
                        room.speaking
                            .iter()
                            .map(|id| (*id).to_owned())
                            .collect::<HashSet<_>>(),
                    )
            })
            .collect();
        let left = CommunityLeft::new(header, channels)
            .access(s.access)
            .rooms(rooms);

        let close_right = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.right_open = Some(false);
                    cx.notify();
                });
            }
        };
        let mut islands = ThreeIslands::new(left, "Couch Co-op", sample_centre(cx), "general")
            .dock(dock)
            .phone_pane(s.pane)
            .left_scroll(&self.left_scroll)
            .right_scroll(&self.right_scroll)
            .right_open(self.right_open)
            .on_right_close(close_right);
        if let Some(members) = &s.members {
            islands = islands
                .right(
                    MembersIsland::new(members.groups.clone(), members.face.clone())
                        .around(members.around)
                        .truncated(members.truncated)
                        .scroll(&self.right_scroll)
                        .on_profile(|_, _, _| {}),
                )
                .right_label("Members");
        }
        if let (Some(you), false) = (&s.you, range.is_phone()) {
            islands = islands.left_footer(
                UserCard::new(Some("alexk"))
                    .person(YOU, None)
                    .line(you.line)
                    .call(you.call.clone()),
            );
        }

        let sheet = self.sheet.then(|| {
            let close = move |_, _: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.sheet = false;
                    cx.notify();
                });
            };
            let current = match &s.current {
                DockCurrent::Community(id) => Some(id.clone()),
                _ => None,
            };
            AllCommunitiesSheet::new(
                "moss.social",
                s.communities
                    .iter()
                    .map(|community| SheetCommunity {
                        id: community.id.clone(),
                        name: community.name.clone(),
                        file: None,
                        mentions: community.mentions,
                        new_messages: community.new_messages,
                        in_your_call: community.in_call,
                    })
                    .collect(),
                s.sheet_face.clone(),
            )
            .username(Some("alexk"))
            .current(current)
            .can_create(s.can_create)
            .filter(&self.filter)
            .phone_foot(range.is_phone())
            .notification_count(s.notifications)
            .on_close(close)
        });
        div()
            .size_full()
            .child(AppFrame::new(islands))
            .children(sheet)
    }
}

fn demo(scene: fn() -> Scene, window: &mut Window, cx: &mut App) -> AnyView {
    let scene = scene();
    theme::apply(
        ThemeInput::new(DEFAULT_BASE, scene.mode, Intensity::Minimal),
        cx,
    );
    let filter = text_state(window, cx, false);
    if !scene.filter.is_empty() {
        let value = scene.filter;
        filter.update(cx, |state, cx| state.set_value(value, window, cx));
    }
    cx.new(|cx| {
        cx.observe(&filter, |_, _, cx| cx.notify()).detach();
        Demo {
            sheet: scene.sheet,
            menu: scene.menu,
            right_open: scene.right_open,
            left_scroll: ScrollHandle::new(),
            right_scroll: ScrollHandle::new(),
            scene,
            filter,
        }
    })
    .into()
}

pub fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $scene:expr) => {
            Story::new($name, |_, window, cx| demo($scene, window, cx))
        };
    }
    vec![
        // The dock (`ShellDock.stories.tsx`).
        story!("shell-dock-mentions-and-new", base),
        story!("shell-dock-light", || Scene {
            mode: Mode::Light,
            ..base()
        }),
        story!("shell-dock-loading", || Scene {
            dock: DockStatus::Loading,
            ..base()
        }),
        story!("shell-dock-load-error", || Scene {
            dock: DockStatus::Error,
            ..base()
        }),
        story!("shell-dock-none", || Scene {
            communities: Vec::new(),
            current: DockCurrent::None,
            inbox: 0,
            ..base()
        }),
        story!("shell-dock-one", || Scene {
            communities: communities(1),
            ..base()
        }),
        story!("shell-dock-twelve", || Scene {
            communities: mockup(12),
            ..base()
        }),
        story!("shell-dock-sixty", || Scene {
            communities: mockup(60),
            current: DockCurrent::Community("c-55".into()),
            ..base()
        }),
        story!("shell-dock-inbox-current", || Scene {
            current: DockCurrent::Inbox,
            ..base()
        }),
        story!("shell-dock-long-names", || {
            let mut all = mockup(5);
            all[0].name = LONG_NAME.into();
            Scene {
                communities: all,
                ..base()
            }
        }),
        // The "All communities" sheet (`AllCommunitiesSheet.stories.tsx`).
        story!("all-communities-sheet-twelve", sheet),
        story!("all-communities-sheet-twelve-light", || Scene {
            mode: Mode::Light,
            ..sheet()
        }),
        story!("all-communities-sheet-few", || Scene {
            communities: mockup(5),
            ..sheet()
        }),
        story!("all-communities-sheet-sixty", || Scene {
            communities: mockup(60),
            current: DockCurrent::Community("c-55".into()),
            ..sheet()
        }),
        story!("all-communities-sheet-filtered", || Scene {
            filter: "lan",
            ..sheet()
        }),
        story!("all-communities-sheet-no-match", || Scene {
            filter: "zebra",
            ..sheet()
        }),
        story!("all-communities-sheet-empty", || Scene {
            communities: Vec::new(),
            current: DockCurrent::None,
            sheet_face: Face::Empty,
            ..sheet()
        }),
        story!("all-communities-sheet-no-create", || Scene {
            communities: mockup(5),
            can_create: false,
            ..sheet()
        }),
        story!("all-communities-sheet-loading", || Scene {
            sheet_face: Face::Loading,
            ..sheet()
        }),
        story!("all-communities-sheet-load-error", || Scene {
            sheet_face: Face::Error("The server didn't answer.".into(), Retry::new(|_, _| {})),
            ..sheet()
        }),
        story!("all-communities-sheet-long-names", || {
            let mut all = mockup(5);
            all[1].name = LONG_NAME.into();
            Scene {
                communities: all,
                ..sheet()
            }
        }),
        story!("all-communities-sheet-foot-notifications", || Scene {
            communities: mockup(3),
            notifications: 7,
            ..sheet()
        }),
        // The community left island (`CommunityLeft.stories.tsx`).
        story!("community-left-default", left),
        story!("community-left-light", || Scene {
            mode: Mode::Light,
            ..left()
        }),
        story!("community-left-not-in-call", || Scene {
            rooms: vec![room("vc-squad", "Squad Up", squad()[..2].to_vec()), afk()],
            you: Some(You {
                line: Some("keeping it chill"),
                call: None
            }),
            ..left()
        }),
        story!("community-left-here-with-twelve", || Scene {
            rooms: vec![
                Room {
                    people: twelve(),
                    ..squad_here()
                },
                afk()
            ],
            ..left()
        }),
        story!("community-left-cannot-join", || Scene {
            rooms: vec![
                squad_here(),
                Room {
                    can_join: false,
                    ..afk()
                }
            ],
            ..left()
        }),
        story!("community-left-no-permission", || Scene {
            can_settings: false,
            ..left()
        }),
        story!("community-left-no-around-count", || Scene {
            around: None,
            ..left()
        }),
        story!("community-left-five-channels", || Scene {
            channels: five_channels(),
            selected: Some("ch-lfg"),
            ..left()
        }),
        story!("community-left-zero-channels", || Scene {
            channels: Vec::new(),
            channel_face: Face::Empty,
            rooms: Vec::new(),
            ..left()
        }),
        story!("community-left-two-hundred-channels", || Scene {
            channels: many_channels(200),
            selected: Some("ch-3"),
            ..left()
        }),
        story!("community-left-long-names", || {
            let mut all = channels();
            all[1].name = LONG_CHANNEL.into();
            Scene {
                header: Some(LONG_NAME.into()),
                channels: all,
                rooms: vec![Room {
                    name: LONG_NAME.into(),
                    ..squad_here()
                }],
                ..left()
            }
        }),
        story!("community-left-loading", || Scene {
            header: None,
            channel_face: Face::Loading,
            rooms: Vec::new(),
            ..left()
        }),
        story!("community-left-load-error", || Scene {
            channel_face: Face::Error("The server didn't answer.".into(), Retry::new(|_, _| {})),
            rooms: Vec::new(),
            ..left()
        }),
        story!("community-left-not-member", || Scene {
            access: CommunityLeftAccess::NotMember,
            you: None,
            ..left()
        }),
        story!("community-left-user-muted", || Scene {
            you: Some(in_call(Mic::Muted, false)),
            ..left()
        }),
        story!("community-left-user-deafened", || Scene {
            you: Some(in_call(Mic::Muted, true)),
            ..left()
        }),
        story!("community-left-user-server-muted", || Scene {
            you: Some(in_call(Mic::ServerMuted, false)),
            ..left()
        }),
        story!("community-left-user-push-to-talk", || Scene {
            you: Some(in_call(Mic::PushToTalk, false)),
            ..left()
        }),
        story!("community-left-members-button-island-closed", || Scene {
            right_open: Some(false),
            ..left()
        }),
        story!("community-left-busy-channel-row", || Scene {
            busy: Some("ch-lfg"),
            ..left()
        }),
        story!("community-left-menu-open", || Scene {
            menu: true,
            ..left()
        }),
        // The members island (`MembersIsland.stories.tsx`).
        story!("members-island-default", || members(
            mockup_members(),
            Some(9)
        )),
        story!("members-island-light", || Scene {
            mode: Mode::Light,
            ..members(mockup_members(), Some(9))
        }),
        story!("members-island-sixty", || {
            let groups = many_members(60);
            let around = groups.online();
            members(groups, Some(around))
        }),
        story!("members-island-three-hundred", || {
            let mut scene = members(many_members(300), None);
            if let Some(members) = &mut scene.members {
                members.truncated = true;
            }
            scene
        }),
        story!("members-island-no-hosts", || {
            let mut groups = mockup_members();
            groups.hosts.clear();
            members(groups, Some(6))
        }),
        story!("members-island-only-away", || {
            let mut groups = mockup_members();
            groups.hosts.clear();
            groups.around.clear();
            members(groups, Some(0))
        }),
        story!("members-island-long-status", || {
            let mut groups = mockup_members();
            groups.around[0].status = Some(
                "back in a bit, the cat knocked the router off the shelf again and it is somehow my fault".into(),
            );
            groups.hosts[0].name = LONG_NAME.into();
            members(groups, Some(9))
        }),
        story!("members-island-loading", || {
            let mut scene = members(MemberGroups::default(), None);
            if let Some(members) = &mut scene.members {
                members.face = Face::Loading;
            }
            scene
        }),
        story!("members-island-empty", || {
            let mut scene = members(MemberGroups::default(), None);
            if let Some(members) = &mut scene.members {
                members.face = Face::Empty;
            }
            scene
        }),
        story!("members-island-load-error", || {
            let mut scene = members(MemberGroups::default(), None);
            if let Some(members) = &mut scene.members {
                members.face =
                    Face::Error("The server didn't answer.".into(), Retry::new(|_, _| {}));
            }
            scene
        }),
    ]
}
