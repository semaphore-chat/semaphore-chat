//! `PaintedRow`: what the list learns from a row as it is placed on screen.
//!
//! - The rows actually placed this frame (not only measured in the overdraw), with their bounds:
//!   the list's Tab stop is picked from these (`Shared::tab_stop_seq`).
//! - The row GPUI's list draws after the visible ones because it holds focus off screen
//!   (`ListState::splice_focusable`) is kept drawn but out of sight and out of hit testing: an
//!   empty content mask. It is placed under the last visible row: below the view, or at the end of
//!   the list in the room under the newest message.

use super::row::Shared;
use gpui_kit::*;
use std::rc::Rc;

pub(crate) struct PaintedRow {
    seq: i64,
    shared: Rc<Shared>,
    child: AnyElement,
}

impl PaintedRow {
    pub(crate) fn new(seq: i64, shared: Rc<Shared>, child: AnyElement) -> Self {
        Self { seq, shared, child }
    }
}

impl IntoElement for PaintedRow {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

/// Nothing shows and nothing is hit through an empty mask.
fn hidden_mask() -> ContentMask<Pixels> {
    ContentMask {
        bounds: Bounds::default(),
    }
}

impl Element for PaintedRow {
    type RequestLayoutState = ();
    /// Whether the row is the off-screen focused one, kept out of sight.
    type PrepaintState = bool;

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
        (self.child.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        // The list places its visible rows, then the off-screen focused one after the last of
        // them: under the content (the room under the newest message, at the end of the list),
        // where no visible row starts.
        let mask = window.content_mask().bounds;
        let content_bottom = mask.bottom() - self.shared.bottom_room.get();
        let hidden = self.shared.focusable.get() == Some(self.seq)
            && bounds.top() >= content_bottom - px(0.5);
        if hidden {
            window.with_content_mask(Some(hidden_mask()), |window| {
                self.child.prepaint(window, cx)
            });
        } else {
            self.shared.viewport.set(window.content_mask().bounds);
            self.shared.drawn.borrow_mut().push((self.seq, bounds));
            self.child.prepaint(window, cx);
        }
        hidden
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        hidden: &mut bool,
        window: &mut Window,
        cx: &mut App,
    ) {
        if *hidden {
            window.with_content_mask(Some(hidden_mask()), |window| self.child.paint(window, cx));
        } else {
            self.child.paint(window, cx);
        }
    }
}
