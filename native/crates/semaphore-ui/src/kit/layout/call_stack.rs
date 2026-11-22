//! CallStack and the three-islands call slot (`frontend/src/kit/layout/CallStack.tsx`).

use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{CONTROL_MD, LAYOUT_GUTTER, SPACE_LG, SPACE_SM};

/// The share of the layout's height the call surface may take.
pub(crate) const SURFACE_SHARE: f32 = 0.4;

/// The least a phone's shown pane keeps while a call bar is there: a composer (`control.md`,
/// with the space screens draw above it, `space.sm`, and below it, `space.lg`). The call's
/// surface gives way first.
pub const PANE_MIN: f32 = CONTROL_MD + SPACE_SM + SPACE_LG;

/// What the three-islands call slot holds while a call has video: the bounded `surface` above the
/// `bar`. The bar never gives up height; the surface takes at most two fifths of the layout's
/// height, less when the frame is too short for that and the pane's minimum, and scrolls inside
/// itself. Layout only: no surface colour, no padding, no landmark.
///
/// `summary` stands in for the surface on the web while an on-screen keyboard is up. A desktop
/// window has none, so it is accepted and never drawn.
pub struct CallStack {
    bar: AnyElement,
    surface: Option<AnyElement>,
    summary: Option<AnyElement>,
}

impl CallStack {
    pub fn new(bar: impl IntoElement) -> Self {
        Self {
            bar: bar.into_any_element(),
            surface: None,
            summary: None,
        }
    }

    /// The call's video and what it offers, above the bar.
    pub fn surface(mut self, surface: impl IntoElement) -> Self {
        self.surface = Some(surface.into_any_element());
        self
    }

    /// One line for the surface while an on-screen keyboard is up: never drawn here.
    pub fn summary(mut self, summary: impl IntoElement) -> Self {
        self.summary = Some(summary.into_any_element());
        self
    }

    pub fn has_summary(&self) -> bool {
        self.summary.is_some()
    }
}

/// What a template's call slot holds: the bar on its own, or a [`CallStack`].
pub enum CallSlot {
    Bar(AnyElement),
    Stack(CallStack),
}

impl<E: IntoElement> From<E> for CallSlot {
    fn from(bar: E) -> Self {
        CallSlot::Bar(bar.into_any_element())
    }
}

impl From<CallStack> for CallSlot {
    fn from(stack: CallStack) -> Self {
        CallSlot::Stack(stack)
    }
}

impl CallSlot {
    /// The slot's pieces, each a direct child of the template's column (a flex column of definite
    /// height), so the surface's share resolves against the column: the web's `40cqh` of the grid.
    /// The first piece is a gutter below what is above it.
    pub(crate) fn into_parts(self) -> Vec<AnyElement> {
        let bar = |bar: AnyElement, gap: f32| {
            div()
                .id("kit-call-bar")
                .test_support()
                .flex_none()
                .min_w_0()
                .mt(px(gap))
                .child(bar)
                .into_any_element()
        };
        match self {
            CallSlot::Bar(element) => vec![bar(element, LAYOUT_GUTTER)],
            CallSlot::Stack(CallStack { bar: element, surface: None, .. }) => {
                vec![bar(element, LAYOUT_GUTTER)]
            }
            CallSlot::Stack(CallStack {
                bar: element,
                surface: Some(surface),
                ..
            }) => vec![
                div()
                    .id("kit-call-surface")
                    .test_support()
                    .flex_shrink(1.)
                    .min_w_0()
                    .min_h_0()
                    .max_h(relative(SURFACE_SHARE))
                    .mt(px(LAYOUT_GUTTER))
                    .overflow_y_scroll()
                    .overflow_x_hidden()
                    .child(surface)
                    .into_any_element(),
                bar(element, SPACE_SM),
            ],
        }
    }
}
