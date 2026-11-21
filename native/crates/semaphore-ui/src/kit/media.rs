//! MediaTile: a 16:9 rounded box for one participant's video, a shared screen, or their avatar,
//! as the web kit draws it (`frontend/src/kit/display/MediaTile.tsx`, `design/guide/components.md`).
//!
//! The tile has no video of its own. The call screen hands it a [`MediaTile::video`] slot: a
//! closure that gets a [`VideoSlot`] (how to fit the picture, the corner radius, what shows
//! outside the corners) and returns the element that paints the frames, a `canvas` over
//! `VideoFrames::paint` as the voice stage draws one today. The tile lays it out over its whole
//! box, under the caption.
//!
//! The web steps the avatar down with container queries. GPUI has none, so the centred contents
//! are laid out once per step and only the step that fits the tile's laid-out width is drawn
//! ([`ByWidth`]), in the same frame: nothing flickers on a resize.

use super::display::{Avatar, AvatarSize, outset, shown_name, styled, weighted};
use super::surface::{Surface, SurfaceScope, stand_out_fill, tint_base};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    BORDER_SELECTED, RADIUS_CARD, RADIUS_SM, SPACE_MD, SPACE_SM, TEXT_BODY_STRONG, TEXT_META,
};

/// What a tile shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    /// A shared screen, shown whole.
    Screen,
    /// A camera, filling the box.
    Camera,
    /// Someone with no video: their avatar. Never draws a video.
    Avatar,
}

impl MediaKind {
    /// How this kind's picture fits the tile.
    pub fn fit(self) -> VideoFit {
        match self {
            MediaKind::Screen => VideoFit::Contain,
            MediaKind::Camera | MediaKind::Avatar => VideoFit::Cover,
        }
    }
}

/// How a picture fits a tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoFit {
    /// The whole frame, with bars if the shape differs (a shared screen: a cropped edge is lost
    /// content).
    Contain,
    /// Fills the tile, cropping (a face).
    Cover,
}

/// What the video slot's element needs to paint like the tile.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VideoSlot {
    /// How to fit the frame in the tile.
    pub fit: VideoFit,
    /// The tile's corner radius. The tile clips the element to its box and masks the corners
    /// itself, so a frame painted square or oversized (cropped to cover) still comes out rounded.
    pub radius: Pixels,
}

type VideoBuilder = Box<dyn FnOnce(VideoSlot) -> AnyElement>;

/// The 16:9 shape.
const RATIO: f32 = 16. / 9.;

/// What the centred avatar, gap and label take: `padding` each side, `space.sm` between, one meta
/// line.
fn stack_height(avatar: AvatarSize, padding: f32) -> f32 {
    2. * padding + avatar.px() + SPACE_SM + TEXT_META.line_height
}

/// The tile width at which a 16:9 box is as high as that stack.
fn width_for(height: f32) -> f32 {
    (height * 16. / 9.).ceil()
}

/// The tile widths below which the avatar steps down to `lg`, then to `md` with the smaller
/// padding, then the label goes. The web's `FITS_XL`, `FITS_LG` and `FITS_MD`.
pub fn media_tile_breakpoints() -> [f32; 3] {
    [
        width_for(stack_height(AvatarSize::Xl, SPACE_MD)),
        width_for(stack_height(AvatarSize::Lg, SPACE_MD)),
        width_for(stack_height(AvatarSize::Md, SPACE_SM)),
    ]
}

/// How the centred contents of a tile `width` px wide are drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MediaStep {
    /// The avatar's size (an `avatar` tile).
    pub avatar: AvatarSize,
    /// The padding round the centred stack.
    pub padding: f32,
    /// Whether the label shows under the avatar (the group's name always carries it).
    pub label: bool,
}

/// The step for a tile `width` px wide.
pub fn media_step(width: f32) -> MediaStep {
    let [xl, lg, md] = media_tile_breakpoints();
    let step = |avatar, padding, label| MediaStep {
        avatar,
        padding,
        label,
    };
    if width >= xl {
        step(AvatarSize::Xl, SPACE_MD, true)
    } else if width >= lg {
        step(AvatarSize::Lg, SPACE_MD, true)
    } else if width >= md {
        step(AvatarSize::Md, SPACE_SM, true)
    } else {
        step(AvatarSize::Md, SPACE_SM, false)
    }
}

/// The accessible name of a tile: the label (or "Unknown user"), and ", speaking".
pub fn media_tile_label(label: &str, speaking: bool) -> String {
    let name = shown_name(label);
    if speaking {
        format!("{name}, speaking")
    } else {
        name.to_owned()
    }
}

/// A 16:9 rounded box for one participant's video, shared screen or avatar. One group named by
/// its label (and ", speaking"); the picture inside is only a picture. Without video it shows the
/// label, and for `Avatar` a kit Avatar above it, stepping down as the tile narrows. As wide as its
/// container, which sets the size; leave two `border.selected` round it for the speaking ring.
#[derive(IntoElement)]
pub struct MediaTile {
    id: ElementId,
    label: SharedString,
    kind: MediaKind,
    speaking: bool,
    on: Option<Surface>,
    fit: Option<VideoFit>,
    video: Option<VideoBuilder>,
}

impl MediaTile {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, kind: MediaKind) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            kind,
            speaking: false,
            on: None,
            fit: None,
            video: None,
        }
    }

    /// Someone is talking: the speaking ring, and ", speaking" in the name.
    pub fn speaking(mut self, speaking: bool) -> Self {
        self.speaking = speaking;
        self
    }

    /// The layer it is drawn on (otherwise the current [`SurfaceScope`]'s).
    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }

    /// How the video fits, instead of the kind's own ([`MediaKind::fit`]): `Contain` for a camera
    /// shown whole on a focused stage, say.
    pub fn fit(mut self, fit: VideoFit) -> Self {
        self.fit = Some(fit);
        self
    }

    /// The video: an element that paints the frames over the whole tile, built with the tile's
    /// [`VideoSlot`]. Set it only while the track is live; without it, or for `Avatar`, the tile
    /// shows the label (and the avatar). Until the first frame, paint nothing: the tile's fill and
    /// the caption show. Like the web's `videoRef`, the slot is the tile's only video hook.
    pub fn video(mut self, build: impl FnOnce(VideoSlot) -> AnyElement + 'static) -> Self {
        self.video = Some(Box::new(build));
        self
    }
}

fn label_text(label: SharedString) -> Div {
    styled(weighted(TEXT_META, TEXT_BODY_STRONG.weight), label)
        .min_w_0()
        .max_w_full()
        .overflow_hidden()
        .text_ellipsis()
}

impl RenderOnce for MediaTile {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let on = Surface::or_current(self.on, cx);
        let behind = tint_base(&sem, on);
        let name = media_tile_label(&self.label, self.speaking);
        let initials_from: SharedString = shown_name(&self.label).to_owned().into();
        let video = self.video.filter(|_| self.kind != MediaKind::Avatar);
        // A blank label is named "Unknown user" but draws no line or chip: an empty one would only
        // push the avatar off centre, or put an empty pill on the picture.
        let has_label = !self.label.trim().is_empty();

        let body: AnyElement = match video {
            Some(build) => {
                let slot = VideoSlot {
                    fit: self.fit.unwrap_or(self.kind.fit()),
                    radius: px(RADIUS_CARD),
                };
                div()
                    .absolute()
                    .inset_0()
                    .child(div().absolute().inset_0().child(build(slot)))
                    .child(corner_mask(behind))
                    .when(has_label, |body| {
                        body.child(
                            // Over video the label sits on its own opaque chip, so it reads on any
                            // picture.
                            div()
                                .absolute()
                                .left(px(SPACE_SM))
                                .bottom(px(SPACE_SM))
                                .right(px(SPACE_SM))
                                .flex()
                                .child(
                                    label_text(self.label.clone())
                                        .id("media-caption")
                                        .test_support()
                                        .px(px(SPACE_SM))
                                        .rounded(px(RADIUS_SM))
                                        .bg(sem.role.surface)
                                        .text_color(sem.role.text),
                                ),
                        )
                    })
                    .into_any_element()
            }
            None => {
                let [xl, lg, md] = media_tile_breakpoints();
                let steps = [xl, lg, md, 0.].map(|width| {
                    let step = media_step(width);
                    let centre = div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .gap(px(SPACE_SM))
                        .p(px(step.padding))
                        .min_w_0()
                        .when(self.kind == MediaKind::Avatar, |centre| {
                            centre.child(
                                div()
                                    .id(SharedString::from(format!(
                                        "media-avatar-{}",
                                        step.avatar.name()
                                    )))
                                    .test_support()
                                    .child(
                                        Avatar::new(initials_from.clone())
                                            .size(step.avatar)
                                            .decorative(true),
                                    ),
                            )
                        })
                        .when(step.label && has_label, |centre| {
                            centre.child(
                                div()
                                    .id("media-label")
                                    .test_support()
                                    .min_w_0()
                                    .max_w_full()
                                    .child(label_text(self.label.clone())),
                            )
                        });
                    (width, centre.into_any_element())
                });
                ByWidth {
                    steps: steps.into(),
                }
                .into_any_element()
            }
        };

        div()
            .id(self.id)
            .test_support()
            .role(Role::Group)
            .aria_label(name)
            .relative()
            .w_full()
            .aspect_ratio(RATIO)
            .rounded(px(RADIUS_CARD))
            .child(
                // Clips the picture to the rounded corners; the ring outside is not clipped.
                div()
                    .absolute()
                    .inset_0()
                    .overflow_hidden()
                    .rounded(px(RADIUS_CARD))
                    .bg(stand_out_fill(&sem, on))
                    .text_color(sem.role.text)
                    // The frame is the stand-out fill of its layer; what is drawn on it (the
                    // avatar) sits one layer over.
                    .child(SurfaceScope::new(on.inside_fill(), body)),
            )
            // Last, so nothing in the tile (the corner masks) is ever painted over it.
            .when(self.speaking, |root| {
                root.children(ring(sem.role.positive, behind))
            })
    }
}

/// The speaking ring, as Avatar's (a gap in the layer's colour, then the positive ring, outside
/// the box), but border-only: drawn over the tile, it covers nothing inside it.
fn ring(positive: Hsla, behind: Hsla) -> [AnyElement; 2] {
    [
        outset(BORDER_SELECTED, RADIUS_CARD)
            .border(px(BORDER_SELECTED))
            .border_color(behind)
            .into_any_element(),
        outset(BORDER_SELECTED * 2., RADIUS_CARD)
            .id("media-speaking-ring")
            .test_support()
            .border(px(BORDER_SELECTED))
            .border_color(positive)
            .into_any_element(),
    ]
}

/// Paints the layer's colour outside the tile's rounded corners, over the video: GPUI clips the
/// video to the tile's rectangle, not its rounded shape. A border whose inner edge is the tile's
/// outline, wide enough to reach the box's corners, clipped to the box by the frame.
fn corner_mask(behind: Hsla) -> Div {
    let width = (RADIUS_CARD * (std::f32::consts::SQRT_2 - 1.)).ceil() + 1.;
    outset(width, RADIUS_CARD)
        .border(px(width))
        .border_color(behind)
}

/// Lays out every step and draws only the first whose minimum width the laid-out width reaches
/// (the last otherwise). Steps go widest first. Fills its parent; each step positions itself.
struct ByWidth {
    steps: Vec<(f32, AnyElement)>,
}

impl ByWidth {
    fn pick(&self, width: f32) -> usize {
        self.steps
            .iter()
            .position(|(min, _)| width >= *min)
            .unwrap_or(self.steps.len().saturating_sub(1))
    }
}

impl IntoElement for ByWidth {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl Element for ByWidth {
    type RequestLayoutState = ();
    type PrepaintState = Option<usize>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let children: Vec<LayoutId> = self
            .steps
            .iter_mut()
            .map(|(_, child)| child.request_layout(window, cx))
            .collect();
        let style = Style {
            position: Position::Absolute,
            size: size(relative(1.).into(), relative(1.).into()),
            ..Style::default()
        };
        (window.request_layout(style, children, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Option<usize> {
        if self.steps.is_empty() {
            return None;
        }
        // Steps not drawn are never prepainted, so they add no hitbox and no accessibility node.
        let shown = self.pick(f32::from(bounds.size.width));
        self.steps[shown].1.prepaint(window, cx);
        Some(shown)
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        shown: &mut Option<usize>,
        window: &mut Window,
        cx: &mut App,
    ) {
        if let Some(shown) = *shown {
            self.steps[shown].1.paint(window, cx);
        }
    }
}
