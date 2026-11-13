//! UM: GIF messages, third-party pictures behind the setting, and "Seen by".

use super::fixture::{self, NOW_MS};
use super::format::TimeFormat;
use super::media::{MediaRef, MediaSource};
use super::media_stories::{
    GIF_BROKEN, GIF_CAT, StoryMedia, animated, gif_message, mine, readers, seen, text_message,
};
use super::seen::{SeenState, own_latest, seen_line, seen_tooltip};
use super::selection::Pos;
use super::third_party::{self, GIF_MAX, ThirdParty, gif_box, host_label};
use super::view::{ListData, ListOptions, ListStatus, MessageList, MessageListEvent, init};
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_core::model::{
    AttachmentView, ErrorView, GifEmbed, LinkPreviewView, ListOp, LoadState, MessageRow,
    SeenByView, SendState,
};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
// `gpui_kit::*` exports the `test` attribute, and the macro's own `#[test]` would resolve to it.
use std::prelude::v1::test;
use std::time::Duration;

/// Answers like `StoryMedia`, and counts every third-party question it is asked.
type GifCalls = Rc<RefCell<HashMap<String, u32>>>;

struct CountingMedia {
    inner: StoryMedia,
    gif_calls: GifCalls,
    link_calls: Rc<Cell<u32>>,
}

impl CountingMedia {
    fn new() -> (Self, GifCalls, Rc<Cell<u32>>) {
        let gif_calls = Rc::new(RefCell::new(HashMap::new()));
        let link_calls = Rc::new(Cell::new(0));
        (
            Self {
                inner: StoryMedia::new(),
                gif_calls: gif_calls.clone(),
                link_calls: link_calls.clone(),
            },
            gif_calls,
            link_calls,
        )
    }
}

impl MediaSource for CountingMedia {
    fn attachment(&self, attachment: &AttachmentView) -> MediaRef {
        self.inner.attachment(attachment)
    }
    fn emoji(&self, emoji_id: &str) -> MediaRef {
        self.inner.emoji(emoji_id)
    }
    fn avatar(&self, file_id: &str) -> MediaRef {
        self.inner.avatar(file_id)
    }
    fn link_image(&self, url: &str) -> MediaRef {
        self.link_calls.set(self.link_calls.get() + 1);
        self.inner.link_image(url)
    }
    fn gif(&self, url: &str) -> MediaRef {
        *self
            .gif_calls
            .borrow_mut()
            .entry(url.to_owned())
            .or_default() += 1;
        self.inner.gif(url)
    }
}

fn gif_calls_total(calls: &RefCell<HashMap<String, u32>>) -> u32 {
    calls.borrow().values().sum()
}

fn embed(url: &str, host: &str) -> GifEmbed {
    GifEmbed {
        url: url.into(),
        host: host.into(),
    }
}

fn preview(image_url: Option<&str>, image_host: Option<&str>) -> LinkPreviewView {
    LinkPreviewView {
        url: "https://example.com/post".into(),
        title: Some("A post".into()),
        image_url: image_url.map(str::to_owned),
        image_host: image_host.map(str::to_owned),
        ..LinkPreviewView::default()
    }
}

fn preview_row(seq: i64) -> MessageRow {
    let mut row = text_message(seq, fixture::user("u-ava", "ava", None), 3, "a link");
    row.link_previews = vec![preview(
        Some("https://blog.example.com/cover.png"),
        Some("blog.example.com"),
    )];
    row
}

fn failure() -> ErrorView {
    ErrorView {
        code: "FAILED".into(),
        message: "failed".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

fn sam() -> semaphore_core::model::UserView {
    fixture::user("u-sam", "sam", Some("Sam Rivera"))
}

// ---- The gate, without GPUI ----

#[test]
fn blocked_never_asks_the_source_for_a_gif() {
    let (media, gifs, _) = CountingMedia::new();
    let decision = third_party::gif(false, &media, &embed(GIF_CAT, "media.giphy.com"));
    assert!(
        matches!(&decision, ThirdParty::Blocked { host } if host.as_ref() == "media.giphy.com")
    );
    assert_eq!(gif_calls_total(&gifs), 0);
}

#[test]
fn blocked_never_asks_the_source_for_a_link_image() {
    let (media, _, links) = CountingMedia::new();
    let decision = third_party::link_image(
        false,
        &media,
        &preview(
            Some("https://blog.example.com/cover.png"),
            Some("blog.example.com"),
        ),
    );
    assert!(
        matches!(&decision, Some(ThirdParty::Blocked { host }) if host.as_ref() == "blog.example.com")
    );
    assert_eq!(links.get(), 0);
}

#[test]
fn allowed_passes_the_source_answer_through() {
    let (media, gifs, links) = CountingMedia::new();
    assert!(matches!(
        third_party::gif(true, &media, &embed(GIF_CAT, "media.giphy.com")),
        ThirdParty::Allowed(MediaRef::Ready(_))
    ));
    assert!(matches!(
        third_party::gif(true, &media, &embed(GIF_BROKEN, "media.tenor.com")),
        ThirdParty::Allowed(MediaRef::Missing)
    ));
    assert_eq!(gifs.borrow().get(GIF_CAT), Some(&1));
    assert_eq!(gifs.borrow().get(GIF_BROKEN), Some(&1));
    assert!(matches!(
        third_party::link_image(true, &media, &preview(Some("https://x.test/a.png"), None)),
        Some(ThirdParty::Allowed(MediaRef::Missing))
    ));
    assert_eq!(links.get(), 1);
}

#[test]
fn a_preview_without_a_picture_has_nothing_to_gate() {
    let (media, _, links) = CountingMedia::new();
    for allowed in [false, true] {
        assert!(third_party::link_image(allowed, &media, &preview(None, Some("x.test"))).is_none());
        assert!(third_party::link_image(allowed, &media, &preview(Some(""), None)).is_none());
    }
    assert_eq!(links.get(), 0);
}

/// The structural half of the boundary: nothing else in the list can reach a third-party picture.
#[test]
fn only_third_party_rs_calls_gif_or_link_image() {
    let sources = [
        ("actions.rs", include_str!("actions.rs")),
        ("format.rs", include_str!("format.rs")),
        ("icons.rs", include_str!("icons.rs")),
        ("media.rs", include_str!("media.rs")),
        ("palette.rs", include_str!("palette.rs")),
        ("row.rs", include_str!("row.rs")),
        ("seen.rs", include_str!("seen.rs")),
        ("selection.rs", include_str!("selection.rs")),
        ("store.rs", include_str!("store.rs")),
        ("text.rs", include_str!("text.rs")),
        ("text_element.rs", include_str!("text_element.rs")),
        ("view.rs", include_str!("view.rs")),
    ];
    for (name, source) in sources {
        for call in [".gif(", ".link_image(", "::gif(&", "::link_image(&"] {
            assert!(
                !source.contains(call),
                "{name} calls `{call}`: third-party pictures go through third_party.rs"
            );
        }
    }
    let gate = include_str!("third_party.rs");
    assert!(gate.contains("source.gif(") && gate.contains("source.link_image("));
}

// ---- Host labels ----

#[test]
fn host_label_uses_core_host() {
    assert_eq!(
        host_label(Some("media.giphy.com")).as_ref(),
        "media.giphy.com"
    );
    assert_eq!(host_label(Some("  tenor.com ")).as_ref(), "tenor.com");
    assert_eq!(
        third_party::gif_title("media.giphy.com"),
        "GIF from media.giphy.com"
    );
    assert_eq!(
        third_party::image_title("example.com"),
        "Image from example.com"
    );
}

#[test]
fn host_label_empty_or_missing_says_another_site() {
    for host in [None, Some(""), Some("   ")] {
        assert_eq!(host_label(host).as_ref(), "another site");
    }
    let (media, _, _) = CountingMedia::new();
    assert!(matches!(
        third_party::gif(false, &media, &embed(GIF_CAT, "")),
        ThirdParty::Blocked { host } if host.as_ref() == "another site"
    ));
    assert!(matches!(
        third_party::link_image(false, &media, &preview(Some("https://x.test/a.png"), None)),
        Some(ThirdParty::Blocked { host }) if host.as_ref() == "another site"
    ));
}

// ---- GIF box ----

#[test]
fn gif_box_fits_400x300_keeping_aspect() {
    assert_eq!(gif_box(480., 270.), (400., 225.));
    let (w, h) = gif_box(1200., 160.);
    assert_eq!(w, 400.);
    assert!((h - 160. / 3.).abs() < 1e-3, "{h}");
    assert_eq!(gif_box(160., 1000.), (48., 300.));
    // Never scaled up.
    assert_eq!(gif_box(100., 50.), (100., 50.));
    assert_eq!(gif_box(400., 300.), (400., 300.));
    // No size: the whole box, as while it loads.
    assert_eq!(gif_box(0., 0.), GIF_MAX);
    assert_eq!(gif_box(-1., 10.), GIF_MAX);
    assert_eq!(gif_box(f32::NAN, 10.), GIF_MAX);
    assert_eq!(gif_box(f32::INFINITY, 10.), GIF_MAX);
    // Extreme shapes keep at least a pixel.
    let (w, h) = gif_box(100_000., 1.);
    assert!((w - 400.).abs() < 1e-2, "{w}");
    assert!(h >= 1.);
}

// ---- Seen by, without GPUI ----

#[test]
fn own_latest_skips_pending_failed_removed_and_others() {
    let me = fixture::me();
    let mut pending = mine(text_message(4, me.clone(), 1, "pending"));
    pending.send_state = SendState::Pending;
    pending.id = None;
    let mut failed = mine(text_message(5, me.clone(), 1, "failed"));
    failed.send_state = SendState::Failed { error: failure() };
    let mut removed = mine(text_message(6, me.clone(), 1, "removed"));
    removed.removed = true;
    let rows = [
        mine(text_message(1, me.clone(), 9, "old")),
        mine(text_message(2, me.clone(), 8, "latest sent")),
        text_message(3, sam(), 7, "theirs"),
        pending,
        failed,
        removed,
        text_message(7, sam(), 1, "theirs again"),
    ];
    let expected = rows[1].id.clone().map(|id| (2, id));
    assert_eq!(own_latest(rows.iter()), expected);
    assert_eq!(own_latest(rows[2..3].iter()), None);
    assert_eq!(own_latest(std::iter::empty()), None);
}

#[test]
fn seen_line_names_two_then_plus_n() {
    let one = seen_line(&seen(readers(1), 1)).unwrap();
    assert_eq!((one.names.as_str(), one.more), ("Seen by Sam Rivera", None));
    let two = seen_line(&seen(readers(2), 2)).unwrap();
    assert_eq!(
        (two.names.as_str(), two.more),
        ("Seen by Sam Rivera, Ava Chen", None)
    );
    let five = seen_line(&seen(readers(5), 5)).unwrap();
    assert_eq!(five.names, "Seen by Sam Rivera, Ava Chen");
    assert_eq!(five.more.as_deref(), Some("+3"));
    // 15 named of 23: "+21" counts everyone not on the line.
    let many = seen_line(&seen(readers(15), 23)).unwrap();
    assert_eq!(many.more.as_deref(), Some("+21"));
}

#[test]
fn seen_tooltip_cuts_at_15_with_more() {
    // Core sends at most 15, but the list must not trust that.
    let mut view = seen(readers(20), 20);
    view.more = 0;
    let tip = seen_tooltip(&view).unwrap();
    assert_eq!(tip.header, "Seen by 20");
    assert_eq!(tip.names.len(), 15);
    assert_eq!(tip.names[0], "Sam Rivera");
    assert_eq!(tip.more.as_deref(), Some("+5 more"));
}

#[test]
fn seen_tooltip_more_from_view() {
    let tip = seen_tooltip(&seen(readers(15), 19)).unwrap();
    assert_eq!(tip.header, "Seen by 19");
    assert_eq!(tip.names.len(), 15);
    assert_eq!(tip.more.as_deref(), Some("+4 more"));
    let single = seen_tooltip(&seen(readers(1), 1)).unwrap();
    assert_eq!(single.header, "Seen by Sam Rivera");
    assert_eq!(single.more, None);
    // A count lower than the names sent is read as the names sent.
    let mut odd = seen(readers(3), 3);
    odd.count = 1;
    let tip = seen_tooltip(&odd).unwrap();
    assert_eq!((tip.header.as_str(), tip.more), ("Seen by 3", None));
}

#[test]
fn display_name_falls_back_to_username() {
    let users = vec![
        fixture::user("u-1", "plain", None),
        fixture::user("u-2", "blank", Some("   ")),
        fixture::user("u-3", "named", Some("Named Person")),
    ];
    let tip = seen_tooltip(&seen(users, 3)).unwrap();
    assert_eq!(tip.names, ["plain", "blank", "Named Person"]);
    let line = seen_line(&seen(vec![fixture::user("u-1", "plain", Some(""))], 1)).unwrap();
    assert_eq!(line.names, "Seen by plain");
}

#[test]
fn nobody_or_loading_draws_nothing() {
    assert_eq!(seen_line(&seen(Vec::new(), 0)), None);
    assert_eq!(seen_line(&SeenByView::default()), None);
    let mut loading = seen(readers(2), 2);
    loading.state = LoadState::Loading;
    assert_eq!(seen_line(&loading), None);
    let mut failed = seen(readers(2), 2);
    failed.state = LoadState::Failed { error: failure() };
    assert_eq!(seen_line(&failed), None);
    assert_eq!(seen_tooltip(&failed), None);
    // A count with no names behind it names nobody.
    assert_eq!(seen_line(&seen(Vec::new(), 4)), None);
}

#[test]
fn seen_state_keeps_an_answer_only_for_its_own_message() {
    let mut state = SeenState::default();
    // No target: an answer has nowhere to go.
    state.answer(Some(seen(readers(1), 1)));
    assert_eq!(state.view, None);

    assert!(state.retarget(Some((2, "m-2".into()))));
    state.answer(Some(seen(readers(1), 1)));
    assert!(state.for_row(2).is_some());
    assert!(state.for_row(1).is_none());
    // The same target again changes nothing.
    assert!(!state.retarget(Some((2, "m-2".into()))));
    assert!(state.for_row(2).is_some());

    // A newer own message: the old answer goes, and stays gone for both rows.
    assert!(state.retarget(Some((4, "m-4".into()))));
    assert_eq!(state.view, None);
    assert!(state.for_row(2).is_none() && state.for_row(4).is_none());
    state.answer(Some(seen(readers(2), 2)));
    assert!(state.for_row(4).is_some());

    // The row moved (a reset renumbers seqs) but is the same message: the answer stays.
    assert!(state.retarget(Some((9, "m-4".into()))));
    assert!(state.for_row(9).is_some());

    // `None` clears it; losing the target clears it.
    state.answer(None);
    assert_eq!(state.view, None);
    state.answer(Some(seen(readers(2), 2)));
    assert!(state.retarget(None));
    assert_eq!(state.view, None);
}

// ---- In a window ----

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
    cx.run_until_parked();
}

fn open(
    cx: &mut TestAppContext,
    rows: Vec<MessageRow>,
    media: Rc<dyn MediaSource>,
    third_party: bool,
) -> (
    Entity<MessageList>,
    &mut VisualTestContext,
    Rc<RefCell<Vec<MessageListEvent>>>,
) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        init(cx);
    });
    let (view, cx) = cx.add_window_view(move |_, cx| {
        let mut list = MessageList::new(
            ListData {
                me_id: fixture::me().id,
                rows,
                replies: HashMap::new(),
                status: ListStatus::Ready,
            },
            media,
            ListOptions {
                time: TimeFormat::fixed(NOW_MS),
                scrollbar: false,
                ..ListOptions::default()
            },
            cx,
        );
        list.set_third_party_media(third_party, cx);
        list
    });
    draw(cx);
    draw(cx);
    let events = Rc::new(RefCell::new(Vec::new()));
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event: &MessageListEvent, _| {
            sink.borrow_mut().push(event.clone());
        })
        .detach();
    });
    (view, cx, events)
}

fn has(cx: &mut VisualTestContext, id: &str) -> bool {
    let id = id.to_owned();
    cx.update(move |window, _| window.try_find(id).is_some())
}

fn click(cx: &mut VisualTestContext, id: &str) {
    let id = id.to_owned();
    cx.update(move |window, cx| window.click(id, cx));
    draw(cx);
}

fn painted_seqs(view: &Entity<MessageList>, cx: &mut VisualTestContext) -> Vec<i64> {
    view.read_with(cx, |view, _| {
        view.painted_blocks()
            .into_iter()
            .map(|(seq, _)| seq)
            .collect()
    })
}

/// Every row in view once, top to bottom.
fn scroll_through(view: &Entity<MessageList>, count: i64, cx: &mut VisualTestContext) {
    let mut seq = 1;
    while seq <= count {
        view.update(cx, |view, cx| {
            view.scroll_to_seq(seq, 0.);
            cx.notify();
        });
        draw(cx);
        seq += 3;
    }
}

fn many_gifs(count: i64) -> Vec<MessageRow> {
    (1..=count)
        .map(|seq| {
            let url = format!("https://media.giphy.com/media/{seq}/giphy.gif");
            let mut row = gif_message(seq, sam(), 1000 - seq, &url);
            if seq % 2 == 0 {
                row.link_previews = preview_row(seq).link_previews;
                row.gif = None;
            }
            row
        })
        .collect()
}

#[gpui_kit::test]
fn nothing_third_party_is_asked_for_while_off(cx: &mut TestAppContext) {
    let (media, gifs, links) = CountingMedia::new();
    let (view, cx, _) = open(cx, many_gifs(60), Rc::new(media), false);
    scroll_through(&view, 60, cx);
    assert_eq!(gif_calls_total(&gifs), 0, "no GIF asked for while off");
    assert_eq!(links.get(), 0, "no link picture asked for while off");
    assert!(has(cx, "message-gif-blocked-59") || has(cx, "message-gif-blocked-57"));

    view.update(cx, |view, cx| view.set_third_party_media(true, cx));
    draw(cx);
    assert!(gif_calls_total(&gifs) > 0, "on: the rows in view ask");
    assert!(links.get() > 0);

    view.update(cx, |view, cx| view.set_third_party_media(false, cx));
    draw(cx);
    let (gif_before, link_before) = (gif_calls_total(&gifs), links.get());
    scroll_through(&view, 60, cx);
    assert_eq!(
        gif_calls_total(&gifs),
        gif_before,
        "off again: nothing new asked"
    );
    assert_eq!(links.get(), link_before);
    assert!(has(cx, "message-gif-blocked-59") || has(cx, "message-gif-blocked-57"));
}

#[gpui_kit::test]
fn load_on_gif_card_emits_enable(cx: &mut TestAppContext) {
    let rows = vec![gif_message(1, sam(), 2, GIF_CAT)];
    let (_, cx, events) = open(cx, rows, Rc::new(StoryMedia::new()), false);
    assert!(has(cx, "message-gif-blocked-1"));
    click(cx, "message-gif-load-1");
    assert_eq!(*events.borrow(), [MessageListEvent::EnableThirdPartyMedia]);
}

#[gpui_kit::test]
fn load_on_preview_strip_emits_enable(cx: &mut TestAppContext) {
    let (_, cx, events) = open(cx, vec![preview_row(1)], Rc::new(StoryMedia::new()), false);
    assert!(has(cx, "message-preview-blocked-1-0"));
    click(cx, "message-preview-load-1-0");
    // The card under it would open the link: it must not.
    assert_eq!(*events.borrow(), [MessageListEvent::EnableThirdPartyMedia]);
}

#[gpui_kit::test]
fn allowed_preview_draws_no_strip(cx: &mut TestAppContext) {
    let (_, cx, _) = open(cx, vec![preview_row(1)], Rc::new(StoryMedia::new()), true);
    assert!(!has(cx, "message-preview-blocked-1-0"));
}

#[gpui_kit::test]
fn gif_row_hides_text_and_previews(cx: &mut TestAppContext) {
    let rows = vec![
        text_message(1, sam(), 3, "before"),
        gif_message(2, sam(), 2, GIF_CAT),
    ];
    let (view, cx, events) = open(cx, rows, Rc::new(StoryMedia::new()), true);
    assert!(has(cx, "message-gif-2"));
    assert_eq!(painted_seqs(&view, cx), [1], "the URL text isn't drawn");
    click(cx, "message-gif-2");
    assert_eq!(
        *events.borrow(),
        [MessageListEvent::OpenLink {
            url: GIF_CAT.into()
        }]
    );
}

#[gpui_kit::test]
fn a_blocked_gif_row_draws_the_card_and_no_text(cx: &mut TestAppContext) {
    let rows = vec![
        text_message(1, sam(), 3, "before"),
        gif_message(2, sam(), 2, GIF_CAT),
    ];
    let (view, cx, _) = open(cx, rows, Rc::new(StoryMedia::new()), false);
    assert!(has(cx, "message-gif-blocked-2"));
    assert!(!has(cx, "message-gif-2"));
    assert_eq!(painted_seqs(&view, cx), [1]);
}

#[gpui_kit::test]
fn gif_failed_falls_back_to_text_and_preview(cx: &mut TestAppContext) {
    let rows = vec![gif_message(1, sam(), 2, GIF_BROKEN)];
    let (view, cx, _) = open(cx, rows, Rc::new(StoryMedia::new()), true);
    assert!(!has(cx, "message-gif-1"));
    assert!(!has(cx, "message-gif-blocked-1"));
    assert_eq!(painted_seqs(&view, cx), [1], "the URL is drawn as text");
}

#[gpui_kit::test]
fn a_loading_gif_holds_the_whole_box(cx: &mut TestAppContext) {
    struct Pending;
    impl MediaSource for Pending {
        fn attachment(&self, _: &AttachmentView) -> MediaRef {
            MediaRef::Missing
        }
        fn emoji(&self, _: &str) -> MediaRef {
            MediaRef::Missing
        }
        fn avatar(&self, _: &str) -> MediaRef {
            MediaRef::Missing
        }
        fn gif(&self, _: &str) -> MediaRef {
            MediaRef::Pending
        }
    }
    let rows = vec![gif_message(1, sam(), 2, GIF_CAT)];
    let (view, cx, _) = open(cx, rows, Rc::new(Pending), true);
    // Not clickable yet, and the URL text isn't drawn while it loads.
    assert!(!has(cx, "message-gif-1"));
    assert!(painted_seqs(&view, cx).is_empty());
}

fn run_idle(view: &Entity<MessageList>, millis: u64, cx: &mut VisualTestContext) -> u64 {
    let notifies = Rc::new(Cell::new(0u32));
    let counter = notifies.clone();
    let observed = cx.update(|_, cx| cx.observe(view, move |_, _| counter.set(counter.get() + 1)));
    let before = view.read_with(cx, |view, _| view.animated_paints());
    let mut drawn = 0;
    let mut left = millis;
    while left > 0 {
        let step = left.min(10);
        cx.executor().advance_clock(Duration::from_millis(step));
        cx.run_until_parked();
        if notifies.get() != drawn {
            drawn = notifies.get();
            cx.update(|window, cx| window.draw(cx).clear(cx));
            cx.run_until_parked();
        }
        left -= step;
    }
    drop(observed);
    view.read_with(cx, |view, _| view.animated_paints()) - before
}

#[gpui_kit::test]
fn an_allowed_gif_animates(cx: &mut TestAppContext) {
    let rows = vec![gif_message(1, sam(), 2, GIF_CAT)];
    let (view, cx, _) = open(cx, rows, Rc::new(StoryMedia::new()), true);
    let paints = run_idle(&view, 1_000, cx);
    // Six frames at 100 ms: about ten changes a second.
    assert!(paints >= 5, "{paints} paints of the GIF in 1 s");
}

#[gpui_kit::test]
fn reduced_motion_paints_first_frame_of_gif(cx: &mut TestAppContext) {
    cx.update(|cx| cx.set_reduce_motion(true));
    let rows = vec![gif_message(1, sam(), 2, GIF_CAT)];
    let (view, cx, _) = open(cx, rows, Rc::new(StoryMedia::new()), true);
    assert!(has(cx, "message-gif-1"));
    assert_eq!(
        run_idle(&view, 1_000, cx),
        0,
        "no animation under reduced motion"
    );
}

/// A long list of GIFs: only the rows laid out ask for their picture, and only those in view
/// animate.
#[gpui_kit::test]
fn offscreen_gifs_are_not_resolved_or_animated(cx: &mut TestAppContext) {
    let (media, gifs, _) = CountingMedia::new();
    // Distinct URLs, so the count says which rows asked.
    let rows: Vec<MessageRow> = (1..=200)
        .map(|seq| {
            let url = format!("https://media.giphy.com/media/{seq}/giphy.gif");
            gif_message(seq, sam(), 1000 - seq, &url)
        })
        .collect();
    let (view, cx, _) = open(cx, rows, Rc::new(media), true);
    let asked = gifs.borrow().len();
    assert!(asked > 0, "the rows in view ask");
    assert!(
        asked < 20,
        "{asked} of 200 GIFs asked for: only rows near the viewport"
    );
    assert!(
        !gifs
            .borrow()
            .contains_key("https://media.giphy.com/media/1/giphy.gif"),
        "the first row, far above the tail, isn't laid out"
    );
    // None of them has a picture (unknown URLs): nothing animates either.
    assert_eq!(run_idle(&view, 500, cx), 0);
}

#[gpui_kit::test]
fn only_gifs_in_view_animate(cx: &mut TestAppContext) {
    // 200 rows, all the same animated GIF: the number painted per frame stays at what fits.
    let rows: Vec<MessageRow> = (1..=200)
        .map(|seq| gif_message(seq, sam(), 1000 - seq, GIF_CAT))
        .collect();
    let (view, cx, _) = open(cx, rows, Rc::new(StoryMedia::new()), true);
    let before = view.read_with(cx, |view, _| view.animated_paints());
    draw(cx);
    let per_frame = view.read_with(cx, |view, _| view.animated_paints()) - before;
    assert!(per_frame > 0, "the GIFs in view animate");
    assert!(
        per_frame <= 8,
        "{per_frame} GIFs painted in one frame: only those in view"
    );
}

// ---- Seen by, in a window ----

fn dm_rows() -> Vec<MessageRow> {
    let me = fixture::me();
    vec![
        text_message(1, sam(), 9, "Around later?"),
        mine(text_message(2, me.clone(), 8, "Yes, after lunch.")),
        text_message(3, sam(), 7, "Great."),
        mine(text_message(4, me, 6, "Bring the checklist.")),
    ]
}

#[gpui_kit::test]
fn seen_line_drawn_under_own_latest_only(cx: &mut TestAppContext) {
    let rows = dm_rows();
    let latest = rows[3].id.clone();
    let (view, cx, _) = open(cx, rows, Rc::new(StoryMedia::new()), false);
    assert_eq!(view.read_with(cx, |view, _| view.seen_by_target()), latest);
    assert!(!has(cx, "message-seen-by"), "nothing before core answers");
    view.update(cx, |view, cx| {
        view.set_seen_by(Some(seen(vec![sam()], 1)), cx)
    });
    draw(cx);
    assert!(has(cx, "message-seen-by"));
    let label = cx.update(|window, _| window.find_all_by_label("Seen by Sam Rivera").len());
    assert_eq!(label, 1, "one line, under one row");
    // Nobody: no line.
    view.update(cx, |view, cx| {
        view.set_seen_by(Some(seen(Vec::new(), 0)), cx)
    });
    draw(cx);
    assert!(!has(cx, "message-seen-by"));
    view.update(cx, |view, cx| view.set_seen_by(None, cx));
    draw(cx);
    assert!(!has(cx, "message-seen-by"));
}

#[gpui_kit::test]
fn a_newer_own_message_drops_the_old_answer(cx: &mut TestAppContext) {
    let (view, cx, _) = open(cx, dm_rows(), Rc::new(StoryMedia::new()), false);
    view.update(cx, |view, cx| {
        view.set_seen_by(Some(seen(vec![sam()], 1)), cx)
    });
    draw(cx);
    assert!(has(cx, "message-seen-by"));
    let newer = mine(text_message(5, fixture::me(), 1, "And the keys."));
    let newer_id = newer.id.clone();
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 4,
                rows: vec![newer],
            },
            cx,
        )
    });
    draw(cx);
    assert_eq!(
        view.read_with(cx, |view, _| view.seen_by_target()),
        newer_id
    );
    assert!(
        !has(cx, "message-seen-by"),
        "the old answer isn't drawn under the new message"
    );
    // Someone else's message after mine leaves the target alone.
    let theirs = text_message(6, sam(), 0, "ok");
    view.update(cx, |view, cx| {
        view.set_seen_by(Some(seen(vec![sam()], 1)), cx);
        view.apply(
            ListOp::Insert {
                index: 5,
                rows: vec![theirs],
            },
            cx,
        )
    });
    draw(cx);
    assert_eq!(
        view.read_with(cx, |view, _| view.seen_by_target()),
        newer_id
    );
    assert!(has(cx, "message-seen-by"));
}

#[gpui_kit::test]
fn hovering_own_latest_emits_seen_by_hovered_and_none_on_leave(cx: &mut TestAppContext) {
    let rows = dm_rows();
    let latest = rows[3].id.clone();
    let (view, cx, events) = open(cx, rows, Rc::new(StoryMedia::new()), false);
    let on_latest = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 4, byte: 2 }))
        .expect("row 4 is painted");
    let on_other = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 3, byte: 2 }))
        .expect("row 3 is painted");
    cx.simulate_mouse_move(on_latest, None, Modifiers::default());
    draw(cx);
    cx.simulate_mouse_move(on_other, None, Modifiers::default());
    draw(cx);
    let seen_events: Vec<_> = events
        .borrow()
        .iter()
        .filter(|event| matches!(event, MessageListEvent::SeenByHovered { .. }))
        .cloned()
        .collect();
    assert_eq!(
        seen_events,
        [
            MessageListEvent::SeenByHovered { message_id: latest },
            MessageListEvent::SeenByHovered { message_id: None },
        ]
    );
}

#[gpui_kit::test]
fn hovering_other_rows_emits_nothing(cx: &mut TestAppContext) {
    let (view, cx, events) = open(cx, dm_rows(), Rc::new(StoryMedia::new()), false);
    for seq in [1, 2, 3, 1] {
        let at = view
            .read_with(cx, |view, _| view.point_of(Pos { seq, byte: 2 }))
            .expect("painted");
        cx.simulate_mouse_move(at, None, Modifiers::default());
        draw(cx);
    }
    assert!(
        events
            .borrow()
            .iter()
            .all(|event| !matches!(event, MessageListEvent::SeenByHovered { .. }))
    );
}

#[gpui_kit::test]
fn the_seen_tooltip_lists_names_on_hover(cx: &mut TestAppContext) {
    let (view, cx, _) = open(cx, dm_rows(), Rc::new(StoryMedia::new()), false);
    view.update(cx, |view, cx| {
        view.set_seen_by(Some(seen(readers(15), 19)), cx)
    });
    draw(cx);
    assert!(!has(cx, "message-seen-tooltip"));
    cx.update(|window, cx| window.hover(ElementId::Name("message-seen-by".into()), cx));
    draw(cx);
    assert!(has(cx, "message-seen-tooltip"));
    let found = cx.update(|window, _| window.find_all_by_label("Seen by 19").len());
    assert_eq!(found, 1);
}

#[test]
fn story_pictures_are_animated_and_sized() {
    let image = animated(480, 270, 6, [1, 2, 3]);
    assert_eq!(image.frame_count(), 6);
    let size = image.size(0);
    assert_eq!((size.width.0, size.height.0), (480, 270));
    let _: Arc<RenderImage> = image;
}
