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

/// Where a [`ToastAnchor`] may put the toasts in the frame being drawn: `open` from the start of
/// a template's main pane (its [`toast_scope`]) until that pane's own region has rendered, and
/// `claimed` once an anchor inside it drew the region. Children render in tree order, so an
/// anchor inside the pane's content renders after the scope opens and before the pane's region.
#[derive(Default)]
struct AnchorScope {
    open: bool,
    claimed: bool,
}

impl Global for AnchorScope {}

fn set_scope(open: bool, claimed: bool, cx: &mut App) {
    cx.set_global(AnchorScope { open, claimed });
}

fn scope(cx: &App) -> (bool, bool) {
    cx.try_global::<AnchorScope>()
        .map_or((false, false), |scope| (scope.open, scope.claimed))
}

/// The toast region a template puts in its main pane, a direct child of a `relative` element
/// whose foot is where toasts sit. It tells the AppFrame around it not to draw its own, and
/// draws nothing itself when a [`ToastAnchor`] in the same pane drew the region.
pub(crate) fn place_toasts(cx: &mut App) -> TemplateToasts {
    set_placed(true, cx);
    TemplateToasts
}

/// The first child of a template's main pane: opens the pane to [`ToastAnchor`]s. Panes laid out
/// but not shown (a phone's other pane) have none, so an anchor there draws nothing.
pub(crate) fn toast_scope() -> ToastScope {
    ToastScope
}

#[derive(IntoElement)]
pub(crate) struct ToastScope;

impl RenderOnce for ToastScope {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        set_scope(true, false, cx);
        div()
    }
}

/// A template's own toast region: drawn unless an anchor in its pane already drew one. It closes
/// the pane's scope either way.
#[derive(IntoElement)]
pub(crate) struct TemplateToasts;

impl RenderOnce for TemplateToasts {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let (_, claimed) = scope(cx);
        set_scope(false, false, cx);
        if claimed {
            div().into_any_element()
        } else {
            ToastRegion::new().into_any_element()
        }
    }
}

/// A screen embedded above other content in the same pane (the call's stage above a DM's
/// conversation): any [`ToastAnchor`] inside `child` draws nothing, so the anchor of the content
/// below it (above the composer) places the toasts.
///
/// Anchors are claimed in tree order, the first in a pane winning. Wrap the upper screen in this
/// so the lowest pinned part is the one toasts clear.
#[derive(IntoElement)]
pub struct WithoutToastAnchor {
    child: AnyElement,
}

impl WithoutToastAnchor {
    pub fn new(child: impl IntoElement) -> Self {
        Self {
            child: child.into_any_element(),
        }
    }
}

impl RenderOnce for WithoutToastAnchor {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        // The child renders after this and before `Reopen`, in tree order.
        let (open, claimed) = scope(cx);
        set_scope(false, claimed, cx);
        div()
            .size_full()
            .child(self.child)
            .child(Reopen { open, claimed })
    }
}

/// Puts the scope back the way [`WithoutToastAnchor`] found it, after its child.
#[derive(IntoElement)]
struct Reopen {
    open: bool,
    claimed: bool,
}

impl RenderOnce for Reopen {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        set_scope(self.open, self.claimed, cx);
        div()
    }
}

/// Where a screen's toasts sit when the screen pins something to the bottom of a template's main
/// pane (a composer, call controls): the native `useToastClearance`.
///
/// Put it as a child of the `relative` box that ends where the pinned part starts (the message
/// list above the composer, the stage above its bar). The toasts then sit at that box's foot, and
/// the template's own region at the pane's foot draws nothing.
///
/// It works inside the main pane of a [`super::ThreeIslands`] (the centre, or a phone's shown
/// pane). Anywhere else (a pane laid out but not shown, outside a template, a later anchor in
/// the same pane, inside a [`WithoutToastAnchor`]) it draws nothing and the template's or the frame's region is used, so there is
/// always exactly one.
#[derive(IntoElement, Default)]
pub struct ToastAnchor;

impl ToastAnchor {
    pub fn new() -> Self {
        Self
    }
}

impl RenderOnce for ToastAnchor {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let (open, claimed) = scope(cx);
        if open && !claimed {
            set_scope(true, true, cx);
            ToastRegion::new().into_any_element()
        } else {
            div().into_any_element()
        }
    }
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
        set_scope(false, false, cx);
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
        let placed = cx
            .try_global::<ToastsPlaced>()
            .is_some_and(|placed| placed.0);
        set_placed(false, cx);
        if placed {
            div().into_any_element()
        } else {
            ToastRegion::new().into_any_element()
        }
    }
}
