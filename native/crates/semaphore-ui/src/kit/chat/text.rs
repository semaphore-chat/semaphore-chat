//! `MessageText`: a message's words, drawn from segments the chat data layer has already parsed
//! (the web kit's `frontend/src/kit/chat/MessageText.tsx` and `messageSegments.ts`).
//!
//! The kit only draws segments; turning a message's stored spans into segments is the screen's
//! job (B13). Segments are inline and drawn in order, except a code block, which is a block of its
//! own.
//!
//! GPUI lays a paragraph out as one `StyledText`, so links and mentions are runs, not elements.
//! [`InlineText`] adds what a run cannot do: the chip behind inline code and mentions, inline
//! emoji images, clicks and the pointer cursor on links and mentions, and one hidden focusable
//! node per link or mention, placed over its first line, so Tab and a screen reader reach each one
//! (Enter or Space follows it; its focus ring is drawn around the words).
//!
//! Text selection is the message list's (`messages/selection.rs`), across rows: the list hands
//! each row's words a [`ListText`] (crate only) with the range to highlight, a sink for the laid
//! out blocks it hit-tests against, and a painter for emoji from its own bounded image cache.

use crate::kit::Action;
use crate::kit::look::{focus_handle, shows_focus};
use crate::kit::surface::{Surface, stand_out_fill};
use crate::theme::color::{blend, hsla_of};
use crate::theme::{FONT_FAMILY, SemTheme};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::links::check_link;
use semaphore_core::text::EMOJI_PLACEHOLDER;
use semaphore_design::chat::{internal_href, strip_bidi};
use semaphore_design::lounge::{
    BORDER_FOCUS, BORDER_HAIRLINE, ICON_MD, RADIUS_SM, SPACE_2XS, SPACE_MD, SPACE_SM, SPACE_XS,
    STATE_HOVER_ON_FILL, STATE_PRESSED_ON_FILL, TEXT_BODY, TEXT_BODY_STRONG, TEXT_META,
};
use std::cell::{Cell, OnceCell};
use std::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

/// The inline formatting a run of words can carry. A link inside a formatted span keeps it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SegmentStyle {
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
}

impl SegmentStyle {
    pub const BOLD: Self = Self {
        bold: true,
        italic: false,
        strike: false,
    };
    pub const ITALIC: Self = Self {
        bold: false,
        italic: true,
        strike: false,
    };
    pub const STRIKE: Self = Self {
        bold: false,
        italic: false,
        strike: true,
    };
    pub const ALL: Self = Self {
        bold: true,
        italic: true,
        strike: true,
    };
}

/// Who or what a mention points at. `Everyone` covers `@everyone` and `@here`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MentionKind {
    User,
    Role,
    Channel,
    Everyone,
}

/// A mention, shown as written (`@aiko`, `#clips`, `@mods`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionSegment {
    pub kind: MentionKind,
    /// The visible text, with its sign: `@aiko`, `#clips`.
    pub text: SharedString,
    /// The id of the user, role or channel, handed back to `on_mention`.
    pub id: Option<SharedString>,
    /// Where a channel mention goes: an app-internal address only (`#/c/clips`, `/c/clips`).
    /// Anything else is not followed: the mention is drawn as text.
    pub href: Option<SharedString>,
    /// It mentions the reader: drawn in the solid accent.
    pub me: bool,
    /// The reader cannot open it (a channel they cannot see): dimmed and not interactive.
    pub unavailable: bool,
}

impl MentionSegment {
    pub fn new(kind: MentionKind, text: impl Into<SharedString>) -> Self {
        Self {
            kind,
            text: text.into(),
            id: None,
            href: None,
            me: false,
            unavailable: false,
        }
    }

    pub fn id(mut self, id: impl Into<SharedString>) -> Self {
        self.id = Some(id.into());
        self
    }

    pub fn href(mut self, href: impl Into<SharedString>) -> Self {
        self.href = Some(href.into());
        self
    }

    pub fn me(mut self) -> Self {
        self.me = true;
        self
    }

    pub fn unavailable(mut self) -> Self {
        self.unavailable = true;
        self
    }

    /// Whether pressing it does anything: an available mention with an app-internal address, or
    /// a user mention, and only when the screen handles mentions.
    pub fn is_interactive(&self, handled: bool) -> bool {
        handled
            && !self.unavailable
            && (self.kind == MentionKind::User
                || self.href.as_deref().and_then(internal_href).is_some())
    }

    /// The mention as handed to `on_mention`: an address that does not stay in the app is
    /// cleared, so the handler never sees it.
    pub fn followed(&self) -> Self {
        let mut mention = self.clone();
        mention.href = self
            .href
            .as_deref()
            .and_then(internal_href)
            .map(|href| SharedString::from(href.to_owned()));
        mention
    }

    /// What a screen reader hears for it.
    pub fn spoken(&self) -> String {
        if self.unavailable {
            format!("{} (not available to you)", self.text)
        } else if self.me && self.kind != MentionKind::Channel {
            format!("{}, mentions you", self.text)
        } else {
            self.text.to_string()
        }
    }
}

/// One piece of a message's words.
#[derive(Clone)]
pub enum MessageSegment {
    /// Words, with their formatting. Line breaks are kept.
    Text {
        text: SharedString,
        style: SegmentStyle,
    },
    /// Inline code, verbatim in the code font.
    Code(SharedString),
    /// A block of code on its own lines. Long lines wrap.
    CodeBlock(SharedString),
    /// A web link, shown as its own parsed address. Only http and https without user info are
    /// links; anything else is drawn as its text.
    Link {
        href: SharedString,
        style: SegmentStyle,
    },
    Mention(MentionSegment),
    /// A community's custom emoji. Without `src` its `:name:` is shown.
    Emoji {
        name: SharedString,
        src: Option<ImageSource>,
    },
}

impl MessageSegment {
    pub fn text(text: impl Into<SharedString>) -> Self {
        Self::Text {
            text: text.into(),
            style: SegmentStyle::default(),
        }
    }

    pub fn styled(text: impl Into<SharedString>, style: SegmentStyle) -> Self {
        Self::Text {
            text: text.into(),
            style,
        }
    }

    pub fn code(text: impl Into<SharedString>) -> Self {
        Self::Code(text.into())
    }

    pub fn code_block(text: impl Into<SharedString>) -> Self {
        Self::CodeBlock(text.into())
    }

    pub fn link(href: impl Into<SharedString>) -> Self {
        Self::styled_link(href, SegmentStyle::default())
    }

    pub fn styled_link(href: impl Into<SharedString>, style: SegmentStyle) -> Self {
        Self::Link {
            href: href.into(),
            style,
        }
    }

    pub fn mention(mention: MentionSegment) -> Self {
        Self::Mention(mention)
    }

    pub fn emoji(name: impl Into<SharedString>, src: Option<ImageSource>) -> Self {
        Self::Emoji {
            name: name.into(),
            src,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The plan: what is drawn where, with no GPUI paint. Tested on its own.

/// What a run of a paragraph is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PieceKind {
    Text(SegmentStyle),
    Code,
    /// A link that opens `href`, drawn with its checked label.
    Link {
        href: String,
        style: SegmentStyle,
    },
    /// An address that is not a link, drawn as its text.
    RefusedLink(SegmentStyle),
    /// The segment index of a mention.
    Mention(usize),
    /// An emoji with a picture: a placeholder its image paints over. The segment index.
    Emoji(usize),
    /// An emoji with no picture: its `:name:`.
    Shortcode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Piece {
    pub range: Range<usize>,
    pub kind: PieceKind,
}

/// A paragraph or a code block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Block {
    Inline { text: String, pieces: Vec<Piece> },
    Code(String),
}

/// The blocks `segments` draw as: inline segments run together into a paragraph; a code block
/// ends it and stands alone.
#[cfg(test)]
pub(crate) fn plan(segments: &[MessageSegment]) -> Vec<Block> {
    plan_with(segments, false)
}

/// Left-to-right isolate (U+2066) and its end (U+2069): every link label and mention is drawn
/// inside one, so no bidi control in the words around it can reorder what it reads.
pub(crate) const LRI: char = '\u{2066}';
pub(crate) const PDI: char = '\u{2069}';
/// The room a mention keeps each side of its name, inside its isolate, so its chip pads the
/// name as the web's `padding: 0 space.2xs` does. A run cannot be padded, and a chip only
/// spilling past the glyphs would let the name's last letter reach its edge, and two mentions a
/// space apart touch.
pub(crate) const MENTION_PAD: char = '\u{200A}';

/// Byte offsets of the bidi embeddings, overrides and isolates in `text` that are not closed (or
/// close nothing) inside it: they would run on into the next segment, so they are not drawn.
pub(crate) fn unpaired_bidi(text: &str) -> Vec<usize> {
    let mut unpaired = Vec::new();
    // Embeddings and overrides (LRE, RLE, LRO, RLO) close with PDF; isolates (LRI, RLI, FSI)
    // with PDI. A PDI also closes the embeddings opened inside its isolate.
    let mut embeds: Vec<usize> = Vec::new();
    let mut isolates: Vec<(usize, usize)> = Vec::new();
    for (at, c) in text.char_indices() {
        match c {
            '\u{202A}' | '\u{202B}' | '\u{202D}' | '\u{202E}' => embeds.push(at),
            '\u{2066}'..='\u{2068}' => isolates.push((at, embeds.len())),
            '\u{202C}' => {
                // A PDF closes only an embedding opened inside the innermost open isolate.
                let floor = isolates.last().map_or(0, |(_, depth)| *depth);
                if embeds.len() > floor {
                    embeds.pop();
                } else {
                    unpaired.push(at);
                }
            }
            '\u{2069}' => match isolates.pop() {
                Some((_, depth)) => {
                    // Embeddings opened inside the isolate end with it, unclosed.
                    unpaired.extend(embeds.drain(depth..));
                }
                None => unpaired.push(at),
            },
            _ => {}
        }
    }
    unpaired.extend(embeds);
    unpaired.extend(isolates.into_iter().map(|(at, _)| at));
    unpaired.sort_unstable();
    unpaired
}

/// `text` without its unpaired bidi controls (`unpaired_bidi`).
pub(crate) fn strip_unpaired_bidi(text: &str) -> String {
    let unpaired = unpaired_bidi(text);
    if unpaired.is_empty() {
        return text.to_owned();
    }
    text.char_indices()
        .filter(|(at, _)| unpaired.binary_search(at).is_err())
        .map(|(_, c)| c)
        .collect()
}

/// `words` inside a left-to-right isolate, with any bidi control of its own taken out.
fn isolated(words: &str) -> String {
    format!("{LRI}{}{PDI}", strip_bidi(words))
}

/// What one segment draws as, in order with the rest. `emoji_placeholders` draws every emoji as a
/// placeholder, painted by the list (`ListText::paint_emoji`). A checked link is its label and a
/// mention its text, each in a left-to-right isolate; words lose their unpaired bidi controls.
pub(crate) fn shown(segment: &MessageSegment, emoji_placeholders: bool) -> String {
    match segment {
        MessageSegment::Text { text, .. } => strip_unpaired_bidi(text),
        MessageSegment::Code(code) | MessageSegment::CodeBlock(code) => strip_unpaired_bidi(code),
        MessageSegment::Link { href, .. } => match check_link(href) {
            Some(link) => isolated(&link.label),
            None => strip_bidi(href),
        },
        MessageSegment::Mention(mention) => {
            format!(
                "{LRI}{MENTION_PAD}{}{MENTION_PAD}{PDI}",
                strip_bidi(&mention.text)
            )
        }
        MessageSegment::Emoji { name, src } => {
            if src.is_some() || emoji_placeholders {
                EMOJI_PLACEHOLDER.to_string()
            } else {
                format!(":{name}:")
            }
        }
    }
}

/// How many bytes a segment draws as in a list row (emoji as placeholders).
#[cfg(test)]
pub(crate) fn shown_len(segment: &MessageSegment) -> usize {
    shown(segment, true).len()
}

/// Where each block starts in the words as drawn, all blocks run together.
pub(crate) fn block_starts(blocks: &[Block]) -> Vec<usize> {
    let mut at = 0;
    blocks
        .iter()
        .map(|block| {
            let start = at;
            at += match block {
                Block::Inline { text, .. } => text.len(),
                Block::Code(code) => code.len(),
            };
            start
        })
        .collect()
}

pub(crate) fn plan_with(segments: &[MessageSegment], emoji_placeholders: bool) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut text = String::new();
    let mut pieces = Vec::new();
    let flush = |text: &mut String, pieces: &mut Vec<Piece>, blocks: &mut Vec<Block>| {
        if !pieces.is_empty() {
            blocks.push(Block::Inline {
                text: std::mem::take(text),
                pieces: std::mem::take(pieces),
            });
        }
    };
    for (index, segment) in segments.iter().enumerate() {
        let drawn = shown(segment, emoji_placeholders);
        let kind = match segment {
            MessageSegment::Text { style, .. } => PieceKind::Text(*style),
            MessageSegment::Code(_) => PieceKind::Code,
            MessageSegment::CodeBlock(_) => {
                flush(&mut text, &mut pieces, &mut blocks);
                blocks.push(Block::Code(drawn));
                continue;
            }
            MessageSegment::Link { href, style } => match check_link(href) {
                Some(link) => PieceKind::Link {
                    href: link.href,
                    style: *style,
                },
                None => PieceKind::RefusedLink(*style),
            },
            MessageSegment::Mention(_) => PieceKind::Mention(index),
            MessageSegment::Emoji { src, .. } if src.is_some() || emoji_placeholders => {
                PieceKind::Emoji(index)
            }
            MessageSegment::Emoji { .. } => PieceKind::Shortcode,
        };
        let shown = drawn;
        if shown.is_empty() {
            continue;
        }
        let start = text.len();
        text.push_str(&shown);
        pieces.push(Piece {
            range: start..text.len(),
            kind,
        });
    }
    flush(&mut text, &mut pieces, &mut blocks);
    blocks
}

/// A message's words planned once: its blocks, where each starts as drawn, and what a screen
/// reader hears. The list keeps one per row revision, so a redraw parses nothing.
pub(crate) struct Planned {
    pub blocks: Vec<Block>,
    pub starts: Vec<usize>,
    pub spoken: SharedString,
}

pub(crate) fn planned(segments: &[MessageSegment], emoji_placeholders: bool) -> Planned {
    let blocks = plan_with(segments, emoji_placeholders);
    Planned {
        starts: block_starts(&blocks),
        spoken: spoken(segments).into(),
        blocks,
    }
}

/// What a screen reader hears for the whole message.
pub(crate) fn spoken(segments: &[MessageSegment]) -> String {
    segments
        .iter()
        .map(|segment| match segment {
            MessageSegment::Text { text, .. } | MessageSegment::Code(text) => text.to_string(),
            MessageSegment::CodeBlock(text) => format!("\n{text}\n"),
            MessageSegment::Link { href, .. } => match check_link(href) {
                Some(link) => link.label,
                None => strip_bidi(href),
            },
            MessageSegment::Mention(mention) => mention.spoken(),
            MessageSegment::Emoji { name, .. } => format!(":{name}:"),
        })
        .collect::<String>()
        .trim()
        .to_string()
}

// ---------------------------------------------------------------------------------------------
// The piece

type MentionHandler = Rc<dyn Fn(&MentionSegment, &mut Window, &mut App)>;
/// A link was pressed: its checked address (punycode host, nothing decoded).
pub(crate) type LinkHandler = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// A message's words: formatting, inline code and code blocks, links, mentions and custom emoji.
/// It holds no parsing and no data.
#[derive(IntoElement)]
pub struct MessageText {
    id: ElementId,
    segments: Rc<[MessageSegment]>,
    on_mention: Option<MentionHandler>,
    on_link: Option<LinkHandler>,
    on: Option<Surface>,
    list: Option<ListText>,
}

/// What the message list adds to a row's words. Offsets are bytes in the words as drawn, every
/// block run together (`block_starts`).
#[derive(Clone)]
pub(crate) struct ListText {
    /// The row's words planned with emoji as placeholders (`planned(.., true)`), kept by the list
    /// per row revision.
    pub plan: Rc<Planned>,
    /// The part of the selection in this row.
    pub selected: Option<Range<usize>>,
    pub selection: Hsla,
    /// Each block as laid out this frame: its start, its length, its layout and bounds.
    pub record: Rc<dyn Fn(usize, usize, TextLayout, Bounds<Pixels>)>,
    /// Paints the emoji of this segment index into its box, in place of the kit's picture.
    pub paint_emoji: EmojiPainter,
}

/// `ListText::paint_emoji`.
pub(crate) type EmojiPainter = Rc<dyn Fn(usize, Bounds<Pixels>, &mut Window, &mut App)>;

impl MessageText {
    pub fn new(id: impl Into<ElementId>, segments: Vec<MessageSegment>) -> Self {
        Self::shared(id, segments.into())
    }

    /// The words as a shared slice, so a list row hands them over without copying.
    pub(crate) fn shared(id: impl Into<ElementId>, segments: Rc<[MessageSegment]>) -> Self {
        Self {
            id: id.into(),
            segments,
            on_mention: None,
            on_link: None,
            on: None,
            list: None,
        }
    }

    /// Selection, hit-testing geometry and emoji painting from the message list.
    pub(crate) fn list(mut self, list: ListText) -> Self {
        self.list = Some(list);
        self
    }

    /// A link was pressed, with its checked address: the screen decides where it goes (a message
    /// on this server, or the browser). Without it a link is drawn but not pressable; the kit
    /// never opens anything itself.
    pub fn on_link(mut self, handler: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_link = Some(Rc::new(handler));
        self
    }

    /// A user mention, or a mention with an app-internal address, was pressed.
    pub fn on_mention(
        mut self,
        handler: impl Fn(&MentionSegment, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_mention = Some(Rc::new(handler));
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// The platform's monospace, picked once from the installed fonts (`messages::palette::Fonts`).
fn code_font(cx: &App) -> SharedString {
    thread_local! {
        static CODE: OnceCell<SharedString> = const { OnceCell::new() };
    }
    CODE.with(|code| {
        code.get_or_init(|| crate::messages::palette::Fonts::pick(cx).code)
            .clone()
    })
}

fn child_id(id: &ElementId, name: String) -> ElementId {
    ElementId::NamedChild(Arc::new(id.clone()), name.into())
}

impl RenderOnce for MessageText {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let on = Surface::or_current(self.on, cx);
        let code = code_font(cx);
        let plan = match &self.list {
            Some(list) => list.plan.clone(),
            None => Rc::new(planned(&self.segments, false)),
        };
        let spoken = plan.spoken.clone();
        let blocks = plan.blocks.clone();
        let starts = &plan.starts;
        let mut column = div()
            .id(self.id.clone())
            .test_support()
            .role(Role::Paragraph)
            .aria_label(spoken)
            .relative()
            .flex()
            .flex_col()
            .min_w_0()
            .w_full()
            .font_family(FONT_FAMILY)
            .text_size(px(TEXT_BODY.size))
            .line_height(px(TEXT_BODY.line_height))
            .text_color(sem.role.text);
        for (block_index, block) in blocks.into_iter().enumerate() {
            let list = self.list.clone().map(|list| (list, starts[block_index]));
            match block {
                Block::Code(text) => {
                    let len = text.len();
                    let run = TextRun {
                        len,
                        font: font(code.clone()),
                        color: sem.role.text,
                        background_color: None,
                        underline: None,
                        strikethrough: None,
                    };
                    let laid = InlineText {
                        styled: StyledText::new(text).with_runs(vec![run]),
                        chips: Vec::new(),
                        targets: Vec::new(),
                        emoji: Vec::new(),
                        state: Rc::new(InlineState::default()),
                        focus: sem.role.focus,
                        list: list.map(|(list, start)| (list, start, len)),
                    };
                    column = column.child(
                        div()
                            .my(px(SPACE_XS))
                            .px(px(SPACE_MD))
                            .py(px(SPACE_SM))
                            .rounded(px(RADIUS_SM))
                            .bg(stand_out_fill(&sem, on))
                            .font_family(code.clone())
                            .text_size(px(TEXT_META.size))
                            .line_height(px(TEXT_META.line_height))
                            .child(laid),
                    );
                }
                Block::Inline { text, pieces } => {
                    let len = text.len();
                    let mut element = inline_element(
                        &self.id,
                        block_index,
                        text,
                        pieces,
                        &self.segments,
                        self.on_mention.clone(),
                        self.on_link.clone(),
                        on,
                        &code,
                        list.is_some(),
                        window,
                        cx,
                    );
                    element.list = list.map(|(list, start)| (list, start, len));
                    column = column.child(element);
                }
            }
        }
        column
    }
}

/// The runs, chips, targets and emoji of one paragraph.
#[allow(clippy::too_many_arguments)]
fn inline_element(
    id: &ElementId,
    block_index: usize,
    text: String,
    pieces: Vec<Piece>,
    segments: &[MessageSegment],
    on_mention: Option<MentionHandler>,
    on_link: Option<LinkHandler>,
    on: Surface,
    code: &SharedString,
    list_paints_emoji: bool,
    window: &mut Window,
    cx: &mut App,
) -> InlineText {
    let sem = cx.sem().clone();
    let row_tab = super::RowTabScope::active(cx);
    let p = sem.roles;
    let under = crate::kit::surface::tint_base_token(&p, on);
    let mention_tint = hsla_of(blend(p.accent, under, STATE_HOVER_ON_FILL));
    let mention_tint_hover = hsla_of(blend(p.accent, under, STATE_PRESSED_ON_FILL));
    let me_hover = hsla_of(blend(p.text, p.accent, STATE_HOVER_ON_FILL));
    let base_font = || font(FONT_FAMILY);
    let mut runs = Vec::new();
    let mut chips = Vec::new();
    let mut targets = Vec::new();
    let mut emoji = Vec::new();
    let styled = |run: &mut TextRun, style: SegmentStyle| {
        if style.bold {
            run.font.weight = FontWeight::BOLD;
        }
        if style.italic {
            run.font.style = FontStyle::Italic;
        }
        if style.strike {
            run.strikethrough = Some(StrikethroughStyle {
                thickness: px(BORDER_HAIRLINE),
                color: Some(run.color),
            });
        }
    };
    for piece in &pieces {
        let mut run = TextRun {
            len: piece.range.len(),
            font: base_font(),
            color: sem.role.text,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        match &piece.kind {
            PieceKind::Text(style) | PieceKind::RefusedLink(style) => styled(&mut run, *style),
            PieceKind::Code => {
                run.font = font(code.clone());
                chips.push(ChipPaint {
                    range: piece.range.clone(),
                    rest: stand_out_fill(&sem, on),
                    hover: None,
                    target: None,
                    spill: true,
                });
            }
            PieceKind::Link { href, style } => {
                run.color = sem.role.accent_text;
                run.underline = Some(UnderlineStyle {
                    thickness: px(BORDER_HAIRLINE),
                    color: Some(sem.role.accent_text),
                    wavy: false,
                });
                styled(&mut run, *style);
                if let Some(handler) = on_link.clone() {
                    let href = href.clone();
                    targets.push(TargetSpec {
                        range: piece.range.clone(),
                        role: Role::Link,
                        // The label without its isolate marks.
                        label: text
                            .get(piece.range.clone())
                            .unwrap_or_default()
                            .trim_matches([LRI, PDI])
                            .to_owned()
                            .into(),
                        activate: Rc::new(move |window, cx| handler(&href, window, cx)),
                    });
                }
            }
            PieceKind::Mention(index) => {
                let MessageSegment::Mention(mention) = &segments[*index] else {
                    continue;
                };
                run.font.weight = FontWeight(TEXT_BODY_STRONG.weight as f32);
                let interactive = mention.is_interactive(on_mention.is_some());
                let (rest, hover) = if mention.unavailable {
                    run.color = sem.role.text_dim;
                    run.font.style = FontStyle::Italic;
                    (None, None)
                } else if mention.me {
                    run.color = sem.role.on_accent;
                    (Some(sem.role.accent), Some(me_hover))
                } else {
                    run.color = sem.role.accent_text;
                    (Some(mention_tint), Some(mention_tint_hover))
                };
                let target = interactive.then(|| {
                    let handler = on_mention.clone().expect("interactive needs a handler");
                    let mention = mention.followed();
                    targets.push(TargetSpec {
                        range: piece.range.clone(),
                        // A link only when its address stays in the app; otherwise a button.
                        role: if mention.href.is_some() {
                            Role::Link
                        } else {
                            Role::Button
                        },
                        label: mention.spoken().into(),
                        activate: Rc::new(move |window, cx| handler(&mention, window, cx)),
                    });
                    targets.len() - 1
                });
                if let Some(rest) = rest {
                    chips.push(ChipPaint {
                        range: piece.range.clone(),
                        rest,
                        hover: hover.filter(|_| interactive),
                        target,
                        spill: false,
                    });
                }
            }
            PieceKind::Emoji(index) => {
                run.color = Hsla::transparent_black();
                if list_paints_emoji {
                    emoji.push(EmojiPaint {
                        byte: piece.range.start,
                        index: *index,
                        element: None,
                    });
                } else if let MessageSegment::Emoji {
                    name,
                    src: Some(src),
                } = &segments[*index]
                {
                    let fallback = sem.role.hairline;
                    let picture = img(src.clone())
                        .size(px(ICON_MD))
                        .object_fit(ObjectFit::Contain)
                        .with_fallback(move || {
                            div()
                                .size(px(ICON_MD))
                                .rounded(px(RADIUS_SM))
                                .bg(fallback)
                                .into_any_element()
                        });
                    emoji.push(EmojiPaint {
                        byte: piece.range.start,
                        index: *index,
                        element: Some(
                            div()
                                .id(child_id(id, format!("emoji-{block_index}-{index}")))
                                .role(Role::Image)
                                .aria_label(format!(":{name}:"))
                                .child(picture)
                                .into_any_element(),
                        ),
                    });
                }
            }
            PieceKind::Shortcode => {}
        }
        runs.push(run);
    }

    let state = window
        .use_keyed_state(child_id(id, format!("inline-{block_index}")), cx, |_, _| {
            Rc::new(InlineState::default())
        })
        .read(cx)
        .clone();
    let targets = targets
        .into_iter()
        .enumerate()
        .map(|(index, spec)| {
            let node_id = child_id(id, format!("target-{block_index}-{index}"));
            let handle = focus_handle(&node_id, window, cx);
            let focused = shows_focus(&handle, window);
            let activate = spec.activate.clone();
            let node = base::Button::new(node_id)
                .when(!row_tab, |button| button.tab_stop(false))
                .track_focus(&handle)
                .role(spec.role)
                .accessibility_label(spec.label.clone())
                // A mouse press is the paragraph's own (it covers every wrapped line); this node
                // takes keyboard and assistive-technology presses.
                .on_click(move |event, window, cx| {
                    if !matches!(event, ClickEvent::Mouse(_)) {
                        activate(window, cx);
                    }
                })
                .into_any_element();
            Target {
                range: spec.range,
                activate: spec.activate,
                node,
                focused,
            }
        })
        .collect();
    InlineText {
        styled: StyledText::new(text).with_runs(runs),
        chips,
        targets,
        emoji,
        state,
        focus: sem.role.focus,
        list: None,
    }
}

struct TargetSpec {
    range: Range<usize>,
    role: Role,
    label: SharedString,
    activate: Action,
}

struct ChipPaint {
    range: Range<usize>,
    rest: Hsla,
    /// The tint while the pointer is over it, for an interactive mention.
    hover: Option<Hsla>,
    /// The target it belongs to, for its hover.
    target: Option<usize>,
    /// Spills past its glyphs (inline code).
    spill: bool,
}

struct Target {
    range: Range<usize>,
    activate: Action,
    node: AnyElement,
    focused: bool,
}

struct EmojiPaint {
    byte: usize,
    /// Its segment.
    index: usize,
    /// The kit's picture; `None` when the list paints it.
    element: Option<AnyElement>,
}

/// What the pointer is doing to a paragraph's targets, kept across frames.
#[derive(Default)]
struct InlineState {
    hovered: Cell<Option<usize>>,
    pressed: Cell<Option<usize>>,
    /// Where the press was: a release further than `CLICK_SLOP` away is a drag (a selection),
    /// not a click.
    pressed_at: Cell<Option<Point<Pixels>>>,
}

/// How far a press may move and still be a click.
const CLICK_SLOP: Pixels = px(3.);

// ---------------------------------------------------------------------------------------------
// The element: the list's selection, hit-testing geometry and emoji ride on it (`ListText`).

/// One paragraph: `StyledText` plus chips, emoji images, targets and their focus rings.
struct InlineText {
    styled: StyledText,
    chips: Vec<ChipPaint>,
    targets: Vec<Target>,
    emoji: Vec<EmojiPaint>,
    state: Rc<InlineState>,
    focus: Hsla,
    /// The list's selection and geometry, with this block's start and length.
    list: Option<(ListText, usize, usize)>,
}

impl IntoElement for InlineText {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

/// One wrapped line as laid out.
struct VisualLine {
    start: usize,
    end: usize,
    x_origin: Pixels,
    line: Arc<WrappedLineLayout>,
    logical_start: usize,
    top: Pixels,
}

impl VisualLine {
    fn x_of(&self, index: usize) -> Pixels {
        self.line
            .unwrapped_layout
            .x_for_index(index - self.logical_start)
            - self.x_origin
    }
}

fn visual_lines(layout: &TextLayout, bounds: Bounds<Pixels>) -> Vec<VisualLine> {
    let line_height = layout.line_height();
    let mut lines = Vec::new();
    let mut logical_start = 0;
    let mut top = bounds.top();
    for line in layout.line_layouts() {
        let mut start = 0;
        let boundaries: Vec<usize> = line
            .wrap_boundaries()
            .iter()
            .map(|boundary| line.runs()[boundary.run_ix].glyphs[boundary.glyph_ix].index)
            .collect();
        for end in boundaries.into_iter().chain([line.len()]) {
            lines.push(VisualLine {
                start: logical_start + start,
                end: logical_start + end,
                x_origin: line.unwrapped_layout.x_for_index(start),
                line: line.clone(),
                logical_start,
                top,
            });
            top += line_height;
            start = end;
        }
        logical_start += line.len() + 1;
    }
    lines
}

/// A rectangle per wrapped line covering `range`, as wide as its glyphs on that line.
fn range_quads(
    lines: &[VisualLine],
    range: &Range<usize>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
) -> Vec<Bounds<Pixels>> {
    let mut quads = Vec::new();
    for line in lines {
        if line.start >= range.end || line.end <= range.start {
            continue;
        }
        let from = range.start.max(line.start);
        let to = range.end.min(line.end);
        let left = line.x_of(from);
        let right = line.x_of(to);
        if right > left {
            quads.push(Bounds::from_corners(
                point(bounds.left() + left, line.top),
                point(bounds.left() + right, line.top + line_height),
            ));
        }
    }
    quads
}

/// The box an emoji placeholder at `byte` is painted in: its em cell, centred on the line.
fn emoji_box(layout: &TextLayout, byte: usize, window: &Window) -> Option<Bounds<Pixels>> {
    let cell = layout.position_for_index(byte)?;
    let line_height = layout.line_height();
    let em = window.text_style().font_size.to_pixels(window.rem_size());
    let side = px(ICON_MD).min(line_height);
    Some(Bounds::new(
        point(
            cell.x + (em - side) / 2.,
            cell.y + (line_height - side) / 2.,
        ),
        size(side, side),
    ))
}

/// The selection's rectangles: as `range_quads`, plus a stub for a selected hard line end, so a
/// blank line in a selection shows.
fn selection_quads(
    lines: &[VisualLine],
    range: Range<usize>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
) -> Vec<Bounds<Pixels>> {
    let stub = px(6.);
    let mut quads = Vec::new();
    for line in lines {
        if line.start >= range.end || line.end < range.start {
            continue;
        }
        let from = range.start.max(line.start);
        let to = range.end.min(line.end);
        let left = line.x_of(from);
        let mut right = line.x_of(to);
        if range.end > line.end && line.end - line.logical_start == line.line.len() {
            right += stub;
        }
        if right > left {
            quads.push(Bounds::from_corners(
                point(bounds.left() + left, line.top),
                point(bounds.left() + right, line.top + line_height),
            ));
        }
    }
    quads
}

/// A chip's box around its glyphs. Runs cannot be padded, so inline code spills `space.2xs` past
/// them; a mention does not, or two mentions a space apart would touch: its room is the pads
/// drawn inside its isolate (`MENTION_PAD`).
fn chip_box(quad: Bounds<Pixels>, spill: bool) -> Bounds<Pixels> {
    let side = if spill { px(SPACE_2XS) } else { px(0.) };
    Bounds::from_corners(
        point(quad.left() - side, quad.top() + px(BORDER_HAIRLINE)),
        point(quad.right() + side, quad.bottom() - px(BORDER_HAIRLINE)),
    )
}

fn target_at(
    layout: &TextLayout,
    targets: &[Range<usize>],
    position: Point<Pixels>,
) -> Option<usize> {
    let index = layout.index_for_position(position).ok()?;
    targets.iter().position(|range| range.contains(&index))
}

impl Element for InlineText {
    type RequestLayoutState = ();
    type PrepaintState = (Hitbox, Vec<Bounds<Pixels>>);

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        self.styled.request_layout(id, inspector, window, cx)
    }

    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> (Hitbox, Vec<Bounds<Pixels>>) {
        self.styled
            .prepaint(id, inspector, bounds, &mut (), window, cx);
        let layout = self.styled.layout().clone();
        let line_height = layout.line_height();
        let lines = visual_lines(&layout, bounds);
        // Each target's node sits over its first line, so its accessibility bounds are the words.
        let mut first = Vec::new();
        for target in &mut self.targets {
            let quad = range_quads(&lines, &target.range, bounds, line_height)
                .into_iter()
                .next()
                .unwrap_or(Bounds::new(bounds.origin, size(px(1.), line_height)));
            let space = size(
                AvailableSpace::Definite(quad.size.width),
                AvailableSpace::Definite(quad.size.height),
            );
            let mut node = std::mem::replace(&mut target.node, Empty.into_any_element());
            node = div()
                .w(quad.size.width)
                .h(quad.size.height)
                .child(node)
                .into_any_element();
            node.prepaint_as_root(quad.origin, space, window, cx);
            target.node = node;
            first.push(quad);
        }
        for emoji in &mut self.emoji {
            let Some(origin) = emoji_box(&layout, emoji.byte, window).map(|b| b.origin) else {
                continue;
            };
            let side = px(ICON_MD).min(line_height);
            let Some(element) = emoji.element.as_mut() else {
                continue;
            };
            element.prepaint_as_root(
                origin,
                size(
                    AvailableSpace::Definite(side),
                    AvailableSpace::Definite(side),
                ),
                window,
                cx,
            );
        }
        (window.insert_hitbox(bounds, HitboxBehavior::Normal), first)
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        (hitbox, _): &mut (Hitbox, Vec<Bounds<Pixels>>),
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled.layout().clone();
        let line_height = layout.line_height();
        let lines = visual_lines(&layout, bounds);
        let hovered = self.state.hovered.get();

        for chip in &self.chips {
            let colour = match (chip.hover, chip.target) {
                (Some(hover), Some(target)) if hovered == Some(target) => hover,
                _ => chip.rest,
            };
            for quad in range_quads(&lines, &chip.range, bounds, line_height) {
                window.paint_quad(
                    fill(chip_box(quad, chip.spill), colour).corner_radii(px(RADIUS_SM)),
                );
            }
        }
        if let Some((list, start, len)) = &self.list
            && let Some(selected) = &list.selected
        {
            let from = selected.start.max(*start) - start;
            let to = selected.end.min(start + len).saturating_sub(*start);
            if from < to {
                for quad in selection_quads(&lines, from..to, bounds, line_height) {
                    window.paint_quad(fill(quad, list.selection));
                }
            }
        }
        for target in self.targets.iter().filter(|target| target.focused) {
            for quad in range_quads(&lines, &target.range, bounds, line_height) {
                window.paint_quad(
                    outline(chip_box(quad, true), self.focus, BorderStyle::Solid)
                        .border_widths(px(BORDER_FOCUS))
                        .corner_radii(px(RADIUS_SM)),
                );
            }
        }

        self.styled
            .paint(id, inspector, bounds, &mut (), &mut (), window, cx);
        for emoji in &mut self.emoji {
            match (emoji.element.as_mut(), &self.list) {
                (Some(element), _) => element.paint(window, cx),
                (None, Some((list, _, _))) => {
                    if let Some(rect) = emoji_box(&layout, emoji.byte, window) {
                        (list.paint_emoji)(emoji.index, rect, window, cx);
                    }
                }
                (None, None) => {}
            }
        }
        for target in &mut self.targets {
            target.node.paint(window, cx);
        }
        if let Some((list, start, len)) = &self.list {
            (list.record)(*start, *len, layout.clone(), bounds);
        }

        let ranges: Rc<[Range<usize>]> = self.targets.iter().map(|t| t.range.clone()).collect();
        let over = hitbox
            .is_hovered(window)
            .then(|| target_at(&layout, &ranges, window.mouse_position()))
            .flatten();
        if self.list.is_some() && over.is_none() {
            window.set_cursor_style(CursorStyle::IBeam, hitbox);
        }
        if self.targets.is_empty() {
            return;
        }
        let actions: Rc<[Action]> = self.targets.iter().map(|t| t.activate.clone()).collect();
        if over.is_some() {
            window.set_cursor_style(CursorStyle::PointingHand, hitbox);
        }
        {
            let (state, layout, ranges, hitbox) = (
                self.state.clone(),
                layout.clone(),
                ranges.clone(),
                hitbox.clone(),
            );
            window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, _| {
                if !phase.bubble() {
                    return;
                }
                let now = hitbox
                    .is_hovered(window)
                    .then(|| target_at(&layout, &ranges, event.position))
                    .flatten();
                if now != state.hovered.get() {
                    state.hovered.set(now);
                    window.refresh();
                }
            });
        }
        {
            let (state, layout, ranges, hitbox) = (
                self.state.clone(),
                layout.clone(),
                ranges.clone(),
                hitbox.clone(),
            );
            window.on_mouse_event(move |event: &MouseDownEvent, phase, window, _| {
                if phase.bubble() && event.button == MouseButton::Left && hitbox.is_hovered(window)
                {
                    // Only a plain single click follows: a double or triple click selects a
                    // word or a line, and Shift (or any other modifier) extends a selection.
                    let plain = event.click_count <= 1 && !event.modifiers.modified();
                    state.pressed.set(
                        plain
                            .then(|| target_at(&layout, &ranges, event.position))
                            .flatten(),
                    );
                    state.pressed_at.set(Some(event.position));
                }
            });
        }
        {
            let (state, hitbox) = (self.state.clone(), hitbox.clone());
            window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
                if !phase.bubble() || event.button != MouseButton::Left {
                    return;
                }
                let pressed = state
                    .pressed
                    .take()
                    .filter(|_| event.click_count <= 1 && !event.modifiers.modified());
                let pressed_at = state.pressed_at.take();
                if !hitbox.is_hovered(window) {
                    return;
                }
                // A press dragged into a selection opens nothing.
                if pressed_at.is_some_and(|at| {
                    let moved = event.position - at;
                    moved.x.abs() > CLICK_SLOP || moved.y.abs() > CLICK_SLOP
                }) {
                    return;
                }
                let released = target_at(&layout, &ranges, event.position);
                if let Some(index) = released.filter(|index| Some(*index) == pressed) {
                    actions[index](window, cx);
                }
            });
        }
    }
}
