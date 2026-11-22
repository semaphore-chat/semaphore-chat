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
//! (Enter or Space follows it; its focus ring is drawn around the words). There is no text
//! selection in the kit's MessageText yet: the old list's selection engine
//! (`messages/selection.rs`) stays until B13 converts the screen.

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
pub(crate) fn plan(segments: &[MessageSegment]) -> Vec<Block> {
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
        let (shown, kind): (String, PieceKind) = match segment {
            MessageSegment::Text { text, style } => (text.to_string(), PieceKind::Text(*style)),
            MessageSegment::Code(code) => (code.to_string(), PieceKind::Code),
            MessageSegment::CodeBlock(code) => {
                flush(&mut text, &mut pieces, &mut blocks);
                blocks.push(Block::Code(code.to_string()));
                continue;
            }
            MessageSegment::Link { href, style } => match check_link(href) {
                Some(link) => (
                    link.label,
                    PieceKind::Link {
                        href: link.href,
                        style: *style,
                    },
                ),
                None => (strip_bidi(href), PieceKind::RefusedLink(*style)),
            },
            MessageSegment::Mention(mention) => {
                (mention.text.to_string(), PieceKind::Mention(index))
            }
            MessageSegment::Emoji { name, src } => match src {
                Some(_) => (EMOJI_PLACEHOLDER.to_string(), PieceKind::Emoji(index)),
                None => (format!(":{name}:"), PieceKind::Shortcode),
            },
        };
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

/// A message's words: formatting, inline code and code blocks, links, mentions and custom emoji.
/// It holds no parsing and no data.
#[derive(IntoElement)]
pub struct MessageText {
    id: ElementId,
    segments: Vec<MessageSegment>,
    on_mention: Option<MentionHandler>,
    on: Option<Surface>,
}

impl MessageText {
    pub fn new(id: impl Into<ElementId>, segments: Vec<MessageSegment>) -> Self {
        Self {
            id: id.into(),
            segments,
            on_mention: None,
            on: None,
        }
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
        let spoken = spoken(&self.segments);
        let blocks = plan(&self.segments);
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
            match block {
                Block::Code(text) => {
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
                            .child(text),
                    );
                }
                Block::Inline { text, pieces } => {
                    let element = inline_element(
                        &self.id,
                        block_index,
                        text,
                        pieces,
                        &self.segments,
                        self.on_mention.clone(),
                        on,
                        &code,
                        window,
                        cx,
                    );
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
    on: Surface,
    code: &SharedString,
    window: &mut Window,
    cx: &mut App,
) -> InlineText {
    let sem = cx.sem().clone();
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
                let href = href.clone();
                targets.push(TargetSpec {
                    range: piece.range.clone(),
                    role: Role::Link,
                    label: text[piece.range.clone()].to_string().into(),
                    activate: Rc::new(move |_, cx: &mut App| cx.open_url(&href)),
                });
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
                    let mention = mention.clone();
                    targets.push(TargetSpec {
                        range: piece.range.clone(),
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
                if let MessageSegment::Emoji {
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
                        element: div()
                            .id(child_id(id, format!("emoji-{block_index}-{index}")))
                            .role(Role::Image)
                            .aria_label(format!(":{name}:"))
                            .child(picture)
                            .into_any_element(),
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
    element: AnyElement,
}

/// What the pointer is doing to a paragraph's targets, kept across frames.
#[derive(Default)]
struct InlineState {
    hovered: Cell<Option<usize>>,
    pressed: Cell<Option<usize>>,
}

// ---------------------------------------------------------------------------------------------
// The element. B13 deletes messages/text_element.rs's copy of the line and quad arithmetic.

/// One paragraph: `StyledText` plus chips, emoji images, targets and their focus rings.
struct InlineText {
    styled: StyledText,
    chips: Vec<ChipPaint>,
    targets: Vec<Target>,
    emoji: Vec<EmojiPaint>,
    state: Rc<InlineState>,
    focus: Hsla,
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

/// A chip's box around its glyphs. Runs cannot be padded, so inline code spills `space.2xs` past
/// them; a mention does not, or two mentions a space apart would touch.
fn chip_box(quad: Bounds<Pixels>, spill: bool) -> Bounds<Pixels> {
    let side = if spill { px(SPACE_2XS) } else { px(0.) };
    Bounds::from_corners(
        point(
            quad.left() - side,
            quad.top() + px(BORDER_HAIRLINE),
        ),
        point(
            quad.right() + side,
            quad.bottom() - px(BORDER_HAIRLINE),
        ),
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
        let em = window.text_style().font_size.to_pixels(window.rem_size());
        for emoji in &mut self.emoji {
            let Some(cell) = layout.position_for_index(emoji.byte) else {
                continue;
            };
            let side = px(ICON_MD).min(line_height);
            let origin = point(
                cell.x + (em - side) / 2.,
                cell.y + (line_height - side) / 2.,
            );
            emoji.element.prepaint_as_root(
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
                window.paint_quad(fill(chip_box(quad, chip.spill), colour).corner_radii(px(RADIUS_SM)));
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
            emoji.element.paint(window, cx);
        }
        for target in &mut self.targets {
            target.node.paint(window, cx);
        }

        if self.targets.is_empty() {
            return;
        }
        let ranges: Rc<[Range<usize>]> = self.targets.iter().map(|t| t.range.clone()).collect();
        let actions: Rc<[Action]> = self.targets.iter().map(|t| t.activate.clone()).collect();
        let over = hitbox
            .is_hovered(window)
            .then(|| target_at(&layout, &ranges, window.mouse_position()))
            .flatten();
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
                    state
                        .pressed
                        .set(target_at(&layout, &ranges, event.position));
                }
            });
        }
        {
            let (state, hitbox) = (self.state.clone(), hitbox.clone());
            window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
                if !phase.bubble() || event.button != MouseButton::Left {
                    return;
                }
                let pressed = state.pressed.take();
                if !hitbox.is_hovered(window) {
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
