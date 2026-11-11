//! A small hand-written conversation, until U3's scenarios cover what's here. The list takes
//! `ScenarioViews` plus its media, so swapping this for an exported scenario changes one call:
//! `stories.rs` already prefers one when it loads. Failed sends and half-loaded images can't come
//! from the web's fixtures at all, so those stay here.

use super::media::{MediaRef, MediaSource};
use super::row::ReplyPreview;
use gpui_kit::*;
use image::{Delay, Frame, RgbaImage};
use semaphore_core::model::{
    AttachmentKind, AttachmentView, Conversation, ErrorView, MessageRow, ReactionView, SegKind,
    SendState, TextSeg, TextStyle, UserView,
};
use semaphore_core::scenario::ScenarioViews;
use semaphore_core::text::EMOJI_PLACEHOLDER;
use std::collections::HashMap;
use std::sync::Arc;

/// The clock stories run at: 2026-11-05 16:12:00 UTC.
pub const NOW_MS: i64 = 1_793_895_120_000;
const MINUTE: i64 = 60_000;
const DAY: i64 = 24 * 60 * MINUTE;

pub fn user(id: &str, username: &str, display_name: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display_name.map(str::to_owned),
        avatar_file_id: None,
    }
}

pub fn me() -> UserView {
    user("u-mike", "mike", Some("Mike"))
}

fn ava() -> UserView {
    user("u-ava", "ava", Some("Ava Chen"))
}

fn ben() -> UserView {
    user("u-ben", "ben", None)
}

fn cleo() -> UserView {
    user("u-cleo", "cleo", Some("Cleo"))
}

/// Builds a display string and its segments together, which is what `layout_spans` will do.
#[derive(Default)]
pub struct Body {
    display: String,
    segs: Vec<TextSeg>,
}

impl Body {
    pub fn seg(mut self, text: &str, kind: SegKind, style: TextStyle) -> Self {
        self.display.push_str(text);
        self.segs.push(TextSeg {
            end: self.display.len() as u32,
            kind,
            style,
        });
        self
    }
    pub fn text(self, text: &str) -> Self {
        self.seg(text, SegKind::Text, TextStyle::default())
    }
    pub fn styled(self, text: &str, style: TextStyle) -> Self {
        self.seg(text, SegKind::Text, style)
    }
    pub fn link(self, text: &str, url: &str) -> Self {
        self.seg(
            text,
            SegKind::Link { url: url.into() },
            TextStyle::default(),
        )
    }
    pub fn mention(self, name: &str, user_id: &str) -> Self {
        self.seg(
            name,
            SegKind::UserMention {
                user_id: user_id.into(),
            },
            TextStyle::default(),
        )
    }
    pub fn emoji(self, emoji_id: &str, name: &str) -> Self {
        self.seg(
            &EMOJI_PLACEHOLDER.to_string(),
            SegKind::Emoji {
                emoji_id: emoji_id.into(),
                name: name.into(),
            },
            TextStyle::default(),
        )
    }
    pub fn code_block(self, text: &str) -> Self {
        self.seg(text, SegKind::CodeBlock, TextStyle::default())
    }
}

pub fn message(seq: i64, author: UserView, sent_at_ms: i64, body: Body) -> MessageRow {
    MessageRow {
        seq,
        id: Some(format!("0190a0d4-{seq:04x}-7000-8000-00000000abcd")),
        author,
        sent_at_ms,
        display: body.display,
        segs: body.segs,
        send_state: SendState::Sent,
        ..MessageRow::default()
    }
}

fn image_attachment(file_id: &str, filename: &str, size: Option<(u32, u32)>) -> AttachmentView {
    AttachmentView {
        file_id: file_id.into(),
        filename: filename.into(),
        mime_type: "image/png".into(),
        size_bytes: 482_133,
        kind: AttachmentKind::Image,
        has_thumbnail: false,
        width: size.map(|(width, _)| width),
        height: size.map(|(_, height)| height),
    }
}

fn file_attachment(filename: &str, mime: &str, size: u64, kind: AttachmentKind) -> AttachmentView {
    AttachmentView {
        file_id: format!("file-{filename}"),
        filename: filename.into(),
        mime_type: mime.into(),
        size_bytes: size,
        kind,
        has_thumbnail: false,
        width: None,
        height: None,
    }
}

fn reaction(emoji: &str, count: u32, me: bool) -> ReactionView {
    ReactionView {
        emoji: emoji.into(),
        count,
        me,
        ..ReactionView::default()
    }
}

const BOLD: TextStyle = TextStyle {
    bold: true,
    italic: false,
    strikethrough: false,
    code: false,
};
const ITALIC: TextStyle = TextStyle {
    bold: false,
    italic: true,
    strikethrough: false,
    code: false,
};
const STRIKE: TextStyle = TextStyle {
    bold: false,
    italic: false,
    strikethrough: true,
    code: false,
};
const CODE: TextStyle = TextStyle {
    bold: false,
    italic: false,
    strikethrough: false,
    code: true,
};

/// A conversation with each kind of row in it, ending now.
pub fn conversation() -> (Vec<MessageRow>, HashMap<i64, ReplyPreview>) {
    let mut seq = 0;
    let mut next = || {
        seq += 1;
        seq
    };
    let yesterday = NOW_MS - DAY;
    let mut rows = Vec::new();
    rows.push(message(
        next(),
        ava(),
        yesterday - 120 * MINUTE,
        Body::default()
            .text("Deploy notes are up: ")
            .link("release checklist", "https://example.com/release")
            .text(". Shout if I missed anything."),
    ));
    let mut row = message(
        next(),
        ben(),
        yesterday - 110 * MINUTE,
        Body::default().text("Looks good to me."),
    );
    row.reactions = vec![
        reaction("\u{1F44D}", 3, true),
        reaction("custom:party", 2, false),
    ];
    row.reply_count = 4;
    rows.push(row);

    rows.push(message(
        next(),
        cleo(),
        NOW_MS - 58 * MINUTE,
        Body::default()
            .text("Morning. The voice bug is back, ")
            .mention("@Mike", "u-mike")
            .text(" can you look? Logs in ")
            .seg(
                "#ops",
                SegKind::ChannelMention {
                    channel_id: "c-ops".into(),
                },
                TextStyle::default(),
            )
            .text("."),
    ));
    rows.push(message(
        next(),
        me(),
        NOW_MS - 50 * MINUTE,
        Body::default()
            .text("On it. ")
            .styled("Bold", BOLD)
            .text(", ")
            .styled("italic", ITALIC)
            .text(", ")
            .styled("gone", STRIKE)
            .text(" and ")
            .styled("run_list()", CODE)
            .text(" all render inline."),
    ));
    let grouped_second = next();
    let mut row = message(
        grouped_second,
        me(),
        NOW_MS - 49 * MINUTE,
        Body::default().text("Grouped under the same header, and edited."),
    );
    row.edited = true;
    rows.push(row);
    rows.push(message(
        next(),
        me(),
        NOW_MS - 48 * MINUTE,
        Body::default()
            .text("The trace, with ")
            .emoji("wave", "wave")
            .text(" still and ")
            .emoji("spin", "spin")
            .text(" animated emoji:")
            .code_block(
                "fn reconnect(state: &mut State) -> Result<()> {\n    state.room.leave()?;\n\n    state.room.join(&state.token)\n}",
            )
            .text("Fails on the second join."),
    ));
    let reply_seq = next();
    rows.push(message(
        reply_seq,
        ava(),
        NOW_MS - 40 * MINUTE,
        Body::default().text("That's the token expiring. Screenshot attached."),
    ));
    let mut row = message(
        next(),
        ben(),
        NOW_MS - 30 * MINUTE,
        Body::default().text("Here's what I see:"),
    );
    row.attachments = vec![image_attachment(
        "img-wide",
        "dashboard.png",
        Some((1280, 720)),
    )];
    rows.push(row);
    let mut row = message(next(), ben(), NOW_MS - 29 * MINUTE, Body::default());
    row.attachments = vec![
        image_attachment("img-tall", "phone.png", Some((600, 900))),
        image_attachment("img-square", "icon.png", Some((400, 400))),
    ];
    rows.push(row);
    let mut row = message(
        next(),
        cleo(),
        NOW_MS - 20 * MINUTE,
        Body::default().text("Logs and a recording:"),
    );
    row.attachments = vec![
        file_attachment(
            "voice-server.log",
            "text/plain",
            18_432,
            AttachmentKind::Document,
        ),
        file_attachment("call.ogg", "audio/ogg", 3_482_112, AttachmentKind::Audio),
    ];
    rows.push(row);
    let mut row = message(next(), cleo(), NOW_MS - 19 * MINUTE, Body::default());
    row.attachments = vec![file_attachment(
        "repro.mp4",
        "video/mp4",
        48_113_664,
        AttachmentKind::Video,
    )];
    rows.push(row);
    let mut row = message(
        next(),
        ava(),
        NOW_MS - 10 * MINUTE,
        Body::default()
            .seg(
                "@here",
                SegKind::SpecialMention {
                    kind: "here".into(),
                },
                TextStyle::default(),
            )
            .text(" fix is rolling out, thanks ")
            .seg(
                "@oncall",
                SegKind::AliasMention {
                    alias_id: "a-oncall".into(),
                },
                TextStyle::default(),
            )
            .text("."),
    );
    row.reactions = vec![reaction("\u{1F389}", 5, false)];
    rows.push(row);

    let mut replies = HashMap::new();
    replies.insert(
        reply_seq,
        ReplyPreview {
            author: "Mike".into(),
            text: "The trace, with :wave: still and :spin: animated emoji".into(),
            deleted: false,
        },
    );
    (rows, replies)
}

/// `conversation()` as the views a real scenario gives.
pub fn scenario() -> (ScenarioViews, HashMap<i64, ReplyPreview>) {
    let (rows, replies) = conversation();
    let views = ScenarioViews {
        me: me(),
        messages: vec![(
            Conversation::Channel {
                id: "general".into(),
            },
            rows,
        )],
        ..ScenarioViews::default()
    };
    (views, replies)
}

/// Content that doesn't fit: a long paragraph, an unbroken URL, a wide code block, a very long name.
pub fn long_content() -> Vec<MessageRow> {
    let long_name = user(
        "u-long",
        "x",
        Some(
            "Bartholomew Maximilian Featherstonehaugh-Cholmondeley the Third of Somewhere Far Away",
        ),
    );
    let paragraph = "Long messages wrap at the column cap the web client uses, and keep wrapping \
        when the window narrows. The rows below them don't move while an image loads, because a known \
        size reserves its box up front. Selecting across all of this still gives back exact bytes, \
        since endpoints are a seq and an offset into the display string rather than anything to do \
        with what happens to be mounted right now. Wrapping changes nothing about that. ";
    vec![
        message(
            1,
            ava(),
            NOW_MS - 30 * MINUTE,
            Body::default().text(&paragraph.repeat(3)),
        ),
        message(
            2,
            long_name,
            NOW_MS - 20 * MINUTE,
            Body::default().text("Long name, then a long URL: ").link(
                "https://example.com/a/very/long/path/that/keeps/going/and/going/with/no/spaces/to/break/on/at/all/because/urls/do/that/index.html?query=string&and=more",
                "https://example.com/a/very/long/path",
            ),
        ),
        message(
            3,
            ben(),
            NOW_MS - 10 * MINUTE,
            Body::default().code_block(
                "fn a_line_that_is_much_longer_than_the_column(state: &mut State, event: &Event, options: Options, more: More, and_more: AndMore) -> Result<Box<dyn std::error::Error + Send + Sync + 'static>> {\n    todo!()\n}",
            ),
        ),
        message(
            4,
            ben(),
            NOW_MS - 9 * MINUTE,
            Body::default().text("supercalifragilisticexpialidocious".repeat(8).as_str()),
        ),
    ]
}

/// Rows removed by their author or a moderator, in and between ordinary ones.
pub fn removed() -> (Vec<MessageRow>, HashMap<i64, ReplyPreview>) {
    let mut gone = message(2, ben(), NOW_MS - 20 * MINUTE, Body::default());
    gone.removed = true;
    let mut gone_grouped = message(3, ben(), NOW_MS - 19 * MINUTE, Body::default());
    gone_grouped.removed = true;
    let mut replies = HashMap::new();
    replies.insert(
        4,
        ReplyPreview {
            author: String::new(),
            text: String::new(),
            deleted: true,
        },
    );
    (
        vec![
            message(
                1,
                ava(),
                NOW_MS - 30 * MINUTE,
                Body::default().text("The row below this was removed."),
            ),
            gone,
            gone_grouped,
            message(
                4,
                cleo(),
                NOW_MS - 10 * MINUTE,
                Body::default().text("This one replies to a message that's gone."),
            ),
        ],
        replies,
    )
}

fn error(retryable: bool, message: &str) -> SendState {
    SendState::Failed {
        error: ErrorView {
            code: "SEND_FAILED".into(),
            message: message.into(),
            retryable,
            retry_after_ms: None,
        },
    }
}

/// For the message-action stories: someone else's message (seq 1), one pinned (2), mine (3, with
/// reactions), one mid-edit (4), and a moderator's view of a removed message with its reason (5).
pub fn actions() -> Vec<MessageRow> {
    let mut theirs = message(
        1,
        ava(),
        NOW_MS - 40 * MINUTE,
        Body::default().text("Has anyone tried the new build on Windows yet?"),
    );
    theirs.reactions = vec![
        reaction("\u{1F44D}", 3, false),
        reaction("\u{1F440}", 1, true),
    ];
    theirs.reactions[0].user_ids = vec!["u-ben".into(), "u-cleo".into(), "u-me".into()];
    let mut pinned = message(
        2,
        ben(),
        NOW_MS - 30 * MINUTE,
        Body::default().text("Release checklist lives in the wiki, please read it before tagging."),
    );
    pinned.pinned = true;
    pinned.pinned_by = Some(cleo());
    let mut mine = message(
        3,
        me(),
        NOW_MS - 20 * MINUTE,
        Body::default().text("Yes, installer works, auto-update too."),
    );
    mine.mine = true;
    let mut editing = message(
        4,
        me(),
        NOW_MS - 19 * MINUTE,
        Body::default().text("One more thing: the tray icon is blurry at 150%."),
    );
    editing.mine = true;
    editing.edited = true;
    editing.edit_pending = true;
    let mut removed = message(
        5,
        cleo(),
        NOW_MS - 10 * MINUTE,
        Body::default().text("buy cheap followers at example.com"),
    );
    removed.removed = true;
    removed.removed_by = Some(ava());
    removed.removed_reason = Some("Spam".into());
    let later = message(
        6,
        ava(),
        NOW_MS - 5 * MINUTE,
        Body::default().text("Thanks, merging the fix now."),
    );
    vec![theirs, pinned, mine, editing, removed, later]
}

/// Sends in flight and failed, with and without a retry.
pub fn send_states() -> Vec<MessageRow> {
    let mut pending = message(
        2,
        me(),
        NOW_MS - 4 * MINUTE,
        Body::default().text("Still on its way to the server."),
    );
    pending.id = None;
    pending.client_nonce = Some("n-pending".into());
    pending.send_state = SendState::Pending;

    let mut pending_grouped = message(
        3,
        me(),
        NOW_MS - 3 * MINUTE,
        Body::default().text("A second one, grouped, so its clock sits after the text."),
    );
    pending_grouped.id = None;
    pending_grouped.client_nonce = Some("n-grouped".into());
    pending_grouped.send_state = SendState::Pending;

    let mut failed = message(
        4,
        me(),
        NOW_MS - 2 * MINUTE,
        Body::default().text("This didn't go through, and can be tried again."),
    );
    failed.id = None;
    failed.client_nonce = Some("n-failed".into());
    failed.send_state = error(true, "Network error");

    let mut rejected = message(
        5,
        me(),
        NOW_MS - MINUTE,
        Body::default().text("The server refused this one for good."),
    );
    rejected.id = None;
    rejected.client_nonce = Some("n-rejected".into());
    rejected.send_state = error(false, "You don't have permission to post here.");

    vec![
        message(
            1,
            ava(),
            NOW_MS - 10 * MINUTE,
            Body::default().text("Try sending something."),
        ),
        pending,
        pending_grouped,
        failed,
        rejected,
    ]
}

/// A gradient the size of a real image, so a story shows the box it would fill.
fn gradient(width: u32, height: u32, tint: [u8; 3]) -> Arc<RenderImage> {
    let buffer = RgbaImage::from_fn(width, height, |x, y| {
        let (fx, fy) = (x as f32 / width as f32, y as f32 / height as f32);
        // GPUI's RenderImage frames are BGRA.
        image::Rgba([
            (tint[2] as f32 * (0.35 + 0.65 * fx)) as u8,
            (tint[1] as f32 * (0.35 + 0.65 * fy)) as u8,
            (tint[0] as f32 * (1.0 - 0.5 * fx)) as u8,
            255,
        ])
    });
    Arc::new(RenderImage::new(vec![Frame::from_parts(
        buffer,
        0,
        0,
        Delay::from_numer_denom_ms(0, 1),
    )]))
}

fn disc(frames: u32, tint: [u8; 3]) -> Arc<RenderImage> {
    const SIZE: u32 = 32;
    let frames: Vec<Frame> = (0..frames)
        .map(|frame| {
            let shift = frame as f32 * 3.;
            let buffer = RgbaImage::from_fn(SIZE, SIZE, |x, y| {
                let (dx, dy) = (x as f32 - 15.5, y as f32 - 15.5);
                if dx * dx + dy * dy <= 15. * 15. {
                    let wave = ((x as f32 + shift).sin() * 40.) as i16;
                    image::Rgba([
                        (tint[2] as i16 + wave).clamp(0, 255) as u8,
                        tint[1],
                        tint[0],
                        255,
                    ])
                } else {
                    image::Rgba([0, 0, 0, 0])
                }
            });
            Frame::from_parts(buffer, 0, 0, Delay::from_numer_denom_ms(80, 1))
        })
        .collect();
    Arc::new(RenderImage::new(frames))
}

/// Images and emoji for the fixture, in memory, so a story needs no files and draws on its first
/// frame. Ids it doesn't know are `Missing`, which is how a story shows a failed load.
pub struct FixtureMedia {
    images: HashMap<String, Arc<RenderImage>>,
    emoji: HashMap<String, Arc<RenderImage>>,
}

impl FixtureMedia {
    pub fn new() -> Self {
        let mut images = HashMap::new();
        images.insert("img-wide".to_owned(), gradient(640, 360, [20, 184, 166]));
        images.insert("img-tall".to_owned(), gradient(300, 450, [99, 102, 241]));
        images.insert("img-square".to_owned(), gradient(200, 200, [244, 63, 94]));
        let mut emoji = HashMap::new();
        emoji.insert("wave".to_owned(), disc(1, [245, 158, 11]));
        emoji.insert("spin".to_owned(), disc(8, [34, 197, 94]));
        emoji.insert("party".to_owned(), disc(1, [244, 63, 94]));
        Self { images, emoji }
    }
}

impl Default for FixtureMedia {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaSource for FixtureMedia {
    fn attachment(&self, attachment: &AttachmentView) -> MediaRef {
        self.images
            .get(&attachment.file_id)
            .map_or(MediaRef::Missing, |image| MediaRef::Ready(image.clone()))
    }
    fn emoji(&self, emoji_id: &str) -> MediaRef {
        self.emoji
            .get(emoji_id)
            .map_or(MediaRef::Missing, |image| MediaRef::Ready(image.clone()))
    }
    fn avatar(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
}
