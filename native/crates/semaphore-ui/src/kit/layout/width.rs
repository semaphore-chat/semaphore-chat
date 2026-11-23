//! The three width ranges (`frontend/src/kit/layout/breakpoints.ts`), from the breakpoint tokens.

use gpui_kit::{Pixels, Window};
use semaphore_design::lounge::{BREAKPOINT_DOCKED, BREAKPOINT_PHONE};

/// The width range a layout is in.
/// - `Phone`: below `breakpoint.phone`.
/// - `Compact`: from `breakpoint.phone` up to, not including, `breakpoint.docked`.
/// - `Wide`: `breakpoint.docked` and above.
///
/// Each range is half-open, so a fractional width falls in exactly one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WidthRange {
    Phone,
    Compact,
    Wide,
}

impl WidthRange {
    /// The range a width is in. A width that is not a number counts as a phone's.
    pub fn of(width: Pixels) -> Self {
        let width = f32::from(width);
        if width >= BREAKPOINT_DOCKED {
            WidthRange::Wide
        } else if width >= BREAKPOINT_PHONE {
            WidthRange::Compact
        } else {
            WidthRange::Phone
        }
    }

    /// The range of the window being drawn: the web reads the viewport, so does this.
    pub fn current(window: &Window) -> Self {
        Self::of(window.viewport_size().width)
    }

    pub fn is_phone(self) -> bool {
        self == WidthRange::Phone
    }

    pub fn is_wide(self) -> bool {
        self == WidthRange::Wide
    }
}
