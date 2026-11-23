//! The chat pieces, one story per state the web kit's stories show
//! (`frontend/src/stories/kit/Kit{MessageText,ListSeparator,ReactionChip,MessageQuote,
//! TypingLine,JumpToLatest,LinkCard,AttachmentTile}.stories.tsx`), in the same words, on the
//! web's three chat palettes: dark, light, and tinted (`#0d9488`, vibrant).
//!
//! Each piece sits in a MessageRow, as on the web.

use super::{
    AttachmentKind, AttachmentTile, JumpToLatest, LinkCard, MentionKind, MentionSegment,
    MessageQuote, MessageRow, MessageSegment as S, MessageText, PlayerSlot, ReactionChip,
    SegmentStyle, TypingLine,
};
use crate::kit::overlays::type_text;
use crate::kit::{Icon, Island, LinearProgress, ListSeparator, Padding};
use crate::stories::Story;
use crate::theme::{self, SemTheme, ThemeInput};
use gpui_kit::prelude::*;
use gpui_kit::*;
use image::{Frame, RgbaImage};
use semaphore_design::lounge::{
    self as t, LAYOUT_GUTTER, RADIUS_FULL, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XS,
};
use semaphore_design::{Intensity, LoungeIcon, Mode, Rgba};
use std::sync::Arc;

/// The three palettes every chat-piece story renders in (`kitChatData.ts`'s `PALETTES`).
#[derive(Clone, Copy)]
pub(super) enum Palette {
    Dark,
    Light,
    Tinted,
}

impl Palette {
    pub(super) fn input(self) -> ThemeInput {
        match self {
            Palette::Dark => ThemeInput::new(theme::DEFAULT_BASE, Mode::Dark, Intensity::Minimal),
            Palette::Light => ThemeInput::new(theme::DEFAULT_BASE, Mode::Light, Intensity::Minimal),
            Palette::Tinted => ThemeInput::new(Rgba(0x0d9488ff), Mode::Dark, Intensity::Vibrant),
        }
    }
}

pub(super) type Body = fn(&mut Window, &mut App) -> AnyElement;

struct ChatStory {
    body: Body,
}

impl Render for ChatStory {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("chat-story")
            .size_full()
            .overflow_y_scroll()
            .bg(cx.sem().role.ground)
            .text_color(cx.sem().role.text)
            .p(px(LAYOUT_GUTTER))
            .flex()
            .flex_col()
            .gap(px(SPACE_LG))
            .child((self.body)(window, cx))
    }
}

pub(super) fn view(palette: Palette, body: Body, cx: &mut App) -> AnyView {
    theme::apply(palette.input(), cx);
    cx.new(|_| ChatStory { body }).into()
}

/// A centre island the width of a chat column, capped to the window (`ChatColumn`).
pub(super) fn chat_column(id: &'static str, width: f32, children: Vec<AnyElement>) -> AnyElement {
    div()
        .w(px(width))
        .max_w_full()
        .child(
            Island::new(id).padding(Padding::None).child(
                div()
                    .py(px(SPACE_LG))
                    .flex()
                    .flex_col()
                    .gap(px(SPACE_XS))
                    .children(children),
            ),
        )
        .into_any_element()
}

/// A labelled group of pieces (`kitStory`'s `Row`).
pub(super) fn labelled(label: &'static str, children: Vec<AnyElement>, cx: &App) -> AnyElement {
    div()
        .px(px(SPACE_LG))
        .flex()
        .flex_col()
        .gap(px(SPACE_SM))
        .child(type_text(t::TEXT_SMALL, label).text_color(cx.sem().role.text_secondary))
        .child(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(SPACE_SM))
                .children(children),
        )
        .into_any_element()
}

/// A person's colour, as `#rrggbb` in the web stories.
pub(super) fn colour(hex: u32) -> Rgba {
    Rgba((hex << 8) | 0xff)
}

/// The stand-in message row: avatar, name and time, then the quote, body and attachments.
fn row(
    id: &'static str,
    author: &'static str,
    hex: u32,
    time: &'static str,
    slots: Vec<AnyElement>,
    _: &App,
) -> AnyElement {
    let mut slots = slots.into_iter();
    let mut row = MessageRow::new(id, author, time).avatar_colour(colour(hex));
    // The web stories' rows: a quote first when there is one, then the body, then attachments.
    let first = slots.next();
    let second = slots.next();
    match (first, second) {
        (Some(body), None) => row = row.body(body),
        (Some(first), Some(second)) => row = row.body(first).attachments(second),
        _ => {}
    }
    row.into_any_element()
}

/// A row whose first slot is a reply quote and second its words.
fn quote_row(
    id: &'static str,
    author: &'static str,
    hex: u32,
    time: &'static str,
    slots: Vec<AnyElement>,
    _: &App,
) -> AnyElement {
    let mut slots = slots.into_iter();
    let mut row = MessageRow::new(id, author, time).avatar_colour(colour(hex));
    if let Some(quote) = slots.next() {
        row = row.quote(quote);
    }
    if let Some(body) = slots.next() {
        row = row.body(body);
    }
    row.into_any_element()
}

/// What a story does with a pressed link: logs it. A story never opens anything.
pub(super) fn log_link(href: &str, _: &mut Window, _: &mut App) {
    eprintln!("story: link pressed: {href}");
}

pub(super) fn words(id: &'static str, text: &'static str) -> AnyElement {
    MessageText::new(id, vec![S::text(text)]).into_any_element()
}

/// A smooth two-colour picture with a dark disc, as the web stories' SVG pictures (BGRA frames).
pub(super) fn picture(width: u32, height: u32, rgb: u32) -> ImageSource {
    let (r, g, b) = ((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8);
    let (cx_, cy_) = (width as f32 / 2., height as f32 / 2.);
    let radius = width.min(height) as f32 / 4.;
    let buffer = RgbaImage::from_fn(width, height, |x, y| {
        let (dx, dy) = (x as f32 - cx_, y as f32 - cy_);
        if dx * dx + dy * dy <= radius * radius {
            image::Rgba([0x14, 0x12, 0x12, 255])
        } else {
            image::Rgba([b, g, r, 255])
        }
    });
    ImageSource::Render(Arc::new(RenderImage::new(vec![Frame::new(buffer)])))
}

/// A picture the decoder refuses: its tile draws the fallback.
fn broken() -> ImageSource {
    ImageSource::Image(Arc::new(Image::from_bytes(
        ImageFormat::Png,
        b"broken".to_vec(),
    )))
}

/// A picture that never arrives: the box stays in its loading state.
fn never_arrives() -> ImageSource {
    ImageSource::Custom(Arc::new(|_, _| None))
}

pub(super) fn parrot() -> ImageSource {
    picture(24, 24, 0x6fd39a)
}

// ---------------------------------------------------------------------------------------------
// MessageText

fn mention(kind: MentionKind, text: &'static str) -> MentionSegment {
    MentionSegment::new(kind, text)
}

fn every() -> Vec<Vec<S>> {
    vec![
        vec![
            S::text("plain, "),
            S::styled("bold", SegmentStyle::BOLD),
            S::text(", "),
            S::styled("italic", SegmentStyle::ITALIC),
            S::text(", "),
            S::styled("struck", SegmentStyle::STRIKE),
            S::text(", "),
            S::styled("all three", SegmentStyle::ALL),
            S::text(" and "),
            S::code("inline code"),
        ],
        vec![
            S::text("mentions: "),
            S::mention(mention(MentionKind::User, "@aiko").id("u1")),
            S::text(" "),
            S::mention(mention(MentionKind::User, "@alexk").id("me").me()),
            S::text(" "),
            S::mention(mention(MentionKind::Role, "@mods").id("r1")),
            S::text(" "),
            S::mention(mention(MentionKind::Everyone, "@everyone").me()),
            S::text(" "),
            S::mention(
                mention(MentionKind::Channel, "#clips")
                    .id("c1")
                    .href("#/c/clips"),
            ),
            S::text(" "),
            S::mention(mention(MentionKind::Channel, "#private-channel").unavailable()),
        ],
        vec![
            S::text("a link: "),
            S::link("https://docs.semaphorechat.app"),
            S::text(", and an unsafe one drawn as text: "),
            S::link("javascript:alert(1)"),
        ],
        vec![
            S::styled("formatted links keep the span: ", SegmentStyle::BOLD),
            S::styled_link("https://docs.semaphorechat.app/guide", SegmentStyle::BOLD),
            S::text(", "),
            S::styled_link("https://example.com/italic", SegmentStyle::ITALIC),
            S::text(", "),
            S::styled_link("https://example.com/gone", SegmentStyle::STRIKE),
        ],
        vec![
            S::text("a lookalike host shows as punycode: "),
            S::link("https://\u{0430}pple.com/login"),
            S::text("; a right-to-left override stays encoded: "),
            S::link("https://example.com/\u{202E}gnp.exe"),
            S::text("; so do spaces: "),
            S::link("https://evil.example/%20%20%20https://bank.example/login"),
            S::text("; a user name in the address is not a link: "),
            S::link("https://aaaaaaaaaaaa.bank.example@evil.example/login"),
        ],
        vec![
            S::text("a mention whose address leaves the app is not a link: "),
            S::mention(
                mention(MentionKind::Channel, "#elsewhere")
                    .id("c9")
                    .href("//evil.example/c"),
            ),
        ],
        vec![
            S::text("custom emoji "),
            S::emoji("partyparrot", Some(parrot())),
            S::text(" and one with no image "),
            S::emoji("gone", None),
        ],
        vec![
            S::text("a code block:"),
            S::code_block("const answer = 42;\nconsole.log(answer);"),
        ],
        vec![S::text("line one\nline two, kept as written\n\nand a gap")],
    ]
}

fn segments_body(_: &mut Window, _: &mut App) -> AnyElement {
    const IDS: [&str; 9] = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
    let mut texts: Vec<AnyElement> = every()
        .into_iter()
        .zip(IDS)
        .map(|(segments, id)| {
            MessageText::new(id, segments)
                .on_link(log_link)
                .on_mention(|_, _, _| {})
                .into_any_element()
        })
        .collect();
    texts.push(
        MessageText::new(
            "long-link",
            vec![
                S::text("a very long link: "),
                S::link("https://example.com/a/very/long/path/that/goes/on/and/on/and/never/breaks/naturally/because/it/has/no/spaces/at/all?with=query&and=more&params=than&anyone=needs"),
            ],
        )
        .on_link(log_link)
        .into_any_element(),
    );
    texts.push(
        MessageText::new(
            "rtl",
            vec![
                S::text("مرحبا بالجميع، هل نلعب الليلة؟ "),
                S::mention(mention(MentionKind::User, "@سارة").id("u5")),
            ],
        )
        .on_mention(|_, _, _| {})
        .into_any_element(),
    );
    texts.push(MessageText::new("emoji-only", vec![S::text("😂🔥👍")]).into_any_element());
    texts.push(
        MessageText::new(
            "parrots",
            vec![
                S::emoji("partyparrot", Some(parrot())),
                S::emoji("partyparrot", Some(parrot())),
            ],
        )
        .into_any_element(),
    );
    chat_column(
        "segments",
        640.,
        vec![
            div()
                .px(px(SPACE_LG))
                .flex()
                .flex_col()
                .gap(px(SPACE_MD))
                .children(texts)
                .into_any_element(),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// ListSeparator

fn separator_body(_: &mut Window, cx: &mut App) -> AnyElement {
    chat_column(
        "separators",
        640.,
        vec![
            ListSeparator::day("yesterday", "Yesterday").into_any_element(),
            row("r1", "kwam3", 0x6fb1f5, "11:58 PM", vec![words("b1", "night all")], cx),
            ListSeparator::day("today", "Today").into_any_element(),
            row("r2", "aiko", 0xff8fb8, "8:19 PM", vec![words("b2", "read this one")], cx),
            ListSeparator::unread("new", "New").into_any_element(),
            row(
                "r3",
                "dropbear",
                0x5fd49a,
                "8:21 PM",
                vec![words("b3", "the first one not read yet")],
                cx,
            ),
            ListSeparator::day(
                "long",
                "Wednesday 11 November 2026, a long day label that has to give way on a narrow phone",
            )
            .into_any_element(),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// ReactionChip

/// The live toggle (`Toggle`): its own view, so a press redraws it.
struct ToggleChip {
    mine: bool,
}

impl Render for ToggleChip {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        ReactionChip::new("toggle", "🎉", "Party", if self.mine { 3 } else { 2 })
            .mine(self.mine)
            .on_toggle(move |_, cx| {
                entity.update(cx, |chip, cx| {
                    chip.mine = !chip.mine;
                    cx.notify();
                })
            })
    }
}

fn reaction_body(window: &mut Window, cx: &mut App) -> AnyElement {
    let chip = |id: &'static str, emoji: &'static str, label: &'static str, count: u64| {
        ReactionChip::new(id, emoji, label, count).on_toggle(|_, _| {})
    };
    let toggle = window.use_keyed_state("toggle-chip", cx, |_, _| ToggleChip { mine: false });
    chat_column(
        "reactions",
        640.,
        vec![
            labelled(
                "Not mine, mine",
                vec![
                    chip("laugh", "😂", "Laugh", 4).into_any_element(),
                    chip("laugh-mine", "😂", "Laugh", 4)
                        .mine(true)
                        .into_any_element(),
                ],
                cx,
            ),
            labelled(
                "Big counts: 999 in full, then compact; the name keeps the exact count",
                vec![
                    chip("fire-999", "🔥", "Fire", 999).into_any_element(),
                    chip("fire-1250", "🔥", "Fire", 1250)
                        .mine(true)
                        .into_any_element(),
                    chip("fire-48213", "🔥", "Fire", 48213).into_any_element(),
                ],
                cx,
            ),
            labelled(
                "Custom emoji, and one whose image is missing",
                vec![
                    chip("parrot", ":partyparrot:", "partyparrot", 7)
                        .src(parrot())
                        .mine(true)
                        .into_any_element(),
                    chip("gone", ":gone:", "gone", 1)
                        .src(broken())
                        .into_any_element(),
                ],
                cx,
            ),
            labelled(
                "Unavailable (no permission to react; a press says why), busy (toggle in flight)",
                vec![
                    chip("thumbs", "👍", "Thumbs up", 2)
                        .unavailable(true)
                        .on_unavailable_press(|_, _| {})
                        .into_any_element(),
                    chip("thumbs-busy", "👍", "Thumbs up", 3)
                        .mine(true)
                        .busy(true)
                        .into_any_element(),
                ],
                cx,
            ),
            labelled("Press to toggle", vec![toggle.into_any_element()], cx),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// MessageQuote

fn quote_body(_: &mut Window, cx: &mut App) -> AnyElement {
    chat_column(
        "quotes",
        390.,
        vec![
            quote_row(
                "q1",
                "dropbear",
                0x5fd49a,
                "8:21 PM",
                vec![
                    MessageQuote::new("q1-quote", "kwam3", "ok that run was cursed, same time tomorrow?")
                        .on_open(|_, _| {})
                        .into_any_element(),
                    words("q1-body", "yes, 9 sharp"),
                ],
                cx,
            ),
            quote_row(
                "q2",
                "aiko",
                0xff8fb8,
                "8:22 PM",
                vec![
                    MessageQuote::new(
                        "q2-quote",
                        "a display name that is much too long for a phone column",
                        "and a line that is also far too long to fit on one line of a narrow phone column, so it gives way",
                    )
                    .on_open(|_, _| {})
                    .into_any_element(),
                    words("q2-body", "long author, long line"),
                ],
                cx,
            ),
            quote_row(
                "q3",
                "gracie",
                0xffa366,
                "8:23 PM",
                vec![
                    MessageQuote::new("q3-quote", "kwam3", "")
                        .deleted(true)
                        .into_any_element(),
                    words("q3-body", "replying to a message that is gone"),
                ],
                cx,
            ),
            quote_row(
                "q4",
                "gracie",
                0xffa366,
                "8:24 PM",
                vec![
                    MessageQuote::new("q4-quote", "kwam3", "no way to open this one").into_any_element(),
                    words("q4-body", "a plain quote (nothing to open)"),
                ],
                cx,
            ),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// TypingLine

fn typing_body(_: &mut Window, cx: &mut App) -> AnyElement {
    let line = |label: &'static str, names: Vec<&'static str>, cx: &App| {
        labelled(
            label,
            vec![
                div()
                    .w_full()
                    .child(TypingLine::new(names))
                    .into_any_element(),
            ],
            cx,
        )
    };
    chat_column(
        "typing",
        390.,
        vec![
            line("One", vec!["aiko"], cx),
            line("Two", vec!["aiko", "dropbear"], cx),
            line("Many", vec!["aiko", "dropbear", "gracie", "kwam3"], cx),
            line(
                "A long name gives way",
                vec![
                    "a display name that is much too long for a phone column to show",
                    "dropbear",
                ],
                cx,
            ),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// JumpToLatest

fn region(id: &'static str, jump: JumpToLatest, cx: &App) -> AnyElement {
    chat_column(
        id,
        360.,
        vec![
            div()
                .relative()
                .h(px(220.))
                .overflow_hidden()
                .child(row(
                    "j1",
                    "aiko",
                    0xff8fb8,
                    "8:19 PM",
                    vec![words("j1b", "scrolled up a little")],
                    cx,
                ))
                .child(row(
                    "j2",
                    "dropbear",
                    0x5fd49a,
                    "8:21 PM",
                    vec![words("j2b", "the newest are further down")],
                    cx,
                ))
                .child(row(
                    "j3",
                    "gracie",
                    0xffa366,
                    "8:22 PM",
                    vec![words("j3b", "the control floats over the rows")],
                    cx,
                ))
                .child(jump)
                .into_any_element(),
        ],
    )
}

fn jump_body(_: &mut Window, cx: &mut App) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_LG))
        .child(labelled(
            "Plain",
            vec![region(
                "plain",
                JumpToLatest::new("jump-plain", |_, _| {}),
                cx,
            )],
            cx,
        ))
        .child(labelled(
            "With a count",
            vec![region(
                "count",
                JumpToLatest::new("jump-count", |_, _| {}).new_count(3),
                cx,
            )],
            cx,
        ))
        .child(labelled(
            "Over 99",
            vec![region(
                "over",
                JumpToLatest::new("jump-over", |_, _| {}).new_count(240),
                cx,
            )],
            cx,
        ))
        .child(labelled(
            "Busy (loading the latest)",
            vec![region(
                "busy",
                JumpToLatest::new("jump-busy", |_, _| {}).busy(true),
                cx,
            )],
            cx,
        ))
        .into_any_element()
}

// ---------------------------------------------------------------------------------------------
// LinkCard

pub(super) fn stack(children: Vec<AnyElement>) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .items_start()
        .gap(px(SPACE_SM))
        .children(children)
        .into_any_element()
}

fn link_card_body(_: &mut Window, cx: &mut App) -> AnyElement {
    chat_column(
        "cards",
        390.,
        vec![
            row(
                "l1",
                "aiko",
                0xff8fb8,
                "8:19 PM",
                vec![
                    words("l1b", "https://trailheads.example/routes/ridge-loop"),
                    LinkCard::new("ridge", "https://trailheads.example/routes/ridge-loop", "Trailheads · Aiko Tanaka")
.on_link(log_link)
                        .title("The ridge loop, in late autumn")
                        .description("Eleven kilometres, one steep climb and the best view of the valley before the snow comes in.")
                        .image(picture(1200, 630, 0x6fb1f5))
                        .icon(picture(32, 32, 0xffa366))
                        .into_any_element(),
                ],
                cx,
            ),
            row(
                "l2",
                "dropbear",
                0x5fd49a,
                "8:20 PM",
                vec![
                    words("l2b", "no picture, no icon; a long title and summary cut at two lines"),
                    stack(vec![
                        LinkCard::new("news", "https://news.example.org/a", "news.example.org")
.on_link(log_link)
                            .title("A very long title that keeps going well past the second line so it has to give way with an ellipsis at phone width")
                            .description("And a summary that is just as long, written to show that it also stops after two lines however much the page says about itself.")
                            .into_any_element(),
                        LinkCard::new("bare", "https://example.com/", "example.com").on_link(log_link).into_any_element(),
                    ]),
                ],
                cx,
            ),
            row(
                "l3",
                "kwam3",
                0x6fb1f5,
                "8:21 PM",
                vec![
                    words("l3b", "a picture that is still loading, one that failed, and an address the kit will not open"),
                    stack(vec![
                        LinkCard::new("slow", "https://slow.example/", "slow.example")
.on_link(log_link)
                            .title("Its picture arrives late")
                            .image(never_arrives())
                            .into_any_element(),
                        LinkCard::new("broken", "https://broken.example/", "broken.example")
.on_link(log_link)
                            .title("Broken picture and icon")
                            .image(broken())
                            .icon(broken())
                            .into_any_element(),
                        LinkCard::new("refused", "https://bank.example@evil.example/", "bank.example")
.on_link(log_link)
                            .title("Drawn, but not a link")
                            .into_any_element(),
                    ]),
                ],
                cx,
            ),
        ],
    )
}

// ---------------------------------------------------------------------------------------------
// AttachmentTile

fn tile(id: &'static str, kind: AttachmentKind, name: &'static str) -> AttachmentTile {
    AttachmentTile::new(id, kind, name).on_open(|_, _| {})
}

fn row_of(children: Vec<AnyElement>) -> AnyElement {
    div()
        .flex()
        .gap(px(SPACE_SM))
        .children(children)
        .into_any_element()
}

fn attachment_body(_: &mut Window, cx: &mut App) -> AnyElement {
    use AttachmentKind::{File, Image};
    chat_column(
        "tiles",
        390.,
        vec![
            row(
                "a1",
                "aiko",
                0xff8fb8,
                "8:19 PM",
                vec![
                    words("a1b", "a wide picture, shrunk to fit its box"),
                    tile("sunset", Image, "sunset.png")
                        .src(picture(1600, 900, 0xffa366))
                        .size(1600., 900.)
                        .into_any_element(),
                ],
                cx,
            ),
            row(
                "a2",
                "aiko",
                0xff8fb8,
                "8:20 PM",
                vec![
                    words(
                        "a2b",
                        "a tall one, and one still loading (its box is already the right size)",
                    ),
                    row_of(vec![
                        tile("tall", Image, "tall.png")
                            .src(picture(600, 1200, 0x6fb1f5))
                            .size(600., 1200.)
                            .into_any_element(),
                        tile("loading", Image, "loading.png")
                            .size(600., 1200.)
                            .into_any_element(),
                    ]),
                ],
                cx,
            ),
            row(
                "a3",
                "dropbear",
                0x5fd49a,
                "8:21 PM",
                vec![
                    words("a3b", "size unknown, a broken picture, and opening"),
                    stack(vec![
                        tile("no-size", Image, "no-size.jpg")
                            .src(picture(300, 300, 0x5fd49a))
                            .into_any_element(),
                        tile("broken", Image, "broken-picture-with-a-long-name.webp")
                            .src(broken())
                            .size(400., 300.)
                            .into_any_element(),
                        tile("opening", Image, "opening.png")
                            .src(picture(400, 300, 0xff8fb8))
                            .size(400., 300.)
                            .busy(true)
                            .into_any_element(),
                    ]),
                ],
                cx,
            ),
            row(
                "a4",
                "kwam3",
                0x6fb1f5,
                "8:21 PM",
                vec![
                    words(
                        "a4b",
                        "extreme shapes: a 4000×10 strip and a 10×4000 pole, letterboxed in boxes no side under 48 px",
                    ),
                    stack(vec![
                        tile("strip", Image, "strip.png")
                            .src(picture(4000, 10, 0xffa366))
                            .size(4000., 10.)
                            .into_any_element(),
                        tile("pole", Image, "pole.png")
                            .src(picture(10, 4000, 0x5fd49a))
                            .size(10., 4000.)
                            .into_any_element(),
                    ]),
                ],
                cx,
            ),
            row(
                "a5",
                "gracie",
                0xffa366,
                "8:22 PM",
                vec![
                    words("a5b", "files: a short one, a long name, one downloading"),
                    stack(vec![
                        tile("notes", File, "notes.txt")
                            .detail("2.1 KB")
                            .into_any_element(),
                        tile(
                            "long-file",
                            File,
                            "a-very-long-recording-name-from-last-night-that-will-not-fit.mp3",
                        )
                        .detail("38.4 MB")
                        .into_any_element(),
                        tile("clip", File, "clip.mp4")
                            .detail("120 MB")
                            .busy(true)
                            .into_any_element(),
                    ]),
                ],
                cx,
            ),
            row(
                "a6",
                "me",
                0x8e75ff,
                "8:23 PM",
                vec![
                    words(
                        "a6b",
                        "sent, its files still on their way: uploading, failed with Retry, a picture uploading",
                    ),
                    stack(vec![
                        AttachmentTile::new("up-recording", File, "recording.mp3")
                            .detail("38.4 MB")
                            .progress(42.)
                            .on_remove(|_, _| {})
                            .into_any_element(),
                        AttachmentTile::new("up-too-big", File, "too-big.zip")
                            .detail("2 GB")
                            .error("Upload failed: File too large")
                            .on_retry(|_, _| {})
                            .on_remove(|_, _| {})
                            .into_any_element(),
                        AttachmentTile::new("up-sunset", File, "sunset.png")
                            .detail("1.2 MB")
                            .src(picture(1600, 900, 0xffa366))
                            .progress(90.)
                            .into_any_element(),
                    ]),
                ],
                cx,
            ),
        ],
    )
}

/// A stand-in player in its slot: the still's colour, Play and a progress bar, as a real player's
/// controls would sit.
fn fake_player(id: &'static str, rgb: u32) -> impl FnOnce(PlayerSlot) -> AnyElement {
    move |slot| {
        let ink = hsla(0., 0., 1., 0.9);
        let colour = Rgba((rgb << 8) | 0xff);
        div()
            .size_full()
            .rounded(slot.radius)
            .bg(crate::theme::color::hsla_of(colour))
            .flex()
            .flex_col()
            .justify_end()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_SM))
                    .px(px(SPACE_SM))
                    .h(px(t::CONTROL_SM))
                    .bg(hsla(0., 0., 0., 0.45))
                    .rounded(px(RADIUS_FULL))
                    .m(px(SPACE_XS))
                    .child(Icon::lounge(LoungeIcon::Play).size(t::ICON_SM).color(ink))
                    .child(
                        div()
                            .flex_1()
                            .child(LinearProgress::new(id, Some(30.), "Playing")),
                    ),
            )
            .into_any_element()
    }
}

fn media_body(_: &mut Window, cx: &mut App) -> AnyElement {
    use AttachmentKind::{Audio, Image, Video};
    chat_column(
        "media",
        390.,
        vec![
            row(
                "m1",
                "gracie",
                0xffa366,
                "8:24 PM",
                vec![
                    words(
                        "m1b",
                        "a video with its still, one without, and one asking for its address",
                    ),
                    stack(vec![
                        tile("clip", Video, "clip.mp4")
                            .detail("12 MB")
                            .poster(picture(1920, 1080, 0x6fb1f5))
                            .size(1920., 1080.)
                            .into_any_element(),
                        row_of(vec![
                            tile("phone", Video, "phone.mov")
                                .detail("30 MB")
                                .size(1080., 1920.)
                                .into_any_element(),
                            tile("loading", Video, "loading.mp4")
                                .detail("30 MB")
                                .poster(picture(1080, 1920, 0x5fd49a))
                                .size(1080., 1920.)
                                .busy(true)
                                .into_any_element(),
                        ]),
                    ]),
                ],
                cx,
            ),
            row(
                "m2",
                "gracie",
                0xffa366,
                "8:25 PM",
                vec![
                    words(
                        "m2b",
                        "audio: ready, asking, and playing (a long name gives way)",
                    ),
                    stack(vec![
                        tile("voice", Audio, "voice-note.ogg")
                            .detail("420 KB")
                            .into_any_element(),
                        tile("asking", Audio, "loading.mp3")
                            .detail("4 MB")
                            .busy(true)
                            .into_any_element(),
                        tile(
                            "playing-audio",
                            Audio,
                            "a-very-long-recording-name-from-last-night-that-will-not-fit.mp3",
                        )
                        .detail("38.4 MB")
                        .player(fake_player("audio-progress", 0x2a2a35))
                        .into_any_element(),
                    ]),
                ],
                cx,
            ),
            row(
                "m3",
                "dropbear",
                0x5fd49a,
                "8:26 PM",
                vec![
                    words("m3b", "a video playing in its box"),
                    tile("playing", Video, "playing.mp4")
                        .detail("1 MB")
                        .poster(picture(1280, 720, 0xff8fb8))
                        .size(1280., 720.)
                        .player(fake_player("video-progress", 0xff8fb8))
                        .into_any_element(),
                ],
                cx,
            ),
            row(
                "m4",
                "kwam3",
                0x6fb1f5,
                "8:27 PM",
                vec![
                    tile("gif", Image, "GIF")
                        .src(picture(480, 270, 0xffa366))
                        .remote(true)
                        .into_any_element(),
                ],
                cx,
            ),
        ],
    )
}

/// Press Play: the screen gives the player at once and the tile becomes it.
struct PressToPlay {
    video: bool,
    audio: bool,
}

impl Render for PressToPlay {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        let (video_entity, audio_entity) = (entity.clone(), entity);
        let mut video = AttachmentTile::new("press-video", AttachmentKind::Video, "clip.mp4")
            .detail("1 MB")
            .size(1280., 720.)
            .on_open(move |_, cx| {
                video_entity.update(cx, |story, cx| {
                    story.video = true;
                    cx.notify();
                })
            });
        if self.video {
            video = video.player(fake_player("press-video-progress", 0x6fb1f5));
        }
        let mut audio = AttachmentTile::new("press-audio", AttachmentKind::Audio, "note.wav")
            .detail("1 KB")
            .on_open(move |_, cx| {
                audio_entity.update(cx, |story, cx| {
                    story.audio = true;
                    cx.notify();
                })
            });
        if self.audio {
            audio = audio.player(fake_player("press-audio-progress", 0x2a2a35));
        }
        div()
            .id("press-to-play")
            .size_full()
            .bg(cx.sem().role.ground)
            .p(px(LAYOUT_GUTTER))
            .child(chat_column(
                "press",
                390.,
                vec![
                    div()
                        .px(px(SPACE_LG))
                        .child(stack(vec![
                            video.into_any_element(),
                            audio.into_any_element(),
                        ]))
                        .into_any_element(),
                ],
            ))
    }
}

pub fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $palette:expr, $body:expr) => {
            Story::new($name, |_, _, cx| view($palette, $body, cx))
        };
    }
    use Palette::{Dark, Light, Tinted};
    vec![
        story!("kit-message-text-segments", Dark, segments_body),
        story!("kit-message-text-segments-light", Light, segments_body),
        story!("kit-message-text-segments-tinted", Tinted, segments_body),
        story!("kit-list-separator-variants", Dark, separator_body),
        story!("kit-list-separator-variants-light", Light, separator_body),
        story!("kit-list-separator-variants-tinted", Tinted, separator_body),
        story!("kit-reaction-chip-states", Dark, reaction_body),
        story!("kit-reaction-chip-states-light", Light, reaction_body),
        story!("kit-reaction-chip-states-tinted", Tinted, reaction_body),
        story!("kit-message-quote-states", Dark, quote_body),
        story!("kit-message-quote-states-light", Light, quote_body),
        story!("kit-message-quote-states-tinted", Tinted, quote_body),
        story!("kit-typing-line-states", Dark, typing_body),
        story!("kit-typing-line-states-light", Light, typing_body),
        story!("kit-typing-line-states-tinted", Tinted, typing_body),
        story!("kit-jump-to-latest-states", Dark, jump_body),
        story!("kit-jump-to-latest-states-light", Light, jump_body),
        story!("kit-jump-to-latest-states-tinted", Tinted, jump_body),
        story!("kit-link-card-states", Dark, link_card_body),
        story!("kit-link-card-states-light", Light, link_card_body),
        story!("kit-link-card-states-tinted", Tinted, link_card_body),
        story!("kit-attachment-tile-states", Dark, attachment_body),
        story!("kit-attachment-tile-states-light", Light, attachment_body),
        story!("kit-attachment-tile-states-tinted", Tinted, attachment_body),
        story!("kit-attachment-tile-media-states", Dark, media_body),
        story!("kit-attachment-tile-media-states-light", Light, media_body),
        Story::new("kit-attachment-tile-press-to-play", |_, _, cx| {
            theme::apply(Palette::Dark.input(), cx);
            cx.new(|_| PressToPlay {
                video: false,
                audio: false,
            })
            .into()
        }),
    ]
}
