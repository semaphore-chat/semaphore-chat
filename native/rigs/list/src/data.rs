//! Deterministic message store. `truth()` regenerates a message's source text from its seed
//! without going through the display string, so copy tests compare against something the copy
//! path never touched.

use gpui_kit::SharedString;
use std::collections::VecDeque;
use std::ops::Range;

/// One piece of a message body, in display-string bytes.
#[derive(Clone, Debug, PartialEq)]
pub enum Seg {
    Text {
        end: u32,
    },
    Bold {
        end: u32,
    },
    Link {
        end: u32,
        url: Box<str>,
    },
    /// A placeholder in the display string, painted over with the emoji image.
    Emoji {
        end: u32,
        emoji: u16,
        name: Box<str>,
    },
}

impl Seg {
    pub fn end(&self) -> u32 {
        match self {
            Seg::Text { end }
            | Seg::Bold { end }
            | Seg::Link { end, .. }
            | Seg::Emoji { end, .. } => *end,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Text,
    Code,
    /// The file is one of `IMAGE_FILES`; width and height are its real pixels, known up front.
    Image {
        file: u32,
        w: u16,
        h: u16,
    },
}

#[derive(Clone, Debug)]
pub struct Message {
    pub id: i64,
    pub author: u16,
    pub minute: u32,
    pub kind: Kind,
    /// What is laid out. May be empty for a bare image.
    pub display: SharedString,
    pub segs: Vec<Seg>,
}

/// The stand-in for an emoji in the display string: one em wide, no glyph.
pub const EMOJI_PLACEHOLDER: char = '\u{2003}';
pub const EMOJI_COUNT: u16 = 24;
pub const ANIMATED_FROM: u16 = 16;
pub const IMAGE_FILES: u32 = 300;

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
}

struct Spec {
    kind: Kind,
    inlines: Vec<Inline>,
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
                let e = rng.below(ANIMATED_FROM as u64) as u16;
                inlines.push(Inline::Emoji(e));
                inlines.push(Inline::Text(" ".into()));
            }
            _ => {}
        }
        if animated {
            let e = ANIMATED_FROM + rng.below((EMOJI_COUNT - ANIMATED_FROM) as u64) as u16;
            inlines.push(Inline::Emoji(e));
            inlines.push(Inline::Text(" ".into()));
        }
    }
    inlines
}

fn spec(id: i64) -> Spec {
    let mut rng = Rng::new(id);
    let roll = rng.below(100);
    match roll {
        // 55% short, one or two lines.
        0..55 => {
            let n = 2 + rng.below(25);
            Spec {
                kind: Kind::Text,
                inlines: rich(&mut rng, n, false),
            }
        }
        // 20% long, wrapping many lines at any width we run.
        55..75 => {
            let n = 80 + rng.below(320);
            Spec {
                kind: Kind::Text,
                inlines: rich(&mut rng, n, false),
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
                kind: Kind::Code,
                inlines: vec![Inline::Text(body)],
            }
        }
        // 10% images of varied aspect, half with a caption.
        85..95 => {
            let file = rng.below(IMAGE_FILES as u64) as u32;
            let (w, h) = image_size(file);
            let caption = rng.below(2) == 0;
            let inlines = if caption {
                rich(&mut rng, 4 + 8, false)
            } else {
                Vec::new()
            };
            Spec {
                kind: Kind::Image { file, w, h },
                inlines,
            }
        }
        // 5% animated emoji.
        _ => {
            let n = 4 + rng.below(16);
            Spec {
                kind: Kind::Text,
                inlines: rich(&mut rng, n, true),
            }
        }
    }
}

/// Real pixel size of an image file. Aspect runs from tall (1:2) to panoramic (3:1).
pub fn image_size(file: u32) -> (u16, u16) {
    const ASPECTS: &[(u16, u16)] = &[(1, 2), (3, 4), (1, 1), (4, 3), (16, 9), (21, 9), (3, 1)];
    let (a, b) = ASPECTS[file as usize % ASPECTS.len()];
    let w = 480 + (file % 5) as u16 * 200;
    (w, (w as u32 * b as u32 / a as u32).min(1400) as u16)
}

pub fn emoji_name(emoji: u16) -> &'static str {
    EMOJI_NAMES[emoji as usize]
}

fn emit(id: i64, spec: Spec) -> Message {
    let author = Rng::new(id ^ 0x55AA).below(40) as u16;
    let mut display = String::new();
    let mut segs: Vec<Seg> = Vec::with_capacity(spec.inlines.len());
    for inline in spec.inlines {
        match inline {
            Inline::Text(text) => {
                display.push_str(&text);
                segs.push(Seg::Text {
                    end: display.len() as u32,
                });
            }
            Inline::Bold(text) => {
                display.push_str(&text);
                segs.push(Seg::Bold {
                    end: display.len() as u32,
                });
            }
            Inline::Link { text, url } => {
                display.push_str(&text);
                segs.push(Seg::Link {
                    end: display.len() as u32,
                    url: url.into(),
                });
            }
            Inline::Emoji(emoji) => {
                display.push(EMOJI_PLACEHOLDER);
                segs.push(Seg::Emoji {
                    end: display.len() as u32,
                    emoji,
                    name: emoji_name(emoji).into(),
                });
            }
        }
    }
    display.shrink_to_fit();
    segs.shrink_to_fit();
    Message {
        id,
        author,
        minute: id.rem_euclid(1 << 20) as u32,
        kind: spec.kind,
        display: display.into(),
        segs,
    }
}

pub fn generate(id: i64) -> Message {
    emit(id, spec(id))
}

/// What copying the whole of message `id` must return, from the generator alone.
pub fn truth(id: i64) -> String {
    let mut out = String::new();
    for inline in spec(id).inlines {
        match inline {
            Inline::Text(text) | Inline::Bold(text) => out.push_str(&text),
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

/// The source text for a byte range of the display string. An emoji's placeholder copies as
/// its `:name:`, whole or not at all.
pub fn copy_range(message: &Message, range: Range<u32>) -> String {
    let display: &str = &message.display;
    let mut out = String::new();
    let mut start = 0u32;
    for seg in &message.segs {
        let end = seg.end();
        let from = start.max(range.start);
        let to = end.min(range.end);
        if from < to {
            match seg {
                Seg::Emoji { name, .. } => {
                    out.push(':');
                    out.push_str(name);
                    out.push(':');
                }
                _ => out.push_str(&display[from as usize..to as usize]),
            }
        }
        start = end;
    }
    out
}

/// Messages in order, ids consecutive. Prepending older ones keeps `id - first_id == index`.
pub struct Store {
    pub messages: VecDeque<Message>,
}

impl Store {
    /// Ids `first..first + count`.
    pub fn new(first: i64, count: usize) -> Self {
        Store {
            messages: (first..first + count as i64).map(generate).collect(),
        }
    }
    pub fn first_id(&self) -> i64 {
        self.messages.front().map_or(0, |m| m.id)
    }
    pub fn len(&self) -> usize {
        self.messages.len()
    }
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }
    pub fn index_of(&self, id: i64) -> Option<usize> {
        let ix = id - self.first_id();
        (ix >= 0 && (ix as usize) < self.len()).then_some(ix as usize)
    }
    pub fn get_id(&self, id: i64) -> Option<&Message> {
        self.index_of(id).map(|ix| &self.messages[ix])
    }
    /// Prepends `count` older messages and returns how many were added.
    pub fn prepend(&mut self, count: usize) -> usize {
        let first = self.first_id();
        for k in 1..=count as i64 {
            self.messages.push_front(generate(first - k));
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copying_a_whole_message_matches_the_generator() {
        for id in 0..5_000 {
            let message = generate(id);
            assert_eq!(
                copy_range(&message, 0..message.display.len() as u32),
                truth(id),
                "id {id}"
            );
        }
    }

    #[test]
    fn the_mix_contains_every_kind() {
        let mut code = 0;
        let mut image = 0;
        let mut animated = 0;
        let mut long = 0;
        for id in 0..10_000 {
            let message = generate(id);
            match message.kind {
                Kind::Code => code += 1,
                Kind::Image { .. } => image += 1,
                Kind::Text => {
                    long += (message.display.len() > 600) as i32;
                    animated +=
                        message.segs.iter().any(
                            |s| matches!(s, Seg::Emoji { emoji, .. } if *emoji >= ANIMATED_FROM),
                        ) as i32;
                }
            }
        }
        assert!(
            code > 800 && image > 800 && animated > 300 && long > 1500,
            "{code} {image} {animated} {long}"
        );
    }
}
