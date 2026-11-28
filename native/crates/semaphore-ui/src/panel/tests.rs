//! The search model alone, then the panels in a window: the debounce on the test clock, keys and
//! clicks through `gpui_kit::test`.

use super::search::{DEBOUNCE, SearchModel, Shown};
use super::*;
// `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
use crate::messages::fixture::{self, Body, NOW_MS};
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AnyWindowHandle, AppContext as _, Bounds, Entity, Point, TestAppContext, WindowBounds,
    WindowOptions, px, size,
};
use semaphore_core::model::{Conversation, LoadState, MessageRow, PinnedRow};
use std::cell::RefCell;
use std::time::Duration;

fn row(seq: i64, text: &str) -> MessageRow {
    fixture::message(
        seq,
        fixture::user("u-ava", "ava", Some("Ava Chen")),
        NOW_MS - seq * 60_000,
        Body::default().text(text),
    )
}

fn hit(seq: i64) -> SearchHit {
    SearchHit {
        row: row(seq, "deploy"),
        conversation: Conversation::Channel { id: "c1".into() },
        parent_message_id: None,
        channel_name: Some("general".into()),
    }
}

fn ready(hits: Vec<SearchHit>) -> SearchResults {
    SearchResults::Ready {
        hits,
        at_limit: false,
    }
}

fn search(scope: SearchScopeChoice, query: &str) -> Option<SearchPanelEvent> {
    Some(SearchPanelEvent::Search {
        scope,
        query: query.into(),
    })
}

use SearchScopeChoice::{Community, Here};

// ---- The model. ----

#[test]
fn typing_asks_once_the_debounce_runs_out_with_the_query_trimmed() {
    let mut model = SearchModel::default();
    assert_eq!(model.shown(), Shown::Idle);
    assert!(model.set_text("  deploy "));
    // Typed but not asked yet: a spinner, not "No messages found", as the web shows.
    assert_eq!(model.shown(), Shown::Loading);
    assert_eq!(model.debounce_elapsed(), search(Here, "deploy"));
    assert_eq!(
        model.debounce_elapsed(),
        None,
        "the same search isn't asked twice"
    );
    assert!(model.accept(Here, "deploy", ready(vec![hit(1)])));
    assert_eq!(model.hits().len(), 1);
}

#[test]
fn results_for_an_older_query_or_the_other_scope_are_dropped() {
    let mut model = SearchModel::default();
    model.set_text("dep");
    model.debounce_elapsed();
    model.set_text("deploy");
    model.debounce_elapsed();
    assert!(
        !model.accept(Here, "dep", ready(vec![hit(1)])),
        "an older query"
    );
    assert!(
        !model.accept(Community, "deploy", ready(vec![hit(2)])),
        "the other scope"
    );
    assert_eq!(model.shown(), Shown::Loading);
    assert!(model.accept(Here, "deploy", ready(vec![hit(3)])));
    assert_eq!(model.hits()[0].row.seq, 3);
}

#[test]
fn a_scope_change_asks_at_once_and_drops_the_old_scopes_results() {
    let mut model = SearchModel::default();
    model.set_text("deploy");
    model.debounce_elapsed();
    assert_eq!(model.set_scope(Community), search(Community, "deploy"));
    assert_eq!(model.set_scope(Community), None, "no change, no search");
    assert!(!model.accept(Here, "deploy", ready(vec![hit(1)])));
    assert!(model.accept(Community, "deploy", ready(vec![hit(2)])));
    // Typed but not yet debounced when the scope changes: that text is asked right away.
    model.set_text("deploys");
    assert_eq!(model.set_scope(Here), search(Here, "deploys"));
    assert_eq!(
        model.debounce_elapsed(),
        None,
        "the scope change already asked it"
    );
}

#[test]
fn clearing_the_query_goes_idle_and_drops_late_results() {
    let mut model = SearchModel::default();
    model.set_text("deploy");
    model.debounce_elapsed();
    assert!(!model.set_text("   "), "nothing to ask");
    assert_eq!(model.shown(), Shown::Idle);
    assert_eq!(model.debounce_elapsed(), None);
    assert!(!model.accept(Here, "deploy", ready(vec![hit(1)])));
    assert_eq!(
        model.set_scope(Community),
        None,
        "an empty query asks nothing"
    );
}

#[test]
fn a_scope_change_with_no_query_asks_nothing() {
    let mut model = SearchModel::default();
    assert_eq!(model.set_scope(Community), None);
    assert_eq!(model.scope(), Community);
    model.set_text("x");
    assert_eq!(model.debounce_elapsed(), search(Community, "x"));
}

#[test]
fn try_again_repeats_the_failed_search_only() {
    let mut model = SearchModel::default();
    model.set_text("deploy");
    model.debounce_elapsed();
    assert_eq!(model.retry(), None, "nothing failed");
    model.accept(
        Here,
        "deploy",
        SearchResults::Failed {
            message: "down".into(),
        },
    );
    assert_eq!(model.shown(), Shown::Failed);
    assert_eq!(model.retry(), search(Here, "deploy"));
    assert_eq!(model.shown(), Shown::Loading);
}

#[test]
fn at_limit_and_empty_results_show_as_such() {
    let mut model = SearchModel::default();
    model.set_text("deploy");
    model.debounce_elapsed();
    model.accept(
        Here,
        "deploy",
        SearchResults::Ready {
            hits: vec![hit(1), hit(2)],
            at_limit: true,
        },
    );
    assert!(matches!(model.shown(), Shown::Ready { at_limit: true, hits } if hits.len() == 2));
    model.set_text("zebra");
    model.debounce_elapsed();
    model.accept(Here, "zebra", ready(Vec::new()));
    assert!(matches!(model.shown(), Shown::Ready { hits, .. } if hits.is_empty()));
}

// ---- In a window. ----

fn window_options() -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Point::default(),
            size: size(px(400.), px(800.)),
        })),
        ..Default::default()
    }
}

fn init(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        crate::kit::set_reduced_motion(true, cx);
    });
}

struct SearchRig {
    window: AnyWindowHandle,
    panel: Entity<SearchPanel>,
    events: std::rc::Rc<RefCell<Vec<SearchPanelEvent>>>,
}

impl SearchRig {
    fn new(cx: &mut TestAppContext) -> Self {
        init(cx);
        let events = std::rc::Rc::new(RefCell::new(Vec::new()));
        let log = events.clone();
        let (window, panel) = cx.update(|cx| {
            let mut made = None;
            let handle = gpui_kit::open_window(window_options(), cx, |window, cx| {
                let panel = cx.new(|cx| SearchPanel::new(true, window, cx));
                cx.subscribe(&panel, move |_, event: &SearchPanelEvent, _| {
                    log.borrow_mut().push(event.clone());
                })
                .detach();
                made = Some(panel.clone());
                panel
            })
            .expect("window");
            (handle.0, made.expect("built"))
        });
        Self {
            window,
            panel,
            events,
        }
    }

    fn with<R>(
        &self,
        cx: &mut TestAppContext,
        f: impl FnOnce(&Entity<SearchPanel>, &mut gpui_kit::Window, &mut gpui_kit::App) -> R,
    ) -> R {
        let out = cx
            .update_window(self.window, |_, window, cx| {
                window.render_frame(cx);
                let out = f(&self.panel, window, cx);
                window.render_frame(cx);
                out
            })
            .expect("window");
        cx.run_until_parked();
        out
    }

    fn typed(&self, cx: &mut TestAppContext, text: &str) {
        self.with(cx, |panel, _, cx| {
            panel.update(cx, |panel, cx| panel.query_changed(text, cx))
        });
    }

    fn searches(&self) -> Vec<SearchPanelEvent> {
        self.events
            .borrow()
            .iter()
            .filter(|event| matches!(event, SearchPanelEvent::Search { .. }))
            .cloned()
            .collect()
    }
}

#[gpui_kit::test]
fn the_search_waits_300ms_after_the_last_keystroke(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "de");
    cx.executor().advance_clock(Duration::from_millis(200));
    rig.typed(cx, "deploy");
    cx.executor()
        .advance_clock(DEBOUNCE - Duration::from_millis(1));
    cx.run_until_parked();
    assert!(rig.searches().is_empty(), "still inside the debounce");
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    assert_eq!(rig.searches(), vec![search(Here, "deploy").unwrap()]);
    cx.executor().advance_clock(Duration::from_secs(2));
    cx.run_until_parked();
    assert_eq!(
        rig.searches().len(),
        1,
        "the first keystroke's timer was cancelled"
    );
}

#[gpui_kit::test]
fn the_scope_toggle_searches_at_once(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |_, window, cx| window.click("search-scope-1", cx));
    assert_eq!(
        rig.searches(),
        vec![
            search(Here, "deploy").unwrap(),
            search(Community, "deploy").unwrap()
        ]
    );
}

#[gpui_kit::test]
fn clearing_the_field_cancels_a_pending_search(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    rig.typed(cx, "");
    cx.executor().advance_clock(Duration::from_secs(1));
    cx.run_until_parked();
    assert!(rig.searches().is_empty());
}

#[gpui_kit::test]
fn arrows_and_enter_in_the_field_move_through_and_open_hits(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |panel, window, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_results(
                Here,
                "deploy".into(),
                ready(vec![hit(1), hit(2), hit(3)]),
                cx,
            );
            panel.focus_field(window, cx);
        })
    });
    // Down from the field takes focus to the first result; then the list's own arrows move,
    // stopping at the last.
    rig.with(cx, |_, window, cx| window.press("down", cx));
    rig.with(cx, |_, window, cx| window.press("down", cx));
    rig.with(cx, |_, window, cx| window.press("down", cx));
    rig.with(cx, |_, window, cx| window.press("down", cx));
    rig.with(cx, |_, window, cx| window.press("up", cx));
    rig.with(cx, |_, window, cx| window.press("enter", cx));
    let jumped = rig.events.borrow().iter().find_map(|event| match event {
        SearchPanelEvent::Jump(hit) => Some(hit.row.seq),
        _ => None,
    });
    assert_eq!(jumped, Some(2));
    rig.with(cx, |_, window, cx| window.press("escape", cx));
    assert_eq!(rig.events.borrow().last(), Some(&SearchPanelEvent::Close));
}

#[gpui_kit::test]
fn clicking_a_hit_jumps_to_it(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_results(Here, "deploy".into(), ready(vec![hit(1), hit(2)]), cx)
        })
    });
    let id = hit(2).row.id.unwrap();
    rig.with(cx, |_, window, cx| {
        window.click(format!("search-hit-{id}"), cx)
    });
    assert!(matches!(
        rig.events.borrow().last(),
        Some(SearchPanelEvent::Jump(hit)) if hit.row.seq == 2
    ));
    assert_eq!(cx.update(|cx| rig.panel.read(cx).model().hits().len()), 2);
}

#[gpui_kit::test]
fn more_results_only_when_more(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_results(
                Here,
                "deploy".into(),
                SearchResults::Ready {
                    hits: vec![hit(1), hit(2)],
                    at_limit: true,
                },
                cx,
            );
        })
    });
    let has = |cx: &mut TestAppContext, id: &'static str| {
        rig.with(cx, |_, window, _| window.try_find(id).is_some())
    };
    assert!(has(cx, "search-at-limit"), "the line until core says");
    assert!(!has(cx, "search-more"), "no paging until core says");
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| panel.set_more(false, false, cx))
    });
    assert!(!has(cx, "search-at-limit"), "a known end drops the line");
    assert!(!has(cx, "search-more"));
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| panel.set_more(true, false, cx))
    });
    assert!(has(cx, "search-more"));
    assert!(!has(cx, "search-more-loading"), "not while it rests");
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| panel.set_more(true, true, cx))
    });
    assert!(!has(cx, "search-more"), "a page on its way replaces it");
    assert!(has(cx, "search-more-loading"));
}

#[gpui_kit::test]
fn more_results_emits_more(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_results(
                Here,
                "deploy".into(),
                SearchResults::Ready {
                    hits: vec![hit(1)],
                    at_limit: true,
                },
                cx,
            );
            panel.set_more(true, false, cx);
        })
    });
    rig.with(cx, |_, window, cx| window.click("search-more", cx));
    assert_eq!(
        rig.events.borrow().last(),
        Some(&SearchPanelEvent::More),
        "More results asks for the next page"
    );
}

struct PinsRig {
    window: AnyWindowHandle,
    panel: Entity<PinsPanel>,
    events: std::rc::Rc<RefCell<Vec<PinsPanelEvent>>>,
}

fn pins_rig(cx: &mut TestAppContext, can_unpin: bool) -> PinsRig {
    init(cx);
    let events = std::rc::Rc::new(RefCell::new(Vec::new()));
    let log = events.clone();
    let made = std::rc::Rc::new(RefCell::new(None));
    let keep = made.clone();
    let window = cx.update(|cx| {
        gpui_kit::open_window(window_options(), cx, |_, cx| {
            let panel = cx.new(|cx| {
                let mut panel = PinsPanel::new(cx);
                let rows = vec![
                    PinnedRow {
                        row: row(1, "first"),
                        parent_message_id: None,
                    },
                    PinnedRow {
                        row: row(2, "in a thread"),
                        parent_message_id: Some("parent-9".into()),
                    },
                ];
                panel.set_pins(
                    PinnedList {
                        state: LoadState::Ready,
                        rows,
                    },
                    can_unpin,
                    cx,
                );
                panel
            });
            cx.subscribe(&panel, move |_, event: &PinsPanelEvent, _| {
                log.borrow_mut().push(event.clone());
            })
            .detach();
            *keep.borrow_mut() = Some(panel.clone());
            panel
        })
        .expect("window")
        .0
    });
    let panel = made.borrow_mut().take().expect("built");
    PinsRig {
        window,
        panel,
        events,
    }
}

impl PinsRig {
    fn with<R>(
        &self,
        cx: &mut TestAppContext,
        f: impl FnOnce(&mut gpui_kit::Window, &mut gpui_kit::App) -> R,
    ) -> R {
        let out = cx
            .update_window(self.window, |_, window, cx| {
                window.render_frame(cx);
                let out = f(window, cx);
                window.render_frame(cx);
                out
            })
            .expect("window");
        cx.run_until_parked();
        out
    }
}

#[gpui_kit::test]
fn a_pin_click_jumps_to_it_and_its_thread(cx: &mut TestAppContext) {
    let rig = pins_rig(cx, false);
    let id = row(2, "").id.unwrap();
    rig.with(cx, |window, cx| window.click(format!("pin-{id}"), cx));
    assert_eq!(
        rig.events.borrow().as_slice(),
        [PinsPanelEvent::Jump {
            message_id: id.clone(),
            parent_message_id: Some("parent-9".into()),
        }]
    );
    let offered = rig.with(cx, |window, _| {
        window.try_find(format!("unpin-{id}")).is_some()
    });
    assert!(!offered, "no unpin control without the permission");
}

#[gpui_kit::test]
fn moderators_unpin_without_jumping(cx: &mut TestAppContext) {
    let rig = pins_rig(cx, true);
    let id = row(1, "").id.unwrap();
    rig.with(cx, |window, cx| window.click(format!("unpin-{id}"), cx));
    assert_eq!(
        rig.events.borrow().as_slice(),
        [PinsPanelEvent::Unpin { message_id: id }]
    );
}

#[gpui_kit::test]
fn escape_in_pins_closes_the_panel(cx: &mut TestAppContext) {
    let rig = pins_rig(cx, false);
    // A press on a pin puts the focus inside the panel, as the keyboard's Tab would.
    let id = row(2, "").id.unwrap();
    rig.with(cx, |window, cx| window.click(format!("pin-{id}"), cx));
    rig.events.borrow_mut().clear();
    cx.simulate_keystrokes(rig.window, "escape");
    rig.with(cx, |_, _| {});
    assert_eq!(rig.events.borrow().as_slice(), [PinsPanelEvent::Close]);
}

// ---- What the rows say. ----

/// A message with a lookalike host, as the server sends it: the address as typed.
fn lookalike(seq: i64) -> MessageRow {
    fixture::message(
        seq,
        fixture::user("u-ava", "ava", Some("Ava Chen")),
        NOW_MS - seq * 60_000,
        Body::default().text("log in at ").link(
            "https://\u{0430}pple.com/login",
            "https://\u{0430}pple.com/login",
        ),
    )
}

#[test]
fn previews_show_links_the_way_messages_do() {
    let hit = SearchHit {
        row: lookalike(1),
        ..hit(1)
    };
    assert_eq!(
        super::search::result_words(&hit),
        "log in at https://xn--pple-43d.com/login"
    );
    let pin = PinnedRow {
        row: lookalike(2),
        parent_message_id: None,
    };
    assert_eq!(
        super::pins::pin_secondary(&pin),
        "log in at https://xn--pple-43d.com/login"
    );
}

#[test]
fn a_pin_without_words_says_its_files_or_no_text() {
    let pin = |row: MessageRow| PinnedRow {
        row,
        parent_message_id: None,
    };
    let file = semaphore_core::model::AttachmentView {
        file_id: "f1".into(),
        filename: "notes.txt".into(),
        mime_type: "text/plain".into(),
        size_bytes: 10,
        kind: semaphore_core::model::AttachmentKind::Other,
        has_thumbnail: false,
        width: None,
        height: None,
    };
    let mut row = row(3, "");
    assert_eq!(super::pins::pin_secondary(&pin(row.clone())), "No text");
    row.attachments = vec![file.clone()];
    assert_eq!(super::pins::pin_secondary(&pin(row.clone())), "1 file");
    let mut row = self::row(4, "see these");
    row.attachments = vec![file.clone(), file];
    assert_eq!(super::pins::pin_secondary(&pin(row)), "see these · 2 files");
}

#[test]
fn the_results_announcement_says_how_many_and_where() {
    use super::search::results_announcement;
    assert_eq!(results_announcement(0, Here), "No messages found");
    assert_eq!(
        results_announcement(1, Here),
        "1 message found in this channel"
    );
    assert_eq!(
        results_announcement(4, Community),
        "4 messages found in all channels"
    );
}

#[gpui_kit::test]
fn enter_in_the_field_opens_the_first_result(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |panel, window, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_results(Here, "deploy".into(), ready(vec![hit(1), hit(2)]), cx);
            panel.focus_field(window, cx);
        })
    });
    rig.with(cx, |_, window, cx| window.press("enter", cx));
    assert!(matches!(
        rig.events.borrow().last(),
        Some(SearchPanelEvent::Jump(hit)) if hit.row.seq == 1
    ));
}

#[gpui_kit::test]
fn no_results_here_offers_all_channels(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_results(Here, "deploy".into(), ready(vec![]), cx)
        })
    });
    rig.with(cx, |_, window, cx| window.click("search-all", cx));
    assert_eq!(
        rig.searches().last(),
        search(Community, "deploy").as_ref(),
        "Search all channels asks the community at once"
    );
}

#[gpui_kit::test]
fn focus_comes_back_to_the_result_a_thread_was_opened_from(cx: &mut TestAppContext) {
    let rig = SearchRig::new(cx);
    rig.typed(cx, "deploy");
    cx.executor().advance_clock(DEBOUNCE);
    cx.run_until_parked();
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_results(Here, "deploy".into(), ready(vec![hit(1), hit(2)]), cx)
        })
    });
    let id = hit(2).row.id.unwrap();
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| panel.focus_result(&id, cx))
    });
    let focused = rig.with(cx, |_, window, _| {
        window.find(format!("search-hit-{id}")).focused()
    });
    assert_eq!(focused, Some(true));
}

#[gpui_kit::test]
fn an_unpinned_rows_neighbour_takes_focus(cx: &mut TestAppContext) {
    let rig = pins_rig(cx, true);
    let (first, second) = (row(1, "").id.unwrap(), row(2, "").id.unwrap());
    rig.with(cx, |window, cx| window.click(format!("unpin-{first}"), cx));
    // The list without it, as core sends once the server agreed.
    let panel = rig.panel.clone();
    rig.with(cx, |_, cx| {
        panel.update(cx, |panel, cx| {
            panel.set_pins(
                PinnedList {
                    state: LoadState::Ready,
                    rows: vec![PinnedRow {
                        row: row(2, "in a thread"),
                        parent_message_id: Some("parent-9".into()),
                    }],
                },
                true,
                cx,
            )
        });
    });
    rig.with(cx, |_, _| {});
    let focused = rig.with(cx, |window, _| {
        window.find(format!("pin-{second}")).focused()
    });
    assert_eq!(focused, Some(true));
}
