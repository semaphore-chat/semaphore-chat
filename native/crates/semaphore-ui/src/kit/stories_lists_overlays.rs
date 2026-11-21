//! Lists and overlays (ListRow, Table, Menu, Popover, Tooltip, Dialog), one story per state the
//! web kit's stories show (`frontend/src/stories/kit/Kit*.stories.tsx`), in the same words, dark
//! and light, on the design default base colour.

use super::{
    Align, Avatar, Badge, Button, ButtonTone, Dialog, DialogSize, Icon, IconButton, ListRow, Menu,
    MenuEntry, MenuItem, MenuTone, Placement, Popover, PopoverExt, PopoverPadding, PopoverPanel,
    RowSize, SelectField, Table, TableColumn, TableRow, TextField, Tip, select_state, text_state,
};
use crate::kit::overlays::type_text;
use crate::stories::Story;
use crate::theme::{self, DEFAULT_BASE, SemTheme, ThemeInput};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    self as t, AVATAR_SM, LAYOUT_GUTTER, LAYOUT_LEFT_COLUMN, RADIUS_CARD, RADIUS_ISLAND, SPACE_3XL,
    SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL,
};
use semaphore_design::{Icon as I, Intensity, Mode};

type Body = Box<dyn Fn(&mut Window, &mut Context<StoryView>) -> AnyElement>;

/// A story's view: whatever its body draws, on the ground.
pub(crate) struct StoryView {
    body: Body,
}

impl Render for StoryView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let ground = cx.sem().role.ground;
        div()
            .size_full()
            .relative()
            .bg(ground)
            .p(px(LAYOUT_GUTTER))
            .flex()
            .flex_col()
            .gap(px(SPACE_LG))
            .child((self.body)(window, cx))
    }
}

/// Applies the story's mode on the design default base, then builds its view.
fn view(
    mode: Mode,
    cx: &mut App,
    body: impl Fn(&mut Window, &mut Context<StoryView>) -> AnyElement + 'static,
) -> AnyView {
    theme::apply(ThemeInput::new(DEFAULT_BASE, mode, Intensity::Minimal), cx);
    cx.new(|_| StoryView {
        body: Box::new(body),
    })
    .into()
}

/// An island: the `surface` role, `radius.island`, `md` padding, of a width.
fn island(width: f32, cx: &App) -> Div {
    div()
        .w(px(width))
        .max_w_full()
        .p(px(SPACE_MD))
        .rounded(px(RADIUS_ISLAND))
        .bg(cx.sem().role.surface)
        .flex()
        .flex_col()
}

/// The page behind an overlay: a few lines of text, so the scrim has something to dim.
fn page_behind(cx: &App) -> Div {
    let secondary = cx.sem().role.text_secondary;
    island(LAYOUT_LEFT_COLUMN * 2., cx)
        .gap(px(SPACE_SM))
        .children(
            [
                "general",
                "Couch Co-op is on tonight at nine.",
                "Bring snacks.",
            ]
            .into_iter()
            .map(move |line| type_text(t::TEXT_BODY, line).text_color(secondary)),
        )
}

fn hash(cx: &App) -> Icon {
    Icon::new(I::Tag)
        .size(t::ICON_MD)
        .color(cx.sem().role.text_secondary)
}

fn avatar(name: &str, colour: u32) -> Avatar {
    Avatar::new(name.chars().next().unwrap_or('?').to_string())
        .size(AVATAR_SM)
        .background(theme::color::hsla_of(semaphore_design::Rgba(
            colour << 8 | 0xff,
        )))
}

fn noop(_: &mut Window, _: &mut App) {}

// ---------------------------------------------------------------------------------------------
// ListRow

fn list_row_states(cx: &App) -> AnyElement {
    let rows = island(LAYOUT_LEFT_COLUMN, cx)
        .child(ListRow::new("lfg", "lfg").leading(hash(cx)).on_click(noop))
        .child(
            ListRow::new("general", "general")
                .leading(hash(cx))
                .selected(true)
                .on_click(noop),
        )
        .child(
            ListRow::new("clips", "clips")
                .leading(hash(cx))
                .unread(true)
                .trailing_label("2 unread")
                .on_click(noop)
                .trailing(Badge::new(2)),
        )
        .child(
            ListRow::new("old-news", "old-news")
                .leading(hash(cx))
                .muted(true)
                .on_click(noop),
        )
        .child(
            ListRow::new("staff", "staff")
                .leading(Icon::new(I::Lock).size(t::ICON_MD))
                .disabled(true)
                .on_click(noop),
        )
        .child(ListRow::new("plain", "Plain content, no action").leading(hash(cx)));
    let people = island(LAYOUT_LEFT_COLUMN, cx)
        .child(
            ListRow::new("aiko", "aiko")
                .size(RowSize::Lg)
                .secondary("Playing Hades")
                .leading(avatar("aiko", 0xff8fb8))
                .on_click(noop),
        )
        .child(
            ListRow::new("gracie", "gracie")
                .size(RowSize::Lg)
                .secondary("Away")
                .selected(true)
                .leading(avatar("gracie", 0xffa366))
                .on_click(noop),
        )
        .child(
            ListRow::new("diego", "Diego")
                .size(RowSize::Lg)
                .secondary("Offline")
                .muted(true)
                .leading(avatar("Diego", 0x808080))
                .trailing_label("Mod")
                .on_click(noop)
                .trailing(Badge::new(1)),
        );
    div()
        .flex()
        .flex_wrap()
        .gap(px(SPACE_LG))
        .child(rows)
        .child(people)
        .into_any_element()
}

fn list_row_channels(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN, cx)
        .child(
            ListRow::new("general", "general")
                .leading(hash(cx))
                .selected(true)
                .on_click(noop),
        )
        .child(
            ListRow::new("lfg", "lfg")
                .leading(hash(cx))
                .unread(true)
                .trailing_label("3 unread")
                .on_click(noop)
                .trailing(Badge::new(3)),
        )
        .child(
            ListRow::new("clips", "clips")
                .leading(hash(cx))
                .unread(true)
                .trailing_label("120 unread")
                .on_click(noop)
                .trailing(Badge::new(120)),
        )
        .child(
            ListRow::new("memes", "memes")
                .leading(hash(cx))
                .on_click(noop),
        )
        .child(
            ListRow::new("voice", "Game night")
                .leading(Icon::new(I::VolumeUp).size(t::ICON_MD))
                .on_click(noop),
        )
        .child(
            ListRow::new("afk", "afk")
                .leading(Icon::new(I::VolumeUp).size(t::ICON_MD))
                .muted(true)
                .on_click(noop),
        )
        .into_any_element()
}

fn more(id: &str, label: &str) -> IconButton {
    IconButton::new(
        SharedString::from(id.to_owned()),
        I::MoreHoriz,
        label.to_owned(),
    )
    .small()
}

fn list_row_people(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN, cx)
        .child(
            ListRow::new("samira", "Samira")
                .size(RowSize::Lg)
                .secondary("Admin")
                .leading(avatar("Samira", 0x5ed1d1))
                .trailing_label("admin")
                .on_click(noop)
                .trailing(Badge::new(1)),
        )
        .child(
            ListRow::new("dropbear", "dropbear")
                .size(RowSize::Lg)
                .secondary("Streaming")
                .leading(avatar("dropbear", 0x5fd49a))
                .on_click(noop)
                .trailing(more("more-dropbear", "More about dropbear")),
        )
        .child(
            ListRow::new("kwam3", "kwam3")
                .size(RowSize::Lg)
                .secondary("Away")
                .leading(avatar("kwam3", 0x6fb1f5))
                .on_click(noop),
        )
        .child(
            ListRow::new("pri", "pri")
                .size(RowSize::Lg)
                .leading(avatar("pri", 0xc792f0))
                .on_click(noop),
        )
        .child(
            ListRow::new("zara", "zara")
                .size(RowSize::Lg)
                .secondary("Offline")
                .muted(true)
                .leading(avatar("zara", 0x808080))
                .on_click(noop),
        )
        .into_any_element()
}

const LONG: &str = "the-extremely-long-channel-name-that-somebody-thought-was-a-good-idea";

fn list_row_long_names(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN, cx)
        .child(
            ListRow::new("long-1", LONG)
                .leading(hash(cx))
                .unread(true)
                .on_click(noop)
                .trailing(Badge::new(7)),
        )
        .child(
            ListRow::new("long-2", LONG)
                .leading(hash(cx))
                .selected(true)
                .on_click(noop)
                .trailing(more("more-long", "More")),
        )
        .child(
            ListRow::new("long-3", LONG)
                .size(RowSize::Lg)
                .secondary(format!("{LONG} (secondary)"))
                .leading(avatar("Long Name", 0xff8fb8))
                .on_click(noop),
        )
        .into_any_element()
}

fn list_row_selected_with_trailing(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN, cx)
        .child(
            ListRow::new("general", "general")
                .leading(hash(cx))
                .selected(true)
                .on_click(noop)
                .trailing(Badge::new(3)),
        )
        .child(
            ListRow::new("aiko", "aiko")
                .size(RowSize::Lg)
                .secondary("Playing Hades")
                .selected(true)
                .leading(avatar("aiko", 0xff8fb8))
                .on_click(noop)
                .trailing(more("more-aiko", "More")),
        )
        .into_any_element()
}

fn list_row_labelled(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN, cx)
        .child(
            ListRow::new("squad-up", "Squad Up")
                .size(RowSize::Lg)
                .strong(true)
                .secondary("Voice connected")
                .label("Open call view, Squad Up")
                .chevron(true)
                .on_click(noop)
                .trailing(
                    IconButton::new("leave-call", I::CallEnd, "Leave call")
                        .color(cx.sem().role.danger),
                ),
        )
        .into_any_element()
}

fn list_row_busy(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN, cx)
        .child(
            ListRow::new("general", "general")
                .leading(hash(cx))
                .busy(true)
                .on_click(noop),
        )
        .child(
            ListRow::new("lfg", "lfg")
                .leading(hash(cx))
                .selected(true)
                .busy(true)
                .on_click(noop),
        )
        .child(
            ListRow::new("clips", "clips")
                .leading(hash(cx))
                .unread(true)
                .busy(true)
                .on_click(noop)
                .trailing(Badge::new(2)),
        )
        .child(
            ListRow::new("long", LONG)
                .leading(hash(cx))
                .busy(true)
                .on_click(noop),
        )
        .child(
            ListRow::new("settings", "Settings")
                .leading(Icon::new(I::Settings).size(t::ICON_MD))
                .chevron(true)
                .busy(true)
                .on_click(noop),
        )
        .child(
            ListRow::new("profile", "Profile")
                .leading(Icon::new(I::Person).size(t::ICON_MD))
                .chevron(true)
                .on_click(noop),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Table

fn members_columns() -> Vec<TableColumn> {
    vec![
        TableColumn::new("member", "Member"),
        TableColumn::new("role", "Role"),
        TableColumn::new("joined", "Joined"),
        TableColumn::new("actions", "Actions").align(Align::End),
    ]
}

fn members_rows() -> Vec<TableRow> {
    [
        ("aiko", 0xff8fb8, "Member", "2026-01-12"),
        ("Samira", 0x5ed1d1, "Admin", "2025-11-02"),
        ("dropbear", 0x5fd49a, "Mod", "2026-03-30"),
    ]
    .into_iter()
    .map(|(name, colour, role, joined)| {
        TableRow::new(name)
            .cell(
                "member",
                div()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_SM))
                    .child(avatar(name, colour))
                    .child(name.to_owned()),
            )
            .text("role", role)
            .text("joined", joined)
            .cell(
                "actions",
                more(&format!("more-{name}"), &format!("More about {name}")),
            )
    })
    .collect()
}

fn table_basic(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN * 2., cx)
        .child(Table::new("Members", members_columns(), members_rows()))
        .into_any_element()
}

fn table_empty(cx: &App) -> AnyElement {
    island(LAYOUT_LEFT_COLUMN * 2., cx)
        .child(
            Table::new("Members", members_columns(), Vec::new())
                .empty("No members match that search"),
        )
        .into_any_element()
}

fn table_narrow(cx: &App) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_SM))
        .child(type_text(t::TEXT_META, "320 px box").text_color(cx.sem().role.text_secondary))
        .child(
            island(320., cx).child(
                Table::new("Members", members_columns(), members_rows())
                    .min_width(px(LAYOUT_LEFT_COLUMN * 2.)),
            ),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Menu

fn message_options() -> Vec<MenuEntry> {
    vec![
        MenuItem::new("reply", "Reply", noop)
            .icon(I::Replay)
            .shortcut(["R"])
            .into(),
        MenuItem::new("thread", "Start thread", noop)
            .icon(I::ChatBubbleOutline)
            .shortcut(["T"])
            .into(),
        MenuItem::new("pin", "Pin message", noop)
            .icon(I::PushPin)
            .disabled(true)
            .into(),
        MenuItem::new("copy", "Copy link", noop)
            .icon(I::Link)
            .into(),
        MenuEntry::divider("d1"),
        MenuItem::new("delete", "Delete message", noop)
            .icon(I::Delete)
            .tone(MenuTone::Danger)
            .shortcut(["Shift", "D"])
            .into(),
    ]
}

/// A trigger with its menu open on a side, as the owner anchors it.
fn open_menu(placement: Placement) -> AnyElement {
    let menu = Menu::new("Message options", message_options()).id("story-menu");
    let anchored_menu = deferred(
        anchored()
            .anchor(placement.anchor())
            .snap_to_window_with_margin(px(LAYOUT_GUTTER))
            .child(div().w(px(LAYOUT_LEFT_COLUMN)).child(menu)),
    )
    .with_priority(1);
    let gap = px(super::ANCHOR_GAP);
    let below = matches!(placement, Placement::BottomStart | Placement::BottomEnd);
    let end = matches!(placement, Placement::BottomEnd | Placement::TopEnd);
    div()
        .flex()
        .child(
            div()
                .relative()
                .child(Button::new("menu-trigger", "Message options").outlined())
                .child(
                    div()
                        .absolute()
                        .when(below, |at| at.top_full().mt(gap))
                        .when(!below, |at| at.bottom_full().mb(gap))
                        .when(end, |at| at.right_0())
                        .when(!end, |at| at.left_0())
                        .child(anchored_menu),
                ),
        )
        .into_any_element()
}

fn menu_open(cx: &App) -> AnyElement {
    div()
        .child(page_behind(cx))
        .child(
            div()
                .mt(px(SPACE_LG))
                .child(open_menu(Placement::BottomStart)),
        )
        .into_any_element()
}

fn menu_placements(_: &App) -> AnyElement {
    div()
        .flex_1()
        .h(px(640.))
        .flex()
        .flex_col()
        .justify_end()
        .items_end()
        .child(open_menu(Placement::TopEnd))
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Popover

fn rename_form(window: &mut Window, cx: &mut App) -> AnyElement {
    let name = window
        .use_keyed_state("rename-field", cx, |window, cx| {
            let state = text_state(window, cx, false);
            state.update(cx, |state, cx| state.set_value("memes", window, cx));
            state
        })
        .read(cx)
        .clone();
    div()
        .w(px(280.))
        .max_w_full()
        .flex()
        .flex_col()
        .gap(px(SPACE_MD))
        .child(TextField::new("rename-name", &name, "Channel name"))
        .child(
            div()
                .flex()
                .justify_end()
                .gap(px(SPACE_SM))
                .child(Button::new("rename-cancel", "Cancel"))
                .child(Button::new("rename-save", "Save").contained()),
        )
        .into_any_element()
}

fn popover_open(padding: PopoverPadding, _: &mut Window, cx: &mut App) -> AnyElement {
    div()
        .child(page_behind(cx))
        .child(
            div().mt(px(SPACE_LG)).child(
                div().flex().child(
                    Popover::new("rename-popover")
                        .placement(Placement::BottomStart)
                        .default_open(true)
                        .trigger_element(Button::new("rename-trigger", "Rename channel").outlined())
                        .content(move |_, window, cx| {
                            PopoverPanel::new("Rename channel")
                                .padding(padding)
                                .child(rename_form(window, cx))
                        }),
                ),
            ),
        )
        .into_any_element()
}

const SWATCHES: [&str; 4] = ["#8E75FF", "#0d9488", "#FF8FB8", "#FFA366"];

fn popover_inside_dialog(cx: &App) -> AnyElement {
    div()
        .size_full()
        .child(page_behind(cx))
        .child(
            Dialog::new("Edit channel")
                .description("Rename it or change its colour.")
                .body(
                    div().flex().child(
                        Popover::new("colour-popover")
                            .placement(Placement::BottomStart)
                            .default_open(true)
                            .trigger_element(Button::new("pick-colour", "Pick colour").outlined())
                            .content(|_, _, _| {
                                PopoverPanel::new("Colours").child(
                                    div().flex().gap(px(SPACE_SM)).children(
                                        SWATCHES
                                            .into_iter()
                                            .map(|colour| Button::new(colour, colour)),
                                    ),
                                )
                            }),
                    ),
                )
                .action(Button::new("edit-cancel", "Cancel"))
                .action(Button::new("edit-save", "Save").contained()),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Tooltip

/// A control with its tooltip drawn beside it: a story has no pointer to hover with.
fn shown_tip(
    id: &'static str,
    icon: I,
    label: &'static str,
    below: bool,
    window: &Window,
    cx: &App,
) -> Div {
    let button = IconButton::new(id, icon, format!("{id} example"));
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(super::ANCHOR_GAP))
        .when(!below, |column| column.child(Tip::panel(label, window, cx)))
        .child(button)
        .when(below, |column| column.child(Tip::panel(label, window, cx)))
}

fn tooltip_shown(window: &mut Window, cx: &mut App) -> AnyElement {
    div()
        .flex()
        .flex_wrap()
        .gap(px(SPACE_3XL))
        .px(px(SPACE_XL))
        .py(px(SPACE_3XL))
        .child(shown_tip(
            "top",
            I::Mic,
            "Mute microphone",
            false,
            window,
            cx,
        ))
        .child(shown_tip(
            "bottom",
            I::Notifications,
            "Notification settings",
            true,
            window,
            cx,
        ))
        .child(shown_tip(
            "left",
            I::Settings,
            "Settings",
            false,
            window,
            cx,
        ))
        .child(shown_tip(
            "right",
            I::PushPin,
            "Pinned messages",
            true,
            window,
            cx,
        ))
        .into_any_element()
}

fn tooltip_long_label(window: &mut Window, cx: &mut App) -> AnyElement {
    div()
        .flex()
        .justify_end()
        .pt(px(SPACE_3XL))
        .child(shown_tip(
            "mute",
            I::MicOff,
            "Mute your microphone for everyone in this voice room until you unmute it again",
            true,
            window,
            cx,
        ))
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Dialog

fn confirm_dialog(
    size: DialogSize,
    with_field: bool,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let field = with_field.then(|| {
        let name = window
            .use_keyed_state("confirm-name", cx, |window, cx| {
                text_state(window, cx, false)
            })
            .read(cx)
            .clone();
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_SM))
            .child(
                type_text(t::TEXT_BODY, "Type the channel name to confirm.")
                    .text_color(cx.sem().role.text_secondary),
            )
            .child(TextField::new("confirm-name-field", &name, "Channel name").placeholder("memes"))
    });
    let mut dialog = Dialog::new("Delete #memes?")
        .description(
            "This removes the channel and its 1,204 messages for everyone in Couch Co-op. This can't be undone.",
        )
        .size(size)
        .action(Button::new("confirm-cancel", "Cancel"))
        .action(
            Button::new("confirm-delete", "Delete channel")
                .contained()
                .tone(ButtonTone::Danger),
        );
    if let Some(field) = field {
        dialog = dialog.body(field);
    }
    div()
        .size_full()
        .child(page_behind(cx))
        .child(dialog)
        .into_any_element()
}

fn dialog_with_select(window: &mut Window, cx: &mut App) -> AnyElement {
    let audience = window
        .use_keyed_state("audience", cx, |window, cx| {
            select_state(
                vec![
                    "Everyone in Couch Co-op".into(),
                    "Friends only".into(),
                    "Moderators".into(),
                ],
                Some(1),
                window,
                cx,
            )
        })
        .read(cx)
        .clone();
    div()
        .size_full()
        .child(page_behind(cx))
        .child(
            Dialog::new("Who can see #memes?")
                .description("Pick who may read and post in this channel.")
                .body(SelectField::new("story-audience", &audience, "Audience"))
                .action(Button::new("select-cancel", "Cancel"))
                .action(Button::new("select-save", "Save").contained()),
        )
        .into_any_element()
}

fn dialog_from_card(window: &mut Window, cx: &mut App) -> AnyElement {
    let why = window
        .use_keyed_state("why", cx, |window, cx| text_state(window, cx, false))
        .read(cx)
        .clone();
    let fill = cx.sem().role.fill;
    div()
        .size_full()
        .child(
            island(320., cx).child(
                div()
                    .p(px(SPACE_MD))
                    .rounded(px(RADIUS_CARD))
                    .bg(fill)
                    .flex()
                    .flex_col()
                    .gap(px(SPACE_SM))
                    .child(type_text(t::TEXT_BODY_STRONG, "Squad Up"))
                    .child(div().child(Button::new("leave-room", "Leave room"))),
            ),
        )
        .child(
            Dialog::new("Leave Squad Up?")
                .description("You can rejoin any time while it is open.")
                .body(TextField::new("why-field", &why, "Tell them why").placeholder("Optional"))
                .action(Button::new("stay", "Stay"))
                .action(
                    Button::new("leave", "Leave")
                        .contained()
                        .tone(ButtonTone::Danger),
                ),
        )
        .into_any_element()
}

pub fn stories() -> Vec<Story> {
    macro_rules! static_story {
        ($name:literal, $mode:expr, $body:ident) => {
            Story::new($name, |_, _, cx| view($mode, cx, |_, cx| $body(cx)))
        };
    }
    macro_rules! window_story {
        ($name:literal, $mode:expr, $body:expr) => {
            Story::new($name, |_, _, cx| view($mode, cx, $body))
        };
    }
    vec![
        static_story!("kit-list-row-states", Mode::Dark, list_row_states),
        static_story!("kit-list-row-states-light", Mode::Light, list_row_states),
        static_story!("kit-list-row-channels", Mode::Dark, list_row_channels),
        static_story!("kit-list-row-people", Mode::Dark, list_row_people),
        static_story!("kit-list-row-long-names", Mode::Dark, list_row_long_names),
        static_story!(
            "kit-list-row-selected-with-trailing",
            Mode::Dark,
            list_row_selected_with_trailing
        ),
        static_story!(
            "kit-list-row-selected-with-trailing-light",
            Mode::Light,
            list_row_selected_with_trailing
        ),
        static_story!("kit-list-row-labelled", Mode::Dark, list_row_labelled),
        static_story!(
            "kit-list-row-labelled-light",
            Mode::Light,
            list_row_labelled
        ),
        static_story!("kit-list-row-busy", Mode::Dark, list_row_busy),
        static_story!("kit-list-row-busy-light", Mode::Light, list_row_busy),
        static_story!("kit-table-basic", Mode::Dark, table_basic),
        static_story!("kit-table-basic-light", Mode::Light, table_basic),
        static_story!("kit-table-empty", Mode::Dark, table_empty),
        static_story!("kit-table-narrow", Mode::Dark, table_narrow),
        static_story!("kit-menu-open", Mode::Dark, menu_open),
        static_story!("kit-menu-open-light", Mode::Light, menu_open),
        static_story!("kit-menu-placements", Mode::Dark, menu_placements),
        window_story!("kit-popover-open", Mode::Dark, |window, cx| popover_open(
            PopoverPadding::Lg,
            window,
            cx
        )),
        window_story!("kit-popover-open-light", Mode::Light, |window, cx| {
            popover_open(PopoverPadding::Lg, window, cx)
        }),
        window_story!("kit-popover-open-compact", Mode::Dark, |window, cx| {
            popover_open(PopoverPadding::Md, window, cx)
        }),
        static_story!(
            "kit-popover-inside-dialog",
            Mode::Dark,
            popover_inside_dialog
        ),
        window_story!("kit-tooltip-shown", Mode::Dark, |window, cx| tooltip_shown(
            window, cx
        )),
        window_story!("kit-tooltip-shown-light", Mode::Light, |window, cx| {
            tooltip_shown(window, cx)
        }),
        window_story!("kit-tooltip-long-label", Mode::Dark, |window, cx| {
            tooltip_long_label(window, cx)
        }),
        window_story!("kit-dialog-confirm", Mode::Dark, |window, cx| {
            confirm_dialog(DialogSize::Sm, false, window, cx)
        }),
        window_story!("kit-dialog-confirm-light", Mode::Light, |window, cx| {
            confirm_dialog(DialogSize::Sm, false, window, cx)
        }),
        window_story!("kit-dialog-with-content", Mode::Dark, |window, cx| {
            confirm_dialog(DialogSize::Md, true, window, cx)
        }),
        window_story!("kit-dialog-with-select", Mode::Dark, |window, cx| {
            dialog_with_select(window, cx)
        }),
        window_story!("kit-dialog-from-card", Mode::Dark, |window, cx| {
            dialog_from_card(window, cx)
        }),
    ]
}
