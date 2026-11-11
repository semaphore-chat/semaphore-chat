//! Where the float card sits: the web's `utils/pipPosition.ts`, ported. A placement is a corner and
//! an inward offset (or, docked, just the corner), so a saved one survives a resize. Everything here
//! is pure; `FloatCard` owns the state and the pointer, the app persists the placement.
//!
//! Coordinates are the card's area's own: (0, 0) is its top-left corner.

use super::theme as voice_theme;
use crate::theme::SemTheme;
use gpui_kit::*;

pub const DOCK_MARGIN: f32 = 16.;
pub const EDGE_PADDING: f32 = 8.;
pub const MIN_WIDTH: f32 = 320.;
pub const MIN_HEIGHT: f32 = 240.;
pub const DEFAULT_WIDTH: f32 = 480.;
pub const DEFAULT_HEIGHT: f32 = 360.;
const DOCK_ZONE_WIDTH: f32 = 160.;
const DOCK_ZONE_HEIGHT: f32 = 140.;
/// Room kept free at the bottom of the message column, for the typing indicator and "jump to
/// latest".
pub const REGION_BOTTOM_LANE: f32 = 56.;
/// An area smaller than this can't hold the smallest card: the pill shows instead.
pub const MIN_REGION_WIDTH: f32 = MIN_WIDTH + DOCK_MARGIN * 2.;
pub const MIN_REGION_HEIGHT: f32 = MIN_HEIGHT + REGION_BOTTOM_LANE + DOCK_MARGIN * 2.;
/// The minimized pill's footprint, to anchor it to the card's corner.
pub const PILL_SIZE: Size2 = Size2 {
    width: 200.,
    height: 52.,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum PipAnchor {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
}

impl PipAnchor {
    pub const ALL: [PipAnchor; 4] = [
        PipAnchor::TopLeft,
        PipAnchor::TopRight,
        PipAnchor::BottomLeft,
        PipAnchor::BottomRight,
    ];

    fn is_top(self) -> bool {
        matches!(self, Self::TopLeft | Self::TopRight)
    }

    fn is_left(self) -> bool {
        matches!(self, Self::TopLeft | Self::BottomLeft)
    }

    /// The web's stored name, for the app's settings.
    pub fn name(self) -> &'static str {
        match self {
            Self::TopLeft => "top-left",
            Self::TopRight => "top-right",
            Self::BottomLeft => "bottom-left",
            Self::BottomRight => "bottom-right",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|anchor| anchor.name() == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Point2 {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Size2 {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Rect2 {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect2 {
    pub fn contains(&self, point: Point2) -> bool {
        point.x >= self.x
            && point.x <= self.x + self.width
            && point.y >= self.y
            && point.y <= self.y + self.height
    }
}

/// The area the card lives in, and the strip at its bottom it keeps clear of.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Viewport {
    pub width: f32,
    pub height: f32,
    pub bottom_inset: f32,
}

impl Viewport {
    pub fn new(width: f32, height: f32) -> Self {
        Self {
            width,
            height,
            bottom_inset: REGION_BOTTOM_LANE,
        }
    }

    /// Room for the smallest card plus its margins; smaller shows the pill.
    pub fn fits_card(&self) -> bool {
        self.width >= MIN_REGION_WIDTH
            && self.height >= MIN_HEIGHT + self.bottom_inset + DOCK_MARGIN * 2.
    }
}

/// What the app stores (the web's `PipPlacement`, persisted per window-width bucket).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PipPlacement {
    pub anchor: PipAnchor,
    pub offset: Point2,
    pub size: Size2,
    pub docked: bool,
    pub collapsed: bool,
}

impl Default for PipPlacement {
    /// Docked bottom-right at 480x360, as on the web.
    fn default() -> Self {
        Self {
            anchor: PipAnchor::BottomRight,
            offset: Point2::default(),
            size: Size2 {
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
            },
            docked: true,
            collapsed: false,
        }
    }
}

impl PipPlacement {
    /// A stored placement worth using: finite numbers and a real size. A corrupt one would put the
    /// card where nobody can get it back.
    pub fn is_valid(&self) -> bool {
        [
            self.offset.x,
            self.offset.y,
            self.size.width,
            self.size.height,
        ]
        .iter()
        .all(|value| value.is_finite())
            && self.size.width > 0.
            && self.size.height > 0.
    }

    /// The first placement in a column: docked bottom-right, 45% of its width (320 to 480), 4:3.
    pub fn for_region(viewport: Viewport) -> Self {
        let width = (viewport.width * 0.45)
            .clamp(MIN_WIDTH, DEFAULT_WIDTH)
            .round();
        Self {
            size: Size2 {
                width,
                height: (width * 3. / 4.).round().max(MIN_HEIGHT),
            },
            ..Self::default()
        }
    }
}

/// The window-width buckets the placement is remembered per.
pub fn viewport_bucket(window_width: f32) -> &'static str {
    match window_width {
        w if w < 1280. => "lt1280",
        w if w < 1600. => "1280",
        w if w < 1920. => "1600",
        w if w < 2560. => "1920",
        _ => "2560",
    }
}

/// Keeps a card of `size` at `pos` `EDGE_PADDING` inside the area.
pub fn clamp_position(pos: Point2, size: Size2, vp: Viewport) -> Point2 {
    let max_x = EDGE_PADDING.max(vp.width - size.width - EDGE_PADDING);
    let max_y = EDGE_PADDING.max(vp.height - vp.bottom_inset - size.height - EDGE_PADDING);
    Point2 {
        x: pos.x.clamp(EDGE_PADDING, max_x),
        y: pos.y.clamp(EDGE_PADDING, max_y),
    }
}

/// The card's top-left: docked sits `DOCK_MARGIN` from its corner, free sits at its offset, and
/// either stays `EDGE_PADDING` inside. `size` is the card's, or the pill's.
pub fn to_absolute(placement: &PipPlacement, vp: Viewport, size: Size2) -> Point2 {
    let (offset_x, offset_y) = if placement.docked {
        (DOCK_MARGIN, DOCK_MARGIN)
    } else {
        (placement.offset.x, placement.offset.y)
    };
    let x = if placement.anchor.is_left() {
        offset_x
    } else {
        vp.width - size.width - offset_x
    };
    let y = if placement.anchor.is_top() {
        offset_y
    } else {
        vp.height - vp.bottom_inset - size.height - offset_y
    };
    clamp_position(Point2 { x, y }, size, vp)
}

/// The nearest corner by the card's centre, and the inward offset from it (never negative).
pub fn from_absolute(pos: Point2, size: Size2, vp: Viewport) -> (PipAnchor, Point2) {
    let usable = vp.height - vp.bottom_inset;
    let left = pos.x + size.width / 2. < vp.width / 2.;
    let top = pos.y + size.height / 2. < usable / 2.;
    let anchor = match (top, left) {
        (true, true) => PipAnchor::TopLeft,
        (true, false) => PipAnchor::TopRight,
        (false, true) => PipAnchor::BottomLeft,
        (false, false) => PipAnchor::BottomRight,
    };
    let x = if left {
        pos.x
    } else {
        vp.width - pos.x - size.width
    };
    let y = if top {
        pos.y
    } else {
        usable - pos.y - size.height
    };
    (
        anchor,
        Point2 {
            x: x.max(0.),
            y: y.max(0.),
        },
    )
}

/// At least 320x240, at most the area less its padding.
pub fn clamp_size(size: Size2, vp: Viewport) -> Size2 {
    let max_width = MIN_WIDTH.max(vp.width - EDGE_PADDING * 2.);
    let max_height = MIN_HEIGHT.max(vp.height - vp.bottom_inset - EDGE_PADDING * 2.);
    Size2 {
        width: size.width.clamp(MIN_WIDTH, max_width),
        height: size.height.clamp(MIN_HEIGHT, max_height),
    }
}

/// The four corner targets a drag can drop on.
pub fn dock_zone_rects(vp: Viewport) -> [(PipAnchor, Rect2); 4] {
    let left = DOCK_MARGIN;
    let right = vp.width - DOCK_MARGIN - DOCK_ZONE_WIDTH;
    let top = DOCK_MARGIN;
    let bottom = vp.height - vp.bottom_inset - DOCK_MARGIN - DOCK_ZONE_HEIGHT;
    PipAnchor::ALL.map(|anchor| {
        (
            anchor,
            Rect2 {
                x: if anchor.is_left() { left } else { right },
                y: if anchor.is_top() { top } else { bottom },
                width: DOCK_ZONE_WIDTH,
                height: DOCK_ZONE_HEIGHT,
            },
        )
    })
}

pub fn hit_test_dock_zone(point: Point2, vp: Viewport) -> Option<PipAnchor> {
    dock_zone_rects(vp)
        .into_iter()
        .find(|(_, rect)| rect.contains(point))
        .map(|(anchor, _)| anchor)
}

/// Where a drag that ended at `pointer` with the card's top-left at `card` leaves it: docked in the
/// zone under the pointer, or free where it was let go.
pub fn drop_placement(
    previous: &PipPlacement,
    pointer: Point2,
    card: Point2,
    vp: Viewport,
) -> PipPlacement {
    match hit_test_dock_zone(pointer, vp) {
        Some(anchor) => PipPlacement {
            anchor,
            offset: Point2::default(),
            docked: true,
            ..*previous
        },
        None => {
            let pos = clamp_position(card, previous.size, vp);
            let (anchor, offset) = from_absolute(pos, previous.size, vp);
            PipPlacement {
                anchor,
                offset,
                docked: false,
                ..*previous
            }
        }
    }
}

/// The dashed corner targets shown while the card is dragged, the one under the pointer stronger.
/// Fills its parent, which is the card's area; nothing in it takes the mouse.
pub fn dock_zones(vp: Viewport, active: Option<PipAnchor>, cx: &App) -> impl IntoElement + use<> {
    let primary = cx.sem().primary;
    div()
        .absolute()
        .inset_0()
        .children(dock_zone_rects(vp).into_iter().map(move |(anchor, rect)| {
            div()
                .id(SharedString::from(format!("dock-zone-{}", anchor.name())))
                .absolute()
                .left(px(rect.x))
                .top(px(rect.y))
                .w(px(rect.width))
                .h(px(rect.height))
                .rounded(px(8.))
                .border_2()
                .border_dashed()
                .border_color(primary)
                .bg(voice_theme::alpha(
                    primary,
                    if active == Some(anchor) { 0.35 } else { 0.12 },
                ))
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    const VP: Viewport = Viewport {
        width: 1000.,
        height: 800.,
        bottom_inset: 56.,
    };
    const CARD: Size2 = Size2 {
        width: 480.,
        height: 360.,
    };

    fn free(anchor: PipAnchor, x: f32, y: f32) -> PipPlacement {
        PipPlacement {
            anchor,
            offset: Point2 { x, y },
            docked: false,
            ..PipPlacement::default()
        }
    }

    #[test]
    fn docked_sits_a_margin_from_its_corner_above_the_bottom_lane() {
        let placement = PipPlacement::default();
        assert_eq!(
            to_absolute(&placement, VP, CARD),
            Point2 {
                x: 1000. - 480. - 16.,
                y: 800. - 56. - 360. - 16.
            }
        );
        let top_left = PipPlacement {
            anchor: PipAnchor::TopLeft,
            ..placement
        };
        assert_eq!(to_absolute(&top_left, VP, CARD), Point2 { x: 16., y: 16. });
    }

    #[test]
    fn a_free_placement_is_an_inward_offset_from_its_corner() {
        let placement = free(PipAnchor::TopRight, 40., 30.);
        assert_eq!(
            to_absolute(&placement, VP, CARD),
            Point2 {
                x: 1000. - 480. - 40.,
                y: 30.
            }
        );
    }

    #[test]
    fn the_card_never_leaves_the_area() {
        let placement = free(PipAnchor::TopLeft, 5000., -300.);
        let pos = to_absolute(&placement, VP, CARD);
        assert_eq!(pos.x, 1000. - 480. - EDGE_PADDING);
        assert_eq!(pos.y, EDGE_PADDING);
        // Bigger than the area: pinned to the padding, not pushed off the top-left.
        let tiny = Viewport {
            width: 200.,
            height: 200.,
            bottom_inset: 0.,
        };
        assert_eq!(
            to_absolute(&placement, tiny, CARD),
            Point2 {
                x: EDGE_PADDING,
                y: EDGE_PADDING
            }
        );
    }

    #[test]
    fn from_absolute_round_trips_through_the_nearest_corner() {
        for (x, y, anchor) in [
            (20., 20., PipAnchor::TopLeft),
            (500., 30., PipAnchor::TopRight),
            (10., 376., PipAnchor::BottomLeft),
            (510., 370., PipAnchor::BottomRight),
        ] {
            let pos = Point2 { x, y };
            let (found, offset) = from_absolute(pos, CARD, VP);
            assert_eq!(found, anchor, "at {x},{y}");
            assert!(offset.x >= 0. && offset.y >= 0.);
            let back = to_absolute(&free(found, offset.x, offset.y), VP, CARD);
            assert!((back.x - x).abs() < 0.01 && (back.y - y).abs() < 0.01);
        }
    }

    #[test]
    fn a_free_card_keeps_its_corner_through_a_resize() {
        let placement = free(PipAnchor::BottomRight, 24., 24.);
        let bigger = Viewport {
            width: 1600.,
            height: 1000.,
            ..VP
        };
        let pos = to_absolute(&placement, bigger, CARD);
        assert_eq!(pos.x, 1600. - 480. - 24.);
        assert_eq!(pos.y, 1000. - 56. - 360. - 24.);
    }

    #[test]
    fn sizes_stay_between_the_floor_and_the_area() {
        assert_eq!(
            clamp_size(
                Size2 {
                    width: 10.,
                    height: 10.
                },
                VP
            ),
            Size2 {
                width: MIN_WIDTH,
                height: MIN_HEIGHT
            }
        );
        assert_eq!(
            clamp_size(
                Size2 {
                    width: 5000.,
                    height: 5000.
                },
                VP
            ),
            Size2 {
                width: 1000. - 16.,
                height: 800. - 56. - 16.
            }
        );
    }

    #[test]
    fn zones_sit_in_the_corners_and_hit_tests_find_them() {
        let zones = dock_zone_rects(VP);
        assert_eq!(zones[0].1.x, 16.);
        assert_eq!(zones[1].1.x, 1000. - 16. - 160.);
        assert_eq!(zones[2].1.y, 800. - 56. - 16. - 140.);
        assert_eq!(
            hit_test_dock_zone(Point2 { x: 30., y: 30. }, VP),
            Some(PipAnchor::TopLeft)
        );
        assert_eq!(
            hit_test_dock_zone(Point2 { x: 960., y: 700. }, VP),
            Some(PipAnchor::BottomRight)
        );
        assert_eq!(hit_test_dock_zone(Point2 { x: 500., y: 400. }, VP), None);
    }

    #[test]
    fn dropping_on_a_zone_docks_and_elsewhere_frees() {
        let start = PipPlacement::default();
        let docked = drop_placement(
            &start,
            Point2 { x: 30., y: 30. },
            Point2 { x: 0., y: 0. },
            VP,
        );
        assert_eq!(docked.anchor, PipAnchor::TopLeft);
        assert!(docked.docked);
        let freed = drop_placement(
            &start,
            Point2 { x: 500., y: 400. },
            Point2 { x: 100., y: 100. },
            VP,
        );
        assert!(!freed.docked);
        assert_eq!(freed.anchor, PipAnchor::TopLeft);
        assert_eq!(freed.offset, Point2 { x: 100., y: 100. });
        assert_eq!(freed.size, start.size);
    }

    #[test]
    fn region_defaults_and_buckets_match_the_web() {
        let placement = PipPlacement::for_region(Viewport::new(600., 700.));
        assert_eq!(placement.size.width, MIN_WIDTH);
        assert_eq!(placement.size.height, MIN_HEIGHT);
        let wide = PipPlacement::for_region(Viewport::new(1400., 900.));
        assert_eq!(wide.size.width, DEFAULT_WIDTH);
        assert_eq!(wide.size.height, DEFAULT_HEIGHT);
        assert!(!Viewport::new(300., 900.).fits_card());
        assert!(Viewport::new(400., 400.).fits_card());
        assert_eq!(viewport_bucket(1279.), "lt1280");
        assert_eq!(viewport_bucket(1600.), "1600");
        assert_eq!(viewport_bucket(3000.), "2560");
        assert_eq!(PipAnchor::parse("top-right"), Some(PipAnchor::TopRight));
        assert_eq!(PipAnchor::parse("middle"), None);
    }

    #[test]
    fn a_corrupt_placement_is_refused() {
        assert!(PipPlacement::default().is_valid());
        let mut bad = PipPlacement::default();
        bad.offset.x = f32::NAN;
        assert!(!bad.is_valid());
        bad = PipPlacement::default();
        bad.size.width = f32::INFINITY;
        assert!(!bad.is_valid());
    }

    mod properties {
        use super::*;
        use proptest::prelude::*;
        use proptest::test_runner::{Config, RngSeed};

        fn config() -> Config {
            Config {
                cases: 512,
                rng_seed: RngSeed::Fixed(0xd0c4_0001),
                ..Config::default()
            }
        }

        fn viewport() -> impl Strategy<Value = Viewport> {
            (0f32..3000., 0f32..2000., 0f32..120.).prop_map(|(width, height, bottom_inset)| {
                Viewport {
                    width,
                    height,
                    bottom_inset,
                }
            })
        }

        fn size() -> impl Strategy<Value = Size2> {
            (1f32..2000., 1f32..2000.).prop_map(|(width, height)| Size2 { width, height })
        }

        proptest! {
            #![proptest_config(config())]

            /// When the card fits, it is inside the area; when it doesn't, it sits at the padding.
            #[test]
            fn a_clamped_card_stays_inside_the_area(
                vp in viewport(),
                size in size(),
                x in -5000f32..5000.,
                y in -5000f32..5000.,
            ) {
                let at = clamp_position(Point2 { x, y }, size, vp);
                prop_assert!(at.x >= EDGE_PADDING && at.y >= EDGE_PADDING);
                if size.width + 2. * EDGE_PADDING <= vp.width {
                    prop_assert!(at.x + size.width <= vp.width - EDGE_PADDING + 0.01);
                }
                if size.height + 2. * EDGE_PADDING <= vp.height - vp.bottom_inset {
                    prop_assert!(at.y + size.height <= vp.height - vp.bottom_inset - EDGE_PADDING + 0.01);
                }
            }

            #[test]
            fn a_clamped_size_is_between_the_floor_and_the_area(vp in viewport(), size in size()) {
                let clamped = clamp_size(size, vp);
                prop_assert!(clamped.width >= MIN_WIDTH && clamped.height >= MIN_HEIGHT);
                prop_assert!(clamped.width <= MIN_WIDTH.max(vp.width - 2. * EDGE_PADDING));
            }

            #[test]
            fn a_free_card_put_back_where_it_was_lands_there(
                size in size(),
                x in 0f32..1.,
                y in 0f32..1.,
            ) {
                let vp = Viewport { width: 2400., height: 1600., bottom_inset: 56. };
                let size = clamp_size(size, vp);
                let room_x = (vp.width - size.width - 2. * EDGE_PADDING).max(0.);
                let room_y = (vp.height - vp.bottom_inset - size.height - 2. * EDGE_PADDING).max(0.);
                let at = Point2 { x: EDGE_PADDING + x * room_x, y: EDGE_PADDING + y * room_y };
                let (anchor, offset) = from_absolute(at, size, vp);
                let placement = PipPlacement { anchor, offset, size, docked: false, collapsed: false };
                let back = to_absolute(&placement, vp, size);
                prop_assert!((back.x - at.x).abs() < 0.01 && (back.y - at.y).abs() < 0.01);
            }

            #[test]
            fn nothing_panics_on_numbers_that_are_not_sizes(
                w in prop_oneof![Just(f32::NAN), Just(f32::INFINITY), Just(-1f32), Just(0f32)],
                h in prop_oneof![Just(f32::NAN), Just(f32::NEG_INFINITY), Just(-1f32), Just(0f32)],
            ) {
                let vp = Viewport { width: w, height: h, bottom_inset: 56. };
                let size = Size2 { width: w, height: h };
                let _ = clamp_size(size, vp);
                let _ = clamp_position(Point2 { x: w, y: h }, CARD, vp);
                let _ = from_absolute(Point2 { x: w, y: h }, CARD, vp);
                let _ = hit_test_dock_zone(Point2 { x: w, y: h }, vp);
                let placement = PipPlacement { offset: Point2 { x: w, y: h }, ..PipPlacement::default() };
                prop_assert!(!placement.is_valid() || (w.is_finite() && h.is_finite()));
            }
        }
    }
}
