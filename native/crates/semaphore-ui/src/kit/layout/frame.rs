//! AppFrame: the ground every layout sits on (`frontend/src/kit/layout/AppFrame.tsx`).

use crate::kit::{Surface, SurfaceScope, ToastRegion};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{LAYOUT_GUTTER, SPACE_SM, TEXT_BODY};

/// Whether a template placed the toast region in the frame being drawn. Reset by every AppFrame
/// before its children render and again once its fallback has read it, so it never carries
/// over from one frame, or one AppFrame, to the next.
#[derive(Default)]
struct ToastsPlaced(bool);

impl Global for ToastsPlaced {}

fn set_placed(placed: bool, cx: &mut App) {
    cx.set_global(ToastsPlaced(placed));
}

/// The toast region a template puts in its main pane, a direct child of a `relative` element
/// whose foot is where toasts sit. It tells the AppFrame around it not to draw its own.
pub(crate) fn place_toasts(cx: &mut App) -> ToastRegion {
    set_placed(true, cx);
    ToastRegion::new()
}

/// The ground every layout sits on. It fills the window, insets its content by the gutter, and
/// never scrolls: islands scroll inside themselves. Render one layout template inside it. It adds
/// no landmark, and its content is on the `Ground` layer.
///
/// [`AppFrame::banner`] adds a row above the layout, for a notice about the whole app (a kit
/// Alert); several stack, the first on top, a small gap apart. They take their natural height and
/// the layout fills the rest.
///
/// It draws the toast region at its own foot only when the template inside did not place one in
/// its main pane (a frame around plain content).
#[derive(IntoElement)]
pub struct AppFrame {
    child: AnyElement,
    banners: Vec<AnyElement>,
}

impl AppFrame {
    pub fn new(child: impl IntoElement) -> Self {
        Self {
            child: child.into_any_element(),
            banners: Vec::new(),
        }
    }

    /// One more notice in the banner row, under the ones already given.
    pub fn banner(mut self, banner: impl IntoElement) -> Self {
        self.banners.push(banner.into_any_element());
        self
    }
}

impl RenderOnce for AppFrame {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        // The children (and so the template) render after this, in layout.
        set_placed(false, cx);
        let sem = cx.sem();
        let root = div()
            .id("app-frame")
            .test_support()
            .size_full()
            .relative()
            .flex()
            .flex_col()
            .p(px(LAYOUT_GUTTER))
            .overflow_hidden()
            .bg(sem.role.ground)
            .text_color(sem.role.text)
            .font_family(TEXT_BODY.family)
            .text_size(px(TEXT_BODY.size))
            .line_height(px(TEXT_BODY.line_height))
            .when(!self.banners.is_empty(), |root| {
                root.child(
                    div()
                        .id("app-frame-banner")
                        .test_support()
                        .flex_shrink_0()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(SPACE_SM))
                        .mb(px(LAYOUT_GUTTER))
                        .children(self.banners),
                )
            })
            .child(self.child)
            .child(FrameToasts);
        SurfaceScope::new(Surface::Ground, root)
    }
}

/// The frame's last child: it renders after the template, so it knows whether one placed the
/// region.
#[derive(IntoElement)]
struct FrameToasts;

impl RenderOnce for FrameToasts {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let placed = cx.try_global::<ToastsPlaced>().is_some_and(|placed| placed.0);
        set_placed(false, cx);
        if placed {
            div().into_any_element()
        } else {
            ToastRegion::new().into_any_element()
        }
    }
}
