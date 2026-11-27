//! The chat pieces: what MessageText draws as a link, a mention or text (and what it refuses),
//! what each piece is named, what a press does in each state, and the boxes attachments get.
//! The pure rules behind them are tested in `semaphore_design::chat_tests` and
//! `semaphore_core::links`.

use super::attachment::tile_name;
use super::link_card::{allowed_picture, card_name};
use super::quote::{DELETED_LINE, quote_name};
use super::reaction::is_context_menu_key;
use super::text::{Block, PieceKind, plan, spoken};
use super::*;
use crate::dms::rig::{Rig, rig};
use crate::kit::{ListSeparator, Surface, SurfaceScope};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

type Log = Rc<RefCell<Vec<String>>>;
type Body = Box<dyn Fn(&Log, &mut Window, &mut App) -> AnyElement>;

struct Host {
    body: Body,
    log: Log,
}

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_start()
            .child(SurfaceScope::new(
                Surface::Surface,
                (self.body)(&self.log, window, cx),
            ))
    }
}

fn host(
    cx: &mut TestAppContext,
    body: impl Fn(&Log, &mut Window, &mut App) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, _| Host {
        body: Box::new(body),
        log: shared,
    });
    (rig, log)
}

fn note(log: &Log, line: &str) -> impl Fn(&mut Window, &mut App) + 'static {
    let log = log.clone();
    let line = line.to_owned();
    move |_, _| log.borrow_mut().push(line.clone())
}

/// An `on_link` that logs the address it is handed.
fn link_log(log: &Log) -> impl Fn(&str, &mut Window, &mut App) + 'static {
    let log = log.clone();
    move |href, _, _| log.borrow_mut().push(format!("link {href}"))
}

fn logged(log: &Log) -> Vec<String> {
    log.borrow().clone()
}

/// Moves focus as Tab does until the element named `label` has it, then presses `key`.
fn press_on(rig: &Rig<Host, ()>, cx: &mut TestAppContext, label: &str, key: &str) {
    let label = label.to_owned();
    for _ in 0..40 {
        let focused = rig.with(cx, |_, window, _| {
            window
                .try_find_by_label(&label)
                .and_then(|node| node.focused())
                == Some(true)
        });
        if focused {
            let key = key.to_owned();
            rig.with(cx, move |_, window, cx| window.press(&key, cx));
            return;
        }
        rig.with(cx, |_, window, cx| {
            window.activate_window();
            window.focus_next(cx);
        });
    }
    panic!("Tab never reached {label:?}");
}

// ---------------------------------------------------------------------------------------------
// MessageText: the plan

type S = MessageSegment;

fn inline(segments: &[S]) -> (String, Vec<PieceKind>) {
    match plan(segments).as_slice() {
        [Block::Inline { text, pieces }] => (
            text.clone(),
            pieces.iter().map(|p| p.kind.clone()).collect(),
        ),
        other => panic!("not one paragraph: {other:?}"),
    }
}

#[test]
fn a_link_shows_its_parsed_address_and_opens_that() {
    let (text, kinds) = inline(&[S::link("https://\u{0430}pple.com/login")]);
    // Drawn in a left-to-right isolate, so nothing around it can reorder it.
    assert_eq!(text, "\u{2066}https://xn--pple-43d.com/login\u{2069}");
    assert_eq!(
        kinds,
        [PieceKind::Link {
            href: "https://xn--pple-43d.com/login".into(),
            style: SegmentStyle::default()
        }]
    );
    let (text, _) = inline(&[S::link("https://example.com/\u{202E}gnp.exe")]);
    assert_eq!(text, "\u{2066}https://example.com/%E2%80%AEgnp.exe\u{2069}");
}

#[test]
fn an_unsafe_or_spoofing_address_is_text_without_its_bidi_controls() {
    for href in [
        "javascript:\u{202E}alert(1)",
        "https://aaaaaaaaaaaa.bank.example@evil.example/login",
        "https://user:pass@evil.example/",
        "data:text/html,x",
    ] {
        let (text, kinds) = inline(&[S::styled_link(href, SegmentStyle::BOLD)]);
        assert_eq!(text, href.replace('\u{202E}', ""), "{href:?}");
        assert_eq!(
            kinds,
            [PieceKind::RefusedLink(SegmentStyle::BOLD)],
            "{href:?}"
        );
    }
}

#[test]
fn a_formatted_link_keeps_its_span() {
    let (_, kinds) = inline(&[S::styled_link("https://example.com/b", SegmentStyle::ALL)]);
    assert!(matches!(&kinds[0], PieceKind::Link { style, .. } if *style == SegmentStyle::ALL));
}

#[test]
fn a_code_block_stands_alone_between_paragraphs() {
    let blocks = plan(&[
        S::text("a code block:"),
        S::code_block("let a = 1;\nlet b = 2;"),
        S::text("after"),
    ]);
    assert_eq!(blocks.len(), 3);
    assert!(matches!(&blocks[0], Block::Inline { text, .. } if text == "a code block:"));
    assert_eq!(blocks[1], Block::Code("let a = 1;\nlet b = 2;".into()));
    assert!(matches!(&blocks[2], Block::Inline { text, .. } if text == "after"));
    // Nothing but a block: no empty paragraph around it.
    assert_eq!(plan(&[S::code_block("x")]), [Block::Code("x".into())]);
    assert!(plan(&[]).is_empty());
    assert!(plan(&[S::text("")]).is_empty());
}

/// The list's selection maps display bytes to the words as drawn through `shown_len`: it must
/// agree with what the plan lays out, block by block.
#[test]
fn shown_lengths_add_up_to_the_planned_blocks() {
    let segments = [
        S::text("see "),
        S::link("https://\u{0430}pple.com/"),
        S::link("javascript:alert(1)\u{202E}"),
        S::code("x"),
        S::emoji("party", None),
        S::code_block("let a = 1;"),
        S::mention(MentionSegment::new(MentionKind::User, "@sam")),
        S::text(""),
    ];
    let blocks = super::text::plan_with(&segments, true);
    let planned: usize = blocks
        .iter()
        .map(|block| match block {
            Block::Inline { text, .. } => text.len(),
            Block::Code(code) => code.len(),
        })
        .sum();
    let shown: usize = segments.iter().map(super::text::shown_len).sum();
    assert_eq!(planned, shown);
    let mention = super::text::shown_len(&segments[6]);
    assert_eq!(
        mention,
        "@sam".len() + 12,
        "in a left-to-right isolate, between its two pads"
    );
    assert_eq!(
        super::text::block_starts(&blocks),
        [0, planned - mention - "let a = 1;".len(), planned - mention]
    );
}

#[test]
fn an_emoji_without_a_picture_is_its_shortcode() {
    let (text, kinds) = inline(&[S::emoji("gone", None)]);
    assert_eq!(
        (text.as_str(), kinds.as_slice()),
        (":gone:", [PieceKind::Shortcode].as_slice())
    );
    let picture = ImageSource::Custom(std::sync::Arc::new(|_: &mut Window, _: &mut App| None));
    let (text, kinds) = inline(&[S::text("a "), S::emoji("parrot", Some(picture))]);
    assert_eq!(
        text,
        format!("a {}", semaphore_core::text::EMOJI_PLACEHOLDER)
    );
    assert_eq!(kinds[1], PieceKind::Emoji(1));
}

#[test]
fn ranges_cover_the_text_in_order() {
    let segments = [
        S::text("hi "),
        S::mention(MentionSegment::new(MentionKind::User, "@aiko")),
        S::text(" see "),
        S::code("x"),
        S::link("https://example.com"),
    ];
    let blocks = plan(&segments);
    let [Block::Inline { text, pieces }] = blocks.as_slice() else {
        panic!("one paragraph");
    };
    let mut at = 0;
    for piece in pieces {
        assert_eq!(piece.range.start, at);
        at = piece.range.end;
    }
    assert_eq!(at, text.len());
    assert_eq!(
        text,
        "hi \u{2066}\u{200A}@aiko\u{200A}\u{2069} see x\u{2066}https://example.com/\u{2069}"
    );
}

#[test]
fn a_screen_reader_hears_who_a_mention_means_and_what_it_cannot_open() {
    let segments = [
        S::text("hey "),
        S::mention(MentionSegment::new(MentionKind::User, "@alexk").me()),
        S::text(" and "),
        S::mention(MentionSegment::new(MentionKind::Everyone, "@everyone").me()),
        S::text(" in "),
        S::mention(MentionSegment::new(MentionKind::Channel, "#clips").me()),
        S::text(" not "),
        S::mention(MentionSegment::new(MentionKind::Channel, "#secret").unavailable()),
        S::text(" "),
        S::emoji("parrot", None),
        S::text(" "),
        S::link("https://user@evil.example/"),
    ];
    assert_eq!(
        spoken(&segments),
        "hey @alexk, mentions you and @everyone, mentions you in #clips not #secret (not available to you) :parrot: https://user@evil.example/"
    );
}

#[test]
fn only_a_user_mention_or_an_in_app_address_is_pressable() {
    let user = MentionSegment::new(MentionKind::User, "@aiko");
    assert!(user.is_interactive(true));
    assert!(!user.is_interactive(false), "no handler, nothing to do");
    assert!(!user.clone().unavailable().is_interactive(true));
    let channel = MentionSegment::new(MentionKind::Channel, "#clips");
    assert!(!channel.is_interactive(true), "no address");
    assert!(channel.clone().href("#/c/clips").is_interactive(true));
    assert!(channel.clone().href("/c/clips").is_interactive(true));
    for outside in [
        "//evil.example/c",
        "https://evil.example",
        "/a/../b",
        "javascript:x",
    ] {
        assert!(
            !channel.clone().href(outside).is_interactive(true),
            "{outside:?}"
        );
    }
    assert!(!MentionSegment::new(MentionKind::Role, "@mods").is_interactive(true));
}

// ---------------------------------------------------------------------------------------------
// MessageText: drawn

fn every_kind() -> Vec<S> {
    vec![
        S::text("see "),
        S::link("https://docs.semaphorechat.app"),
        S::text(" or "),
        S::link("https://bank.example@evil.example/"),
        S::text(", ask "),
        S::mention(MentionSegment::new(MentionKind::User, "@aiko").id("u1")),
        S::text(" in "),
        S::mention(
            MentionSegment::new(MentionKind::Channel, "#clips")
                .id("c1")
                .href("#/c/clips"),
        ),
        S::text(", not "),
        S::mention(
            MentionSegment::new(MentionKind::Channel, "#elsewhere")
                .id("c9")
                .href("//evil.example/c"),
        ),
        S::text(" or "),
        S::mention(MentionSegment::new(MentionKind::Channel, "#secret").unavailable()),
    ]
}

#[gpui_kit::test]
fn each_link_and_pressable_mention_is_its_own_named_node(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |log, _, _| {
        let log = log.clone();
        MessageText::new("words", every_kind())
            .on_link(link_log(&log))
            .on_mention(move |mention, _, _| log.borrow_mut().push(mention.text.to_string()))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let words = window.find("words");
        assert_eq!(words.role(), Some(Role::Paragraph));
        assert!(
            words
                .label()
                .unwrap()
                .starts_with("see https://docs.semaphorechat.app/ or ")
        );
        assert_eq!(
            window
                .find_by_label("https://docs.semaphorechat.app/")
                .role(),
            Some(Role::Link)
        );
        assert_eq!(window.find_by_label("@aiko").role(), Some(Role::Button));
        assert_eq!(window.find_by_label("#clips").role(), Some(Role::Link));
        // Not links: the spoofing address, the outside mention, the unavailable one.
        assert!(
            window
                .try_find_by_label("https://bank.example@evil.example/")
                .is_none()
        );
        assert!(window.try_find_by_label("#elsewhere").is_none());
        assert!(
            window
                .try_find_by_label("#secret (not available to you)")
                .is_none()
        );
        assert_eq!(window.find_all_by_role(Role::Link).len(), 2);
    });
}

#[gpui_kit::test]
fn a_node_sits_over_its_words(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |log, _, _| {
        MessageText::new(
            "words",
            vec![S::text("see "), S::link("https://example.com/")],
        )
        .on_link(link_log(log))
        .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let words = window.find("words").bounds();
        let link = window.find_by_label("https://example.com/").bounds();
        assert!(link.size.width > px(40.), "{link:?}");
        assert!(
            link.left() > words.left(),
            "after \"see \": {link:?} in {words:?}"
        );
        assert!(words.contains(&link.center()), "{link:?} in {words:?}");
    });
}

#[gpui_kit::test]
fn enter_on_a_link_hands_over_the_parsed_address(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        MessageText::new(
            "words",
            vec![S::text("go to "), S::link("https://\u{0430}pple.com/login")],
        )
        .on_link(link_log(log))
        .into_any_element()
    });
    press_on(&rig, cx, "https://xn--pple-43d.com/login", "enter");
    assert_eq!(logged(&log), ["link https://xn--pple-43d.com/login"]);
    assert_eq!(cx.opened_url(), None, "the kit never opens anything itself");
}

#[gpui_kit::test]
fn a_click_on_a_link_hands_it_over(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        MessageText::new(
            "words",
            vec![S::text("go to "), S::link("https://example.com/a")],
        )
        .on_link(link_log(log))
        .into_any_element()
    });
    rig.with(cx, |_, window, cx| {
        let link = window.find_by_label("https://example.com/a").bounds();
        let words = window.find("words").bounds();
        let offset = link.center() - words.origin;
        window.click_at("words", offset, cx);
    });
    assert_eq!(logged(&log), ["link https://example.com/a"]);
    assert_eq!(cx.opened_url(), None);
}

#[gpui_kit::test]
fn a_click_beside_a_link_opens_nothing(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        MessageText::new(
            "words",
            vec![
                S::text("plain words first "),
                S::link("https://example.com/a"),
            ],
        )
        .on_link(link_log(log))
        .into_any_element()
    });
    rig.with(cx, |_, window, cx| {
        window.click_at("words", point(px(4.), px(4.)), cx)
    });
    assert!(logged(&log).is_empty());
}

#[gpui_kit::test]
fn without_a_link_handler_a_link_is_drawn_but_not_pressable(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        MessageText::new(
            "words",
            vec![S::text("go to "), S::link("https://example.com/a")],
        )
        .into_any_element()
    });
    rig.with(cx, |_, window, cx| {
        assert!(window.try_find_by_label("https://example.com/a").is_none());
        assert!(window.find_all_by_role(Role::Link).is_empty());
        let words = window.find("words").bounds();
        window.click_at("words", point(words.size.width - px(8.), px(8.)), cx);
    });
    assert_eq!(cx.opened_url(), None);
}

#[gpui_kit::test]
fn a_user_mention_with_an_outside_address_is_a_button_and_loses_the_address(
    cx: &mut TestAppContext,
) {
    let (rig, log) = host(cx, |log, _, _| {
        let log = log.clone();
        MessageText::new(
            "words",
            vec![
                S::text("hi "),
                S::mention(
                    MentionSegment::new(MentionKind::User, "@aiko")
                        .id("u1")
                        .href("//evil.example/u"),
                ),
                S::text(" and "),
                S::mention(
                    MentionSegment::new(MentionKind::User, "@gracie")
                        .id("u2")
                        .href("#/u/u2"),
                ),
            ],
        )
        .on_mention(move |mention, _, _| {
            log.borrow_mut()
                .push(format!("{} {:?}", mention.text, mention.href))
        })
        .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find_by_label("@aiko").role(), Some(Role::Button));
        assert_eq!(window.find_by_label("@gracie").role(), Some(Role::Link));
    });
    press_on(&rig, cx, "@aiko", "enter");
    press_on(&rig, cx, "@gracie", "enter");
    assert_eq!(logged(&log), ["@aiko None", "@gracie Some(\"#/u/u2\")"]);
}

#[test]
fn a_followed_mention_keeps_only_an_in_app_address() {
    let mention =
        |href: &str| MentionSegment::new(MentionKind::Channel, "#c").href(href.to_owned());
    assert_eq!(
        mention("#/c/clips").followed().href.as_deref(),
        Some("#/c/clips")
    );
    assert_eq!(
        mention("/c/señor").followed().href.as_deref(),
        Some("/c/señor")
    );
    for outside in ["//evil.example", "https://evil.example", "/a/../b", "/\\x"] {
        assert_eq!(mention(outside).followed().href, None, "{outside:?}");
    }
}

#[gpui_kit::test]
fn pressing_a_mention_hands_it_back(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        let log = log.clone();
        MessageText::new("words", every_kind())
            .on_link(link_log(&log))
            .on_mention(move |mention, _, _| {
                log.borrow_mut()
                    .push(format!("{} {:?}", mention.text, mention.id))
            })
            .into_any_element()
    });
    press_on(&rig, cx, "@aiko", "enter");
    press_on(&rig, cx, "#clips", "space");
    assert_eq!(logged(&log), ["@aiko Some(\"u1\")", "#clips Some(\"c1\")"]);
}

#[gpui_kit::test]
fn without_handlers_nothing_is_pressable(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        MessageText::new("words", every_kind()).into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("@aiko").is_none());
        assert!(window.try_find_by_label("#clips").is_none());
        assert!(window.find_all_by_role(Role::Link).is_empty());
    });
}

#[gpui_kit::test]
fn a_code_block_is_drawn_below_the_words(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        MessageText::new(
            "words",
            vec![
                S::text("before"),
                S::code_block("one\ntwo\nthree"),
                S::text("after"),
            ],
        )
        .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let height = window.find("words").bounds().size.height;
        // Three lines of code plus two of text: well over three body lines.
        assert!(
            height > px(semaphore_design::lounge::TEXT_BODY.line_height * 4.),
            "{height:?}"
        );
    });
}

// ---------------------------------------------------------------------------------------------
// ListSeparator

#[gpui_kit::test]
fn a_separator_is_named_by_its_label(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        div()
            .w(px(400.))
            .child(ListSeparator::day("today", "Today"))
            .child(ListSeparator::unread("new", "New"))
            .child(ListSeparator::day(
                "long",
                "Wednesday 11 November 2026, a long day label that has to give way on a narrow phone",
            ))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        for (id, label) in [("today", "Today"), ("new", "New")] {
            let node = window.find(id);
            assert_eq!(node.role(), Some(Role::Splitter));
            assert_eq!(node.label(), Some(label));
        }
        // A long label gives way: one line, the row as wide as its column.
        let long = window.find("long").bounds();
        let today = window.find("today").bounds();
        assert_eq!(long.size.height, today.size.height);
        assert!(long.size.width <= px(400.));
    });
}

// ---------------------------------------------------------------------------------------------
// ReactionChip

#[gpui_kit::test]
fn a_chip_is_named_with_its_exact_count_and_toggles(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        div()
            .flex()
            .child(ReactionChip::new("fire", "🔥", "Fire", 1250).on_toggle(note(log, "toggle")))
            .child(
                ReactionChip::new("laugh", "😂", "Laugh", 4)
                    .mine(true)
                    .on_toggle(note(log, "mine")),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find("fire").label(), Some("Fire reaction, 1250"));
        assert_eq!(
            window.find("laugh").checked(),
            Some(true),
            "pressed when mine"
        );
        assert_eq!(window.find("fire").checked(), Some(false));
    });
    rig.click(cx, "fire");
    rig.click(cx, "laugh");
    assert_eq!(logged(&log), ["toggle", "mine"]);
}

#[gpui_kit::test]
fn a_busy_chip_ignores_presses_and_says_so(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        ReactionChip::new("busy", "👍", "Thumbs up", 3)
            .busy(true)
            .on_toggle(note(log, "toggle"))
            .on_unavailable_press(note(log, "why"))
            .into_any_element()
    });
    rig.click(cx, "busy");
    press_on(&rig, cx, "Thumbs up reaction, 3", "enter");
    assert!(logged(&log).is_empty());
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find("busy").description(), Some("busy"));
    });
}

#[gpui_kit::test]
fn an_unavailable_chip_says_why_instead_of_toggling(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        ReactionChip::new("no", "👍", "Thumbs up", 2)
            .unavailable(true)
            .on_toggle(note(log, "toggle"))
            .on_unavailable_press(note(log, "why"))
            .into_any_element()
    });
    rig.click(cx, "no");
    press_on(&rig, cx, "Thumbs up reaction, 2", "space");
    assert_eq!(logged(&log), ["why", "why"]);
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find("no").description(), Some("unavailable"));
    });
}

#[gpui_kit::test]
fn a_right_click_or_the_menu_key_shows_who_reacted(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        ReactionChip::new("party", "🎉", "Party", 2)
            .busy(true)
            .on_toggle(note(log, "toggle"))
            .on_show_people(note(log, "people"))
            .into_any_element()
    });
    press_on(&rig, cx, "Party reaction, 2", "shift-f10");
    press_on(&rig, cx, "Party reaction, 2", "menu");
    rig.with(cx, |_, window, cx| window.right_click("party", cx));
    assert_eq!(logged(&log), ["people", "people", "people"]);
}

#[test]
fn the_context_menu_keys() {
    let key = |s: &'static str| Keystroke::parse(s).unwrap();
    assert!(is_context_menu_key(&key("menu")));
    assert!(is_context_menu_key(&key("shift-f10")));
    assert!(!is_context_menu_key(&key("f10")));
    assert!(!is_context_menu_key(&key("ctrl-shift-f10")));
    assert!(!is_context_menu_key(&key("ctrl-menu")));
    assert!(!is_context_menu_key(&key("enter")));
}

#[gpui_kit::test]
fn a_custom_emoji_chip_keeps_its_height(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        div()
            .flex()
            .child(ReactionChip::new("plain", "😂", "Laugh", 1))
            .child(
                ReactionChip::new("custom", ":gone:", "gone", 1).src(ImageSource::Image(
                    std::sync::Arc::new(Image::from_bytes(ImageFormat::Png, b"broken".to_vec())),
                )),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let height = px(semaphore_design::lounge::CONTROL_SM);
        assert_eq!(window.find("plain").bounds().size.height, height);
        assert_eq!(window.find("custom").bounds().size.height, height);
    });
}

// ---------------------------------------------------------------------------------------------
// MessageQuote

#[test]
fn quote_names() {
    assert_eq!(
        quote_name("aiko", "ok that run", false),
        "Reply to aiko: ok that run"
    );
    assert_eq!(
        quote_name("aiko", "anything", true),
        format!("Reply to a deleted message: {DELETED_LINE}")
    );
}

#[gpui_kit::test]
fn a_quote_opens_its_message_unless_it_was_deleted(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        div()
            .w(px(390.))
            .flex()
            .flex_col()
            .child(
                MessageQuote::new("open", "kwam3", "same time tomorrow?")
                    .on_open(note(log, "open")),
            )
            .child(
                MessageQuote::new("gone", "kwam3", "")
                    .deleted(true)
                    .on_open(note(log, "gone")),
            )
            .child(MessageQuote::new(
                "plain",
                "kwam3",
                "no way to open this one",
            ))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(
            window.find("open").label(),
            Some("Reply to kwam3: same time tomorrow?")
        );
        assert_eq!(window.find("gone").role(), Some(Role::Group));
        assert_eq!(
            window.find("gone").label().map(str::to_owned),
            Some(format!("Reply to a deleted message: {DELETED_LINE}"))
        );
        assert_eq!(window.find("plain").role(), Some(Role::Group));
    });
    rig.click(cx, "open");
    rig.click(cx, "gone");
    rig.click(cx, "plain");
    assert_eq!(logged(&log), ["open"]);
}

#[gpui_kit::test]
fn a_long_quote_stays_on_one_line(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        div()
            .w(px(300.))
            .flex()
            .flex_col()
            .child(MessageQuote::new("short", "kwam3", "ok"))
            .child(MessageQuote::new(
                "long",
                "a display name that is much too long for a phone column",
                "and a line that is also far too long to fit on one line of a narrow phone column",
            ))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let short = window.find("short").bounds();
        let long = window.find("long").bounds();
        assert_eq!(long.size.height, short.size.height);
        assert!(long.size.width <= px(300.));
    });
}

// ---------------------------------------------------------------------------------------------
// TypingLine

#[gpui_kit::test]
fn the_typing_line_is_one_line_or_nothing(cx: &mut TestAppContext) {
    let names: Rc<RefCell<Vec<&'static str>>> = Rc::new(RefCell::new(vec![]));
    let shown = names.clone();
    let (rig, _) = host(cx, move |_, _, _| {
        div()
            .w(px(240.))
            .child(TypingLine::new(shown.borrow().clone()))
            .into_any_element()
    });
    assert!(!rig.has(cx, "typing-line"));
    *names.borrow_mut() = vec!["aiko", "dropbear", "gracie"];
    rig.with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
    rig.with(cx, |_, window, _| {
        let line = window.find("typing-line");
        assert_eq!(line.label(), Some("aiko and 2 others are typing…"));
        assert_eq!(
            line.bounds().size.height,
            px(semaphore_design::chat::TYPING_LINE_HEIGHT)
        );
    });
    *names.borrow_mut() = vec![
        "a display name that is much too long for a phone column to show",
        "x",
    ];
    rig.with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
    rig.with(cx, |_, window, _| {
        let line = window.find("typing-line").bounds();
        assert_eq!(
            line.size.height,
            px(semaphore_design::chat::TYPING_LINE_HEIGHT)
        );
        assert!(line.size.width <= px(240.));
    });
}

// ---------------------------------------------------------------------------------------------
// JumpToLatest

#[gpui_kit::test]
fn jump_names_its_count_and_ignores_presses_while_busy(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .relative()
                    .w(px(360.))
                    .h(px(120.))
                    .child(JumpToLatest::new("plain", note(log, "plain"))),
            )
            .child(
                div()
                    .relative()
                    .w(px(360.))
                    .h(px(120.))
                    .child(JumpToLatest::new("count", note(log, "count")).new_count(240)),
            )
            .child(
                div()
                    .relative()
                    .w(px(360.))
                    .h(px(120.))
                    .child(JumpToLatest::new("busy", note(log, "busy")).busy(true)),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find("plain").label(), Some("Jump to latest"));
        assert_eq!(
            window.find("count").label(),
            Some("Jump to latest, 99+ new messages")
        );
        assert_eq!(window.find("busy").description(), Some("busy"));
    });
    rig.click(cx, "plain");
    rig.click(cx, "count");
    rig.click(cx, "busy");
    rig.with(cx, |_, window, cx| {
        window.activate_window();
        window.focus_next(cx);
    });
    rig.with(cx, |_, window, cx| {
        window.press("enter", cx);
    });
    assert_eq!(logged(&log), ["plain", "count", "plain"]);
}

#[gpui_kit::test]
fn jump_floats_centred_above_the_bottom_of_its_region(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        div()
            .id("region")
            .test_support()
            .relative()
            .w(px(360.))
            .h(px(220.))
            .child(div().h(px(400.)))
            .child(JumpToLatest::new("jump", |_, _| {}))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let region = window.find("region").bounds();
        let jump = window.find("jump").bounds();
        let gap = region.bottom() - jump.bottom();
        assert_eq!(gap, px(semaphore_design::lounge::SPACE_LG));
        let centre = (jump.center().x - region.center().x).abs();
        assert!(centre < px(1.), "off centre by {centre:?}");
        assert_eq!(
            region.size.height,
            px(220.),
            "it takes no room in the region"
        );
    });
}

// ---------------------------------------------------------------------------------------------
// LinkCard

#[test]
fn link_card_names_and_pictures() {
    assert_eq!(
        card_name(Some("Ridge"), "Trailheads", true),
        "Ridge, Trailheads"
    );
    assert_eq!(card_name(None, "example.com", true), "example.com");
    assert_eq!(card_name(Some("Ridge"), "Trailheads", false), "Ridge");
    assert_eq!(card_name(None, "example.com", false), "example.com");

    let uri = |s: &str| ImageSource::Resource(Resource::Uri(SharedUri::from(s.to_owned())));
    let kept = |s: &str| match allowed_picture(uri(s)) {
        Some(ImageSource::Resource(Resource::Uri(u))) => Some(u.to_string()),
        Some(_) => Some("other".into()),
        None => None,
    };
    assert_eq!(
        kept("https://pictures.example/b.png").as_deref(),
        Some("https://pictures.example/b.png")
    );
    assert_eq!(
        kept("https://\u{0430}pple.com/i.png").as_deref(),
        Some("https://xn--pple-43d.com/i.png")
    );
    assert_eq!(kept("https://bank.example@evil.example/i.png"), None);
    assert_eq!(kept("file:///etc/passwd"), None);
    assert_eq!(kept("data:image/png;base64,AAAA"), None);
    // A decoded picture the screen already holds is drawn as it is.
    let decoded = ImageSource::Image(std::sync::Arc::new(Image::from_bytes(
        ImageFormat::Png,
        vec![],
    )));
    assert!(allowed_picture(decoded).is_some());
}

#[gpui_kit::test]
fn a_link_card_opens_its_page_and_a_refused_one_is_plain(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _| {
        div()
            .w(px(390.))
            .flex()
            .flex_col()
            .child(
                LinkCard::new("ridge", "https://trailheads.example/ridge", "Trailheads")
                    .title("The ridge loop")
                    .description("Eleven kilometres.")
                    .on_link(link_log(log)),
            )
            .child(
                LinkCard::new(
                    "refused",
                    "https://bank.example@evil.example/",
                    "bank.example",
                )
                .title("Drawn, but not a link")
                .on_link(link_log(log)),
            )
            .child(
                LinkCard::new("no-handler", "https://example.com/", "example.com")
                    .title("No handler"),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let ridge = window.find("ridge");
        assert_eq!(ridge.role(), Some(Role::Link));
        assert_eq!(ridge.label(), Some("The ridge loop, Trailheads"));
        assert!(ridge.bounds().size.width <= px(semaphore_design::chat::IMAGE_MAX.width));
        let refused = window.find("refused");
        assert_eq!(refused.role(), Some(Role::Group));
        assert_eq!(refused.label(), Some("Drawn, but not a link"));
        assert_eq!(window.find("no-handler").role(), Some(Role::Group));
    });
    rig.click(cx, "refused");
    rig.click(cx, "no-handler");
    rig.click(cx, "ridge");
    assert_eq!(logged(&log), ["link https://trailheads.example/ridge"]);
    assert_eq!(cx.opened_url(), None, "the kit never opens anything itself");
}

#[gpui_kit::test]
fn a_banner_keeps_its_shape_whether_or_not_the_picture_loads(cx: &mut TestAppContext) {
    let broken = || {
        ImageSource::Image(std::sync::Arc::new(Image::from_bytes(
            ImageFormat::Png,
            b"x".to_vec(),
        )))
    };
    let (rig, _) = host(cx, move |_, _, _| {
        div()
            .w(px(390.))
            .flex()
            .flex_col()
            .child(LinkCard::new("plain", "https://a.example/", "a.example").title("T"))
            .child(
                LinkCard::new("banner", "https://b.example/", "b.example")
                    .title("T")
                    .image(broken()),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let plain = window.find("plain").bounds().size.height;
        let banner = window.find("banner").bounds().size.height;
        let inner = semaphore_design::chat::IMAGE_MAX.width
            - 2. * semaphore_design::lounge::SPACE_MD
            - semaphore_design::lounge::BORDER_SELECTED;
        let expected = inner / LINK_CARD_BANNER_RATIO + semaphore_design::lounge::SPACE_XS * 2.;
        let grew = f32::from(banner - plain);
        assert!(
            (grew - expected).abs() < 2.,
            "banner adds {grew}, expected about {expected}"
        );
    });
}

// ---------------------------------------------------------------------------------------------
// AttachmentTile

#[test]
fn tile_names() {
    use AttachmentKind::*;
    assert_eq!(
        tile_name(Image, "sunset.png", Some("1 MB"), true),
        "Open image sunset.png"
    );
    assert_eq!(
        tile_name(Video, "clip.mp4", Some("12 MB"), true),
        "Play video clip.mp4, 12 MB"
    );
    assert_eq!(
        tile_name(Audio, "note.ogg", Some("420 KB"), true),
        "Play audio note.ogg, 420 KB"
    );
    assert_eq!(
        tile_name(File, "notes.txt", Some("2 KB"), true),
        "Download notes.txt, 2 KB"
    );
    assert_eq!(
        tile_name(File, "notes.txt", None, true),
        "Download notes.txt"
    );
    assert_eq!(
        tile_name(File, "notes.txt", Some(""), true),
        "Download notes.txt"
    );
    assert_eq!(
        tile_name(File, "notes.txt", Some("2 KB"), false),
        "notes.txt, 2 KB"
    );
}

fn size_of(rig: &Rig<Host, ()>, cx: &mut TestAppContext, id: &str) -> (f32, f32) {
    let id = id.to_owned();
    rig.with(cx, move |_, window, _| {
        let b = window.find(id).bounds();
        (f32::from(b.size.width), f32::from(b.size.height))
    })
}

#[gpui_kit::test]
fn an_image_tile_is_sized_before_its_picture_arrives(cx: &mut TestAppContext) {
    use AttachmentKind::Image;
    let (rig, _) = host(cx, |_, _, _| {
        let tile = |id: &'static str| AttachmentTile::new(id, Image, id).on_open(|_, _| {});
        div()
            .w(px(600.))
            .flex()
            .flex_col()
            .items_start()
            .child(tile("wide").size(1600., 900.))
            .child(tile("tall").size(600., 1200.))
            .child(tile("strip").size(4000., 10.))
            .child(tile("pole").size(10., 4000.))
            .child(tile("unknown"))
            .child(tile("small").size(200., 100.))
            .into_any_element()
    });
    assert_eq!(size_of(&rig, cx, "wide"), (320., 180.));
    assert_eq!(size_of(&rig, cx, "tall"), (120., 240.));
    assert_eq!(size_of(&rig, cx, "strip"), (320., 48.));
    assert_eq!(size_of(&rig, cx, "pole"), (48., 240.));
    assert_eq!(size_of(&rig, cx, "unknown"), (240., 160.));
    assert_eq!(size_of(&rig, cx, "small"), (200., 100.));
}

#[gpui_kit::test]
fn an_image_box_shrinks_with_a_narrow_column_and_keeps_its_shape(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        div()
            .w(px(160.))
            .child(
                AttachmentTile::new("wide", AttachmentKind::Image, "wide.png")
                    .size(1600., 900.)
                    .on_open(|_, _| {}),
            )
            .into_any_element()
    });
    assert_eq!(size_of(&rig, cx, "wide"), (160., 90.));
}

#[gpui_kit::test]
fn a_tile_opens_unless_busy(cx: &mut TestAppContext) {
    use AttachmentKind::{File, Image, Video};
    let (rig, log) = host(cx, |log, _, _| {
        div()
            .w(px(600.))
            .flex()
            .flex_col()
            .items_start()
            .child(
                AttachmentTile::new("image", Image, "sunset.png")
                    .size(400., 300.)
                    .on_open(note(log, "image")),
            )
            .child(
                AttachmentTile::new("file", File, "notes.txt")
                    .detail("2 KB")
                    .on_open(note(log, "file")),
            )
            .child(AttachmentTile::new("video", Video, "clip.mp4").on_open(note(log, "video")))
            .child(
                AttachmentTile::new("busy", File, "big.zip")
                    .busy(true)
                    .on_open(note(log, "busy")),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find("image").label(), Some("Open image sunset.png"));
        assert_eq!(
            window.find("file").label(),
            Some("Download notes.txt, 2 KB")
        );
        assert_eq!(window.find("video").label(), Some("Play video clip.mp4"));
        assert_eq!(window.find("busy").description(), Some("busy"));
    });
    for id in ["image", "file", "video", "busy"] {
        rig.click(cx, id);
    }
    press_on(&rig, cx, "Download big.zip", "enter");
    assert_eq!(logged(&log), ["image", "file", "video"]);
}

#[gpui_kit::test]
fn a_tile_without_open_is_a_named_group(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        AttachmentTile::new("queued", AttachmentKind::File, "notes.txt")
            .detail("2 KB")
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let queued = window.find("queued");
        assert_eq!(queued.role(), Some(Role::Group));
        assert_eq!(queued.label(), Some("notes.txt, 2 KB"));
    });
}

#[gpui_kit::test]
fn the_player_takes_the_tiles_place_in_its_box(cx: &mut TestAppContext) {
    let slots: Rc<RefCell<Vec<PlayerSlot>>> = Rc::default();
    let seen = slots.clone();
    let (rig, log) = host(cx, move |log, _, _| {
        let (video_slots, audio_slots) = (seen.clone(), seen.clone());
        div()
            .w(px(600.))
            .flex()
            .flex_col()
            .items_start()
            .child(
                AttachmentTile::new("video", AttachmentKind::Video, "clip.mp4")
                    .size(1280., 720.)
                    .on_open(note(log, "open"))
                    .player(move |slot| {
                        video_slots.borrow_mut().push(slot);
                        div()
                            .id("video-player")
                            .test_support()
                            .size_full()
                            .into_any_element()
                    }),
            )
            .child(
                AttachmentTile::new("audio", AttachmentKind::Audio, "note.ogg")
                    .detail("1 KB")
                    .on_open(note(log, "open"))
                    .player(move |slot| {
                        audio_slots.borrow_mut().push(slot);
                        div()
                            .id("audio-player")
                            .test_support()
                            .size_full()
                            .into_any_element()
                    }),
            )
            .child(
                // A player on a file is ignored: it stays a download.
                AttachmentTile::new("file", AttachmentKind::File, "x.txt")
                    .on_open(note(log, "file"))
                    .player(|_| div().id("file-player").test_support().into_any_element()),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert!(
            window.try_find_by_label("Play video clip.mp4").is_none(),
            "Play is gone"
        );
        let player = window.find("video-player").bounds();
        assert_eq!(
            (f32::from(player.size.width), f32::from(player.size.height)),
            (320., 180.)
        );
        assert_eq!(window.find("audio").label(), Some("note.ogg, 1 KB"));
        assert_eq!(
            window.find("audio-player").bounds().size.height,
            px(semaphore_design::lounge::CONTROL_MD)
        );
        assert!(window.try_find("file-player").is_none());
    });
    let first = slots.borrow()[0];
    assert_eq!((first.size.width, first.size.height), (320., 180.));
    assert_eq!(first.radius, px(semaphore_design::lounge::RADIUS_MD));
    rig.click(cx, "video-player");
    assert!(logged(&log).is_empty(), "a playing tile is not a button");
}

#[gpui_kit::test]
fn a_picture_that_cannot_be_drawn_says_so_once_and_keeps_its_box(cx: &mut TestAppContext) {
    let failures = Rc::new(Cell::new(0));
    let count = failures.clone();
    let (rig, _) = host(cx, move |_, _, _| {
        let count = count.clone();
        AttachmentTile::new("broken", AttachmentKind::Image, "broken.webp")
            .src(ImageSource::Image(std::sync::Arc::new(Image::from_bytes(
                ImageFormat::Png,
                b"broken".to_vec(),
            ))))
            .size(400., 300.)
            .on_open(|_, _| {})
            .on_load_error(move |_, _| count.set(count.get() + 1))
            .into_any_element()
    });
    // Let the decode fail, then draw a few more frames.
    for _ in 0..4 {
        rig.with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
    }
    assert_eq!(failures.get(), 1);
    assert_eq!(
        size_of(&rig, cx, "broken"),
        (320., 240.),
        "the box keeps its size"
    );
}

#[gpui_kit::test]
fn the_name_of_a_picture_that_cannot_be_drawn_is_drawn_in_its_box(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _| {
        AttachmentTile::new("broken", AttachmentKind::Image, "broken.webp")
            .src(ImageSource::Image(std::sync::Arc::new(Image::from_bytes(
                ImageFormat::Png,
                b"broken".to_vec(),
            ))))
            .size(400., 300.)
            .on_open(|_, _| {})
            .into_any_element()
    });
    for _ in 0..4 {
        rig.with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
    }
    rig.with(cx, |_, window, _| {
        let id = ElementId::NamedChild(std::sync::Arc::new("broken".into()), "failed-name".into());
        let name = window.find(id);
        assert_eq!(name.label(), Some("broken.webp"));
        assert!(name.visible(), "the name is drawn");
        let tile = window.find("broken").bounds();
        assert!(tile.contains(&name.bounds().center()), "inside the box");
    });
}

#[gpui_kit::test]
fn a_video_whose_still_fails_is_not_a_load_error(cx: &mut TestAppContext) {
    let failures = Rc::new(Cell::new(0));
    let count = failures.clone();
    let (rig, _) = host(cx, move |_, _, _| {
        let count = count.clone();
        AttachmentTile::new("clip", AttachmentKind::Video, "clip.mp4")
            .poster(ImageSource::Image(std::sync::Arc::new(Image::from_bytes(
                ImageFormat::Png,
                b"broken".to_vec(),
            ))))
            .size(1280., 720.)
            .on_open(|_, _| {})
            .on_load_error(move |_, _| count.set(count.get() + 1))
            .into_any_element()
    });
    for _ in 0..4 {
        rig.with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
    }
    assert_eq!(failures.get(), 0);
    rig.with(cx, |_, window, _| {
        assert!(
            window.try_find_by_label("Play video clip.mp4").is_some(),
            "still playable"
        );
    });
}

/// Link labels draw in a left-to-right isolate, and an unpaired override in the words before
/// one is not drawn at all: `pay at <RLO>https://evil.example/moc.knab//:sptth` reads as written,
/// never as `https://bank.com/...`.
#[test]
fn link_labels_draw_in_a_left_to_right_isolate() {
    let (text, _) = inline(&[
        S::text("pay at \u{202E}"),
        S::link("https://evil.example/moc.knab//:sptth"),
    ]);
    assert_eq!(
        text,
        "pay at \u{2066}https://evil.example/moc.knab//:sptth\u{2069}"
    );
    // Each kind of control, unpaired, goes; a closed pair stays.
    for open in [
        '\u{202A}', '\u{202B}', '\u{202D}', '\u{202E}', '\u{2066}', '\u{2067}', '\u{2068}',
    ] {
        let (text, _) = inline(&[S::text(format!("a{open}b"))]);
        assert_eq!(text, "ab", "{open:?}");
    }
    let (text, _) = inline(&[S::text("a\u{202C}b\u{2069}c")]);
    assert_eq!(text, "abc", "a close with nothing open goes too");
    let (text, _) = inline(&[S::text("a\u{202E}b\u{202C}c")]);
    assert_eq!(text, "a\u{202E}b\u{202C}c");
    // A mention's own controls can't end its isolate early.
    let (text, _) = inline(&[S::mention(MentionSegment::new(
        MentionKind::User,
        "@x\u{2069}\u{202E}y",
    ))]);
    assert_eq!(text, "\u{2066}\u{200A}@xy\u{200A}\u{2069}");
}

/// A pane under a cover is laid out but not painted: its list foot (the toast anchor) is left
/// out, so it can't claim the window's toasts and then draw none.
#[gpui_kit::test]
fn the_list_foot_is_left_out_under_a_cover(cx: &mut TestAppContext) {
    fn pane(covered: bool) -> AnyElement {
        let foot = div()
            .id("foot")
            .test_support()
            .role(Role::Status)
            .aria_label("the foot");
        let pane = ChatPane::new("pane")
            .list(div().h(px(100.)))
            .list_foot(foot)
            .composer(div().h(px(40.)));
        let pane = if covered {
            pane.cover(div().id("cover").size_full())
        } else {
            pane
        };
        div().w(px(360.)).h(px(300.)).child(pane).into_any_element()
    }
    let (rig, _) = host(cx, |_, _, _| pane(false));
    rig.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("the foot").is_some());
    });
    let (rig, _) = host(cx, |_, _, _| pane(true));
    rig.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("the foot").is_none());
    });
}
