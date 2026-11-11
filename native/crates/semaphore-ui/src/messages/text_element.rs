//! One block of a message's text: `StyledText` plus what it can't do itself, namely the selection
//! highlight, chips behind inline code, inline emoji, and recording the layout for hit testing.

use super::icons::{self, paint_glyph};
use super::media::{MediaState, animation_frame, contain};
use super::row::{PreparedBlock, Shared};
use gpui_kit::*;
use semaphore_core::model::MessageRow;
use std::rc::Rc;
use std::sync::Arc;

/// A block as painted in the last frame, for turning a pointer position into a `Pos`.
pub(crate) struct BlockGeom {
    pub layout: TextLayout,
    pub bounds: Bounds<Pixels>,
    /// How many of the layout's bytes are message text. Marks like "(edited)" follow them.
    pub selectable: u32,
}

/// One line of wrapped text as painted.
struct VisualLine {
    start: usize,
    end: usize,
    /// `x` of `start` in the unwrapped line, which is what `x_for_index` measures from.
    x_origin: Pixels,
    line: Arc<WrappedLineLayout>,
    /// Bytes before this logical line.
    logical_start: usize,
    top: Pixels,
}

impl VisualLine {
    fn x_of(&self, index: usize) -> Pixels {
        self.line
            .unwrapped_layout
            .x_for_index(index - self.logical_start)
            - self.x_origin
    }
}

fn visual_lines(layout: &TextLayout, bounds: Bounds<Pixels>) -> Vec<VisualLine> {
    let line_height = layout.line_height();
    let mut lines = Vec::new();
    let mut logical_start = 0;
    let mut top = bounds.top();
    for line in layout.line_layouts() {
        let mut start = 0;
        let boundaries: Vec<usize> = line
            .wrap_boundaries()
            .iter()
            .map(|boundary| line.runs()[boundary.run_ix].glyphs[boundary.glyph_ix].index)
            .collect();
        for end in boundaries.into_iter().chain([line.len()]) {
            lines.push(VisualLine {
                start: logical_start + start,
                end: logical_start + end,
                x_origin: line.unwrapped_layout.x_for_index(start),
                line: line.clone(),
                logical_start,
                top,
            });
            top += line_height;
            start = end;
        }
        logical_start += line.len() + 1;
    }
    lines
}

/// A rectangle per wrapped line covering `range`, as wide as the text on that line. A selected
/// newline shows as a stub, so a blank line in a selection is visible.
fn range_quads(
    lines: &[VisualLine],
    range: std::ops::Range<usize>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
    newline_stub: Pixels,
) -> Vec<Bounds<Pixels>> {
    let mut quads = Vec::new();
    for line in lines {
        if line.start >= range.end || line.end < range.start {
            continue;
        }
        let from = range.start.max(line.start);
        let to = range.end.min(line.end);
        let left = line.x_of(from);
        let mut right = line.x_of(to);
        // A hard line end with its newline selected. A soft wrap has no character to show.
        if range.end > line.end && line.end - line.logical_start == line.line.len() {
            right += newline_stub;
        }
        if right > left {
            quads.push(Bounds::from_corners(
                point(bounds.left() + left, line.top),
                point(bounds.left() + right, line.top + line_height),
            ));
        }
    }
    quads
}

pub(crate) struct MessageText {
    pub seq: i64,
    pub row: Arc<MessageRow>,
    pub block: Rc<PreparedBlock>,
    pub styled: StyledText,
    pub shared: Rc<Shared>,
    /// Each inline emoji in this block: its byte in the block and what it resolved to.
    pub emoji: Vec<(u32, MediaState)>,
}

impl IntoElement for MessageText {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for MessageText {
    type RequestLayoutState = ();
    type PrepaintState = Hitbox;

    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        self.styled.request_layout(id, inspector, window, cx)
    }
    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Hitbox {
        self.styled
            .prepaint(id, inspector, bounds, &mut (), window, cx);
        window.insert_hitbox(bounds, HitboxBehavior::Normal)
    }
    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        hitbox: &mut Hitbox,
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled.layout().clone();
        let line_height = layout.line_height();
        let palette = self.shared.palette.get();
        let base = self.block.base;
        let selectable = self.block.selectable;

        let hovered_link = self.shared.hovered_link.get() == Some((self.seq, base));
        window.set_cursor_style(
            if hovered_link {
                CursorStyle::PointingHand
            } else {
                CursorStyle::IBeam
            },
            hitbox,
        );

        let selected = self
            .shared
            .selection
            .get()
            .and_then(|selection| selection.range_in(&self.row))
            .and_then(|range| {
                let from = range.start.max(base) - base;
                let to = range.end.min(base + selectable).saturating_sub(base);
                (from < to).then_some(from as usize..to as usize)
            });
        if selected.is_some() || !self.block.chips.is_empty() {
            let lines = visual_lines(&layout, bounds);
            for chip in &self.block.chips {
                let range = chip.range.start as usize..chip.range.end as usize;
                for quad in range_quads(&lines, range, bounds, line_height, px(0.)) {
                    // Runs can't be padded, so the chip spills a little past its glyphs.
                    let quad = Bounds::from_corners(
                        point(quad.left() - px(2.), quad.top() + px(1.)),
                        point(quad.right() + px(2.), quad.bottom() - px(1.)),
                    );
                    window.paint_quad(PaintQuad {
                        bounds: quad,
                        corner_radii: Corners::all(px(4.)),
                        background: chip.background.into(),
                        border_widths: Edges::all(chip.border.map_or(px(0.), |_| px(1.))),
                        border_color: chip.border.unwrap_or_default(),
                        border_style: BorderStyle::Solid,
                    });
                }
            }
            if let Some(range) = selected {
                for quad in range_quads(&lines, range, bounds, line_height, px(6.)) {
                    window.paint_quad(fill(quad, palette.selection));
                }
            }
        }

        self.styled
            .paint(id, inspector, bounds, &mut (), &mut (), window, cx);

        for (byte, state) in &self.emoji {
            let Some(position) = layout.position_for_index(*byte as usize) else {
                continue;
            };
            let cell = point(position.x, position.y);
            let side = px(18.).min(line_height);
            let em = window.text_style().font_size.to_pixels(window.rem_size());
            let rect = Bounds::new(
                point(
                    cell.x + (em - side) / 2.,
                    cell.y + (line_height - side) / 2.,
                ),
                size(side, side),
            );
            match state {
                MediaState::Ready(image) => {
                    let frame = self.shared.frame_of(image, rect, window, cx);
                    let fitted = contain(rect, image.size(frame));
                    window
                        .paint_image(
                            fitted,
                            fitted,
                            Corners::default(),
                            image.clone(),
                            frame,
                            false,
                        )
                        .ok();
                }
                MediaState::Loading | MediaState::Failed => {
                    window.paint_quad(quad(
                        rect,
                        Corners::all(px(4.)),
                        palette.skeleton,
                        Edges::default(),
                        Hsla::default(),
                        BorderStyle::Solid,
                    ));
                }
            }
        }

        if let Some(byte) = self.block.pending_icon_at
            && let Some(position) = layout.position_for_index(byte as usize)
        {
            let side = px(14.);
            let rect = Bounds::new(
                point(position.x, position.y + (line_height - side) / 2.),
                size(side, side),
            );
            paint_glyph(icons::SCHEDULE, rect, palette.text_secondary, window, cx);
        }

        self.shared.visible.borrow_mut().insert(
            (self.seq, base),
            BlockGeom {
                layout,
                bounds,
                selectable,
            },
        );
    }
}

impl Shared {
    /// The frame to paint now, and a note of when the next one is due. Animations never ask for
    /// the next animation frame: that redraws the window at 60 fps. The view arms one timer for the
    /// soonest deadline instead. An image in the list's overdraw, measured but clipped, asks nothing.
    pub(crate) fn frame_of(
        &self,
        image: &RenderImage,
        bounds: Bounds<Pixels>,
        window: &Window,
        cx: &App,
    ) -> usize {
        if cx.reduce_motion() || image.frame_count() <= 1 {
            return 0;
        }
        let now = cx.background_executor().now();
        let started = match self.animation_started.get() {
            Some(started) => started,
            None => {
                self.animation_started.set(Some(now));
                now
            }
        };
        let Some((frame, wait)) = animation_frame(image, now.duration_since(started)) else {
            return 0;
        };
        if bounds.intersect(&window.content_mask().bounds).is_empty() {
            return frame;
        }
        self.animated_paints.set(self.animated_paints.get() + 1);
        let soonest = self
            .next_animation_frame
            .get()
            .map_or(wait, |other| other.min(wait));
        self.next_animation_frame.set(Some(soonest));
        frame
    }
}
