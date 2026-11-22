//! The left island of a community (design §3.3, the web's `CommunityLeft`, `CommunityHeader` and
//! `ChannelSection`): the community's header and its menu, the text channels and the voice rooms.
//! The frame puts your card ([`super::UserCard`]) at the island's foot at compact and wide.

use super::lines::{around_line, channel_trailing_label, members_button_text, mention_text};
use super::{Act, Face, IdAct, Rows, VoiceRoomCard, column, focused, text_line};
use crate::kit::{
    Avatar, AvatarShape, AvatarSize, Badge, BadgeTone, Button, ButtonSize, Card, ControlSize, Icon,
    IconButton, IconButtonVariant, ListRow, Menu, MenuItem, Skeleton,
};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, LAYOUT_GUTTER, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XS};
use semaphore_design::{Icon as I, LoungeIcon};
use std::rc::Rc;

// ---------------------------------------------------------------------------------------------
// The header

/// The community's header: avatar, name and "N around", on a Card. While the members are not
/// beside the list, "N around" is a text button that shows them. With Community settings allowed,
/// a menu button at its end opens a menu of exactly that; without, the header is a plain heading.
#[derive(IntoElement)]
pub struct CommunityHeader {
    /// None while the community loads.
    name: Option<SharedString>,
    file: Option<String>,
    around: Option<u32>,
    can_settings: bool,
    menu_open: bool,
    members_shown: bool,
    on_show_members: Option<Act>,
    on_menu: Option<Act>,
    on_menu_close: Option<Act>,
    on_settings: Option<Act>,
}

impl CommunityHeader {
    pub fn new(name: Option<impl Into<SharedString>>) -> Self {
        Self {
            name: name.map(Into::into),
            file: None,
            around: None,
            can_settings: false,
            menu_open: false,
            members_shown: false,
            on_show_members: None,
            on_menu: None,
            on_menu_close: None,
            on_settings: None,
        }
    }

    pub fn file(mut self, file: Option<String>) -> Self {
        self.file = file;
        self
    }

    /// Online members in the whole community; none when no source knows it.
    pub fn around(mut self, count: Option<u32>) -> Self {
        self.around = count;
        self
    }

    /// You may open Community settings: the menu button shows.
    pub fn can_settings(mut self, can: bool) -> Self {
        self.can_settings = can;
        self
    }

    /// The menu is open (the owner holds it).
    pub fn menu_open(mut self, open: bool) -> Self {
        self.menu_open = open;
        self
    }

    /// The members island is on screen beside the list: "N around" stays plain text.
    pub fn members_shown(mut self, shown: bool) -> Self {
        self.members_shown = shown;
        self
    }

    pub fn on_show_members(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_show_members = Some(Rc::new(handler));
        self
    }

    /// The menu button: the owner opens or closes the menu.
    pub fn on_menu(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_menu = Some(Rc::new(handler));
        self
    }

    pub fn on_menu_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_menu_close = Some(Rc::new(handler));
        self
    }

    pub fn on_settings(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_settings = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for CommunityHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        let Some(name) = self.name else {
            return Card::new("community-header").child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_MD))
                    .child(Skeleton::circle("community-header-avatar", AvatarSize::Lg))
                    .child(
                        div()
                            .flex_1()
                            .child(Skeleton::text("community-header-lines", 2)),
                    ),
            );
        };
        let line: AnyElement = match (&self.on_show_members, self.members_shown) {
            (Some(show), false) => {
                let (words, name) = members_button_text(self.around);
                let show = show.clone();
                Button::new("community-members", words)
                    .accessibility_label(name)
                    .text()
                    .size(ButtonSize::Sm)
                    .on_click(move |_, window, cx| show(window, cx))
                    .into_any_element()
            }
            _ => around_line(self.around)
                .map(|line| {
                    text_line(t::TEXT_META, line)
                        .text_color(secondary)
                        .truncate()
                        .into_any_element()
                })
                .unwrap_or_else(|| div().into_any_element()),
        };
        let menu = self.can_settings.then(|| {
            let toggle = self.on_menu.clone();
            let button = IconButton::new(
                "community-menu",
                I::ExpandMore,
                format!("{name}, community menu"),
            )
            .lounge_icon(LoungeIcon::ChevronDown)
            .variant(IconButtonVariant::Soft)
            .size(ControlSize::Sm)
            .selected(self.menu_open)
            .on_click(move |_, window, cx| {
                if let Some(toggle) = &toggle {
                    toggle(window, cx);
                }
            });
            let open = self.menu_open.then(|| {
                let settings = self.on_settings.clone();
                let close = self.on_menu_close.clone();
                let item = MenuItem::new(
                    "community-settings",
                    "Community settings",
                    move |window, cx| {
                        if let Some(settings) = &settings {
                            settings(window, cx);
                        }
                    },
                )
                .icon(I::Settings);
                let menu = Menu::new(format!("{name} menu"), [item])
                    .id("community-menu-list")
                    .on_close(move |_, window, cx| {
                        if let Some(close) = &close {
                            close(window, cx);
                        }
                    });
                div()
                    .absolute()
                    .top_full()
                    .right_0()
                    .mt(px(crate::kit::ANCHOR_GAP))
                    .child(
                        deferred(
                            anchored()
                                .anchor(Anchor::TopRight)
                                .snap_to_window_with_margin(px(LAYOUT_GUTTER))
                                // Its own width (the kit's minimum) under the chevron, as the
                                // web's `placement="bottom-end"`; occluding, so a press on it
                                // reaches nothing beneath.
                                .child(div().occlude().child(menu)),
                        )
                        .with_priority(1),
                    )
            });
            div().relative().flex_none().child(button).children(open)
        });
        Card::new("community-header").child(
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_MD))
                .child(
                    Avatar::new(name.clone())
                        .shape(AvatarShape::Rounded)
                        .size(AvatarSize::Lg)
                        .file(self.file.as_deref())
                        .decorative(true),
                )
                .child(
                    column()
                        .flex_1()
                        .items_start()
                        .gap(px(SPACE_XS))
                        .child(
                            text_line(t::TEXT_TITLE, name)
                                .id("community-name")
                                .test_support()
                                .w_full()
                                .truncate(),
                        )
                        .child(line),
                )
                .children(menu),
        )
    }
}

// ---------------------------------------------------------------------------------------------
// The channels

/// A text channel in the list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelItem {
    pub id: String,
    pub name: String,
    /// New messages since you last read it (bold).
    pub unread: bool,
    pub mentions: u32,
    pub private: bool,
    /// An announcement channel: most members only read it.
    pub announcement: bool,
}

/// The community's text channels as one keyboard list. Unread channels are bold, mentions a
/// count, the channel you are in the selected pill; an announcement channel wears the megaphone,
/// a private one the lock. Row ids are `channel-<id>`.
#[derive(IntoElement)]
pub struct ChannelSection {
    channels: Vec<ChannelItem>,
    selected: Option<String>,
    face: Face,
    has_rooms: bool,
    busy: Option<String>,
    on_channel: Option<IdAct>,
    scroll: Option<ScrollHandle>,
}

impl ChannelSection {
    pub fn new(channels: Vec<ChannelItem>, face: Face) -> Self {
        Self {
            channels,
            selected: None,
            face,
            has_rooms: false,
            busy: None,
            on_channel: None,
            scroll: None,
        }
    }

    pub fn selected(mut self, id: Option<String>) -> Self {
        self.selected = id;
        self
    }

    /// The community has voice rooms: an empty list says "No text channels yet".
    pub fn has_rooms(mut self, has: bool) -> Self {
        self.has_rooms = has;
        self
    }

    /// The row just chosen whose screen is still on its way: busy.
    pub fn busy(mut self, id: Option<String>) -> Self {
        self.busy = id;
        self
    }

    pub fn on_channel(mut self, handler: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_channel = Some(Rc::new(handler));
        self
    }

    /// The handle of the island the list scrolls in: a row that takes focus is brought into
    /// view.
    pub fn scroll(mut self, handle: &ScrollHandle) -> Self {
        self.scroll = Some(handle.clone());
        self
    }
}

impl RenderOnce for ChannelSection {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        let rows = Rows::new(
            "channel-list",
            self.channels
                .iter()
                .map(|channel| (channel.id.clone(), channel.name.clone()))
                .collect(),
            self.selected.clone(),
            self.scroll.clone(),
            window,
            cx,
        );
        let items: Vec<AnyElement> = self
            .channels
            .iter()
            .map(|channel| {
                let selected = self.selected.as_deref() == Some(channel.id.as_str());
                let mentions = if selected { 0 } else { channel.mentions };
                let icon = if channel.announcement {
                    LoungeIcon::Megaphone
                } else if channel.private {
                    LoungeIcon::Lock
                } else {
                    LoungeIcon::Hash
                };
                let open = self.on_channel.clone();
                let id = channel.id.clone();
                let mut row = ListRow::new(
                    SharedString::from(format!("channel-{}", channel.id)),
                    channel.name.clone(),
                )
                .selected(selected)
                .unread(!selected && channel.unread)
                .leading(Icon::lounge(icon))
                .busy(self.busy.as_deref() == Some(channel.id.as_str()))
                .on_click(move |window, cx| {
                    if let Some(open) = &open {
                        open(&id, window, cx);
                    }
                });
                let label = channel_trailing_label(channel.announcement, channel.private, mentions);
                if !label.is_empty() {
                    row = row.trailing_label(label);
                }
                if mentions > 0 {
                    row = row.trailing(
                        Badge::new(mention_text(mentions))
                            .count(mentions)
                            .tone(BadgeTone::Accent)
                            .decorative(true),
                    );
                }
                focused(row, &rows, &channel.id, cx)
            })
            .collect();
        let empty = if self.has_rooms {
            "No text channels yet."
        } else {
            "No channels yet. They show here once someone creates one."
        };
        column()
            .gap(px(SPACE_XS))
            .child(text_line(t::TEXT_SECTION, "Channels").text_color(secondary))
            .child(
                self.face
                    .view("channels-load")
                    .lines(6)
                    .empty(empty)
                    .error_title("Couldn't load channels")
                    .content(rows.keys(column()).children(items)),
            )
    }
}

// ---------------------------------------------------------------------------------------------
// The island

/// Whether the server says the community is yours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CommunityLeftAccess {
    #[default]
    Member,
    /// 403/404: not a member (or no such community).
    NotMember,
}

/// The left island's content: the header, the channels and the "Voice rooms" section (none
/// without rooms), or the not-a-member face.
#[derive(IntoElement)]
pub struct CommunityLeft {
    access: CommunityLeftAccess,
    header: CommunityHeader,
    channels: ChannelSection,
    rooms: Vec<VoiceRoomCard>,
    on_leave: Option<Act>,
}

impl CommunityLeft {
    pub fn new(header: CommunityHeader, channels: ChannelSection) -> Self {
        Self {
            access: CommunityLeftAccess::Member,
            header,
            channels,
            rooms: Vec::new(),
            on_leave: None,
        }
    }

    pub fn access(mut self, access: CommunityLeftAccess) -> Self {
        self.access = access;
        self
    }

    pub fn rooms(mut self, rooms: Vec<VoiceRoomCard>) -> Self {
        self.rooms = rooms;
        self
    }

    /// The not-a-member face's button.
    pub fn on_leave(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_leave = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for CommunityLeft {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        if self.access == CommunityLeftAccess::NotMember {
            let leave = self.on_leave.clone();
            return column()
                .gap(px(SPACE_MD))
                .child(text_line(
                    t::TEXT_TITLE,
                    "You're not a member of this community",
                ))
                .child(
                    text_line(t::TEXT_BODY, "Ask someone in it for an invite.")
                        .text_color(secondary),
                )
                .child(div().flex().child(
                    Button::new("community-leave", "Go to your communities").on_click(
                        move |_, window, cx| {
                            if let Some(leave) = &leave {
                                leave(window, cx);
                            }
                        },
                    ),
                ));
        }
        let has_rooms = !self.rooms.is_empty();
        column()
            .gap(px(SPACE_LG))
            .child(self.header)
            .child(self.channels)
            .when(has_rooms, |column_| {
                column_.child(
                    column()
                        .gap(px(SPACE_SM))
                        .child(text_line(t::TEXT_SECTION, "Voice rooms").text_color(secondary))
                        .children(self.rooms),
                )
            })
    }
}
