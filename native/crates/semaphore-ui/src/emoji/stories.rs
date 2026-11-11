//! The picker's stories: anchored as a popover on a desktop, a bottom sheet on a phone.

use super::EmojiPicker;
use crate::messages::{MediaRef, MediaSource};
use crate::shell::PHONE;
use crate::stories::Story;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use image::{Delay, Frame, RgbaImage};
use semaphore_core::model::{AttachmentView, EmojiView};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

/// A coloured badge for every custom emoji, so a story needs no files.
struct Badges {
    cache: std::cell::RefCell<HashMap<String, Arc<RenderImage>>>,
}

fn badge(seed: usize) -> Arc<RenderImage> {
    const SIZE: u32 = 32;
    const TINTS: [[u8; 3]; 6] = [
        [245, 158, 11],
        [34, 197, 94],
        [244, 63, 94],
        [99, 102, 241],
        [20, 184, 166],
        [168, 85, 247],
    ];
    let tint = TINTS[seed % TINTS.len()];
    let buffer = RgbaImage::from_fn(SIZE, SIZE, |x, y| {
        let (dx, dy) = (x as f32 - 15.5, y as f32 - 15.5);
        let inside = if seed.is_multiple_of(2) {
            dx * dx + dy * dy <= 15. * 15.
        } else {
            dx.abs() <= 13. && dy.abs() <= 13.
        };
        // GPUI's RenderImage frames are BGRA.
        if inside {
            image::Rgba([tint[2], tint[1], tint[0], 255])
        } else {
            image::Rgba([0, 0, 0, 0])
        }
    });
    Arc::new(RenderImage::new(vec![Frame::from_parts(
        buffer,
        0,
        0,
        Delay::from_numer_denom_ms(0, 1),
    )]))
}

impl MediaSource for Badges {
    fn attachment(&self, _: &AttachmentView) -> MediaRef {
        MediaRef::Missing
    }
    fn emoji(&self, emoji_id: &str) -> MediaRef {
        // One id never loads, to show a failed image among the rest.
        if emoji_id == "e-broken" {
            return MediaRef::Missing;
        }
        let seed = emoji_id.bytes().map(usize::from).sum::<usize>();
        let image = self
            .cache
            .borrow_mut()
            .entry(emoji_id.to_owned())
            .or_insert_with(|| badge(seed))
            .clone();
        MediaRef::Ready(image)
    }
    fn avatar(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
}

fn emoji(id: &str, name: &str) -> EmojiView {
    EmojiView {
        id: id.into(),
        name: name.into(),
        file_id: format!("file-{id}"),
    }
}

fn a_few() -> Vec<EmojiView> {
    vec![
        emoji("e-party", "party_blob"),
        emoji("e-cat", "cat_jam"),
        emoji("e-ship", "shipit"),
        emoji("e-broken", "gone_missing"),
        emoji("e-heart", "heart_spin"),
    ]
}

fn many() -> Vec<EmojiView> {
    (0..150)
        .map(|index| emoji(&format!("e-{index}"), &format!("custom_emoji_{index}")))
        .collect()
}

/// The owner's popover on a desktop; the bottom sheet on a phone.
struct PickerFrame {
    picker: Entity<EmojiPicker>,
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
                    .w(px(300.))
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

fn picker(custom: Vec<EmojiView>, query: &str, window: &mut Window, cx: &mut App) -> AnyView {
    let source = Rc::new(Badges {
        cache: Default::default(),
    });
    let picker = cx.new(|cx| {
        let mut picker = EmojiPicker::new(custom, source, window, cx);
        if !query.is_empty() {
            picker.field.update(cx, |field, cx| {
                field.set_value(query.to_owned(), window, cx)
            });
            picker.set_query(query, cx);
        }
        picker
    });
    cx.new(|_| PickerFrame { picker }).into()
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("emoji-default", |_, window, cx| {
            picker(a_few(), "", window, cx)
        }),
        Story::new("emoji-no-custom", |_, window, cx| {
            picker(Vec::new(), "", window, cx)
        }),
        Story::new("emoji-search", |_, window, cx| {
            picker(a_few(), "heart", window, cx)
        }),
        Story::new("emoji-no-matches", |_, window, cx| {
            picker(a_few(), "zzzz", window, cx)
        }),
        Story::new("emoji-long-custom", |_, window, cx| {
            picker(many(), "", window, cx)
        }),
    ]
}
