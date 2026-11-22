//! The Lounge pieces (Island, Card, Dock, Sheet) and the surface context, one story per state the
//! web kit's stories show (`frontend/src/stories/kit/KitLounge*.stories.tsx`), dark and light, on
//! the design default base colour. The phone size of the UI review shows the narrow layouts.

use super::stories_lists_overlays::view;
use super::{
    Button, Card, CountMeaning, Dock, DockDivider, DockEntry, DockItem, IconButton, Island,
    LinearProgress, ListRow, Padding, Pill, Sheet, SheetSize, TextField, text_state,
};
use crate::kit::overlays::type_text;
use crate::stories::Story;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, SPACE_LG, SPACE_MD, SPACE_SM};
use semaphore_design::{Icon as I, Mode, Rgba};

fn secondary(text: &'static str, cx: &App) -> Div {
    type_text(t::TEXT_BODY, text).text_color(cx.sem().role.text_secondary)
}

/// The pieces that pick their colours from the layer they sit on.
fn sample(id: &str) -> Div {
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(SPACE_SM))
        .child(Button::new(SharedString::from(format!("{id}-soft")), "Soft").soft())
        .child(Button::new(SharedString::from(format!("{id}-ghost")), "Ghost").ghost())
        .child(IconButton::new(
            SharedString::from(format!("{id}-icon")),
            I::Settings,
            "Settings",
        ))
        .child(Pill::new("Neutral"))
}

// ---------------------------------------------------------------------------------------------
// Island

fn island_landmarks(_: &mut Window, cx: &mut App) -> AnyElement {
    let island = |island: Island, title: &'static str, line: &'static str, cx: &App| {
        div().w(px(260.)).child(
            island
                .child(type_text(t::TEXT_BODY_STRONG, title))
                .child(secondary(line, cx).mt(px(SPACE_SM)))
                .child(sample(title).mt(px(SPACE_MD))),
        )
    };
    div()
        .flex()
        .flex_wrap()
        .gap(px(SPACE_LG))
        .child(island(
            Island::new("nav").nav("Channels"),
            "Navigation",
            "A named nav landmark.",
            cx,
        ))
        .child(island(
            Island::new("aside").aside("Members"),
            "Complementary",
            "A named aside.",
            cx,
        ))
        .child(island(
            Island::new("main").main(None),
            "Main",
            "The main landmark.",
            cx,
        ))
        .child(island(
            Island::new("region").region("Pinned").padding(Padding::Md),
            "Region, md padding",
            "A named section.",
            cx,
        ))
        .child(island(
            Island::new("plain").padding(Padding::None),
            "No padding",
            "A plain panel.",
            cx,
        ))
        .into_any_element()
}

fn island_scroll_footer(_: &mut Window, cx: &mut App) -> AnyElement {
    let rows = |prefix: &'static str| {
        (0..24).map(move |n| {
            ListRow::new(
                SharedString::from(format!("{prefix}-{n}")),
                format!("channel-{n}"),
            )
            .on_click(|_, _| {})
            .selected(n == 2)
        })
    };
    let me = Card::new("me")
        .label("You")
        .child(type_text(t::TEXT_BODY_STRONG, "Mike"))
        .child(secondary("Online", cx));
    div()
        .flex()
        .gap(px(SPACE_LG))
        .h(px(420.))
        .child(
            div().w(px(280.)).h_full().child(
                Island::new("scroll-footer")
                    .nav("Channels")
                    .padding(Padding::Md)
                    .scroll(true)
                    .footer(Some(me.into_any_element()))
                    .children(rows("with-footer")),
            ),
        )
        .child(
            div().w(px(280.)).h_full().child(
                Island::new("scroll-no-footer")
                    .nav("Channels, no footer")
                    .padding(Padding::Md)
                    .scroll(true)
                    .footer(None)
                    .children(rows("without-footer")),
            ),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Card

fn card_states(_: &mut Window, cx: &mut App) -> AnyElement {
    div()
        .w(px(420.))
        .max_w_full()
        .child(
            Island::new("cards").region("Voice rooms").child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(SPACE_MD))
                    .child(
                        Card::new("plain")
                            .child(type_text(t::TEXT_BODY_STRONG, "Plain card"))
                            .child(secondary("Kit pieces inside draw on the fill.", cx))
                            .child(sample("plain")),
                    )
                    .child(
                        Card::new("selected")
                            .label("Squad Up")
                            .selected(true)
                            .child(type_text(t::TEXT_BODY_STRONG, "Squad Up"))
                            .child(secondary("You are in this room: the accent outline.", cx)),
                    )
                    .child(
                        Card::new("clickable")
                            .label("Lobby, 3 people")
                            .on_click(|_, _| {})
                            .child(type_text(t::TEXT_BODY_STRONG, "Lobby"))
                            .child(secondary("A card that is one button.", cx)),
                    )
                    .child(
                        Card::new("large")
                            .padding(Padding::Lg)
                            .child(type_text(t::TEXT_BODY_STRONG, "Large padding"))
                            .child(secondary(
                                "A long line of text that wraps inside the card instead of \
                                     pushing it wider than the island it sits in, however long.",
                                cx,
                            )),
                    )
                    .child(
                        Card::new("outer")
                            .child(type_text(t::TEXT_BODY_STRONG, "Card in a card"))
                            .child(
                                Card::new("inner")
                                    .child(secondary("The inner one is surface-coloured.", cx))
                                    .child(sample("inner")),
                            ),
                    ),
            ),
        )
        .into_any_element()
}

/// The same pieces on every layer: ground, island, card, card in a card, a selected row.
fn surface_matrix(_: &mut Window, cx: &mut App) -> AnyElement {
    let line = |id: &str| {
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_SM))
            .child(sample(id))
            .child(div().w(px(200.)).child(LinearProgress::new(
                SharedString::from(format!("{id}-bar")),
                Some(40.),
                "Upload",
            )))
    };
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_LG))
        .child(secondary("Ground", cx))
        .child(line("ground"))
        .child(
            div().w(px(520.)).max_w_full().child(
                Island::new("matrix").padding(Padding::Md).child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(SPACE_MD))
                        .child(secondary("Island", cx))
                        .child(line("island"))
                        .child(
                            Card::new("matrix-card")
                                .child(secondary("Card", cx))
                                .child(line("card"))
                                .child(
                                    Card::new("matrix-inner")
                                        .child(secondary("Card in a card", cx))
                                        .child(line("inner")),
                                ),
                        )
                        .child(
                            ListRow::new("matrix-row", "Selected row")
                                .selected(true)
                                .on_click(|_, _| {})
                                .trailing(Pill::new("Neutral")),
                        ),
                ),
            ),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Dock

const COMMUNITIES: [&str; 12] = [
    "Couch Co-op",
    "Night Owls",
    "Speedrunners",
    "Board Game Club",
    "Lo-fi Lounge",
    "Retro Arcade",
    "Book Nook",
    "Pixel Painters",
    "Trail Crew",
    "Synth Lab",
    "Kitchen Table",
    "Moon Base",
];

const COLOURS: [u32; 6] = [
    0x6d5dfcff, 0xe5484dff, 0x30a46cff, 0xf5a524ff, 0x0090ffff, 0xd6409fff,
];

fn community(index: usize) -> DockItem {
    let name = COMMUNITIES[index % COMMUNITIES.len()];
    let name = if index < COMMUNITIES.len() {
        name.to_string()
    } else {
        format!("{name} {}", index / COMMUNITIES.len() + 1)
    };
    DockItem::new(format!("community-{index}"), name)
        .colour(Rgba(COLOURS[index % COLOURS.len()]))
        .on_click(|_, _| {})
}

fn inbox() -> DockEntry {
    DockEntry::button(
        "inbox",
        IconButton::new("dock-inbox", I::Notifications, "Inbox"),
    )
}

fn all_communities() -> DockEntry {
    DockEntry::button(
        "all",
        IconButton::new("dock-all", I::GridView, "All communities"),
    )
}

fn dock_basic(_: &mut Window, _: &mut App) -> AnyElement {
    div()
        .flex()
        .justify_center()
        .child(
            Dock::new("dock-basic", "Communities")
                .start(inbox())
                .start(DockDivider)
                .item(community(0).current(true))
                .item(community(1).unread(3))
                .item(community(2).unread(2).meaning(CountMeaning::Mentions))
                .item(community(3).new_messages(true))
                .item(community(4).unread(120))
                .item(community(5).reconnecting(true))
                .item(community(6).current(false).new_messages(true).unread(1))
                .end(all_communities()),
        )
        .into_any_element()
}

fn dock_overflow(current: usize) -> impl Fn(&mut Window, &mut App) -> AnyElement {
    move |_, _| {
        div()
            .w(px(480.))
            .max_w_full()
            .child(
                Dock::new("dock-overflow", "Communities")
                    .start(inbox())
                    .start(DockDivider)
                    .items((0..30).map(|n| {
                        community(n)
                            .current(n == current)
                            .unread(if n % 7 == 3 { 4 } else { 0 })
                    }))
                    .end(all_communities()),
            )
            .into_any_element()
    }
}

// ---------------------------------------------------------------------------------------------
// Sheet

fn page_behind(cx: &App) -> AnyElement {
    div()
        .w(px(360.))
        .max_w_full()
        .child(
            Island::new("behind")
                .child(type_text(t::TEXT_BODY_STRONG, "general"))
                .child(secondary("Couch Co-op is on tonight at nine.", cx)),
        )
        .into_any_element()
}

fn community_rows(count: usize) -> impl Iterator<Item = ListRow> {
    (0..count).map(|n| {
        ListRow::new(
            SharedString::from(format!("sheet-row-{n}")),
            COMMUNITIES[n % COMMUNITIES.len()],
        )
        .secondary(format!("{} members", 12 + n * 7))
        .on_click(|_, _| {})
    })
}

fn sheet_basic(_: &mut Window, cx: &mut App) -> AnyElement {
    div()
        .size_full()
        .child(page_behind(cx))
        .child(
            Sheet::new("all-communities-sheet", "All communities")
                .body(div().flex().flex_col().children(community_rows(6))),
        )
        .into_any_element()
}

fn sheet_top_actions(window: &mut Window, cx: &mut App) -> AnyElement {
    let search = window
        .use_keyed_state("sheet-search", cx, |window, cx| {
            text_state(window, cx, false)
        })
        .read(cx)
        .clone();
    div()
        .size_full()
        .child(page_behind(cx))
        .child(
            Sheet::new("join-sheet", "Join a community")
                .top(
                    TextField::new("sheet-search-field", &search, "Search")
                        .placeholder("Name or invite"),
                )
                .body(
                    Card::new("sheet-card")
                        .child(type_text(t::TEXT_BODY_STRONG, "Couch Co-op"))
                        .child(secondary("Game nights every Friday.", cx))
                        .child(sample("sheet-card")),
                )
                .body(
                    div()
                        .flex()
                        .flex_col()
                        .mt(px(SPACE_MD))
                        .children(community_rows(3)),
                )
                .action(Button::new("sheet-cancel", "Cancel").ghost())
                .action(Button::new("sheet-join", "Join").primary()),
        )
        .into_any_element()
}

fn sheet_long(_: &mut Window, cx: &mut App) -> AnyElement {
    div()
        .size_full()
        .child(page_behind(cx))
        .child(
            Sheet::new(
                "long-sheet",
                "Every community on this instance, listed in full",
            )
            .size(SheetSize::Lg)
            .body(div().flex().flex_col().children(community_rows(30)))
            .action(Button::new("long-done", "Done").primary()),
        )
        .into_any_element()
}

pub fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $mode:expr, $body:expr) => {
            Story::new($name, |_, _, cx| {
                view($mode, cx, |window, cx| $body(window, cx))
            })
        };
    }
    vec![
        story!("kit-island-landmarks", Mode::Dark, island_landmarks),
        story!("kit-island-landmarks-light", Mode::Light, island_landmarks),
        story!("kit-island-scroll-footer", Mode::Dark, island_scroll_footer),
        story!(
            "kit-island-scroll-footer-light",
            Mode::Light,
            island_scroll_footer
        ),
        story!("kit-card-states", Mode::Dark, card_states),
        story!("kit-card-states-light", Mode::Light, card_states),
        story!("kit-surface-matrix", Mode::Dark, surface_matrix),
        story!("kit-surface-matrix-light", Mode::Light, surface_matrix),
        story!("kit-dock-basic", Mode::Dark, dock_basic),
        story!("kit-dock-basic-light", Mode::Light, dock_basic),
        story!(
            "kit-dock-overflow-current-middle",
            Mode::Dark,
            dock_overflow(15)
        ),
        story!(
            "kit-dock-overflow-current-middle-light",
            Mode::Light,
            dock_overflow(15)
        ),
        story!(
            "kit-dock-overflow-current-start",
            Mode::Dark,
            dock_overflow(0)
        ),
        story!(
            "kit-dock-overflow-current-end",
            Mode::Dark,
            dock_overflow(29)
        ),
        story!("kit-sheet-basic", Mode::Dark, sheet_basic),
        story!("kit-sheet-basic-light", Mode::Light, sheet_basic),
        story!("kit-sheet-top-actions", Mode::Dark, sheet_top_actions),
        story!(
            "kit-sheet-top-actions-light",
            Mode::Light,
            sheet_top_actions
        ),
        story!("kit-sheet-long", Mode::Dark, sheet_long),
    ]
}
