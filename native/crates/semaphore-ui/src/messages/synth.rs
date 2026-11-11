//! Deterministic rows for T2 and T3, ported from `rigs/list/src/data.rs`: the same random mix of
//! short and long text, code blocks, images and animated emoji, as real `MessageRow`s. `truth()`
//! regenerates a row's source text from its seed without going through the display string, so copy
//! tests compare against something the copy path never touched.

use super::media::{MediaRef, MediaSource};
use gpui_kit::*;
use image::{Delay, Frame, RgbaImage};
use semaphore_core::model::{
    AttachmentKind, AttachmentView, MessageRow, ReactionView, SegKind, SendState, TextSeg,
    TextStyle, UserView,
};
use semaphore_core::text::EMOJI_PLACEHOLDER;
use std::path::PathBuf;
use std::sync::Arc;

pub const EMOJI_COUNT: u16 = 24;
pub const ANIMATED_FROM: u16 = 16;
pub const IMAGE_FILES: u32 = 300;
/// One message a minute, from here.
const START_MS: i64 = 1_700_000_000_000;

const WORDS: &[&str] = &[
    "the",
    "voice",
    "channel",
    "ping",
    "patch",
    "merge",
    "deploy",
    "server",
    "again",
    "works",
    "broken",
    "latency",
    "great",
    "thanks",
    "tomorrow",
    "because",
    "probably",
    "screen",
    "share",
    "audio",
    "client",
    "release",
    "ticket",
    "question",
    "answer",
    "maybe",
    "never",
    "always",
    "rust",
    "window",
    "render",
    "frame",
    "buffer",
    "socket",
    "reconnect",
    "token",
    "invite",
    "role",
    "permission",
    "community",
    "message",
    "thread",
    "reaction",
    "upload",
    "image",
    "avatar",
    "banner",
    "presence",
    "typing",
    "scroll",
    "selection",
    "copy",
    "paste",
    "wrap",
    "virtual",
    "Überprüfung",
    "naïve",
    "кириллица",
    "ελληνικά",
    "résumé",
    "and",
    "of",
    "to",
    "in",
    "is",
    "it",
    "that",
    "for",
];
const EMOJI_NAMES: &[&str] = &[
    "grin",
    "party",
    "thumbsup",
    "fire",
    "wave",
    "tada",
    "eyes",
    "think",
    "skull",
    "heart",
    "clap",
    "rocket",
    "sob",
    "shrug",
    "bug",
    "ship",
    "cat_vibe",
    "dance",
    "spin",
    "loading",
    "blob_wave",
    "nyan",
    "pulse",
    "sparkle",
];
const CODE_LINES: &[&str] = &[
    "fn handle(event: &Event, state: &mut State) -> Result<()> {",
    "    let channel = state.channels.get(&event.channel_id)?;",
    "    if channel.is_private() && !channel.has_member(event.user) {",
    "        return Err(Error::Forbidden);",
    "    }",
    "    for message in channel.messages.iter().rev().take(50) {",
    "        println!(\"{}: {}\", message.author, message.body);",
    "    }",
    "    Ok(())",
    "}",
    "const LIVEKIT_URL = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';",
    "SELECT id, body FROM messages WHERE channel_id = $1 ORDER BY id DESC LIMIT 50;",
];

struct Rng(u64);

impl Rng {
    fn new(seed: i64) -> Self {
        Rng((seed as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03)
    }
    fn next(&mut self) -> u64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// A body as authored: the generator's output before any display mapping.
enum Inline {
    Text(String),
    Bold(String),
    Link { text: String, url: String },
    Emoji(u16),
    Code(String),
}

struct Spec {
    inlines: Vec<Inline>,
    image: Option<u32>,
}

fn words(rng: &mut Rng, count: u64) -> String {
    let mut out = String::new();
    for i in 0..count {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(WORDS[rng.below(WORDS.len() as u64) as usize]);
    }
    out
}

fn rich(rng: &mut Rng, word_count: u64, animated: bool) -> Vec<Inline> {
    let mut inlines = Vec::new();
    let mut left = word_count;
    while left > 0 {
        let run = (3 + rng.below(12)).min(left);
        left -= run;
        inlines.push(Inline::Text(format!("{} ", words(rng, run))));
        match rng.below(10) {
            0 => inlines.push(Inline::Bold(format!("{} ", words(rng, 2)))),
            1 => {
                let n = rng.below(10_000);
                inlines.push(Inline::Link {
                    text: format!("issue {n}"),
                    url: format!("https://example.com/issues/{n}"),
                });
                inlines.push(Inline::Text(" ".into()));
            }
            2 => {
                inlines.push(Inline::Emoji(rng.below(ANIMATED_FROM as u64) as u16));
                inlines.push(Inline::Text(" ".into()));
            }
            _ => {}
        }
        if animated {
            let emoji = ANIMATED_FROM + rng.below((EMOJI_COUNT - ANIMATED_FROM) as u64) as u16;
            inlines.push(Inline::Emoji(emoji));
            inlines.push(Inline::Text(" ".into()));
        }
    }
    inlines
}

fn spec(seq: i64) -> Spec {
    let mut rng = Rng::new(seq);
    let roll = rng.below(100);
    match roll {
        // 55% short, one or two lines.
        0..55 => {
            let n = 2 + rng.below(25);
            Spec {
                inlines: rich(&mut rng, n, false),
                image: None,
            }
        }
        // 20% long, wrapping many lines at any width we run.
        55..75 => {
            let n = 80 + rng.below(320);
            Spec {
                inlines: rich(&mut rng, n, false),
                image: None,
            }
        }
        // 10% code blocks.
        75..85 => {
            let lines = 3 + rng.below(22);
            let mut body = String::new();
            for i in 0..lines {
                if i > 0 {
                    body.push('\n');
                }
                body.push_str(CODE_LINES[rng.below(CODE_LINES.len() as u64) as usize]);
            }
            Spec {
                inlines: vec![Inline::Code(body)],
                image: None,
            }
        }
        // 10% images of varied aspect, half with a caption.
        85..95 => {
            let file = rng.below(IMAGE_FILES as u64) as u32;
            let inlines = if rng.below(2) == 0 {
                rich(&mut rng, 4 + 8, false)
            } else {
                Vec::new()
            };
            Spec {
                inlines,
                image: Some(file),
            }
        }
        // 5% animated emoji.
        _ => {
            let n = 4 + rng.below(16);
            Spec {
                inlines: rich(&mut rng, n, true),
                image: None,
            }
        }
    }
}

/// Real pixel size of an image file. Aspect runs from tall (1:2) to panoramic (3:1).
pub fn image_size(file: u32) -> (u32, u32) {
    const ASPECTS: &[(u32, u32)] = &[(1, 2), (3, 4), (1, 1), (4, 3), (16, 9), (21, 9), (3, 1)];
    let (a, b) = ASPECTS[file as usize % ASPECTS.len()];
    let width = 480 + (file % 5) * 200;
    (width, (width * b / a).min(1400))
}

pub fn emoji_name(emoji: u16) -> &'static str {
    EMOJI_NAMES[emoji as usize]
}

fn emoji_id(emoji: u16) -> String {
    format!("emoji-{emoji}")
}

fn author(seq: i64) -> UserView {
    // Runs of three, so grouping is exercised.
    let index = Rng::new(seq.div_euclid(3) ^ 0x55AA).below(40);
    UserView {
        id: format!("0190a0d4-0000-7000-8000-{index:012x}"),
        username: format!("user{index}"),
        display_name: None,
        avatar_file_id: None,
    }
}

/// One row. Real ids are UUIDs, so these are too, and nothing may depend on their order.
pub fn row(seq: i64) -> MessageRow {
    let spec = spec(seq);
    let mut display = String::new();
    let mut segs = Vec::with_capacity(spec.inlines.len());
    for inline in spec.inlines {
        let (kind, style) = match inline {
            Inline::Text(text) => {
                display.push_str(&text);
                (SegKind::Text, TextStyle::default())
            }
            Inline::Bold(text) => {
                display.push_str(&text);
                (
                    SegKind::Text,
                    TextStyle {
                        bold: true,
                        ..TextStyle::default()
                    },
                )
            }
            Inline::Link { text, url } => {
                display.push_str(&text);
                (SegKind::Link { url }, TextStyle::default())
            }
            Inline::Emoji(emoji) => {
                display.push(EMOJI_PLACEHOLDER);
                (
                    SegKind::Emoji {
                        emoji_id: emoji_id(emoji),
                        name: emoji_name(emoji).to_owned(),
                    },
                    TextStyle::default(),
                )
            }
            Inline::Code(text) => {
                display.push_str(&text);
                (SegKind::CodeBlock, TextStyle::default())
            }
        };
        segs.push(TextSeg {
            end: display.len() as u32,
            kind,
            style,
        });
    }
    display.shrink_to_fit();
    segs.shrink_to_fit();

    let attachments = spec.image.map_or_else(Vec::new, |file| {
        let (width, height) = image_size(file);
        vec![AttachmentView {
            file_id: file.to_string(),
            filename: format!("img-{file:04}.png"),
            mime_type: "image/png".into(),
            size_bytes: u64::from(width * height) * 4,
            kind: AttachmentKind::Image,
            has_thumbnail: false,
            width: Some(width),
            height: Some(height),
        }]
    });
    // A separate stream, so the text and the mix match the rig's.
    let mut reactions_rng = Rng::new(seq ^ 0x7777);
    let reactions = if reactions_rng.below(10) == 0 {
        vec![ReactionView {
            emoji: "\u{1F44D}".into(),
            count: 1 + reactions_rng.below(9) as u32,
            me: reactions_rng.below(4) == 0,
            ..ReactionView::default()
        }]
    } else {
        Vec::new()
    };
    MessageRow {
        seq,
        id: Some(format!(
            "0190a0d4-{:04x}-7000-8000-{:012x}",
            seq.rem_euclid(0xffff),
            Rng::new(seq).next() & 0xffff_ffff_ffff
        )),
        client_nonce: None,
        author: author(seq),
        sent_at_ms: START_MS + seq * 60_000,
        edited: false,
        removed: false,
        display,
        segs,
        attachments,
        reactions,
        reply_count: 0,
        send_state: SendState::Sent,
        revision: 0,
        ..MessageRow::default()
    }
}

pub fn rows(first: i64, count: usize) -> Vec<MessageRow> {
    (first..first + count as i64).map(row).collect()
}

/// What copying the whole of row `seq` must return, from the generator alone.
pub fn truth(seq: i64) -> String {
    let mut out = String::new();
    for inline in spec(seq).inlines {
        match inline {
            Inline::Text(text) | Inline::Bold(text) | Inline::Code(text) => out.push_str(&text),
            Inline::Link { text, .. } => out.push_str(&text),
            Inline::Emoji(emoji) => {
                out.push(':');
                out.push_str(emoji_name(emoji));
                out.push(':');
            }
        }
    }
    out
}

fn emoji_frame(emoji: u16, frame: u32, frames: u32) -> Frame {
    const SIZE: u32 = 32;
    let hue = emoji as f32 / EMOJI_COUNT as f32;
    let phase = frame as f32 / frames as f32 * std::f32::consts::TAU;
    let radius = 13.0 + 2.5 * phase.sin();
    let buffer = RgbaImage::from_fn(SIZE, SIZE, |x, y| {
        let dx = x as f32 - 15.5;
        let dy = y as f32 - 15.5 + 2.0 * phase.cos();
        if dx * dx + dy * dy <= radius * radius {
            // GPUI's RenderImage frames are BGRA.
            image::Rgba([
                (255.0 * (1.0 - hue)) as u8,
                (127.0 + 127.0 * phase.cos()) as u8,
                (255.0 * hue) as u8,
                255,
            ])
        } else {
            image::Rgba([0, 0, 0, 0])
        }
    });
    Frame::from_parts(buffer, 0, 0, Delay::from_numer_denom_ms(80, 1))
}

/// Emoji built once and held, as the real client's set would be. Those from `ANIMATED_FROM` on have
/// eight frames at 80 ms, so 12.5 fps.
pub fn build_emoji() -> Vec<Arc<RenderImage>> {
    (0..EMOJI_COUNT)
        .map(|emoji| {
            let frames = if emoji >= ANIMATED_FROM { 8 } else { 1 };
            let frames: Vec<Frame> = (0..frames)
                .map(|frame| emoji_frame(emoji, frame, frames))
                .collect();
            Arc::new(RenderImage::new(frames))
        })
        .collect()
}

/// Emoji from `build_emoji`, attachments as image files from a directory (the rig's generated
/// PNGs), or no attachments at all.
pub struct SynthMedia {
    pub emoji: Vec<Arc<RenderImage>>,
    pub image_dir: Option<PathBuf>,
}

impl SynthMedia {
    pub fn new(image_dir: Option<PathBuf>) -> Self {
        Self {
            emoji: build_emoji(),
            image_dir,
        }
    }
}

impl MediaSource for SynthMedia {
    fn attachment(&self, attachment: &AttachmentView) -> MediaRef {
        match &self.image_dir {
            Some(dir) => MediaRef::Resource(Resource::Path(dir.join(&attachment.filename).into())),
            None => MediaRef::Missing,
        }
    }

    fn emoji(&self, emoji_id: &str) -> MediaRef {
        emoji_id
            .strip_prefix("emoji-")
            .and_then(|index| index.parse::<usize>().ok())
            .and_then(|index| self.emoji.get(index))
            .map_or(MediaRef::Missing, |image| MediaRef::Ready(image.clone()))
    }

    fn avatar(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::text::{copy_range, plain_text};
    // `gpui_kit::*` exports the `test` attribute, and the macro's own `#[test]` would resolve to it.
    use std::prelude::v1::test;

    #[test]
    fn copying_a_whole_row_matches_the_generator() {
        for seq in -2_000..3_000 {
            let row = row(seq);
            assert_eq!(
                copy_range(&row, 0..row.display.len() as u32),
                truth(seq),
                "seq {seq}"
            );
        }
    }

    #[test]
    fn the_mix_contains_every_kind() {
        let (mut code, mut image, mut animated, mut long) = (0, 0, 0, 0);
        for seq in 0..10_000 {
            let row = row(seq);
            code += row.segs.iter().any(|s| s.kind == SegKind::CodeBlock) as i32;
            image += !row.attachments.is_empty() as i32;
            long += (row.display.len() > 600) as i32;
            animated += row.segs.iter().any(|s| {
                matches!(&s.kind, SegKind::Emoji { name, .. }
                    if EMOJI_NAMES[ANIMATED_FROM as usize..].contains(&name.as_str()))
            }) as i32;
            assert_eq!(plain_text(&row).is_empty(), row.display.is_empty());
        }
        assert!(
            code > 800 && image > 800 && animated > 300 && long > 1500,
            "{code} {image} {animated} {long}"
        );
    }
}
