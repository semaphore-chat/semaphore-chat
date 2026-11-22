//! MessageRow and ChatPane, one story per state the web kit's stories show
//! (`frontend/src/stories/kit/KitMessageRow.stories.tsx`, `KitChatPane.stories.tsx`), in the same
//! words. The Composer is B7 part 3: until it lands, the panes' composer slot holds a story-only
//! stand-in field, and the row's `editing` stories come with it.

use super::stories::{Body, Palette, chat_column, colour, log_link, picture, view, words};
use super::{
    AttachmentKind, AttachmentTile, ChatPane, JumpToLatest, MentionKind, MentionSegment,
    MessageQuote, MessageRow, MessageSegment as S, MessageState, MessageText, ReactionChip,
    RowFocus, TypingLine,
};
use crate::kit::overlays::type_text;
use crate::kit::{Button, ControlSize, IconButton, Island, ListSeparator, Padding};
use crate::stories::Story;
use crate::theme::{self, SemTheme};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::chat::TYPING_LINE_HEIGHT;
use semaphore_design::lounge::{
    self as t, LAYOUT_GUTTER, RADIUS_ISLAND, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL,
};
use semaphore_design::{Icon as I, LoungeIcon};

fn text(id: &'static str, words: &'static str) -> MessageText {
    MessageText::new(id, vec![S::text(words)]).on_link(log_link)
}

fn replies(id: &'static str, count: u32) -> Button {
    Button::new(id, format!("{count} replies"))
        .text()
        .size(ControlSize::Sm)
        .start_icon(I::Forum)
        .on_click(|_, _, _| {})
}

const REACTIONS: [(&str, &str, u64, bool); 3] = [
    ("😂", "Laugh", 4, true),
    ("🔥", "Fire", 2, false),
    ("👍", "Thumbs up", 1, false),
];

fn chips(prefix: &'static str) -> Vec<AnyElement> {
    REACTIONS
        .iter()
        .map(|(emoji, label, count, mine)| {
            ReactionChip::new(
                SharedString::from(format!("{prefix}-{label}")),
                *emoji,
                *label,
                *count,
            )
            .mine(*mine)
            .on_toggle(|_, _| {})
            .into_any_element()
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// MessageRow: states

fn states_body(_: &mut Window, _: &mut App) -> AnyElement {
    let row = |id: &'static str, author: &'static str, hex: u32, time: &'static str| {
        MessageRow::new(id, author, time).avatar_colour(colour(hex))
    };
    chat_column(
        "row-states",
        640.,
        vec![
            row("s1", "aiko", 0xff8fb8, "8:19 PM")
                .time_label("Monday 16 November 2026, 8:19 PM")
                .on_open_author(|_, _| {})
                .body(
                    MessageText::new(
                        "s1-body",
                        vec![
                            S::mention(MentionSegment::new(MentionKind::User, "@dropbear").id("u2")),
                            S::text(" you still have my headset btw"),
                        ],
                    )
                    .on_mention(|_, _, _| {}),
                )
                .into_any_element(),
            row("s2", "aiko", 0xff8fb8, "8:19 PM")
                .continued(true)
                .body(text("s2-body", "first of a group above, this one is continued"))
                .into_any_element(),
            row("s3", "dropbear", 0x5fd49a, "8:21 PM")
                .mentioned(true)
                .on_open_author(|_, _| {})
                .body(MessageText::new(
                    "s3-body",
                    vec![
                        S::mention(MentionSegment::new(MentionKind::User, "@alexk").me()),
                        S::text(" yeah i'll bring it friday"),
                    ],
                ))
                .into_any_element(),
            row("s4", "gracie", 0xffa366, "8:22 PM")
                .highlighted(true)
                .edited(true)
                .pinned(true)
                .body(text("s4-body", "the jump target: highlighted, edited and pinned"))
                .into_any_element(),
            row("s5", "gracie", 0xffa366, "8:22 PM")
                .continued(true)
                .quote(MessageQuote::new(
                    "s5-quote",
                    "kwam3",
                    "ok that run was cursed, same time tomorrow?",
                ))
                .body(text("s5-body", "found this from last time"))
                .attachments(
                    AttachmentTile::new("s5-file", AttachmentKind::File, "deep-dive-clip.png")
                        .detail("1.2 MB")
                        .on_open(|_, _| {}),
                )
                .reactions(chips("s5"))
                .footer(replies("s5-replies", 3))
                .into_any_element(),
            row("s6", "alexk", 0x9aa0ff, "8:24 PM")
                .state(MessageState::Pending)
                .body(text("s6-body", "on its way to the server"))
                .into_any_element(),
            row("s7", "alexk", 0x9aa0ff, "8:24 PM")
                .continued(true)
                .state(MessageState::Failed)
                .on_retry(|_, _| {})
                .on_delete(|_, _| {})
                .body(text("s7-body", "this one did not make it"))
                .into_any_element(),
            row("s8", "alexk", 0x9aa0ff, "8:25 PM")
                .continued(true)
                .state(MessageState::Failed)
                .failed_reason("Timed out until 8:40 PM")
                .on_retry(|_, _| {})
                .on_delete(|_, _| {})
                .body(text("s8-body", "failed with a reason from the server"))
                .into_any_element(),
            row("s9", "alexk", 0x9aa0ff, "8:25 PM")
                .continued(true)
                .state(MessageState::Failed)
                .failed_reason(
                    "The server could not store this message because the channel was deleted while it was on its way",
                )
                .retrying(true)
                .on_retry(|_, _| {})
                .on_delete(|_, _| {})
                .body(text(
                    "s9-body",
                    "a long reason wraps; Retry is busy while the retry is on its way",
                ))
                .into_any_element(),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// MessageRow: long content

const MANY: [&str; 16] = [
    "😂", "🔥", "👍", "🎉", "❤️", "😮", "😢", "🙏", "👀", "💯", "🚀", "🤔", "😅", "🍕", "🎮", "⭐",
];

fn long_body(_: &mut Window, _: &mut App) -> AnyElement {
    let unbroken: &'static str = Box::leak(
        format!("{}https://example.com/{}", "a".repeat(30), "x".repeat(160)).into_boxed_str(),
    );
    chat_column(
        "row-long",
        640.,
        vec![
            MessageRow::new(
                "l1",
                "Bartholomew Montgomery-Fitzwilliam the Third, Keeper of the Couch",
                "Yesterday 11:58 PM",
            )
            .avatar_colour(colour(0x6fb1f5))
            .edited(true)
            .pinned(true)
            .on_open_author(|_, _| {})
            .body(text(
                "l1-body",
                "a very long name gives way with an ellipsis; the time stays",
            ))
            .into_any_element(),
            MessageRow::new("l2", "kwam3", "8:23 PM")
                .avatar_colour(colour(0x6fb1f5))
                .body(text("l2-body", unbroken))
                .into_any_element(),
            MessageRow::new("l3", "pri", "8:24 PM")
                .avatar_colour(colour(0xc792f0))
                .body(MessageText::new(
                    "l3-body",
                    vec![
                        S::text("the config that fixed it:"),
                        S::code_block("livekit:\n  rtc:\n    use_external_ip: true\n    port_range_start: 50000\n    port_range_end: 60000 # a long comment line that wraps instead of scrolling sideways on a phone"),
                    ],
                ))
                .into_any_element(),
            MessageRow::new("l4", "aiko", "8:25 PM")
                .avatar_colour(colour(0xff8fb8))
                .body(text("l4-body", "so many reactions they wrap"))
                .reactions(MANY.iter().enumerate().map(|(index, emoji)| {
                    ReactionChip::new(
                        SharedString::from(format!("many-{index}")),
                        *emoji,
                        SharedString::from(format!("Reaction {}", index + 1)),
                        index as u64 * 7 + 1,
                    )
                    .mine(index % 5 == 0)
                    .on_toggle(|_, _| {})
                }))
                .into_any_element(),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// MessageRow: the toolbar

fn toolbar(prefix: &str) -> Vec<AnyElement> {
    [
        (LoungeIcon::SmilePlus, "Add reaction"),
        (LoungeIcon::Reply, "Reply"),
        (LoungeIcon::Ellipsis, "More actions"),
    ]
    .into_iter()
    .map(|(icon, label)| {
        IconButton::new(
            SharedString::from(format!("{prefix}-{label}")),
            I::MoreHoriz,
            label,
        )
        .lounge_icon(icon)
        .small()
        .on_click(|_, _, _| {})
        .into_any_element()
    })
    .collect()
}

/// Rows in a roving list; the first is the Tab stop and has focus, so its toolbar shows.
struct ToolbarRows {
    handles: Vec<FocusHandle>,
    after_list: bool,
    words: [&'static str; 3],
}

impl ToolbarRows {
    fn new(count: usize, after_list: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let handles: Vec<FocusHandle> = (0..count).map(|_| cx.focus_handle()).collect();
        window.focus(&handles[0], cx);
        Self {
            handles,
            after_list,
            words: ["first", "second", "third"],
        }
    }
}

impl Render for ToolbarRows {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let actions = !self.after_list;
        let mut rows: Vec<AnyElement> = vec![div().h(px(SPACE_XL)).into_any_element()];
        for (index, handle) in self.handles.iter().enumerate() {
            let id = SharedString::from(format!("toolbar-row-{index}"));
            let body: AnyElement = if actions {
                if index == 0 {
                    text("tb-0", "hover me, or Tab to me: the toolbar shows").into_any_element()
                } else {
                    text(
                        "tb-1",
                        "a continued row: its time shows in the gutter on hover and focus",
                    )
                    .into_any_element()
                }
            } else {
                MessageText::new(
                    SharedString::from(format!("tb-words-{index}")),
                    vec![S::text(format!("the {} row", self.words[index]))],
                )
                .into_any_element()
            };
            let time = if actions {
                SharedString::from("8:22 PM")
            } else {
                SharedString::from(format!("8:2{index} PM"))
            };
            let mut row = MessageRow::new(id.clone(), "gracie", time)
                .avatar_colour(colour(0xffa366))
                .continued(index > 0)
                .focus(RowFocus {
                    handle: handle.clone(),
                    tab_stop: index == 0,
                })
                .body(body);
            if index == 0 || !actions {
                row = row
                    .on_open_actions(|request, _, _| {
                        eprintln!("story: actions asked for: {request:?}")
                    })
                    .actions(toolbar(&id));
            }
            rows.push(row.into_any_element());
        }
        if self.after_list {
            rows.push(
                div()
                    .p(px(SPACE_MD))
                    .child(Button::new("after-list", "After the list").soft())
                    .into_any_element(),
            );
        }
        div()
            .id("toolbar-story")
            .size_full()
            .bg(cx.sem().role.ground)
            .text_color(cx.sem().role.text)
            .p(px(LAYOUT_GUTTER))
            .child(chat_column("toolbar-rows", 640., rows))
    }
}

fn toolbar_story(
    palette: Palette,
    count: usize,
    after_list: bool,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    theme::apply(palette.input(), cx);
    cx.new(|cx| ToolbarRows::new(count, after_list, window, cx))
        .into()
}

// ---------------------------------------------------------------------------------------------
// ChatPane

/// A centre island of a phone's size: the pane fills it.
fn frame(height: f32, pane: impl IntoElement) -> AnyElement {
    div()
        .w(px(390.))
        .max_w_full()
        .h(px(height))
        .child(
            Island::new("pane-island")
                .padding(Padding::None)
                .child(div().size_full().child(pane)),
        )
        .into_any_element()
}

fn header(id: &'static str, back: &'static str, title: &'static str) -> AnyElement {
    div()
        .flex()
        .items_center()
        .gap(px(SPACE_SM))
        .child(
            IconButton::new(id, I::ArrowBack, back)
                .lounge_icon(LoungeIcon::ArrowLeft)
                .on_click(|_, _, _| {}),
        )
        .child(
            type_text(t::TEXT_TITLE, title)
                .min_w_0()
                .overflow_hidden()
                .whitespace_nowrap()
                .text_ellipsis(),
        )
        .into_any_element()
}

/// The composer slot's stand-in until the Composer lands (B7 part 3): a field-shaped pill.
fn composer_stand_in(placeholder: &'static str, cx: &App) -> AnyElement {
    let sem = cx.sem();
    div()
        .pt(px(SPACE_SM))
        .px(px(SPACE_MD))
        .pb(px(SPACE_MD))
        .child(
            div()
                .h(px(t::CONTROL_LG))
                .px(px(SPACE_LG))
                .flex()
                .items_center()
                .rounded(px(RADIUS_ISLAND))
                .bg(crate::kit::surface::stand_out_fill(
                    sem,
                    crate::kit::Surface::Surface,
                ))
                .text_color(sem.role.text_secondary)
                .child(type_text(t::TEXT_BODY, placeholder)),
        )
        .into_any_element()
}

const WORDS: [&str; 7] = [
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
];

fn rows(id: &'static str) -> AnyElement {
    let mut children: Vec<AnyElement> =
        vec![ListSeparator::day("today", "Today").into_any_element()];
    for (index, word) in WORDS.iter().enumerate() {
        let (author, hex) = if index % 2 == 1 {
            ("aiko", 0xff8fb8)
        } else {
            ("dropbear", 0x5fd49a)
        };
        children.push(
            MessageRow::new(
                SharedString::from(format!("{id}-{index}")),
                author,
                SharedString::from(format!("8:{} PM", 10 + index)),
            )
            .avatar_colour(colour(hex))
            .body(MessageText::new(
                SharedString::from(format!("{id}-{index}-body")),
                vec![S::text(format!("the {word} message of a busy evening"))],
            ))
            .into_any_element(),
        );
    }
    children.push(ListSeparator::unread("new", "New").into_any_element());
    children.push(
        MessageRow::new(
            SharedString::from(format!("{id}-last")),
            "gracie",
            "8:30 PM",
        )
        .avatar_colour(colour(0xffa366))
        .body(words("last-body", "the first one not read yet"))
        .into_any_element(),
    );
    div()
        .id(id)
        .flex_1()
        .min_h_0()
        .overflow_y_scroll()
        .pb(px(TYPING_LINE_HEIGHT))
        .children(children)
        .into_any_element()
}

fn conversation_body(_: &mut Window, _: &mut App) -> AnyElement {
    frame(
        640.,
        ChatPane::new("pane")
            .header(header("back", "Back", "# lobby"))
            .list(rows("rows"))
            .typing(TypingLine::new(["aiko", "dropbear"]))
            .jump(JumpToLatest::new("jump", |_, _| {}).new_count(3))
            .announcement("3 new messages"),
    )
}

fn covered_body(_: &mut Window, cx: &mut App) -> AnyElement {
    let thread = ChatPane::new("thread")
        .header(header("thread-back", "Back to #lobby", "Thread"))
        .list(
            div()
                .id("thread-rows")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .child(
                    MessageRow::new("t1", "aiko", "8:10 PM")
                        .avatar_colour(colour(0xff8fb8))
                        .body(words("t1-body", "the message the thread is about")),
                )
                .child(ListSeparator::day("replies", "2 replies"))
                .child(
                    MessageRow::new("t2", "dropbear", "8:12 PM")
                        .avatar_colour(colour(0x5fd49a))
                        .body(words("t2-body", "a reply")),
                )
                .child(
                    MessageRow::new("t3", "gracie", "8:14 PM")
                        .avatar_colour(colour(0xffa366))
                        .body(words("t3-body", "another reply")),
                ),
        )
        .composer(composer_stand_in("Reply in thread", cx));
    frame(
        640.,
        ChatPane::new("pane")
            .header(header("back", "Back", "# lobby"))
            .list(rows("rows"))
            .typing(TypingLine::new(Vec::<&str>::new()))
            .announcement("")
            .composer(composer_stand_in("Message #lobby", cx))
            .cover(thread),
    )
}

// ---------------------------------------------------------------------------------------------
// ChatPane: a long history

const COUNT: usize = 2000;
const AUTHORS: [(&str, u32); 4] = [
    ("aiko", 0xff8fb8),
    ("dropbear", 0x5fd49a),
    ("gracie", 0xffa366),
    ("kwam3", 0x6fb1f5),
];

/// 2,000 rows (200 with sized images) in GPUI's `list`, the newest at the bottom, with roving
/// focus: the last row is the Tab stop, and the arrows move it.
struct LongHistory {
    list: ListState,
    handles: Vec<FocusHandle>,
    focused: usize,
    picture: ImageSource,
}

impl LongHistory {
    fn new(cx: &mut Context<Self>) -> Self {
        Self {
            list: ListState::new(COUNT, ListAlignment::Bottom, px(400.)),
            handles: (0..COUNT).map(|_| cx.focus_handle()).collect(),
            focused: COUNT - 1,
            picture: picture(160, 90, 0x6fb1f5),
        }
    }

    fn row(&self, index: usize) -> AnyElement {
        let (author, hex) = AUTHORS[(index / 3) % AUTHORS.len()];
        let minutes = index * 7;
        let time = format!("{:02}:{:02}", (12 + minutes / 60) % 24, minutes % 60);
        let words = format!(
            "message {index}: {}",
            "words that fill a line or two of a phone column ".repeat(index % 3 + 1)
        );
        let day = index.is_multiple_of(200);
        let mut row = MessageRow::new(("long-row", index), author, time)
            .avatar_colour(colour(hex))
            .continued(!index.is_multiple_of(3) && !day)
            .focus(RowFocus {
                handle: self.handles[index].clone(),
                tab_stop: index == self.focused,
            })
            .body(MessageText::new(("long-body", index), vec![S::text(words)]));
        if index % 10 == 9 {
            row = row.attachments(
                AttachmentTile::new(
                    ("long-shot", index),
                    AttachmentKind::Image,
                    format!("shot-{index}.png"),
                )
                .src(self.picture.clone())
                .size(1600., 900.)
                .on_open(|_, _| {}),
            );
        }
        div()
            .when(day, |item| {
                item.child(ListSeparator::day(
                    ("long-day", index),
                    format!("Day {}", index / 200 + 1),
                ))
            })
            .child(row)
            .into_any_element()
    }
}

impl Render for LongHistory {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        let rows = list(self.list.clone(), move |index, _, cx| {
            entity.read(cx).row(index)
        })
        .flex_1()
        .size_full();
        let keys = cx.entity();
        let list_region = div()
            .id("long-list")
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .on_key_down(move |event, window, cx| {
                let step: isize = match event.keystroke.key.as_str() {
                    "up" => -1,
                    "down" => 1,
                    _ => return,
                };
                keys.update(cx, |story, cx| {
                    let next =
                        (story.focused as isize + step).clamp(0, COUNT as isize - 1) as usize;
                    story.focused = next;
                    story.list.scroll_to_reveal_item(next);
                    window.focus(&story.handles[next], cx);
                    cx.notify();
                });
            })
            .child(rows);
        div()
            .size_full()
            .bg(cx.sem().role.ground)
            .p(px(LAYOUT_GUTTER))
            .child(frame(
                700.,
                ChatPane::new("long-pane")
                    .header(header("back", "Back", "# lobby"))
                    .list(list_region)
                    .composer(composer_stand_in("Message #lobby", cx)),
            ))
    }
}

pub fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $palette:expr, $body:expr) => {
            Story::new($name, |_, _, cx| view($palette, $body as Body, cx))
        };
    }
    use Palette::{Dark, Light, Tinted};
    vec![
        story!("kit-message-row-states", Dark, states_body),
        story!("kit-message-row-states-light", Light, states_body),
        story!("kit-message-row-states-tinted", Tinted, states_body),
        story!("kit-message-row-long-content", Dark, long_body),
        story!("kit-message-row-long-content-light", Light, long_body),
        Story::new("kit-message-row-actions", |_, window, cx| {
            toolbar_story(Dark, 2, false, window, cx)
        }),
        Story::new("kit-message-row-actions-light", |_, window, cx| {
            toolbar_story(Light, 2, false, window, cx)
        }),
        Story::new("kit-message-row-toolbar-tab-order", |_, window, cx| {
            toolbar_story(Dark, 3, true, window, cx)
        }),
        story!("kit-chat-pane-conversation", Dark, conversation_body),
        story!("kit-chat-pane-conversation-light", Light, conversation_body),
        story!(
            "kit-chat-pane-conversation-tinted",
            Tinted,
            conversation_body
        ),
        story!("kit-chat-pane-covered", Dark, covered_body),
        story!("kit-chat-pane-covered-light", Light, covered_body),
        Story::new("kit-chat-pane-long-history", |_, _, cx| {
            theme::apply(Palette::Dark.input(), cx);
            cx.new(LongHistory::new).into()
        }),
    ]
}
