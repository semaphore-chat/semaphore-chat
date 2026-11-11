//! The pins and search panels' stories. Each draws the panel where the shell puts it: docked at
//! the side panel's width beside a stand-in conversation, or filling a phone's screen.

use super::common::PanelClock;
use super::search::SearchModel;
use super::{PinsPanel, SearchPanel, SearchResults, SearchScopeChoice};
use crate::kit::{Variant, text};
use crate::messages::fixture::{self, Body, FixtureMedia, NOW_MS};
use crate::shell::{PHONE, SIDE_PANEL_WIDTH};
use crate::stories::Story;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AttachmentKind, AttachmentView, Conversation, ErrorView, LoadState, MessageRow, PinnedList,
    PinnedRow, SearchHit,
};
use std::rc::Rc;

const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;

/// Docks a panel at the side panel's width, or fills the window below a phone's width.
pub(crate) struct PanelFrame {
    pub view: AnyView,
}

impl Render for PanelFrame {
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
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(sem.text_disabled)
                    .child(text(Variant::Body2, "Conversation")),
            )
            .child(
                div()
                    .w(px(SIDE_PANEL_WIDTH))
                    .flex_shrink_0()
                    .h_full()
                    .border_l_1()
                    .border_color(sem.divider)
                    .child(self.view.clone()),
            )
            .into_any_element()
    }
}

pub(crate) fn framed(view: AnyView, cx: &mut App) -> AnyView {
    cx.new(|_| PanelFrame { view }).into()
}

fn row(seq: i64, author: (&str, &str, Option<&str>), ago_ms: i64, text: &str) -> MessageRow {
    fixture::message(
        seq,
        fixture::user(author.0, author.1, author.2),
        NOW_MS - ago_ms,
        Body::default().text(text),
    )
}

const AVA: (&str, &str, Option<&str>) = ("u-ava", "ava", Some("Ava Chen"));
const BEN: (&str, &str, Option<&str>) = ("u-ben", "ben", None);
const CLEO: (&str, &str, Option<&str>) = ("u-cleo", "cleo", Some("Cleo"));
const LONG_NAME: (&str, &str, Option<&str>) = (
    "u-long",
    "maximilian",
    Some("Maximilian Alexander Featherstonehaugh-Wolfeschlegelsteinhausen"),
);

const LONG_TEXT: &str = "Reminder for everyone joining this week: the staging database gets \
reset every night at 02:00 UTC, so anything you seed by hand is gone the next morning. Use the \
fixtures in scripts/seed instead, and if you need a long-lived account ask in #ops first. This \
paragraph keeps going so the preview has to stop after three lines and show that it was cut.";

fn attachment(file_id: &str, filename: &str, kind: AttachmentKind) -> AttachmentView {
    AttachmentView {
        file_id: file_id.into(),
        filename: filename.into(),
        mime_type: "application/octet-stream".into(),
        size_bytes: 48_213,
        kind,
        has_thumbnail: false,
        width: Some(640),
        height: Some(360),
    }
}

fn pin(row: MessageRow) -> PinnedRow {
    PinnedRow {
        row,
        parent_message_id: None,
    }
}

fn some_pins() -> Vec<PinnedRow> {
    vec![
        pin(row(
            1,
            AVA,
            3 * DAY,
            "Release checklist lives in the wiki: docs/release.md",
        )),
        pin(row(2, BEN, 5 * HOUR, "Standup moves to 10:30 on Fridays.")),
        PinnedRow {
            row: row(
                3,
                CLEO,
                12 * MINUTE,
                "Thread reply worth keeping: the fix is in 0.9.1.",
            ),
            parent_message_id: Some("parent-1".into()),
        },
    ]
}

fn long_pins() -> Vec<PinnedRow> {
    let mut with_image = row(10, AVA, 2 * DAY, "The new layout, for reference:");
    with_image.attachments = vec![
        attachment("img-wide", "layout.png", AttachmentKind::Image),
        attachment("file-notes", "notes.pdf", AttachmentKind::Document),
        attachment("file-more", "more.zip", AttachmentKind::Other),
    ];
    let mut file_only = row(11, BEN, 40 * DAY, "");
    file_only.attachments = vec![attachment(
        "file-spec",
        "a-very-long-file-name-for-the-network-protocol-specification-v3-final.pdf",
        AttachmentKind::Document,
    )];
    let mut pins = vec![
        pin(row(12, LONG_NAME, 400 * DAY, LONG_TEXT)),
        pin(with_image),
        pin(file_only),
    ];
    pins.extend((0..8).map(|index| {
        pin(row(
            20 + index,
            CLEO,
            (index + 1) * HOUR,
            "Another pinned note.",
        ))
    }));
    pins
}

fn pins_story(state: LoadState, rows: Vec<PinnedRow>, can_unpin: bool, cx: &mut App) -> AnyView {
    let panel = cx.new(|cx| {
        let mut panel = PinsPanel::new(Rc::new(FixtureMedia::new()), cx);
        panel.set_clock(PanelClock::fixed(NOW_MS), cx);
        panel.set_pins(PinnedList { state, rows }, can_unpin, cx);
        panel
    });
    framed(panel.into(), cx)
}

fn failed() -> LoadState {
    LoadState::Failed {
        error: ErrorView {
            code: "UNAVAILABLE".into(),
            message: "network unreachable".into(),
            retryable: true,
            retry_after_ms: None,
        },
    }
}

fn hit(row: MessageRow, channel: Option<&str>, parent: Option<&str>) -> SearchHit {
    SearchHit {
        row,
        conversation: Conversation::Channel {
            id: "c-general".into(),
        },
        parent_message_id: parent.map(str::to_owned),
        channel_name: channel.map(str::to_owned),
    }
}

fn some_hits() -> Vec<SearchHit> {
    vec![
        hit(
            row(
                1,
                AVA,
                4 * MINUTE,
                "The deploy finished, staging is on 0.9.1 now.",
            ),
            Some("general"),
            None,
        ),
        hit(
            row(
                2,
                BEN,
                3 * HOUR,
                "Can someone check the deploy logs? The canary looked slow.",
            ),
            Some("ops-and-infrastructure-alerts-long-name"),
            Some("parent-7"),
        ),
        hit(row(3, LONG_NAME, 2 * DAY, LONG_TEXT), Some("random"), None),
        hit(
            row(
                4,
                CLEO,
                9 * DAY,
                "deploy notes: migrations first, then the backend, then the web.",
            ),
            Some("general"),
            Some("parent-9"),
        ),
    ]
}

/// The panel as it is after typing `query` and waiting, with `results` answered.
fn search_story(
    community_scope: bool,
    scope: SearchScopeChoice,
    query: &str,
    results: Option<SearchResults>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let panel = cx.new(|cx| {
        let mut panel = SearchPanel::new(community_scope, window, cx);
        panel.set_clock(PanelClock::fixed(NOW_MS), cx);
        panel.show_for_story(scope, query, window, cx);
        if let Some(results) = results {
            panel.set_results(scope, query.trim().to_owned(), results, cx);
        }
        panel
    });
    framed(panel.into(), cx)
}

impl SearchPanel {
    /// Types `query` and lets the debounce run out, without waiting for it.
    fn show_for_story(
        &mut self,
        scope: SearchScopeChoice,
        query: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.field.update(cx, |field, cx| {
            field.set_value(query.to_owned(), window, cx)
        });
        let mut model = SearchModel::default();
        model.set_scope(scope);
        model.set_text(query);
        model.debounce_elapsed();
        self.model = model;
        self.debounce = None;
    }
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("pins-loading", |_, _, cx| {
            pins_story(LoadState::Loading, Vec::new(), false, cx)
        }),
        Story::new("pins-empty", |_, _, cx| {
            pins_story(LoadState::Ready, Vec::new(), false, cx)
        }),
        Story::new("pins-failed", |_, _, cx| {
            pins_story(failed(), Vec::new(), false, cx)
        }),
        Story::new("pins-list", |_, _, cx| {
            pins_story(LoadState::Ready, some_pins(), false, cx)
        }),
        Story::new("pins-moderator", |_, _, cx| {
            pins_story(LoadState::Ready, some_pins(), true, cx)
        }),
        Story::new("pins-long", |_, _, cx| {
            pins_story(LoadState::Ready, long_pins(), true, cx)
        }),
        Story::new("search-idle", |_, window, cx| {
            search_story(true, SearchScopeChoice::Here, "", None, window, cx)
        }),
        Story::new("search-loading", |_, window, cx| {
            search_story(true, SearchScopeChoice::Here, "deploy", None, window, cx)
        }),
        Story::new("search-empty", |_, window, cx| {
            let results = SearchResults::Ready {
                hits: Vec::new(),
                at_limit: false,
            };
            search_story(
                true,
                SearchScopeChoice::Here,
                "zebra",
                Some(results),
                window,
                cx,
            )
        }),
        Story::new("search-failed", |_, window, cx| {
            let results = SearchResults::Failed {
                message: "network unreachable".into(),
            };
            search_story(
                true,
                SearchScopeChoice::Here,
                "deploy",
                Some(results),
                window,
                cx,
            )
        }),
        Story::new("search-results", |_, window, cx| {
            let results = SearchResults::Ready {
                hits: some_hits(),
                at_limit: false,
            };
            search_story(
                true,
                SearchScopeChoice::Community,
                "deploy",
                Some(results),
                window,
                cx,
            )
        }),
        Story::new("search-at-limit", |_, window, cx| {
            let hits = (0..20)
                .map(|index| {
                    hit(
                        row(100 + index, AVA, (index + 1) * HOUR, "deploy went fine"),
                        None,
                        (index % 5 == 0).then_some("parent-3"),
                    )
                })
                .collect();
            let results = SearchResults::Ready {
                hits,
                at_limit: true,
            };
            search_story(
                true,
                SearchScopeChoice::Here,
                "deploy",
                Some(results),
                window,
                cx,
            )
        }),
        Story::new("search-dm", |_, window, cx| {
            let results = SearchResults::Ready {
                hits: some_hits().into_iter().take(2).collect(),
                at_limit: false,
            };
            search_story(
                false,
                SearchScopeChoice::Here,
                "deploy",
                Some(results),
                window,
                cx,
            )
        }),
    ]
}
