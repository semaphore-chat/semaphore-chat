//! The list's stories, drawn by `rig-shot`. Each is a fixed set of rows at a fixed time.

use super::fixture::{self, FixtureMedia, NOW_MS};
use super::format::TimeFormat;
use super::row::ReplyPreview;
use super::selection::{Pos, Selection};
use super::view::{ListData, ListOptions, ListStatus, MessageList, init};
use crate::stories::{Story, StoryEnv};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::MessageRow;
use semaphore_core::scenario::ScenarioViews;
use std::collections::HashMap;
use std::rc::Rc;

/// Holds a story to a phone's width, whatever the window's.
struct NarrowFrame {
    view: AnyView,
}

impl Render for NarrowFrame {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .bg(rgb(0x000000))
            .child(div().w(px(390.)).h_full().child(self.view.clone()))
    }
}

fn narrow(view: AnyView, cx: &mut App) -> AnyView {
    cx.new(|_| NarrowFrame { view }).into()
}

/// One story's list.
struct StoryList {
    rows: Vec<MessageRow>,
    replies: HashMap<i64, ReplyPreview>,
    status: ListStatus,
    now_ms: i64,
    selection: Option<Selection>,
    /// The row to start at. The list starts at its tail otherwise.
    top_seq: Option<i64>,
}

impl StoryList {
    fn new(rows: Vec<MessageRow>) -> Self {
        Self {
            rows,
            replies: HashMap::new(),
            status: ListStatus::Ready,
            now_ms: NOW_MS,
            selection: None,
            top_seq: None,
        }
    }

    fn view(self, cx: &mut App) -> AnyView {
        init(cx);
        let view = cx.new(|cx| {
            let mut list = MessageList::new(
                ListData {
                    me_id: fixture::me().id,
                    rows: self.rows,
                    replies: self.replies,
                    status: self.status,
                },
                Rc::new(FixtureMedia::new()),
                ListOptions {
                    time: TimeFormat::fixed(self.now_ms),
                    scrollbar: false,
                    ..ListOptions::default()
                },
                cx,
            );
            list.set_selection(self.selection, cx);
            if let Some(seq) = self.top_seq {
                list.scroll_to_seq(seq, 0.);
            }
            list
        });
        view.into()
    }
}

/// The busiest conversation in a scenario, oldest first.
fn busiest(views: &ScenarioViews) -> Option<&Vec<MessageRow>> {
    views
        .messages
        .iter()
        .map(|(_, rows)| rows)
        .max_by_key(|rows| rows.len())
}

/// A real exported scenario when U3's are here, else the hand-written one.
fn from_scenario(env: &StoryEnv, cx: &mut App) -> AnyView {
    let rows = env
        .scenario("showcase")
        .ok()
        .and_then(|views| busiest(&views).cloned());
    match rows {
        Some(rows) => {
            let now_ms = rows.last().map_or(NOW_MS, |row| row.sent_at_ms);
            StoryList {
                now_ms,
                ..StoryList::new(rows)
            }
            .view(cx)
        }
        None => conversation(None, cx),
    }
}

fn conversation(top_seq: Option<i64>, cx: &mut App) -> AnyView {
    let (views, replies) = fixture::scenario();
    let rows = busiest(&views).cloned().unwrap_or_default();
    StoryList {
        replies,
        top_seq,
        ..StoryList::new(rows)
    }
    .view(cx)
}

fn with_selection(cx: &mut App) -> AnyView {
    let (rows, replies) = fixture::conversation();
    let at = |contains: &str| {
        rows.iter()
            .find(|row| row.display.contains(contains))
            .map_or(0, |row| row.seq)
    };
    // Mid-word in one row, through a mention, styled runs, emoji and a code block, to mid-reply.
    let selection = Selection {
        anchor: Pos {
            seq: at("voice bug"),
            byte: 13,
        },
        cursor: Pos {
            seq: at("token expiring"),
            byte: 22,
        },
    };
    StoryList {
        replies,
        selection: Some(selection),
        top_seq: Some(selection.anchor.seq),
        ..StoryList::new(rows)
    }
    .view(cx)
}

fn missing_images(cx: &mut App) -> AnyView {
    // Ids the fixture media doesn't know: a failed load, in the boxes a real one would fill.
    let (mut rows, replies) = fixture::conversation();
    for row in &mut rows {
        for attachment in &mut row.attachments {
            attachment.file_id = format!("missing-{}", attachment.file_id);
            attachment.width = None;
            attachment.height = None;
        }
    }
    rows.retain(|row| !row.attachments.is_empty());
    StoryList {
        replies,
        ..StoryList::new(rows)
    }
    .view(cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("messages-conversation", |_, _, cx| conversation(None, cx)),
        Story::new("messages-conversation-top", |_, _, cx| {
            conversation(Some(1), cx)
        }),
        Story::new("messages-scenario", |env, _, cx| from_scenario(env, cx)),
        Story::new("messages-empty", |_, _, cx| {
            StoryList::new(Vec::new()).view(cx)
        }),
        Story::new("messages-loading", |_, _, cx| {
            StoryList {
                status: ListStatus::Loading,
                ..StoryList::new(Vec::new())
            }
            .view(cx)
        }),
        Story::new("messages-long", |_, _, cx| {
            StoryList::new(fixture::long_content()).view(cx)
        }),
        Story::new("messages-removed", |_, _, cx| {
            let (rows, replies) = fixture::removed();
            StoryList {
                replies,
                ..StoryList::new(rows)
            }
            .view(cx)
        }),
        Story::new("messages-narrow", |_, _, cx| {
            let view = conversation(Some(1), cx);
            narrow(view, cx)
        }),
        Story::new("messages-narrow-tail", |_, _, cx| {
            let view = conversation(None, cx);
            narrow(view, cx)
        }),
        Story::new("messages-narrow-long", |_, _, cx| {
            let view = StoryList::new(fixture::long_content()).view(cx);
            narrow(view, cx)
        }),
        Story::new("messages-failed", |_, _, cx| {
            StoryList::new(fixture::send_states()).view(cx)
        }),
        Story::new("messages-selection", |_, _, cx| with_selection(cx)),
        Story::new("messages-missing-images", |_, _, cx| missing_images(cx)),
    ]
}
