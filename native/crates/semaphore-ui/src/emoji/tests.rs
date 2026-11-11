//! The exported data, the search, the grid movement alone, then the picker in a window.

use super::data::{self, Cell, SectionKey, sections};
use super::grid::{COLUMNS, NavKey, Pos, next};
use super::*;
// `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
use crate::messages::NoMedia;
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size};
use std::cell::RefCell;

fn emoji(id: &str, name: &str) -> EmojiView {
    EmojiView {
        id: id.into(),
        name: name.into(),
        file_id: format!("file-{id}"),
    }
}

fn custom() -> Vec<EmojiView> {
    vec![
        emoji("e1", "party_blob"),
        emoji("e2", "Cat_Jam"),
        emoji("e3", "shipit"),
        emoji("e4", "heart_spin"),
        emoji("e5", "wave"),
    ]
}

// ---- The data. ----

#[test]
fn the_export_parses_and_matches_quick_reactions() {
    let data = data::data();
    let names: Vec<&str> = data.categories.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Frequently Used",
            "Smileys & People",
            "Animals & Nature",
            "Food & Drink",
            "Activities & Sports",
            "Objects & Symbols"
        ]
    );
    assert_eq!(data.quick_reactions, QUICK_REACTIONS);
    assert_eq!(
        data.categories[0].emoji[..8],
        QUICK_REACTIONS.map(str::to_owned)
    );
    assert_eq!(data::label("\u{1F44D}"), "thumbs up");
    assert_eq!(
        data::label("\u{1F9C4}"),
        "\u{1F9C4}",
        "no name: the character"
    );
    assert!(data::parse("{").is_err());
}

// ---- The search. ----

fn titles(query: &str) -> Vec<String> {
    sections(&custom(), query)
        .into_iter()
        .map(|section| section.title)
        .collect()
}

#[test]
fn no_query_keeps_everything_with_custom_first() {
    let all = sections(&custom(), "  ");
    assert_eq!(all[0].key, SectionKey::Custom);
    assert_eq!(all[0].cells.len(), 5);
    assert_eq!(all.len(), 7);
    assert_eq!(all[1].title, "Frequently Used", "no counts without a query");
    assert!(
        sections(&[], "")
            .iter()
            .all(|s| s.key != SectionKey::Custom)
    );
}

#[test]
fn search_matches_names_case_blind_and_counts_per_category() {
    assert_eq!(
        titles("HEART"),
        [
            "Custom",
            "Frequently Used (2)",
            "Smileys & People (1)",
            "Objects & Symbols (1)"
        ]
    );
    let cat = sections(&custom(), "cat");
    assert_eq!(
        cat[0].cells,
        [Cell::Custom(emoji("e2", "Cat_Jam"))],
        "custom names match case-blind"
    );
}

#[test]
fn search_matches_the_character_itself() {
    let found = sections(&[], "\u{1F355}");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].cells, [Cell::Unicode("\u{1F355}".into())]);
}

#[test]
fn no_match_leaves_no_sections() {
    assert!(sections(&custom(), "zzzz").is_empty());
}

// ---- The grid. ----

const COUNTS: [usize; 3] = [3, 20, 5];

fn at(section: usize, index: usize) -> Pos {
    Pos { section, index }
}

fn go(key: NavKey, from: Pos) -> Pos {
    next(key, from, &COUNTS, COLUMNS)
}

#[test]
fn left_and_right_run_across_sections() {
    assert_eq!(go(NavKey::Right, at(0, 1)), at(0, 2));
    assert_eq!(go(NavKey::Right, at(0, 2)), at(1, 0));
    assert_eq!(go(NavKey::Left, at(1, 0)), at(0, 2));
    assert_eq!(go(NavKey::Left, at(0, 0)), at(0, 0), "nowhere to go");
    assert_eq!(go(NavKey::Right, at(2, 4)), at(2, 4), "nowhere to go");
}

#[test]
fn down_keeps_the_column_into_a_shorter_section() {
    assert_eq!(go(NavKey::Down, at(0, 2)), at(1, 2));
    assert_eq!(go(NavKey::Down, at(1, 10)), at(1, 18));
    // Row two of three: index 21 doesn't exist, so on to the next section, column 5, clamped.
    assert_eq!(go(NavKey::Down, at(1, 13)), at(2, 4));
    assert_eq!(
        go(NavKey::Down, at(2, 1)),
        at(2, 1),
        "the last row of the last section"
    );
}

#[test]
fn up_lands_in_the_last_row_of_the_section_above() {
    assert_eq!(go(NavKey::Up, at(1, 12)), at(1, 4));
    // Column 4 of the last row (16..20) is 20, past the end: clamped to 19.
    assert_eq!(go(NavKey::Up, at(2, 4)), at(1, 19));
    assert_eq!(go(NavKey::Up, at(2, 1)), at(1, 17));
    assert_eq!(go(NavKey::Up, at(1, 3)), at(0, 2));
    assert_eq!(go(NavKey::Up, at(0, 1)), at(0, 1));
}

#[test]
fn home_end_and_paging() {
    assert_eq!(go(NavKey::Home, at(1, 13)), at(1, 8));
    assert_eq!(go(NavKey::End, at(1, 13)), at(1, 15));
    assert_eq!(go(NavKey::End, at(1, 17)), at(1, 19), "a short last row");
    assert_eq!(go(NavKey::PageDown, at(0, 1)), at(1, 0));
    assert_eq!(go(NavKey::PageDown, at(2, 3)), at(2, 3));
    assert_eq!(go(NavKey::PageUp, at(1, 5)), at(0, 0));
    assert_eq!(go(NavKey::PageUp, at(0, 2)), at(0, 0));
    assert_eq!(go(NavKey::PageUp, at(0, 0)), at(0, 0));
}

// ---- In a window. ----

struct Rig {
    window: AnyWindowHandle,
    picker: Entity<EmojiPicker>,
    events: Rc<RefCell<Vec<EmojiPickerEvent>>>,
}

fn rig(cx: &mut TestAppContext) -> Rig {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
    });
    let events = Rc::new(RefCell::new(Vec::new()));
    let log = events.clone();
    let (window, picker) = cx.update(|cx| {
        let mut made = None;
        let handle = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(800.), px(600.)),
                })),
                ..Default::default()
            },
            cx,
            |window, cx| {
                let picker = cx.new(|cx| EmojiPicker::new(custom(), Rc::new(NoMedia), window, cx));
                cx.subscribe(&picker, move |_, event: &EmojiPickerEvent, _| {
                    log.borrow_mut().push(event.clone());
                })
                .detach();
                made = Some(picker.clone());
                picker
            },
        )
        .expect("window");
        (handle.0, made.expect("built"))
    });
    let rig = Rig {
        window,
        picker,
        events,
    };
    rig.with(cx, |picker, window, cx| {
        picker.update(cx, |picker, cx| picker.focus_search(window, cx))
    });
    rig
}

impl Rig {
    fn with<R>(
        &self,
        cx: &mut TestAppContext,
        f: impl FnOnce(&Entity<EmojiPicker>, &mut Window, &mut App) -> R,
    ) -> R {
        let out = cx
            .update_window(self.window, |_, window, cx| {
                window.render_frame(cx);
                let out = f(&self.picker, window, cx);
                window.render_frame(cx);
                out
            })
            .expect("window");
        cx.run_until_parked();
        out
    }

    fn press(&self, cx: &mut TestAppContext, key: &str) {
        self.with(cx, |_, window, cx| window.press(key, cx));
    }

    fn active(&self, cx: &mut TestAppContext) -> Option<(String, usize)> {
        cx.update(|cx| self.picker.read(cx).active_cell())
    }
}

#[gpui_kit::test]
fn arrows_cross_from_custom_into_the_categories_and_enter_picks(cx: &mut TestAppContext) {
    let rig = rig(cx);
    assert_eq!(rig.active(cx), Some(("Custom".into(), 0)));
    rig.press(cx, "down");
    assert_eq!(rig.active(cx), Some(("Frequently Used".into(), 0)));
    rig.press(cx, "down");
    rig.press(cx, "right");
    assert_eq!(rig.active(cx), Some(("Frequently Used".into(), 9)));
    rig.press(cx, "enter");
    assert_eq!(
        rig.events.borrow().as_slice(),
        [EmojiPickerEvent::Picked(EmojiPick::Unicode(
            "\u{1F525}".into()
        ))]
    );
    rig.press(cx, "up");
    rig.press(cx, "up");
    // Up from column 1 of "Frequently Used" lands on column 1 of Custom's only row.
    assert_eq!(rig.active(cx), Some(("Custom".into(), 1)));
}

#[gpui_kit::test]
fn typing_filters_and_the_active_cell_falls_back_to_the_first(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.press(cx, "pagedown");
    rig.press(cx, "pagedown");
    assert_eq!(rig.active(cx), Some(("Smileys & People".into(), 0)));
    // Still there after filtering (with a count in its title now): the web keeps it.
    rig.with(cx, |_, window, cx| window.input("party", cx));
    assert_eq!(rig.active(cx), Some(("Smileys & People (1)".into(), 0)));
    // Gone: back to the first cell.
    rig.with(cx, |picker, _, cx| {
        picker.update(cx, |picker, cx| picker.set_query("cat", cx))
    });
    assert_eq!(rig.active(cx), Some(("Custom".into(), 0)));
    rig.press(cx, "enter");
    assert_eq!(
        rig.events.borrow().last(),
        Some(&EmojiPickerEvent::Picked(EmojiPick::Custom {
            id: "e2".into(),
            name: "Cat_Jam".into()
        }))
    );
}

#[gpui_kit::test]
fn with_no_matches_enter_picks_nothing_and_escape_dismisses(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.with(cx, |_, window, cx| window.input("zzzz", cx));
    assert!(rig.with(cx, |_, window, _| {
        window.try_find("emoji-no-results").is_some()
    }));
    rig.press(cx, "down");
    rig.press(cx, "enter");
    assert!(rig.events.borrow().is_empty());
    rig.press(cx, "escape");
    assert_eq!(
        rig.events.borrow().as_slice(),
        [EmojiPickerEvent::Dismissed]
    );
}

#[gpui_kit::test]
fn clicking_a_custom_emoji_picks_it_as_a_reaction_key(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.with(cx, |_, window, cx| window.click("emoji-custom-e3", cx));
    let picked = match rig.events.borrow().first() {
        Some(EmojiPickerEvent::Picked(pick)) => pick.reaction_key(),
        other => panic!("expected a pick, got {other:?}"),
    };
    assert_eq!(picked, "custom:e3");
}
