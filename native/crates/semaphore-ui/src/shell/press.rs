//! A long press on a member row, on a phone: the web's `useLongPress` (500 ms, cancelled by a
//! drag), which opens the member menu as a right-click does on a desktop. The press that opened
//! the menu doesn't also click the row.

use gpui_kit::{Pixels, Point};
use std::time::Duration;

/// How long a finger rests before the menu opens.
pub const LONG_PRESS: Duration = Duration::from_millis(500);
/// How far it may drift meanwhile (a scroll moves more).
pub const SLOP_PX: f32 = 10.;

/// Whether a press that started at `from` and is now at `to` has become a drag.
pub fn moved_too_far(from: Point<Pixels>, to: Point<Pixels>) -> bool {
    let (dx, dy) = (f32::from(to.x - from.x), f32::from(to.y - from.y));
    dx * dx + dy * dy > SLOP_PX * SLOP_PX
}

/// A press on a member row, until it's released, dragged, or long enough.
#[derive(Debug, Clone, PartialEq)]
pub struct Press {
    pub user_id: String,
    pub at: Point<Pixels>,
    /// The menu opened: the release that follows isn't a click.
    pub fired: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use gpui_kit::{point, px};

    #[test]
    fn a_press_becomes_a_drag_past_the_slop() {
        let from = point(px(100.), px(100.));
        let cases = [
            (point(px(100.), px(100.)), false),
            (point(px(110.), px(100.)), false),
            (point(px(100.), px(90.)), false),
            (point(px(107.), px(107.)), false),
            (point(px(108.), px(108.)), true),
            (point(px(111.), px(100.)), true),
            (point(px(100.), px(60.)), true),
            (point(px(-100.), px(100.)), true),
        ];
        for (to, want) in cases {
            assert_eq!(moved_too_far(from, to), want, "{to:?}");
        }
    }
}
