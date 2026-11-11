//! The list's stories, drawn by `rig-shot`. Each is a fixed set of rows at a fixed time.

use super::actions::{ListPermissions, MessageAction};
use super::fixture::{self, FixtureMedia, NOW_MS};
use super::format::TimeFormat;
use super::row::ReplyPreview;
use super::selection::{Pos, Selection};
use super::view::{ListData, ListOptions, ListStatus, MessageList, init};
use crate::stories::{Story, StoryEnv};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{MessageRow, ReactionUsers, UnreadMarker};
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

/// Files on their way: one mid-upload, one refused with its reason, and one the server still waits
/// for from another client.
fn uploads(cx: &mut App) -> AnyView {
    use semaphore_core::model::{ErrorView, UploadView};
    let mut row = fixture::message(
        1,
        fixture::me(),
        NOW_MS,
        fixture::Body::default().text("the files"),
    );
    row.client_nonce = Some("nonce-1".into());
    row.pending_attachments = 3;
    row.uploads = vec![
        UploadView {
            name: "holiday-photos.zip".into(),
            size_bytes: 8_400_000,
            sent_bytes: 3_150_000,
            failed: None,
        },
        UploadView {
            name: "a-very-large-recording-of-the-whole-meeting.mp4".into(),
            size_bytes: 52_000_000,
            sent_bytes: 0,
            failed: Some(ErrorView {
                code: "PAYLOAD_TOO_LARGE".into(),
                message: "File too large".into(),
                retryable: false,
                retry_after_ms: None,
            }),
        },
    ];
    StoryList::new(vec![row]).view(cx)
}

/// A link preview with its third-party image, which the app loads only when allowed. The fixture
/// source has none, so this draws the card without it, as the default does.
fn link_preview(cx: &mut App) -> AnyView {
    use semaphore_core::model::LinkPreviewView;
    let mut row = fixture::message(
        1,
        fixture::user("u-ava", "ava", Some("Ava Chen")),
        NOW_MS,
        fixture::Body::default().link("https://example.com/post", "https://example.com/post"),
    );
    row.link_previews = vec![LinkPreviewView {
        url: "https://example.com/post".into(),
        title: Some("A post with a long title that runs on past the width of the card".into()),
        description: Some("The description wraps to two lines at most, and anything more is cut off with an ellipsis so the card stays short.".into()),
        image_url: Some("https://example.com/cover.png".into()),
        site_name: Some("Example".into()),
        favicon_url: None,
        author_name: None,
    }];
    StoryList::new(vec![row]).view(cx)
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

const MEMBER: ListPermissions = ListPermissions {
    reply: true,
    react: true,
    threads: true,
    pin: false,
    unpin: false,
    remove_any: false,
};

const MODERATOR: ListPermissions = ListPermissions {
    pin: true,
    unpin: true,
    remove_any: true,
    ..MEMBER
};

type Setup = fn(&mut MessageList, &mut Window, &mut Context<MessageList>);

/// The action fixture with `permissions`, then whatever `setup` opens or hovers.
fn actions_story(
    permissions: ListPermissions,
    setup: Setup,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    init(cx);
    cx.new(|cx| {
        let mut list = MessageList::new(
            ListData {
                me_id: fixture::me().id,
                rows: fixture::actions(),
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
        );
        list.set_permissions(permissions, cx);
        setup(&mut list, window, cx);
        list
    })
    .into()
}

/// Stands in for the composer in edit mode, which the composer's own stories draw.
struct EditorStandIn;

impl Render for EditorStandIn {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .h(px(72.))
            .rounded(px(8.))
            .border_1()
            .border_color(rgb(0x0d9488))
            .p(px(12.))
            .text_color(rgb(0xffffff))
            .child("One more thing: the tray icon is blurry at 150%.")
    }
}

fn names(count: usize) -> ReactionUsers {
    let all = [
        ("u-ben", "ben", None),
        ("u-cleo", "cleo", Some("Cleo")),
        ("u-me", "me", Some("You")),
    ];
    ReactionUsers {
        users: all[..count]
            .iter()
            .map(|(id, username, display)| fixture::user(id, username, *display))
            .collect(),
        more: 0,
    }
}

fn action_stories() -> Vec<Story> {
    vec![
        Story::new("messages-toolbar-member", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| list.set_hovered(Some(1), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-toolbar-mine", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| list.set_hovered(Some(3), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-toolbar-moderator", |_, window, cx| {
            actions_story(
                MODERATOR,
                |list, _, cx| list.set_hovered(Some(2), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-toolbar-read-only", |_, window, cx| {
            actions_story(
                ListPermissions::default(),
                |list, _, cx| list.set_hovered(Some(3), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-delete-staged", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, window, cx| {
                    list.run_action(3, MessageAction::Delete, Point::default(), window, cx)
                },
                window,
                cx,
            )
        }),
        Story::new("messages-menu-member", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| list.open_menu(1, point(px(320.), px(60.)), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-menu-mine", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| list.open_menu(3, point(px(320.), px(200.)), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-menu-moderator", |_, window, cx| {
            actions_story(
                MODERATOR,
                |list, _, cx| list.open_menu(2, point(px(320.), px(120.)), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-remove-dialog", |_, window, cx| {
            actions_story(
                MODERATOR,
                |list, window, cx| list.open_remove_dialog(1, window, cx),
                window,
                cx,
            )
        }),
        Story::new("messages-editing", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| {
                    let editor = cx.new(|_| EditorStandIn).into();
                    list.set_editing(Some((4, editor)), cx);
                },
                window,
                cx,
            )
        }),
        Story::new("messages-removed-moderator", |_, window, cx| {
            actions_story(MODERATOR, |_, _, _| {}, window, cx)
        }),
        Story::new("messages-unread-divider", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| {
                    let marker = UnreadMarker {
                        after_message_id: String::new(),
                        after_seq: Some(3),
                        unread_count: 3,
                        mention_count: 1,
                    };
                    list.set_unread_marker(Some(&marker), cx);
                },
                window,
                cx,
            )
        }),
        Story::new("messages-highlight", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| list.set_highlight(Some(2), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-reaction-tooltip-loading", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| list.set_hovered_reaction(Some((1, "\u{1F44D}".into())), cx),
                window,
                cx,
            )
        }),
        Story::new("messages-reaction-tooltip", |_, window, cx| {
            actions_story(
                MEMBER,
                |list, _, cx| {
                    let id = fixture::actions()[0].id.clone().unwrap_or_default();
                    let mut users = names(3);
                    users.more = 4;
                    list.set_reaction_users(id, "\u{1F44D}".into(), users, cx);
                    list.set_hovered_reaction(Some((1, "\u{1F44D}".into())), cx);
                },
                window,
                cx,
            )
        }),
        Story::new("messages-sheet-narrow", |_, window, cx| {
            let view = actions_story(
                MODERATOR,
                |list, _, cx| list.open_menu(1, Point::default(), cx),
                window,
                cx,
            );
            narrow(view, cx)
        }),
        Story::new("messages-toolbar-narrow", |_, window, cx| {
            let view = actions_story(
                MEMBER,
                |list, _, cx| list.set_hovered(Some(3), cx),
                window,
                cx,
            );
            narrow(view, cx)
        }),
    ]
}

pub fn stories() -> Vec<Story> {
    let mut stories = action_stories();
    stories.extend(base_stories());
    stories
}

fn base_stories() -> Vec<Story> {
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
        Story::new("messages-uploads", |_, _, cx| uploads(cx)),
        Story::new("messages-link-preview", |_, _, cx| link_preview(cx)),
    ]
}
