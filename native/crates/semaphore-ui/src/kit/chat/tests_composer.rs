//! Composer, SuggestionList and the tiles of files on their way: Enter and Shift+Enter, what
//! never submits (marked text, sending, nothing to send), the screen's keys first, the caps, the
//! caret, picking, loading, the active row kept in view, Remove and Retry, and the names.

use super::*;
use crate::dms::rig::{Rig, rig};
use crate::kit::{Button, Placement, Popover, PopoverPanel, Surface, SurfaceScope};
use core::prelude::v1::test;
use gpui_kit::component::input::{Textarea, TextareaState};
use gpui_kit::component::{Sizable as _, Size};
use gpui_kit::prelude::*;
use gpui_kit::test::{TestInput, TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_design::chat::{SUGGESTIONS_SHOWN, cap_rows};
use semaphore_design::lounge::{CONTROL_LG, SPACE_XS, TEXT_BODY};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

type Log = Rc<RefCell<Vec<String>>>;
type Body = Box<dyn Fn(&Entity<TextareaState>, &Log, &mut Window, &mut App) -> AnyElement>;

struct Host {
    field: Entity<TextareaState>,
    body: Body,
    log: Log,
}

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .flex_col()
            .justify_end()
            .child(SurfaceScope::new(
                Surface::Surface,
                (self.body)(&self.field, &self.log, window, cx),
            ))
    }
}

fn host(
    cx: &mut TestAppContext,
    body: impl Fn(&Entity<TextareaState>, &Log, &mut Window, &mut App) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |window, cx| Host {
        field: cx.new(|cx| TextareaState::new(window, cx)),
        body: Box::new(body),
        log: shared,
    });
    rig.with(cx, |_, window, _| window.activate_window());
    (rig, log)
}

fn note(log: &Log, line: &str) -> impl Fn(&mut Window, &mut App) + 'static {
    let log = log.clone();
    let line = line.to_owned();
    move |_, _| log.borrow_mut().push(line.clone())
}

fn logged(log: &Log) -> Vec<String> {
    log.borrow().clone()
}

fn field(rig: &Rig<Host, ()>, cx: &mut TestAppContext) -> Entity<TextareaState> {
    cx.update(|cx| rig.view.read(cx).field.clone())
}

fn value(rig: &Rig<Host, ()>, cx: &mut TestAppContext) -> String {
    let field = field(rig, cx);
    cx.update(|cx| field.read(cx).value().to_string())
}

fn focus_field(rig: &Rig<Host, ()>, cx: &mut TestAppContext) {
    let field = field(rig, cx);
    rig.with(cx, move |_, window, cx| {
        field.update(cx, |field, cx| field.focus(window, cx))
    });
}

fn typed(rig: &Rig<Host, ()>, cx: &mut TestAppContext, text: &str) {
    let text = text.to_owned();
    rig.with(cx, move |_, window, cx| window.input(&text, cx));
}

fn press(rig: &Rig<Host, ()>, cx: &mut TestAppContext, key: &str) {
    let key = key.to_owned();
    rig.with(cx, move |_, window, cx| window.press(&key, cx));
}

fn click(rig: &Rig<Host, ()>, cx: &mut TestAppContext, id: ElementId) {
    rig.with(cx, move |_, window, cx| window.click(id, cx));
}

fn id_of(parent: &'static str, name: &'static str) -> ElementId {
    child_id(&ElementId::from(parent), name)
}

/// Draws one frame, without asking for or delivering another.
fn draw(rig: &Rig<Host, ()>, cx: &mut TestAppContext) {
    cx.update_window(rig.window, |_, window, cx| window.render_frame(cx))
        .expect("window");
}

/// Delivers the frame callbacks scheduled so far, and returns how many ran.
fn frames_asked(rig: &Rig<Host, ()>, cx: &mut TestAppContext) -> usize {
    cx.update_window(rig.window, |_, window, cx| window.simulate_next_frame(cx))
        .expect("window")
}

/// Whether the row named `label` is inside the list's bounds right now (no frame drawn).
fn in_view(rig: &Rig<Host, ()>, cx: &mut TestAppContext, label: &'static str) -> bool {
    cx.update_window(rig.window, |_, window, _| {
        let list = window.find_by_label("Mention suggestions").bounds();
        let row = window.find_by_label(label).bounds();
        row.top() >= list.top() && row.bottom() <= list.bottom()
    })
    .expect("window")
}

/// The list's bounds right now (no frame drawn).
fn list_bounds(rig: &Rig<Host, ()>, cx: &mut TestAppContext) -> Bounds<Pixels> {
    cx.update_window(rig.window, |_, window, _| {
        window.find_by_label("Mention suggestions").bounds()
    })
    .expect("window")
}

/// Drives the input method protocol on the field.
fn ime<R>(
    rig: &Rig<Host, ()>,
    cx: &mut TestAppContext,
    f: impl FnOnce(&mut TestInput, &mut App) -> R,
) -> R {
    let field = field(rig, cx);
    let id: ElementId = ("input", field.entity_id()).into();
    rig.with(cx, move |_, window, cx| {
        let bounds = window.find(id).bounds();
        let mut input = TestInput::new(ElementInputHandler::new(bounds, field), window);
        f(&mut input, cx)
    })
}

/// A plain conversation composer that logs its submits.
fn composer(
    state: &Entity<TextareaState>,
    log: &Log,
    tweak: impl Fn(Composer) -> Composer,
) -> AnyElement {
    tweak(Composer::new("c", "Message #general", state.clone()).on_submit(note(log, "submit")))
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// Enter, and what never submits

#[gpui_kit::test]
fn enter_submits_and_shift_enter_adds_a_line(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| composer(state, log, |c| c));
    focus_field(&rig, cx);
    typed(&rig, cx, "first");
    press(&rig, cx, "shift-enter");
    typed(&rig, cx, "second");
    assert_eq!(value(&rig, cx), "first\nsecond");
    assert!(logged(&log).is_empty());

    press(&rig, cx, "enter");
    assert_eq!(logged(&log), ["submit"]);
    assert_eq!(value(&rig, cx), "first\nsecond", "Enter makes no line");
}

#[gpui_kit::test]
fn without_submit_on_enter_enter_is_a_new_line(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        composer(state, log, |c| c.submit_on_enter(false))
    });
    focus_field(&rig, cx);
    typed(&rig, cx, "a");
    press(&rig, cx, "enter");
    typed(&rig, cx, "b");
    assert_eq!(value(&rig, cx), "a\nb");
    assert!(logged(&log).is_empty());
    click(&rig, cx, id_of("c", "submit"));
    assert_eq!(logged(&log), ["submit"], "Send still sends");
}

#[gpui_kit::test]
fn nothing_submits_while_an_input_method_has_marked_text(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        let keys = log.clone();
        composer(state, log, move |c| {
            let keys = keys.clone();
            c.on_key(move |key, _, _| {
                keys.borrow_mut().push(format!("key {key:?}"));
                false
            })
        })
    });
    focus_field(&rig, cx);
    typed(&rig, cx, "abc");
    // The field's own handling of a key may end the composition, so each key gets a fresh one.
    for key in ["enter", "escape", "up", "down", "tab"] {
        let marked = ime(&rig, cx, |input, cx| {
            input.compose_text(None, "にほん", Some(3..3), cx);
            input.marked_text_range(cx)
        });
        assert!(marked.is_some());
        let composed = value(&rig, cx);
        press(&rig, cx, key);
        if key == "enter" {
            let after = value(&rig, cx);
            assert_eq!(
                after, composed,
                "Enter while composing makes no line over the marked text"
            );
            assert!(!after.contains('\n'), "{after:?}");
        }
        assert!(
            logged(&log).is_empty(),
            "{key}: no submit and no screen key while composing: {:?}",
            logged(&log)
        );
    }
    ime(&rig, cx, |input, cx| {
        input.compose_text(None, "にほん", Some(3..3), cx);
    });
    click(&rig, cx, id_of("c", "submit"));
    assert!(logged(&log).is_empty(), "nor from Send");

    focus_field(&rig, cx);

    ime(&rig, cx, |input, cx| input.commit_text("日本", cx));
    let committed = value(&rig, cx);
    press(&rig, cx, "enter");
    assert_eq!(logged(&log), ["key Enter { shift: false }", "submit"]);
    assert!(committed.contains("日本"), "{committed:?}");
}

#[gpui_kit::test]
fn nothing_submits_while_sending(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        composer(state, log, |c| c.sending(true))
    });
    focus_field(&rig, cx);
    typed(&rig, cx, "on its way");
    press(&rig, cx, "enter");
    click(&rig, cx, id_of("c", "submit"));
    assert!(logged(&log).is_empty());
    focus_field(&rig, cx);
    typed(&rig, cx, "!");
    assert_eq!(value(&rig, cx), "on its way!", "the field stays editable");
    let send = rig.with(cx, |_, window, _| window.find_by_label("Send message"));
    assert_eq!(send.role(), Some(Role::Button));
}

#[gpui_kit::test]
fn nothing_submits_when_there_is_nothing_to_send(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| composer(state, log, |c| c));
    focus_field(&rig, cx);
    press(&rig, cx, "enter");
    typed(&rig, cx, "   ");
    press(&rig, cx, "enter");
    click(&rig, cx, id_of("c", "submit"));
    assert!(logged(&log).is_empty(), "blank text is nothing to send");
    assert_eq!(value(&rig, cx), "   ", "and Enter made no line");
}

#[gpui_kit::test]
fn can_send_wins_over_the_text(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, cx| {
        let only_files = state.read(cx).value().is_empty();
        composer(state, log, move |c| c.can_send(only_files))
    });
    // Empty text with a file queued: sends. Text the screen says cannot go: does not.
    focus_field(&rig, cx);
    press(&rig, cx, "enter");
    assert_eq!(logged(&log), ["submit"]);
    typed(&rig, cx, "words");
    press(&rig, cx, "enter");
    assert_eq!(logged(&log), ["submit"]);
}

// ---------------------------------------------------------------------------------------------
// The screen's keys

#[gpui_kit::test]
fn the_screens_key_claims_first(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        let keys = log.clone();
        composer(state, log, move |c| {
            let keys = keys.clone();
            c.on_key(move |key, _, _| {
                keys.borrow_mut().push(format!("key {key:?}"));
                matches!(key, ComposerKey::Enter { shift: false } | ComposerKey::Tab)
            })
        })
    });
    focus_field(&rig, cx);
    typed(&rig, cx, "hey @a");
    press(&rig, cx, "enter");
    assert_eq!(
        logged(&log),
        ["key Enter { shift: false }"],
        "claimed: the mention list picks, nothing is sent"
    );
    press(&rig, cx, "tab");
    assert_eq!(
        value(&rig, cx),
        "hey @a",
        "a claimed Tab never reaches the field"
    );
    press(&rig, cx, "down");
    press(&rig, cx, "up");
    press(&rig, cx, "escape");
    press(&rig, cx, "shift-enter");
    assert_eq!(
        logged(&log)[1..],
        [
            "key Tab",
            "key Down",
            "key Up",
            "key Escape",
            "key Enter { shift: true }"
        ]
    );
    assert_eq!(
        value(&rig, cx),
        "hey @a\n",
        "an unclaimed Shift+Enter is the field's"
    );
}

#[gpui_kit::test]
fn the_caret_moving_is_reported(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        Composer::new("c", "Message #general", state.clone())
            .on_caret_move(note(log, "caret"))
            .into_any_element()
    });
    focus_field(&rig, cx);
    typed(&rig, cx, "ab");
    let after_typing = logged(&log).len();
    assert!(after_typing >= 1, "typing moves the caret");
    press(&rig, cx, "left");
    assert_eq!(logged(&log).len(), after_typing + 1, "so does an arrow");
    rig.with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
    assert_eq!(
        logged(&log).len(),
        after_typing + 1,
        "a redraw alone does not"
    );
}

#[gpui_kit::test]
fn a_text_field_in_a_slot_keeps_its_own_keys(cx: &mut TestAppContext) {
    // A search field in an emoji picker Popover sits inside the composer's tree, in its emoji
    // slot. The composer's keys are the field's, not the root's, so they are not taken from it.
    let inner_slot: Rc<RefCell<Option<Entity<TextareaState>>>> = Rc::default();
    let slot = inner_slot.clone();
    let (rig, log) = host(cx, move |state, log, window, cx| {
        let existing = slot.borrow().clone();
        let search = match existing {
            Some(search) => search,
            None => {
                let search = cx.new(|cx| TextareaState::new(window, cx).submit_on_enter(true));
                *slot.borrow_mut() = Some(search.clone());
                search
            }
        };
        let keys = log.clone();
        let popover_search = search.clone();
        composer(state, log, move |c| {
            let keys = keys.clone();
            c.on_key(move |key, _, _| {
                keys.borrow_mut().push(format!("key {key:?}"));
                false
            })
            .emoji([Popover::new("emoji-picker")
                .placement(Placement::BottomStart)
                .default_open(true)
                .trigger_element(Button::new("emoji-trigger", "Emoji").soft())
                .content({
                    let search = popover_search.clone();
                    move |_, _| {
                        PopoverPanel::new("Emoji").child(
                            Textarea::new(&search)
                                .with_size(Size::XSmall)
                                .aria_label("Search emoji"),
                        )
                    }
                })])
        })
    });
    let search = inner_slot
        .borrow()
        .clone()
        .expect("the popover's field was drawn");

    focus_field(&rig, cx);
    typed(&rig, cx, "draft");
    rig.with(cx, {
        let search = search.clone();
        move |_, window, cx| search.update(cx, |field, cx| field.focus(window, cx))
    });
    typed(&rig, cx, "cats");
    assert_eq!(
        cx.update(|cx| search.read(cx).value().to_string()),
        "cats",
        "the popover's field took the typing"
    );

    press(&rig, cx, "enter");
    assert!(
        logged(&log).is_empty(),
        "Enter stayed in the popover's field: {:?}",
        logged(&log)
    );
    assert_eq!(value(&rig, cx), "draft", "the draft did not submit or grow");
    assert_eq!(
        cx.update(|cx| search.read(cx).value().to_string()),
        "cats",
        "nor did Enter reach it"
    );
}

// ---------------------------------------------------------------------------------------------
// Caps

#[gpui_kit::test]
fn the_caps_give_2_4_and_10_rows(cx: &mut TestAppContext) {
    for cap in [
        ComposerCap::Keyboard,
        ComposerCap::Phone,
        ComposerCap::Desktop,
    ] {
        let (rig, log) = host(cx, move |state, log, _, _| {
            composer(state, log, |c| c.cap(cap))
        });
        let field_state = field(&rig, cx);
        let id: ElementId = ("input", field_state.entity_id()).into();
        let height = |cx: &mut TestAppContext| {
            let id = id.clone();
            rig.with(cx, move |_, window, _| window.find(id).bounds().size.height)
        };
        let line = px(TEXT_BODY.line_height);
        assert_eq!(height(cx), line, "{cap:?}: one line to start");
        focus_field(&rig, cx);
        typed(&rig, cx, "a");
        for _ in 0..20 {
            press(&rig, cx, "shift-enter");
        }
        assert_eq!(
            height(cx),
            line * cap_rows(cap) as f32,
            "{cap:?}: grows to its cap, then scrolls"
        );
        assert!(logged(&log).is_empty());
    }
}

#[gpui_kit::test]
fn a_new_state_under_the_same_id_grows_and_reports_its_caret(cx: &mut TestAppContext) {
    // A screen may keep one draft per channel and pass a different state under one composer id.
    let (rig, log) = host(cx, |state, log, _, _| {
        Composer::new("c", "Message #general", state.clone())
            .on_caret_move(note(log, "caret"))
            .into_any_element()
    });
    let line = px(TEXT_BODY.line_height);
    let height = |cx: &mut TestAppContext, state: &Entity<TextareaState>| {
        let id: ElementId = ("input", state.entity_id()).into();
        rig.with(cx, move |_, window, _| window.find(id).bounds().size.height)
    };

    let first = field(&rig, cx);
    focus_field(&rig, cx);
    typed(&rig, cx, "a");
    for _ in 0..5 {
        press(&rig, cx, "shift-enter");
    }
    assert!(height(cx, &first) > line, "the first field grows");

    let second = rig.with(cx, |_, window, cx| {
        cx.new(|cx| TextareaState::new(window, cx))
    });
    rig.with(cx, {
        let second = second.clone();
        move |view, _, cx| {
            view.update(cx, |host, cx| {
                host.field = second;
                cx.notify();
            });
        }
    });

    let before = logged(&log).len();
    focus_field(&rig, cx);
    typed(&rig, cx, "b");
    for _ in 0..5 {
        press(&rig, cx, "shift-enter");
    }
    assert!(
        height(cx, &second) > line,
        "the new state under the same id grows too"
    );
    let carets = &logged(&log)[before..];
    assert!(
        !carets.is_empty() && carets.iter().all(|line| line == "caret"),
        "the new state reports its caret: {carets:?}"
    );
}

// ---------------------------------------------------------------------------------------------
// The pieces around the field, and the names

#[gpui_kit::test]
fn the_composer_names_its_field_and_buttons(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        composer(state, log, |c| {
            c.on_attach(|_, _| {}).banner(
                ComposerBanner::new(BannerKind::Reply, "Replying to aiko", "Cancel reply", {
                    let log = log.clone();
                    move |_, _| log.borrow_mut().push("cancel reply".into())
                })
                .detail("you still have my headset btw"),
            )
        })
    });
    rig.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("Message #general").is_some());
        assert_eq!(
            window.find_by_label("Send message").role(),
            Some(Role::Button)
        );
        assert_eq!(
            window.find_by_label("Attach a file").role(),
            Some(Role::Button)
        );
        assert_eq!(
            window.find_by_label("Cancel reply").role(),
            Some(Role::Button)
        );
    });
    click(&rig, cx, id_of("c", "banner-cancel"));
    assert_eq!(logged(&log), ["cancel reply"]);
}

#[gpui_kit::test]
fn an_unavailable_attach_button_is_named_and_does_nothing(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        composer(state, log, |c| {
            c.on_attach(note(log, "attach")).attach_unavailable(true)
        })
    });
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("Attach a file").is_some()
    }));
    click(&rig, cx, id_of("c", "attach"));
    assert!(logged(&log).is_empty());
}

#[gpui_kit::test]
fn inline_save_mode_has_the_hint_in_place_of_save(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |state, log, _, _| {
        composer(state, log, |c| {
            c.inline()
                .mode(ComposerMode::Save)
                .on_cancel(note(log, "cancel"))
                .can_send(true)
        })
    });
    rig.with(cx, |_, window, _| {
        assert!(window.try_find(id_of("c", "submit")).is_none());
        assert_eq!(
            window.find_by_label("Cancel editing").role(),
            Some(Role::Button)
        );
        assert_eq!(
            window.find_by_label("Save changes").role(),
            Some(Role::Button)
        );
    });
    click(&rig, cx, id_of("c", "hint-cancel"));
    click(&rig, cx, id_of("c", "hint-save"));
    assert_eq!(logged(&log), ["cancel", "submit"]);
}

#[gpui_kit::test]
fn a_notice_takes_the_fields_place(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |state, log, _, _| {
        composer(state, log, |c| {
            c.on_attach(|_, _| {}).notice(ComposerNotice::new(
                "You can't send messages in #announcements",
            ))
        })
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(
            window
                .find_by_label("You can't send messages in #announcements")
                .role(),
            Some(Role::Status)
        );
        assert!(window.try_find_by_label("Send message").is_none());
        assert!(window.try_find_by_label("Attach a file").is_none());
    });
}

// ---------------------------------------------------------------------------------------------
// SuggestionList

fn options(count: usize) -> Vec<Suggestion> {
    (0..count)
        .map(|index| {
            Suggestion::new(format!("k{index}"), format!("member{index}"))
                .detail(format!("Member {index}"))
        })
        .collect()
}

fn list_host(
    cx: &mut TestAppContext,
    count: usize,
    active: Option<usize>,
    loading: bool,
) -> (Rig<Host, ()>, Log) {
    host(cx, move |state, log, _, _| {
        let picks = log.clone();
        composer(state, log, move |c| {
            let picks = picks.clone();
            c.suggestions(
                SuggestionList::new("list", "Mention suggestions", options(count), active)
                    .loading(loading)
                    .on_pick(move |index, _, _| picks.borrow_mut().push(format!("pick {index}"))),
            )
        })
    })
}

#[gpui_kit::test]
fn a_suggestion_is_picked_by_a_press_and_the_field_keeps_focus(cx: &mut TestAppContext) {
    let (rig, log) = list_host(cx, 3, Some(0), false);
    focus_field(&rig, cx);
    let option = ElementId::NamedChild(std::sync::Arc::new("list".into()), "k2".into());
    click(&rig, cx, option);
    assert_eq!(logged(&log), ["pick 2"]);
    let field_state = field(&rig, cx);
    let focused = rig.with(cx, move |_, window, cx| {
        field_state.read(cx).focus_handle(cx).is_focused(window)
    });
    assert!(focused, "the press took no focus from the field");
}

#[gpui_kit::test]
fn the_list_and_its_options_are_named(cx: &mut TestAppContext) {
    let (rig, _) = list_host(cx, 3, Some(1), false);
    rig.with(cx, |_, window, _| {
        let list = window.find_by_label("Mention suggestions");
        assert_eq!(list.role(), Some(Role::ListBox));
        let option = window.find_by_label("member1, Member 1");
        assert_eq!(option.role(), Some(Role::ListBoxOption));
        assert_eq!(option.selected(), Some(true));
        assert_eq!(
            window.find_by_label("member0, Member 0").selected(),
            Some(false)
        );
    });
}

#[gpui_kit::test]
fn loading_shows_a_loading_row(cx: &mut TestAppContext) {
    let (rig, log) = list_host(cx, 0, None, true);
    rig.with(cx, |_, window, _| {
        let row = window.find_by_label("Loading…");
        assert_eq!(row.role(), Some(Role::ListBoxOption));
        assert_eq!(
            window.find_by_label("Mention suggestions").description(),
            Some("busy")
        );
    });
    click(&rig, cx, child_id(&ElementId::from("list"), "loading"));
    assert!(logged(&log).is_empty(), "the loading row picks nothing");
}

#[gpui_kit::test]
fn six_rows_show_and_the_active_row_is_kept_in_view(cx: &mut TestAppContext) {
    let active = Rc::new(Cell::new(Some(10usize)));
    let highlight = active.clone();
    let open = Rc::new(Cell::new(false));
    let shown = open.clone();
    let log: Log = Rc::default();
    let rig = rig(cx, 900., move |window, cx| Host {
        field: cx.new(|cx| TextareaState::new(window, cx)),
        body: Box::new(move |state, log, _, _| {
            let open = shown.get();
            composer(state, log, |c| {
                if open {
                    c.suggestions(SuggestionList::new(
                        "list",
                        "Mention suggestions",
                        options(12),
                        highlight.get(),
                    ))
                } else {
                    c
                }
            })
        }),
        log,
    });

    // The list's first frame has no bounds to scroll within; it asks for one more frame. Draw a
    // frame without it first, then the frame it appears on.
    draw(&rig, cx);
    open.set(true);
    draw(&rig, cx);
    let mut settled = false;
    for _ in 0..8 {
        if frames_asked(&rig, cx) == 0 {
            settled = true;
            break;
        }
        draw(&rig, cx);
    }
    assert!(
        settled,
        "the list stops asking for frames once it is laid out"
    );
    assert!(
        in_view(&rig, cx, "member10, Member 10"),
        "the active row is in view from the first frame"
    );

    let list = list_bounds(&rig, cx);
    let most = px(SUGGESTIONS_SHOWN as f32 * CONTROL_LG + 2. * SPACE_XS + 2.);
    assert!(
        list.size.height <= most,
        "{:?} over {most:?}",
        list.size.height
    );
    assert!(list.size.height >= px(SUGGESTIONS_SHOWN as f32 * CONTROL_LG));

    // Moving the highlight above the fold scrolls it into view too.
    active.set(Some(1));
    draw(&rig, cx);
    draw(&rig, cx);
    assert!(
        in_view(&rig, cx, "member1, Member 1"),
        "the moved highlight is in view"
    );
    assert!(
        !in_view(&rig, cx, "member10, Member 10"),
        "and the row it left is not"
    );
}

#[gpui_kit::test]
fn the_list_sits_just_above_the_composer(cx: &mut TestAppContext) {
    let (rig, _) = list_host(cx, 2, None, false);
    rig.with(cx, |_, window, _| {
        let list = window.find_by_label("Mention suggestions").bounds();
        let composer = window.find("c").bounds();
        assert_eq!(list.bottom(), composer.top());
        assert!(
            list.size.width < composer.size.width,
            "inset like the field"
        );
    });
}

// ---------------------------------------------------------------------------------------------
// AttachmentTile on its way

#[gpui_kit::test]
fn a_queued_tile_has_remove(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |_, log, _, _| {
        AttachmentTile::new("t", AttachmentKind::File, "notes.txt")
            .detail("2.1 KB")
            .on_remove(note(log, "remove"))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(
            window.find_by_label("notes.txt, 2.1 KB").role(),
            Some(Role::Group)
        );
        assert_eq!(
            window.find_by_label("Remove notes.txt").role(),
            Some(Role::Button)
        );
    });
    click(&rig, cx, id_of("t", "remove"));
    assert_eq!(logged(&log), ["remove"]);
}

#[gpui_kit::test]
fn an_uploading_tile_has_its_bar(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _, _| {
        AttachmentTile::new("t", AttachmentKind::File, "recording.mp3")
            .detail("38.4 MB")
            .progress(42.)
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let bar = window.find_by_label("Uploading recording.mp3");
        assert_eq!(bar.role(), Some(Role::ProgressIndicator));
        assert!(window.try_find_by_label("Remove recording.mp3").is_none());
    });
}

#[gpui_kit::test]
fn a_failed_upload_says_why_in_place_of_the_size_and_offers_retry(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |_, log, _, _| {
        AttachmentTile::new("t", AttachmentKind::File, "too-big.zip")
            .detail("2 GB")
            .progress(10.)
            .error("Upload failed: File too large")
            .on_retry(note(log, "retry"))
            .on_remove(note(log, "remove"))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert!(
            window
                .try_find_by_label("Upload failed: File too large")
                .is_some()
        );
        assert!(
            window.try_find_by_label("too-big.zip").is_some(),
            "no size in the name"
        );
        assert!(
            window.try_find_by_label("Uploading too-big.zip").is_none(),
            "no bar"
        );
        assert_eq!(
            window.find_by_label("Retry uploading too-big.zip").role(),
            Some(Role::Button)
        );
    });
    click(&rig, cx, id_of("t", "retry"));
    click(&rig, cx, id_of("t", "remove"));
    assert_eq!(logged(&log), ["retry", "remove"]);
}
