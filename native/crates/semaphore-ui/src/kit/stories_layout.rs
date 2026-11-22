//! The layout templates, one story per state the web kit's stories show
//! (`frontend/src/stories/kit/Kit{AppFrame,ThreeIslands,SettingsLayout,StageLayout,CallStack}.stories.tsx`),
//! with the web's sample content (`frontend/src/stories/fixtures/layoutSamples.tsx`). Each fills
//! the window, so the UI review's phone, tablet and desktop sizes show the three width ranges.
//! The Members, People and Back buttons and the channel and section rows work, as on the web.

use super::{
    Alert, AppFrame, Avatar, AvatarShape, AvatarSize, Badge, Button, ButtonSize, CallStack, Card,
    Dock, DockDivider, DockEntry, DockItem, FieldShape, Icon, IconButton, IconButtonVariant,
    Island, ListRow, Padding, PhonePane, Pill, PillTone, Presence, RowSize, SettingsLayout,
    SettingsPane, Severity, StageLayout, Surface, Switch, TextField, ThreeIslands,
    WidthRange, text_state,
};
use crate::kit::overlays::type_text;
use crate::stories::Story;
use crate::theme::{self, DEFAULT_BASE, SemTheme, ThemeInput};
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    self as t, LAYOUT_DIALOG_MD, SPACE_2XS, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL, SPACE_XS,
};
use semaphore_design::{Icon as I, Intensity, LoungeIcon, Mode, Rgba};

// ---------------------------------------------------------------------------------------------
// Sample content

fn meta(text: impl Into<SharedString>, cx: &App) -> Div {
    type_text(t::TEXT_META, text)
        .text_color(cx.sem().role.text_secondary)
        .truncate()
}

fn column() -> Div {
    div().flex().flex_col().min_w_0()
}

fn dock() -> Dock {
    let item = |name: &'static str, colour: u32| {
        DockItem::new(name, name)
            .colour(Rgba(colour))
            .on_click(|_, _| {})
    };
    Dock::new("layout-dock", "Pinned communities")
        .start(DockEntry::button(
            "inbox",
            IconButton::new(
                "layout-inbox",
                I::Notifications,
                "Inbox, 9 unread across all instances",
            )
            .variant(IconButtonVariant::Primary),
        ))
        .start(DockDivider)
        .item(item("Couch Co-op", 0xff9a6bff).current(true))
        .item(item("Lumen Studio", 0x6bc5e0ff).unread(2))
        .item(item("Friday LAN", 0xe0c060ff).reconnecting(true))
        .end(DockEntry::button(
            "all",
            IconButton::new("layout-all", I::GridView, "All communities")
                .variant(IconButtonVariant::Soft),
        ))
}

fn hash() -> Icon {
    Icon::lounge(LoungeIcon::Hash)
}

fn channels(on_pick: impl Fn(&mut Window, &mut App) + Clone + 'static, cx: &App) -> Div {
    let row = |id: &'static str, name: &'static str| {
        let pick = on_pick.clone();
        ListRow::new(id, name)
            .leading(hash())
            .on_click(move |window, cx| pick(window, cx))
    };
    let people = |name: &'static str, colour: u32| {
        Avatar::new(name)
            .colour(Rgba(colour))
            .size(AvatarSize::Sm)
            .decorative(true)
    };
    column()
        .gap(px(SPACE_LG))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_MD))
                .px(px(SPACE_SM))
                .py(px(SPACE_XS))
                .child(
                    Avatar::new("Couch Co-op")
                        .colour(Rgba(0xff9a6bff))
                        .shape(AvatarShape::Rounded)
                        .size(AvatarSize::Lg)
                        .decorative(true),
                )
                .child(
                    column()
                        .flex_1()
                        .child(type_text(t::TEXT_NAME, "Couch Co-op").truncate())
                        .child(meta("moss.social", cx)),
                )
                .child(IconButton::new(
                    "layout-community-settings",
                    I::Settings,
                    "Community settings",
                )),
        )
        .child(
            column()
                .child(row("ch-general", "general").selected(true))
                .child(
                    row("ch-clips", "clips")
                        .unread(true)
                        .trailing(Badge::new("2 unread").count(2)),
                )
                .child(row("ch-lfg", "lfg"))
                .child(row("ch-memes", "memes")),
        )
        .child(
            column()
                .gap(px(SPACE_SM))
                .child(
                    type_text(t::TEXT_SECTION, "Voice rooms")
                        .text_color(cx.sem().role.text_secondary),
                )
                .child(
                    Card::new("room-squad").selected(true).child(
                        column()
                            .gap(px(SPACE_SM))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(SPACE_SM))
                                    .child(
                                        column()
                                            .flex_1()
                                            .items_start()
                                            .gap(px(SPACE_2XS))
                                            .child(type_text(t::TEXT_BODY_STRONG, "Squad Up"))
                                            .child(Pill::new("You're here").tone(PillTone::Accent)),
                                    )
                                    .child(Button::new("room-leave", "Leave").soft().size(
                                        ButtonSize::Sm,
                                    )),
                            )
                            .child(
                                div()
                                    .flex()
                                    .gap(px(SPACE_XS))
                                    .child(people("dropbear", 0x5fd49aff))
                                    .child(people("pri", 0xc792f0ff))
                                    .child(people("alexk", 0x9aa0ffff)),
                            ),
                    ),
                )
                .child(
                    Card::new("room-afk")
                        .label("Join AFK, kwam3 is in it")
                        .on_click(|_, _| {})
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(SPACE_SM))
                                .child(
                                    type_text(t::TEXT_BODY_STRONG, "AFK")
                                        .flex_1()
                                        .text_color(cx.sem().role.text_secondary),
                                )
                                .child(Pill::new("1 here")),
                        ),
                ),
        )
}

const MESSAGES: [(&str, u32, &str, &str); 5] = [
    (
        "dropbear",
        0x5fd49aff,
        "8:41",
        "found the clip from last night, it is somehow even better in slow motion",
    ),
    ("pri", 0xc792f0ff, "8:43", "send it over, the couch demands it"),
    (
        "aiko",
        0xff8fb8ff,
        "8:47",
        "also lfg for tonight? we are one short for the co-op run",
    ),
    (
        "kwam3",
        0x6fb1f5ff,
        "8:52",
        "in, but I need ten minutes to find a headset that works",
    ),
    (
        "alexk",
        0x9aa0ffff,
        "8:53",
        "ten minutes it is. Squad Up at nine?",
    ),
];

fn conversation(
    draft: &Entity<InputState>,
    on_members: impl Fn(&mut Window, &mut App) + 'static,
    on_back: Option<Box<dyn Fn(&mut Window, &mut App)>>,
    cx: &App,
) -> Div {
    column()
        .flex_1()
        .min_h_0()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_MD))
                .pt(px(SPACE_MD))
                .pr(px(SPACE_LG))
                .pb(px(SPACE_SM))
                .pl(px(SPACE_XL))
                .when_some(on_back, |header, back| {
                    header.child(
                        IconButton::new("layout-back", I::ArrowBack, "Back to channels")
                            .on_click(move |_, window, cx| back(window, cx)),
                    )
                })
                .child(type_text(t::TEXT_TITLE, "general").flex_1().truncate())
                .child(
                    IconButton::new("layout-search", I::Search, "Search")
                        .variant(IconButtonVariant::Soft),
                )
                .child(
                    IconButton::new("layout-members", I::People, "Members")
                        .variant(IconButtonVariant::Soft)
                        .on_click(move |_, window, cx| on_members(window, cx)),
                ),
        )
        .child(
            column()
                .id("layout-messages")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .gap(px(SPACE_LG))
                .py(px(SPACE_MD))
                .px(px(SPACE_XL))
                .children(MESSAGES.iter().map(|(who, colour, at, line)| {
                    div()
                        .flex()
                        .gap(px(SPACE_MD))
                        .child(Avatar::new(*who).colour(Rgba(*colour)).decorative(true))
                        .child(
                            column()
                                .child(
                                    div()
                                        .flex()
                                        .items_baseline()
                                        .gap(px(SPACE_SM))
                                        .child(type_text(t::TEXT_NAME, *who))
                                        .child(meta(*at, cx)),
                                )
                                .child(type_text(t::TEXT_BODY, *line)),
                        )
                })),
        )
        .child(
            div()
                .pt(px(SPACE_SM))
                .px(px(SPACE_LG))
                .pb(px(SPACE_LG))
                .child(
                    TextField::new("layout-composer", draft, "Message general")
                        .label_hidden()
                        .shape(FieldShape::Round)
                        .placeholder("Message #general"),
                ),
        )
}

const PEOPLE: [(&str, &str, u32, Presence); 6] = [
    ("Samira", "Admin", 0x5ed1d1ff, Presence::Online),
    ("dropbear", "Streaming", 0x5fd49aff, Presence::Speaking),
    ("gracie", "Mod", 0xffa366ff, Presence::Online),
    ("kwam3", "Away", 0x6fb1f5ff, Presence::Away),
    ("pri", "", 0xc792f0ff, Presence::Online),
    ("zara", "Offline", 0x8a8f98ff, Presence::Offline),
];

fn person(name: &'static str, note: &'static str, colour: u32, presence: Presence) -> ListRow {
    let row = ListRow::new(SharedString::from(format!("person-{name}")), name)
        .size(RowSize::Lg)
        .muted(presence == Presence::Offline)
        .leading(
            Avatar::new(name)
                .colour(Rgba(colour))
                .presence(presence)
                .decorative(true),
        )
        .on_click(|_, _| {});
    if note.is_empty() {
        row
    } else {
        row.secondary(note)
    }
}

fn members(cx: &App) -> Div {
    column()
        .gap(px(SPACE_SM))
        .child(div().px(px(SPACE_SM)).child(meta("5 of 12 here", cx)))
        .child(column().children(
            PEOPLE
                .iter()
                .map(|(name, note, colour, presence)| person(name, note, *colour, *presence)),
        ))
}

fn call_bar() -> Card {
    Card::new("layout-call-bar").child(
        div()
            .flex()
            .items_center()
            .gap(px(SPACE_SM))
            .child(
                column()
                    .flex_1()
                    .child(type_text(t::TEXT_BODY_STRONG, "Squad Up").truncate())
                    .child(type_text(t::TEXT_META, "Connected, 42:10").truncate()),
            )
            .child(IconButton::new("layout-unmute", I::MicOff, "Unmute"))
            .child(
                Button::new("layout-leave", "Leave")
                    .danger()
                    .size(ButtonSize::Sm),
            ),
    )
}

// ---------------------------------------------------------------------------------------------
// The screens

#[derive(Clone, Copy, PartialEq)]
enum Screen {
    Chat,
    Settings,
    Stage,
    CallStack,
    EmptyFrame,
    BannerFrame,
}

#[derive(Clone, Copy)]
struct Setup {
    screen: Screen,
    right: bool,
    open: Option<bool>,
    pane: PhonePane,
    settings_pane: SettingsPane,
    dock: bool,
    call: bool,
    footer: bool,
    strip: bool,
    surface: bool,
}

const CHAT: Setup = Setup {
    screen: Screen::Chat,
    right: true,
    open: None,
    pane: PhonePane::Centre,
    settings_pane: SettingsPane::Content,
    dock: true,
    call: false,
    footer: true,
    strip: true,
    surface: true,
};

struct Demo {
    setup: Setup,
    draft: Entity<InputState>,
    role_name: Entity<InputState>,
    flags: [bool; 3],
}

impl Demo {
    fn chat(&mut self, window: &mut Window, cx: &mut Context<Self>) -> ThreeIslands {
        let s = self.setup;
        let this = cx.entity().downgrade();
        let phone = WidthRange::current(window).is_phone();
        let wide = WidthRange::current(window).is_wide();
        let pick = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.setup.pane = PhonePane::Centre;
                    cx.notify();
                });
            }
        };
        let toggle = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    let showing = demo.setup.open.unwrap_or(wide);
                    demo.setup.open = Some(!showing);
                    cx.notify();
                });
            }
        };
        let back: Option<Box<dyn Fn(&mut Window, &mut App)>> = phone.then(|| {
            let this = this.clone();
            Box::new(move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.setup.pane = PhonePane::Left;
                    cx.notify();
                });
            }) as Box<dyn Fn(&mut Window, &mut App)>
        });
        let close = move |_: &mut Window, cx: &mut App| {
            let _ = this.update(cx, |demo, cx| {
                demo.setup.open = Some(false);
                cx.notify();
            });
        };
        let mut chat = ThreeIslands::new(
            channels(pick, cx),
            "Channels",
            conversation(&self.draft, toggle, back, cx),
            "general in Couch Co-op",
        )
        .phone_pane(s.pane)
        .right_open(s.open)
        .on_right_close(close);
        if s.right {
            chat = chat.right(members(cx)).right_label("Members");
        }
        if s.dock {
            chat = chat.dock(dock());
        }
        if s.call {
            chat = chat.call_bar(call_bar());
        }
        chat
    }

    fn settings(&mut self, window: &mut Window, cx: &mut Context<Self>) -> SettingsLayout {
        let s = self.setup;
        let this = cx.entity().downgrade();
        let pick = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.setup.settings_pane = SettingsPane::Content;
                    cx.notify();
                });
            }
        };
        let sections = column().children(
            [
                "General",
                "Roles",
                "Channels",
                "Members",
                "Invites",
                "Moderation",
                "Emoji",
                "Danger zone",
            ]
            .into_iter()
            .map(|name| {
                let pick = pick.clone();
                ListRow::new(SharedString::from(format!("section-{name}")), name)
                    .selected(name == "Roles")
                    .on_click(move |window, cx| pick(window, cx))
            }),
        );
        let rows = [
            ("Manage messages", "Delete and pin messages in every channel."),
            ("Manage members", "Kick and time out members."),
            ("Mention everyone", "Notify the whole community."),
        ];
        let switches = rows.iter().enumerate().map(|(index, (label, line))| {
            let this = this.clone();
            Switch::new(
                SharedString::from(format!("flag-{index}")),
                *label,
                self.flags[index],
            )
            .description(*line)
            .on_change(move |checked, _, cx| {
                let _ = this.update(cx, |demo, cx| {
                    demo.flags[index] = checked;
                    cx.notify();
                });
            })
        });
        let form = column()
            .gap(px(SPACE_XL))
            .max_w(px(LAYOUT_DIALOG_MD * 1.5))
            .child(type_text(t::TEXT_TITLE, "Edit role: Mods"))
            .child(TextField::new("role-name", &self.role_name, "Role name"))
            .child(column().gap(px(SPACE_LG)).children(switches))
            .child(
                type_text(
                    t::TEXT_BODY,
                    "Roles apply to everyone who has them, in every channel the role can see.",
                )
                .text_color(cx.sem().role.text_secondary),
            );
        let back = move |_: &mut Window, cx: &mut App| {
            let _ = this.update(cx, |demo, cx| {
                demo.setup.settings_pane = SettingsPane::Nav;
                cx.notify();
            });
        };
        let _ = window;
        let layout = SettingsLayout::new(
            "Community settings",
            sections,
            "Settings sections",
            form,
            back,
        )
        .phone_pane(s.settings_pane);
        if s.footer {
            layout.footer(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_end()
                    .gap(px(SPACE_SM))
                    .child(type_text(t::TEXT_BODY_STRONG, "2 unsaved changes"))
                    .child(Button::new("settings-reset", "Reset").ghost())
                    .child(Button::new("settings-save", "Save changes").primary()),
            )
        } else {
            layout
        }
    }

    fn stage(&mut self, cx: &mut Context<Self>) -> StageLayout {
        let s = self.setup;
        let this = cx.entity().downgrade();
        let toggle = {
            let this = this.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                let _ = this.update(cx, |demo, cx| {
                    demo.setup.open = Some(!demo.setup.open.unwrap_or(false));
                    cx.notify();
                });
            }
        };
        let header = div()
            .flex_1()
            .min_w_0()
            .flex()
            .items_center()
            .gap(px(SPACE_MD))
            .child(type_text(t::TEXT_TITLE, "Squad Up").truncate())
            .child(meta("3 here · 42:10", cx).flex_1())
            .child(
                IconButton::new("stage-people", I::People, "People")
                    .variant(IconButtonVariant::Soft)
                    .on_click(toggle),
            );
        let secondary = cx.sem().role.text_secondary;
        let fill = super::surface::stand_out_fill(cx.sem(), Surface::Surface);
        // A 16:9 block for the shared screen (a card's fill), as big as fits the stage's width or
        // height: GPUI has no `cqw`/`cqh`, so it reads the stage's size.
        let screen = container_query(move |room, _, _| {
            let width = room.width.min(room.height * (16. / 9.));
            div().size_full().flex().items_center().justify_center().child(
                div()
                    .id("stage-screen")
                    .w(width)
                    .h(width * (9. / 16.))
                    .rounded(px(t::RADIUS_CARD))
                    .bg(fill)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        type_text(t::TEXT_BODY, "dropbear is sharing their screen")
                            .text_color(secondary),
                    ),
            )
        });
        let tiles = [
            ("dropbear", 0x5fd49aff, Presence::Speaking),
            ("pri", 0xc792f0ff, Presence::Online),
            ("alexk", 0x9aa0ffff, Presence::Online),
        ];
        let strip = div()
            .flex_1()
            .min_w_0()
            .flex()
            .gap(px(SPACE_MD))
            .children(tiles.iter().map(|(name, colour, presence)| {
                div().flex_1().min_w_0().child(
                    Card::new(SharedString::from(format!("tile-{name}"))).child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(SPACE_SM))
                            .child(
                                Avatar::new(*name)
                                    .colour(Rgba(*colour))
                                    .presence(*presence)
                                    .decorative(true),
                            )
                            .child(type_text(t::TEXT_NAME, *name).truncate()),
                    ),
                )
            }));
        let controls = div()
            .flex()
            .flex_wrap()
            .justify_center()
            .gap(px(SPACE_MD))
            .child(
                IconButton::new("stage-mute", I::Mic, "Mute")
                    .variant(IconButtonVariant::Soft)
                    .size(super::ControlSize::Lg),
            )
            .child(
                IconButton::new("stage-deafen", I::Headset, "Deafen")
                    .variant(IconButtonVariant::Soft)
                    .size(super::ControlSize::Lg),
            )
            .child(
                IconButton::new("stage-camera", I::Videocam, "Camera")
                    .variant(IconButtonVariant::Soft)
                    .size(super::ControlSize::Lg),
            )
            .child(
                IconButton::new("stage-share", I::ScreenShare, "Share your screen")
                    .variant(IconButtonVariant::Soft)
                    .size(super::ControlSize::Lg),
            )
            .child(
                IconButton::new("stage-leave", I::CallEnd, "Leave")
                    .variant(IconButtonVariant::Danger)
                    .size(super::ControlSize::Lg),
            );
        let close = move |_: &mut Window, cx: &mut App| {
            let _ = this.update(cx, |demo, cx| {
                demo.setup.open = Some(false);
                cx.notify();
            });
        };
        let people = column().children(
            tiles
                .iter()
                .map(|(name, colour, presence)| person(name, "", *colour, *presence)),
        );
        let stage = StageLayout::new(header, screen, controls, "Squad Up")
            .side(people)
            .side_open(s.open.unwrap_or(false))
            .on_side_close(close);
        if s.strip { stage.strip(strip) } else { stage }
    }

    fn call_stack(&mut self, cx: &mut Context<Self>) -> ThreeIslands {
        let bar = Card::new("stack-bar").padding(Padding::Md).child(
            ListRow::new("stack-bar-row", "The bar")
                .size(RowSize::Lg)
                .strong(true)
                .secondary("Never shrunk or clipped")
                .trailing(
                    IconButton::new("stack-leave", I::CallEnd, "Leave call")
                        .variant(IconButtonVariant::Danger),
                ),
        );
        let surface = Card::new("stack-surface").padding(Padding::Md).child(
            column()
                .child(meta("Taller than two fifths of the frame: it scrolls here.", cx))
                .children((1..=14).map(|row| {
                    ListRow::new(
                        SharedString::from(format!("surface-row-{row}")),
                        SharedString::from(format!("Surface row {row}")),
                    )
                    .trailing(
                        Button::new(SharedString::from(format!("watch-{row}")), "Watch")
                            .size(ButtonSize::Sm),
                    )
                })),
        );
        let summary = Card::new("stack-summary")
            .padding(Padding::Md)
            .child(ListRow::new("stack-summary-row", "14 rows · the surface in one line"));
        let mut stack = CallStack::new(bar).summary(summary);
        if self.setup.surface {
            stack = stack.surface(surface);
        }
        ThreeIslands::new(
            channels(|_, _| {}, cx),
            "Channels",
            conversation(&self.draft, |_, _| {}, None, cx),
            "general in Couch Co-op",
        )
        .dock(dock())
        .call_bar(stack)
    }
}

impl Render for Demo {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        match self.setup.screen {
            Screen::Chat => AppFrame::new(self.chat(window, cx)),
            Screen::Settings => AppFrame::new(self.settings(window, cx)),
            Screen::Stage => AppFrame::new(self.stage(cx)),
            Screen::CallStack => AppFrame::new(self.call_stack(cx)),
            Screen::EmptyFrame => {
                let secondary = cx.sem().role.text_secondary;
                AppFrame::new(
                    Island::new("empty-frame")
                        .main(Some("Empty frame".into()))
                        .scroll(true)
                        .child(type_text(t::TEXT_TITLE, "An empty frame"))
                        .child(
                            type_text(
                                t::TEXT_BODY,
                                "The island fills the frame. Its content scrolls inside it, never the page.",
                            )
                            .text_color(secondary),
                        )
                        .children((1..=40).map(|row| {
                            type_text(
                                t::TEXT_BODY,
                                format!(
                                    "Row {row}, to show the island scrolling and the page staying still."
                                ),
                            )
                            .mt(px(SPACE_MD))
                        })),
                )
            }
            Screen::BannerFrame => {
                AppFrame::new(self.chat(window, cx)).banner(
                    Alert::new(
                        "frame-reconnecting",
                        Severity::Warning,
                        "You are offline. Messages you send will wait until the connection is back.",
                    )
                    .title("Reconnecting"),
                )
            }
        }
    }
}

fn demo(mode: Mode, setup: Setup, window: &mut Window, cx: &mut App) -> AnyView {
    theme::apply(ThemeInput::new(DEFAULT_BASE, mode, Intensity::Minimal), cx);
    let draft = text_state(window, cx, false);
    let role_name = text_state(window, cx, false);
    role_name.update(cx, |state, cx| state.set_value("Mods", window, cx));
    cx.new(|_| Demo {
        setup,
        draft,
        role_name,
        flags: [true, false, true],
    })
    .into()
}

pub fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $mode:expr, $setup:expr) => {
            Story::new($name, |_, window, cx| demo($mode, $setup, window, cx))
        };
    }
    const fn with(screen: Screen) -> Setup {
        Setup { screen, ..CHAT }
    }
    const SETTINGS: Setup = with(Screen::Settings);
    const STAGE: Setup = with(Screen::Stage);
    const STACK: Setup = with(Screen::CallStack);
    vec![
        story!("kit-app-frame-empty", Mode::Dark, with(Screen::EmptyFrame)),
        story!(
            "kit-app-frame-with-banner",
            Mode::Dark,
            Setup { right: false, dock: false, ..with(Screen::BannerFrame) }
        ),
        story!("kit-three-islands-chat", Mode::Dark, CHAT),
        story!("kit-three-islands-no-right", Mode::Dark, Setup { right: false, ..CHAT }),
        story!("kit-three-islands-right-open", Mode::Dark, Setup { open: Some(true), ..CHAT }),
        story!(
            "kit-three-islands-right-closed-wide",
            Mode::Dark,
            Setup { open: Some(false), ..CHAT }
        ),
        story!(
            "kit-three-islands-phone-left",
            Mode::Dark,
            Setup { pane: PhonePane::Left, ..CHAT }
        ),
        story!("kit-three-islands-chat-light", Mode::Light, CHAT),
        story!("kit-three-islands-no-dock", Mode::Dark, Setup { dock: false, ..CHAT }),
        story!("kit-three-islands-in-call", Mode::Dark, Setup { call: true, ..CHAT }),
        story!("kit-settings-layout-community", Mode::Dark, SETTINGS),
        story!(
            "kit-settings-layout-phone-nav",
            Mode::Dark,
            Setup { settings_pane: SettingsPane::Nav, ..SETTINGS }
        ),
        story!("kit-settings-layout-phone-content", Mode::Dark, SETTINGS),
        story!("kit-settings-layout-community-light", Mode::Light, SETTINGS),
        story!(
            "kit-settings-layout-no-footer",
            Mode::Dark,
            Setup { footer: false, ..SETTINGS }
        ),
        story!("kit-stage-layout-sharing", Mode::Dark, STAGE),
        story!(
            "kit-stage-layout-people-open",
            Mode::Dark,
            Setup { open: Some(true), ..STAGE }
        ),
        story!("kit-stage-layout-sharing-light", Mode::Light, STAGE),
        story!("kit-stage-layout-no-strip", Mode::Dark, Setup { strip: false, ..STAGE }),
        story!("kit-call-stack-bounded", Mode::Dark, STACK),
        story!("kit-call-stack-bounded-light", Mode::Light, STACK),
        story!(
            "kit-call-stack-bar-only",
            Mode::Dark,
            Setup { surface: false, ..STACK }
        ),
    ]
}
