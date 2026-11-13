//! The picker in a window: the search's wait, the permission notice, picking, the keyboard, closing
//! and "Load more"; then the composer's GIF button.

use super::{GifPicker, GifPickerEvent};
use crate::composer::{
    Composer, ComposerConfig, ComposerEvent, ComposerMode, DraftStore, MentionSource,
};
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use semaphore_core::model::{Conversation, GifResultsView, GifView, LoadState, MentionCandidate};
use std::rc::Rc;
use std::time::Duration;

fn gif(id: &str) -> GifView {
    GifView {
        id: id.to_owned(),
        title: format!("GIF {id}"),
        url: format!("https://media.giphy.com/media/{id}/giphy.gif"),
        preview_url: format!("https://media.giphy.com/media/{id}/preview.gif"),
        width: 480,
        height: 270,
    }
}

fn ready(count: usize, more: bool, loading_more: bool) -> GifResultsView {
    GifResultsView {
        state: LoadState::Ready,
        results: (0..count).map(|index| gif(&format!("g{index}"))).collect(),
        more,
        loading_more,
        enabled: true,
        needs_permission: false,
        ..GifResultsView::default()
    }
}

fn gif_rig(cx: &mut TestAppContext, view: GifResultsView) -> Rig<GifPicker, GifPickerEvent> {
    rig::<GifPicker, GifPickerEvent>(cx, 400., move |window, cx| {
        let mut picker = GifPicker::new(window, cx);
        picker.set_view(view, cx);
        picker
    })
}

#[gpui_kit::test]
fn query_is_debounced(cx: &mut TestAppContext) {
    let rig = gif_rig(cx, ready(6, false, false));
    rig.with(cx, |_, window, cx| window.input("ca", cx));
    cx.executor().advance_clock(Duration::from_millis(200));
    rig.with(cx, |_, window, cx| window.input("t", cx));
    cx.executor().advance_clock(Duration::from_millis(299));
    cx.run_until_parked();
    assert!(rig.events().is_empty(), "still inside the debounce");
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    assert_eq!(rig.events(), [GifPickerEvent::Query("cat".into())]);
    cx.executor().advance_clock(Duration::from_secs(2));
    cx.run_until_parked();
    assert_eq!(
        rig.events().len(),
        1,
        "the first keystroke's timer was cancelled"
    );
}

#[gpui_kit::test]
fn allow_emits_allow_and_no_grid_while_needed(cx: &mut TestAppContext) {
    let off = GifResultsView {
        state: LoadState::Ready,
        enabled: true,
        needs_permission: true,
        ..GifResultsView::default()
    };
    let rig = gif_rig(cx, off);
    assert!(
        !rig.has(cx, "gif-grid"),
        "no grid while third-party pictures are off"
    );
    assert!(rig.has(cx, "gif-permission"));
    rig.click(cx, "gif-allow");
    assert_eq!(rig.events(), [GifPickerEvent::Allow]);
}

#[gpui_kit::test]
fn pick_emits_the_gif(cx: &mut TestAppContext) {
    let rig = gif_rig(cx, ready(3, false, false));
    rig.click(cx, "gif-g1");
    assert_eq!(rig.events(), [GifPickerEvent::Pick(gif("g1"))]);
}

#[gpui_kit::test]
fn arrows_move_the_highlight(cx: &mut TestAppContext) {
    let rig = gif_rig(cx, ready(6, false, false));
    let active = |rig: &Rig<GifPicker, GifPickerEvent>, cx: &mut TestAppContext| {
        rig.with(cx, |view, _, cx| view.read(cx).active)
    };
    assert_eq!(active(&rig, cx), 0);
    rig.with(cx, |_, window, cx| window.press("down", cx));
    assert_eq!(active(&rig, cx), 2, "down a row, same column");
    rig.with(cx, |_, window, cx| window.press("down", cx));
    assert_eq!(active(&rig, cx), 4);
    rig.with(cx, |_, window, cx| window.press("down", cx));
    assert_eq!(active(&rig, cx), 4, "the last row: nowhere below");
    rig.with(cx, |_, window, cx| window.press("right", cx));
    assert_eq!(active(&rig, cx), 5);
    rig.with(cx, |_, window, cx| window.press("up", cx));
    assert_eq!(active(&rig, cx), 3);
    rig.with(cx, |_, window, cx| window.press("left", cx));
    assert_eq!(active(&rig, cx), 2);
    rig.with(cx, |_, window, cx| window.press("enter", cx));
    assert_eq!(rig.events(), [GifPickerEvent::Pick(gif("g2"))]);
}

#[gpui_kit::test]
fn escape_closes(cx: &mut TestAppContext) {
    let rig = gif_rig(cx, ready(3, false, false));
    rig.with(cx, |_, window, cx| window.press("escape", cx));
    assert_eq!(rig.events(), [GifPickerEvent::Close]);
}

#[gpui_kit::test]
fn load_more_only_when_more(cx: &mut TestAppContext) {
    let rig = gif_rig(cx, ready(6, false, false));
    assert!(!rig.has(cx, "gif-more"), "nothing left to load");

    let rig = gif_rig(cx, ready(6, true, false));
    rig.click(cx, "gif-more");
    assert_eq!(rig.events(), [GifPickerEvent::LoadMore]);

    let rig = gif_rig(cx, ready(6, true, true));
    assert!(
        !rig.has(cx, "gif-more"),
        "the next page is already coming: a spinner instead"
    );
}

// ---- The composer's GIF button. ----

struct NoMentions;

impl MentionSource for NoMentions {
    fn candidates(&self, _: &str) -> Vec<MentionCandidate> {
        Vec::new()
    }
}

fn composer_rig(cx: &mut TestAppContext, enabled: bool) -> Rig<Composer, ComposerEvent> {
    rig::<Composer, ComposerEvent>(cx, 1200., move |window, cx| {
        let drafts = cx.new(|_| DraftStore::default());
        let mut composer = Composer::new(
            ComposerConfig {
                conversation: Conversation::Channel { id: "c1".into() },
                source: Rc::new(NoMentions),
                drafts,
                placeholder: "Message #general".into(),
                max_file_bytes: None,
                mode: ComposerMode::Send,
            },
            window,
            cx,
        );
        composer.set_gifs_enabled(enabled, cx);
        composer
    })
}

#[gpui_kit::test]
fn gif_button_only_when_enabled(cx: &mut TestAppContext) {
    let rig = composer_rig(cx, false);
    assert!(!rig.has(cx, "composer-gif"), "the server offers no GIFs");
    let rig = composer_rig(cx, true);
    assert!(rig.has(cx, "composer-gif"));
}

#[gpui_kit::test]
fn gif_button_emits_open_gifs(cx: &mut TestAppContext) {
    let rig = composer_rig(cx, true);
    rig.click(cx, "composer-gif");
    assert!(
        matches!(rig.events().as_slice(), [ComposerEvent::OpenGifs]),
        "the click opens the GIF picker"
    );
}
