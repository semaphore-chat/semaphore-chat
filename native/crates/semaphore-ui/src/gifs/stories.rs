//! The GIF picker's stories, drawn by `rig-shot`: a popover on a desktop and the web's bottom sheet
//! on a phone, in every state core's view has. Every preview is built in memory here; nothing is
//! fetched.

use super::GifPicker;
use crate::composer::{Composer, ComposerConfig, ComposerMode, DraftStore, MentionSource};
use crate::messages::{MediaRef, MediaSource};
use crate::shell::PHONE;
use crate::stories::Story;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use image::{Delay, Frame, RgbaImage};
use semaphore_core::model::{
    AttachmentView, Conversation, ErrorView, GifResultsView, GifView, LoadState, MentionCandidate,
};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

/// One fixture GIF: what the picker's cell needs, and a colour to tell its preview by.
struct Gif {
    id: String,
    title: String,
    width: u32,
    height: u32,
    tint: [u8; 3],
}

fn gif(id: &str, title: &str, width: u32, height: u32, tint: [u8; 3]) -> Gif {
    Gif {
        id: id.to_owned(),
        title: title.to_owned(),
        width,
        height,
        tint,
    }
}

fn featured() -> Vec<Gif> {
    vec![
        gif("g-celebrate", "Celebration", 480, 270, [244, 114, 182]),
        gif("g-cat-typing", "Cat typing", 400, 400, [251, 191, 36]),
        gif("g-shrug", "Shrug", 300, 400, [163, 230, 53]),
        gif("g-deal-with-it", "Deal with it", 480, 270, [56, 189, 248]),
        gif("g-party", "Party", 500, 250, [168, 85, 247]),
        gif("g-nope", "Nope", 360, 360, [244, 63, 94]),
    ]
}

fn cats() -> Vec<Gif> {
    vec![
        gif("g-cat-jam", "Cat jam", 480, 270, [251, 191, 36]),
        gif("g-cat-typing", "Cat typing", 400, 400, [244, 114, 182]),
        gif("g-cat-vibes", "Cat vibing", 300, 400, [34, 197, 94]),
        gif("g-cat-loaf", "Cat loaf", 480, 270, [56, 189, 248]),
        gif("g-cat-nod", "Cat nodding", 360, 360, [168, 85, 247]),
    ]
}

fn phone_gifs() -> Vec<Gif> {
    vec![
        gif("g-phone-one", "One", 400, 500, [244, 114, 182]),
        gif("g-phone-two", "Two", 480, 300, [56, 189, 248]),
        gif("g-phone-three", "Three", 360, 480, [163, 230, 53]),
        gif("g-phone-four", "Four", 400, 400, [251, 191, 36]),
    ]
}

/// The web's preview: the GIF's shape, a diagonal band for some motion.
fn preview(gif: &Gif) -> Arc<RenderImage> {
    // Small: the cell scales it to its own size, and a story doesn't need the pixels.
    let width = 96u32;
    let height = ((96. * gif.height as f32) / gif.width as f32).max(8.) as u32;
    let tint = gif.tint;
    let buffer = RgbaImage::from_fn(width, height, |x, y| {
        let (fx, fy) = (x as f32 / width as f32, y as f32 / height as f32);
        let light = if ((fx + fy) * 0.5).fract() < 0.5 {
            0.7
        } else {
            1.15
        };
        // GPUI's RenderImage frames are BGRA.
        image::Rgba([
            (tint[2] as f32 * light).min(255.) as u8,
            (tint[1] as f32 * light).min(255.) as u8,
            (tint[0] as f32 * light).min(255.) as u8,
            255,
        ])
    });
    Arc::new(RenderImage::new(vec![Frame::from_parts(
        buffer,
        0,
        0,
        Delay::from_numer_denom_ms(100, 1),
    )]))
}

/// A GIF's own address and its preview's, as core hands them over.
fn url(gif: &Gif, preview: bool) -> String {
    let name = if preview { "preview.gif" } else { "giphy.gif" };
    format!(
        "https://media.giphy.com/media/{}/{name}",
        gif.id.trim_start_matches("g-")
    )
}

fn gif_view(gif: &Gif) -> GifView {
    GifView {
        id: gif.id.to_owned(),
        title: gif.title.to_owned(),
        url: url(gif, false),
        preview_url: url(gif, true),
        width: gif.width,
        height: gif.height,
    }
}

/// Answers every fixture's preview, so a story needs no files and no network.
struct Previews {
    images: HashMap<String, Arc<RenderImage>>,
}

impl Previews {
    fn of(gifs: &[Gif]) -> Self {
        let images = gifs
            .iter()
            .map(|gif| (url(gif, true), preview(gif)))
            .collect();
        Self { images }
    }
}

impl MediaSource for Previews {
    fn attachment(&self, _: &AttachmentView) -> MediaRef {
        MediaRef::Missing
    }
    fn emoji(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
    fn avatar(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
    fn gif(&self, preview_url: &str) -> MediaRef {
        self.images
            .get(preview_url)
            .map_or(MediaRef::Missing, |image| MediaRef::Ready(image.clone()))
    }
}

fn view(
    state: LoadState,
    query: &str,
    gifs: &[Gif],
    more: bool,
    loading_more: bool,
) -> GifResultsView {
    GifResultsView {
        state,
        query: query.to_owned(),
        results: gifs.iter().map(gif_view).collect(),
        more,
        loading_more,
        enabled: true,
        needs_permission: false,
    }
}

/// Sixty results of mixed shapes, one page at a time, as a long search comes back.
fn many() -> Vec<Gif> {
    const SHAPES: [(u32, u32); 4] = [(480, 270), (360, 360), (300, 400), (500, 250)];
    const TINTS: [[u8; 3]; 5] = [
        [244, 114, 182],
        [56, 189, 248],
        [163, 230, 53],
        [251, 191, 36],
        [168, 85, 247],
    ];
    (0..60)
        .map(|index| Gif {
            id: format!("g-long-{index}"),
            title: format!(
                "GIF number {index} — a title long enough to need an ellipsis somewhere, \
                     saying what happens in it"
            ),
            width: SHAPES[index % SHAPES.len()].0,
            height: SHAPES[index % SHAPES.len()].1,
            tint: TINTS[index % TINTS.len()],
        })
        .collect()
}

/// The owner's popover on a desktop; the bottom sheet on a phone.
struct PickerFrame {
    picker: Entity<GifPicker>,
}

impl Render for PickerFrame {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        if f32::from(window.viewport_size().width) < PHONE {
            return div()
                .size_full()
                .flex()
                .flex_col()
                .justify_end()
                .bg(hsla(0., 0., 0., 0.5))
                .child(
                    div()
                        .h(relative(0.7))
                        .w_full()
                        .rounded_t(px(16.))
                        .overflow_hidden()
                        .bg(sem.paper)
                        .child(self.picker.clone()),
                )
                .into_any_element();
        }
        div()
            .size_full()
            .bg(sem.background_default)
            .p(px(40.))
            .child(
                div()
                    .w(px(super::WIDTH))
                    .rounded(px(8.))
                    .overflow_hidden()
                    .border_1()
                    .border_color(sem.divider)
                    .shadow_lg()
                    .child(self.picker.clone()),
            )
            .into_any_element()
    }
}

fn picker(
    view: GifResultsView,
    gifs: &[Gif],
    query: &str,
    active: Option<usize>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let media: Rc<dyn MediaSource> = Rc::new(Previews::of(gifs));
    let query = query.to_owned();
    let picker = cx.new(|cx| {
        let mut picker = GifPicker::new(window, cx);
        picker.set_media(media, cx);
        if !query.is_empty() {
            picker
                .field
                .update(cx, |field, cx| field.set_value(&query, window, cx));
            picker.typed = query.clone();
            picker.sent = query;
        }
        picker.set_view(view, cx);
        if let Some(index) = active {
            picker.active = index;
        }
        picker
    });
    cx.new(|_| PickerFrame { picker }).into()
}

// ---- The composer's GIF button. ----

struct NoMentions;

impl MentionSource for NoMentions {
    fn candidates(&self, _: &str) -> Vec<MentionCandidate> {
        Vec::new()
    }
}

struct ComposerHost {
    composer: Entity<Composer>,
}

impl Render for ComposerHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(cx.sem().background_default)
            .flex()
            .flex_col()
            .justify_end()
            .child(self.composer.clone())
    }
}

fn composer(enabled: bool, window: &mut Window, cx: &mut App) -> AnyView {
    let drafts = cx.new(|_| DraftStore::default());
    let composer = cx.new(|cx| {
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
        composer.follow_theme(cx);
        composer.set_gifs_enabled(enabled, cx);
        composer
    });
    cx.new(|_| ComposerHost { composer }).into()
}

/// One story's picker: the fixture's results and their previews, in `state`.
#[allow(clippy::too_many_arguments)]
fn story(
    gifs: Vec<Gif>,
    state: LoadState,
    query: &str,
    more: bool,
    loading_more: bool,
    active: Option<usize>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let results = view(state, query, &gifs, more, loading_more);
    picker(results, &gifs, query, active, window, cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("gif-picker-loading", |_, window, cx| {
            story(
                vec![],
                LoadState::Loading,
                "",
                false,
                false,
                None,
                window,
                cx,
            )
        }),
        Story::new("gif-picker-featured", |_, window, cx| {
            story(
                featured(),
                LoadState::Ready,
                "",
                true,
                false,
                None,
                window,
                cx,
            )
        }),
        Story::new("gif-picker-search", |_, window, cx| {
            story(
                cats(),
                LoadState::Ready,
                "cat",
                false,
                false,
                None,
                window,
                cx,
            )
        }),
        Story::new("gif-picker-empty", |_, window, cx| {
            story(vec![], LoadState::Ready, "", false, false, None, window, cx)
        }),
        Story::new("gif-picker-failed", |_, window, cx| {
            story(
                vec![],
                LoadState::Failed {
                    error: ErrorView {
                        code: "503".into(),
                        message: "GIF search is not configured on this instance.".into(),
                        retryable: true,
                        retry_after_ms: None,
                    },
                },
                "",
                false,
                false,
                None,
                window,
                cx,
            )
        }),
        Story::new("gif-picker-needs-permission", |_, window, cx| {
            let off = GifResultsView {
                needs_permission: true,
                ..view(LoadState::Ready, "", &[], false, false)
            };
            picker(off, &[], "", None, window, cx)
        }),
        Story::new("gif-picker-loading-more", |_, window, cx| {
            story(
                featured(),
                LoadState::Ready,
                "",
                true,
                true,
                None,
                window,
                cx,
            )
        }),
        Story::new("gif-picker-long", |_, window, cx| {
            story(many(), LoadState::Ready, "", true, false, None, window, cx)
        }),
        Story::new("gif-picker-highlighted", |_, window, cx| {
            story(
                featured(),
                LoadState::Ready,
                "",
                false,
                false,
                Some(2),
                window,
                cx,
            )
        }),
        Story::new("gif-picker-phone", |_, window, cx| {
            story(
                phone_gifs(),
                LoadState::Ready,
                "",
                false,
                false,
                None,
                window,
                cx,
            )
        }),
        Story::new("composer-gif-button", |_, window, cx| {
            composer(true, window, cx)
        }),
        Story::new("composer-no-gif-button", |_, window, cx| {
            composer(false, window, cx)
        }),
    ]
}
