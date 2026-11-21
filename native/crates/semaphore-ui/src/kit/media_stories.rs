//! MediaTile's stories, under the web kit's ids (`KitMediaTile.stories.tsx`: `kit-media-tile--kinds`
//! is `Kinds`). A gradient stands in for a stream: the video slot paints it, as the call screen's
//! frames will.

use super::display::rgb_token;
use super::{MediaKind, MediaTile, VideoFit, media_step};
use crate::stories::Story;
use crate::theme::{self, SemTheme, ThemeInput};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{LAYOUT_GUTTER, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL, TEXT_SMALL};
use semaphore_design::{Intensity, Mode};

#[derive(Clone, Copy)]
enum Look {
    Dark,
    Light,
    Tinted,
}

impl Look {
    fn input(self) -> ThemeInput {
        match self {
            Look::Dark => ThemeInput::new(theme::DEFAULT_BASE, Mode::Dark, Intensity::Minimal),
            Look::Light => ThemeInput::new(theme::DEFAULT_BASE, Mode::Light, Intensity::Minimal),
            Look::Tinted => ThemeInput::new(rgb_token(0x0d9488), Mode::Dark, Intensity::Vibrant),
        }
    }
}

type Body = fn(&App) -> Vec<AnyElement>;

struct Stage {
    body: Body,
}

impl Render for Stage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .id("kit-stage")
            .size_full()
            .overflow_y_scroll()
            .bg(sem.role.ground)
            .text_color(sem.role.text)
            .font_family(theme::FONT_FAMILY)
            .p(px(LAYOUT_GUTTER))
            .flex()
            .flex_col()
            .gap(px(SPACE_XL))
            .children((self.body)(cx))
    }
}

macro_rules! story {
    ($name:literal, $look:expr, $body:expr $(,)?) => {
        Story::new($name, |_, _, cx| {
            theme::apply($look.input(), cx);
            cx.new(|_| Stage { body: $body }).into()
        })
    };
}

fn row(label: impl Into<SharedString>, cx: &App, children: Vec<AnyElement>) -> AnyElement {
    let sem = cx.sem();
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_SM))
        .child(
            div()
                .text_size(px(TEXT_SMALL.size))
                .line_height(px(TEXT_SMALL.line_height))
                .text_color(sem.role.text_secondary)
                .child(label.into()),
        )
        .children(children)
        .into_any_element()
}

/// Tiles side by side, sharing the row (`minmax(240px, 1fr)` on the web), wrapping.
fn grid(tiles: Vec<AnyElement>) -> AnyElement {
    div()
        .flex()
        .flex_wrap()
        .gap(px(SPACE_LG))
        .w_full()
        .children(
            tiles
                .into_iter()
                .map(|tile| div().flex_1().min_w(px(240.)).p(px(4.)).child(tile)),
        )
        .into_any_element()
}

/// A box `width` px wide (at most the row) holding one tile, with room for the ring.
fn sized(width: f32, tile: impl IntoElement) -> AnyElement {
    div()
        .w(px(width))
        .max_w_full()
        .p(px(4.))
        .child(tile)
        .into_any_element()
}

/// A stand-in stream: a diagonal gradient and the label, fitted as the slot says (a screen keeps
/// its 4:3 frame whole, with bars).
fn fake_video(hue: f32, text: &'static str) -> impl FnOnce(super::VideoSlot) -> AnyElement {
    move |slot| {
        let picture = div()
            .rounded(slot.radius)
            .bg(linear_gradient(
                135.,
                linear_color_stop(hsla(hue / 360., 0.6, 0.38, 1.), 0.),
                linear_color_stop(hsla(((hue + 60.) % 360.) / 360., 0.7, 0.22, 1.), 1.),
            ))
            .flex()
            .items_center()
            .justify_center()
            .text_size(px(20.))
            .text_color(hsla(0., 0., 1., 0.85))
            .child(text);
        let picture = match slot.fit {
            VideoFit::Cover => picture.size_full(),
            VideoFit::Contain => picture.h_full().aspect_ratio(4. / 3.),
        };
        div()
            .size_full()
            .flex()
            .justify_center()
            .bg(black())
            .rounded(slot.radius)
            .child(picture)
            .into_any_element()
    }
}

fn tile(id: &'static str, label: &'static str, kind: MediaKind) -> MediaTile {
    MediaTile::new(id, label, kind)
}

fn with_video(id: &'static str, label: &'static str, kind: MediaKind, hue: f32) -> MediaTile {
    tile(id, label, kind).video(fake_video(hue, label))
}

fn any(element: impl IntoElement) -> AnyElement {
    element.into_any_element()
}

fn kinds_body(cx: &App) -> Vec<AnyElement> {
    vec![
        row(
            "With video: a shared screen, a camera",
            cx,
            vec![grid(vec![
                any(with_video(
                    "v-screen",
                    "dropbear's screen",
                    MediaKind::Screen,
                    200.,
                )),
                any(with_video("v-camera", "pri", MediaKind::Camera, 320.)),
            ])],
        ),
        row(
            "No video: avatar, camera and screen show the label",
            cx,
            vec![grid(vec![
                any(tile("n-avatar", "aiko", MediaKind::Avatar)),
                any(tile("n-camera", "kwam3", MediaKind::Camera)),
                any(tile("n-screen", "alexk's screen", MediaKind::Screen)),
            ])],
        ),
    ]
}

fn speaking_body(cx: &App) -> Vec<AnyElement> {
    vec![row(
        "Speaking: the ring, on a camera, a screen and an avatar",
        cx,
        vec![grid(vec![
            any(with_video("s-camera", "dropbear", MediaKind::Camera, 140.).speaking(true)),
            any(with_video("s-screen", "pri's screen", MediaKind::Screen, 30.).speaking(true)),
            any(tile("s-avatar", "dropbear", MediaKind::Avatar).speaking(true)),
        ])],
    )]
}

fn blank_body(cx: &App) -> Vec<AnyElement> {
    vec![row(
        "A blank label reads \"Unknown user\" (named so; the avatar has no initials)",
        cx,
        vec![grid(vec![
            any(tile("b-avatar", " ", MediaKind::Avatar)),
            any(tile("b-camera", "", MediaKind::Camera)),
        ])],
    )]
}

fn long_label_body(_: &App) -> Vec<AnyElement> {
    const LONG: &str = "Squad Up: dropbear with an extremely long display name";
    vec![
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_LG))
            .child(sized(
                200.,
                with_video("l-camera", LONG, MediaKind::Camera, 90.),
            ))
            .child(sized(200., tile("l-avatar", LONG, MediaKind::Avatar)))
            .into_any_element(),
    ]
}

fn sizes_body(cx: &App) -> Vec<AnyElement> {
    let mut rows: Vec<AnyElement> = [120., 160., 180., 220.]
        .into_iter()
        .enumerate()
        .map(|(index, width)| {
            let step = media_step(width);
            let step = format!(
                "{} avatar, padding {}{}",
                step.avatar.name(),
                step.padding,
                if step.label { "" } else { ", no name under it" }
            );
            row(
                format!("{width} px wide: {step}"),
                cx,
                vec![
                    div()
                        .flex()
                        .gap(px(SPACE_MD))
                        .child(sized(
                            width,
                            MediaTile::new(("sz-avatar", index), "dropbear", MediaKind::Avatar),
                        ))
                        .child(sized(
                            width,
                            MediaTile::new(("sz-camera", index), "pri", MediaKind::Camera)
                                .video(fake_video(200., "pri")),
                        ))
                        .into_any_element(),
                ],
            )
        })
        .collect();
    rows.push(row(
        "Full width",
        cx,
        vec![
            div()
                .w_full()
                .p(px(4.))
                .child(tile("sz-full", "dropbear", MediaKind::Avatar))
                .into_any_element(),
        ],
    ));
    rows
}

fn phone_pair_body(_: &App) -> Vec<AnyElement> {
    let pair = |a: MediaTile, b: MediaTile| {
        div()
            .flex()
            .gap(px(SPACE_MD))
            .w_full()
            .child(div().flex_1().min_w_0().p(px(4.)).child(a))
            .child(div().flex_1().min_w_0().p(px(4.)).child(b))
    };
    vec![
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_MD))
            .w_full()
            .child(pair(
                tile("p-1", "dropbear", MediaKind::Avatar).speaking(true),
                tile("p-2", "Squad Up: pri", MediaKind::Avatar),
            ))
            .child(pair(
                with_video("p-3", "aiko", MediaKind::Camera, 30.),
                tile("p-4", "kwam3", MediaKind::Avatar),
            ))
            .into_any_element(),
    ]
}

pub fn stories() -> Vec<Story> {
    use Look::{Dark, Light, Tinted};
    vec![
        story!("kit-media-tile--kinds", Dark, kinds_body),
        story!("kit-media-tile--kinds-light", Light, kinds_body),
        story!("kit-media-tile--kinds-tinted", Tinted, kinds_body),
        story!("kit-media-tile--speaking", Dark, speaking_body),
        story!("kit-media-tile--speaking-light", Light, speaking_body),
        story!("kit-media-tile--blank-label", Dark, blank_body),
        story!("kit-media-tile--blank-label-light", Light, blank_body),
        story!("kit-media-tile--long-label", Dark, long_label_body),
        story!("kit-media-tile--long-label-light", Light, long_label_body),
        story!("kit-media-tile--small-tiles", Dark, sizes_body),
        story!("kit-media-tile--small-tiles-light", Light, sizes_body),
        story!("kit-media-tile--phone-pair", Dark, phone_pair_body),
    ]
}
