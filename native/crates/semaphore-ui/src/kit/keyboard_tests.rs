//! The roving controls in a real window: Tab reaches one stop per group, and the arrows (and
//! Home and End for tabs) move focus and selection together.

use super::{Button, RadioGroup, RadioOption, Tabs};
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::*;

/// What the group under test is.
#[derive(Clone, Copy, PartialEq)]
enum Under {
    Radios,
    RadiosTracked,
    Tabs,
}

/// A button, the group, a button: so a Tab from the first shows how many stops the group has.
struct Harness {
    under: Under,
    selected: usize,
    before: FocusHandle,
    after: FocusHandle,
    caller: FocusHandle,
}

impl EventEmitter<usize> for Harness {}

impl Render for Harness {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.entity().downgrade();
        let pick = move |index: usize, _: &mut Window, cx: &mut App| {
            view.update(cx, |this, cx| {
                this.selected = index;
                cx.emit(index);
                cx.notify();
            })
            .ok();
        };
        let group = match self.under {
            Under::Radios | Under::RadiosTracked => {
                let radios = RadioGroup::new(
                    "group",
                    "Sound",
                    ["One", "Two", "Three", "Four"]
                        .map(RadioOption::new)
                        .to_vec(),
                    Some(self.selected),
                )
                .on_change(pick);
                if self.under == Under::RadiosTracked {
                    radios.track_focus(&self.caller).into_any_element()
                } else {
                    radios.into_any_element()
                }
            }
            Under::Tabs => Tabs::new(
                "tabs",
                ["One", "Two", "Three", "Four"]
                    .map(SharedString::from)
                    .to_vec(),
                self.selected,
            )
            .on_select(pick)
            .into_any_element(),
        };
        div()
            .flex()
            .flex_col()
            .child(Button::new("before", "Before").track_focus(&self.before))
            .child(group)
            .child(Button::new("after", "After").track_focus(&self.after))
    }
}

fn harness(cx: &mut TestAppContext, under: Under, selected: usize) -> Rig<Harness, usize> {
    let rig = rig(cx, 600., move |_, cx| Harness {
        under,
        selected,
        before: cx.focus_handle(),
        after: cx.focus_handle(),
        caller: cx.focus_handle(),
    });
    rig.with(cx, |_, window, _| window.activate_window());
    rig
}

fn focus(rig: &Rig<Harness, usize>, cx: &mut TestAppContext, which: fn(&Harness) -> FocusHandle) {
    rig.with(cx, move |view, window, cx| {
        let handle = which(view.read(cx));
        handle.focus(window, cx);
    });
}

fn tab(rig: &Rig<Harness, usize>, cx: &mut TestAppContext) {
    rig.with(cx, |_, window, cx| window.focus_next(cx));
}

fn is_focused(
    rig: &Rig<Harness, usize>,
    cx: &mut TestAppContext,
    which: fn(&Harness) -> FocusHandle,
) -> bool {
    rig.with(cx, move |view, window, cx| {
        which(view.read(cx)).is_focused(window)
    })
}

fn press(rig: &Rig<Harness, usize>, cx: &mut TestAppContext, keys: &str) {
    cx.simulate_keystrokes(rig.window, keys);
    rig.with(cx, |_, _, _| {});
}

#[gpui_kit::test]
fn a_radio_group_is_one_tab_stop(cx: &mut TestAppContext) {
    let rig = harness(cx, Under::Radios, 2);
    focus(&rig, cx, |h| h.before.clone());
    tab(&rig, cx);
    assert!(!is_focused(&rig, cx, |h| h.after.clone()));
    // One more Tab leaves the group: it had one stop.
    tab(&rig, cx);
    assert!(is_focused(&rig, cx, |h| h.after.clone()));
}

#[gpui_kit::test]
fn tab_lands_on_the_selected_radio_and_arrows_move_from_it(cx: &mut TestAppContext) {
    let rig = harness(cx, Under::Radios, 2);
    focus(&rig, cx, |h| h.before.clone());
    tab(&rig, cx);
    // From the selected (third) option, Down picks the fourth; from the first it would pick the second.
    press(&rig, cx, "down");
    press(&rig, cx, "down");
    press(&rig, cx, "up");
    assert_eq!(rig.events(), [3, 0, 3]);
    // The stop moved with the selection: Tab now leaves the group.
    tab(&rig, cx);
    assert!(is_focused(&rig, cx, |h| h.after.clone()));
}

#[gpui_kit::test]
fn a_tracked_radio_group_keeps_its_arrows(cx: &mut TestAppContext) {
    let rig = harness(cx, Under::RadiosTracked, 1);
    focus(&rig, cx, |h| h.caller.clone());
    press(&rig, cx, "down");
    press(&rig, cx, "down");
    press(&rig, cx, "right");
    assert_eq!(rig.events(), [2, 3, 0]);
}

#[gpui_kit::test]
fn tabs_are_one_stop_with_arrows_home_and_end(cx: &mut TestAppContext) {
    let rig = harness(cx, Under::Tabs, 1);
    focus(&rig, cx, |h| h.before.clone());
    tab(&rig, cx);
    press(&rig, cx, "right");
    press(&rig, cx, "end");
    press(&rig, cx, "right");
    press(&rig, cx, "left");
    press(&rig, cx, "home");
    assert_eq!(rig.events(), [2, 3, 0, 3, 0]);
    tab(&rig, cx);
    assert!(is_focused(&rig, cx, |h| h.after.clone()));
}
