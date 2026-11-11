//! The thread pane's stories, with a real list for the parent and the replies and a real composer,
//! docked or full-screen as the shell draws it.

use super::ThreadPane;
use crate::composer::{Composer, ComposerConfig, DraftStore, MentionSource};
use crate::messages::fixture::{self, Body, FixtureMedia, NOW_MS};
use crate::messages::{ListData, ListOptions, ListStatus, MessageList, TimeFormat, init};
use crate::panel::PanelClock;
use crate::panel::stories::framed;
use crate::stories::Story;
use gpui_kit::*;
use semaphore_core::model::{
    Conversation, ErrorView, LoadState, MentionCandidate, MessageRow, ThreadInfo,
};
use std::collections::HashMap;
use std::rc::Rc;

const MINUTE: i64 = 60_000;

struct NoMentions;

impl MentionSource for NoMentions {
    fn candidates(&self, _: &str) -> Vec<MentionCandidate> {
        Vec::new()
    }
}

fn list(rows: Vec<MessageRow>, cx: &mut App) -> AnyView {
    init(cx);
    cx.new(|cx| {
        MessageList::new(
            ListData {
                me_id: fixture::me().id,
                rows,
                replies: HashMap::new(),
                status: ListStatus::Ready,
            },
            Rc::new(FixtureMedia::new()),
            ListOptions {
                time: TimeFormat::fixed(NOW_MS),
                scrollbar: false,
                ..ListOptions::default()
            },
            cx,
        )
    })
    .into()
}

fn parent_row() -> MessageRow {
    let mut row = fixture::message(
        1,
        fixture::user("u-ava", "ava", Some("Ava Chen")),
        NOW_MS - 90 * MINUTE,
        Body::default().text("Deploy notes are up. Shout if I missed anything in the checklist."),
    );
    row.reply_count = 3;
    row
}

fn replies() -> Vec<MessageRow> {
    vec![
        fixture::message(
            2,
            fixture::user("u-ben", "ben", None),
            NOW_MS - 80 * MINUTE,
            Body::default().text("Looks good to me."),
        ),
        fixture::message(
            3,
            fixture::user("u-cleo", "cleo", Some("Cleo")),
            NOW_MS - 30 * MINUTE,
            Body::default().text("The migration step should come before the backend restart."),
        ),
        fixture::message(
            4,
            fixture::me(),
            NOW_MS - 5 * MINUTE,
            Body::default().text("Fixed, thanks both."),
        ),
    ]
}

fn composer(window: &mut Window, cx: &mut App) -> AnyView {
    let drafts = cx.new(|_| DraftStore::default());
    cx.new(|cx| {
        Composer::new(
            ComposerConfig {
                conversation: Conversation::Thread {
                    parent_message_id: "parent-1".into(),
                },
                source: Rc::new(NoMentions),
                drafts,
                placeholder: "Reply in thread...".into(),
                max_file_bytes: None,
                mode: crate::composer::ComposerMode::Thread,
            },
            window,
            cx,
        )
    })
    .into()
}

fn pane(
    info: ThreadInfo,
    reply_rows: Vec<MessageRow>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let parent = list(vec![parent_row()], cx);
    let replies = list(reply_rows.clone(), cx);
    let composer = composer(window, cx);
    let count = reply_rows.len();
    let pane = cx.new(|cx| {
        let mut pane = ThreadPane::new(parent, replies, composer, cx);
        pane.set_clock(PanelClock::fixed(NOW_MS), cx);
        pane.set_info(info, cx);
        pane.set_reply_rows(count, cx);
        pane
    });
    framed(pane.into(), cx)
}

fn ready(subscribed: bool, reply_count: u32) -> ThreadInfo {
    ThreadInfo {
        state: LoadState::Ready,
        subscribed,
        reply_count,
        last_reply_at_ms: (reply_count > 0).then_some(NOW_MS - 5 * MINUTE),
    }
}

fn failed(code: &str) -> ThreadInfo {
    ThreadInfo {
        state: LoadState::Failed {
            error: ErrorView {
                code: code.into(),
                message: format!("{code} (404): not found"),
                retryable: code != "NOT_FOUND",
                retry_after_ms: None,
            },
        },
        ..ThreadInfo::default()
    }
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("thread-subscribed", |_, window, cx| {
            pane(ready(true, 3), replies(), window, cx)
        }),
        Story::new("thread-unsubscribed", |_, window, cx| {
            pane(ready(false, 3), replies(), window, cx)
        }),
        Story::new("thread-no-replies", |_, window, cx| {
            pane(ready(false, 0), Vec::new(), window, cx)
        }),
        // A first reply on its way: the server's count is still 0, the row shows anyway.
        Story::new("thread-first-reply-pending", |_, window, cx| {
            let mut reply =
                fixture::message(2, fixture::me(), NOW_MS, Body::default().text("First!"));
            reply.id = None;
            reply.client_nonce = Some("n-first".into());
            reply.send_state = semaphore_core::model::SendState::Pending;
            pane(ready(false, 0), vec![reply], window, cx)
        }),
        Story::new("thread-loading", |_, window, cx| {
            pane(ThreadInfo::default(), Vec::new(), window, cx)
        }),
        Story::new("thread-missing-parent", |_, window, cx| {
            pane(failed("NOT_FOUND"), Vec::new(), window, cx)
        }),
        Story::new("thread-failed", |_, window, cx| {
            pane(failed("UNAVAILABLE"), Vec::new(), window, cx)
        }),
    ]
}
