//! The call floating over the message column while the stage isn't shown: the web's `FloatCard.tsx`
//! (the "Float" of "Stage, Float, Dock"). One tile (a screen share, else whoever's speaking on
//! camera, else their avatar), a header to drag it by, hover controls, a corner to resize it, and a
//! minimized pill. Dragging shows the four dock zones; dropping on one docks the card there.
//!
//! Put it over the area it floats in (`size_full`, as the last child of that area's `relative`
//! box): it measures that area itself. Wide layouts only; on a phone the bar is enough. The owner
//! keeps `PipPlacement` (per `dock::viewport_bucket` of the window's width, as the web does),
//! saves it on `PlacementChanged` and hands it back with `set_placement`.

use super::dock::{
    self, PILL_SIZE, PipPlacement, Point2, Size2, Viewport, clamp_size, dock_zones,
    hit_test_dock_zone, to_absolute,
};
use super::frames::{Fit, VideoFrames};
use super::icons::{self, icon};
use super::model::{
    ShareLook, Tile, TileContent, TileDemand, VoiceController, VoiceStageModel, build_tiles,
    display_name, initial, mic_blocked_reason, tile_hue,
};
use super::theme as voice_theme;
use crate::kit::{Icon, Variant, text, with_tip};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

const HEADER_HEIGHT: f32 = 36.;
/// Pointer travel before a press on the header becomes a drag; less is a click.
const DRAG_THRESHOLD: f32 = 5.;
const RESIZE_HANDLE: f32 = 16.;
const FRAME_POLL: Duration = Duration::from_millis(8);
const IDLE_POLL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq)]
pub enum FloatEvent {
    /// Moved, docked, resized, minimized or expanded: save it (the card already shows it).
    PlacementChanged(PipPlacement),
    /// A press on the tile, or on the pill when the area is too small for the card: go to the
    /// call's stage.
    OpenCall,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum DragKind {
    Move,
    Resize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Drag {
    kind: DragKind,
    /// Where the press was, in the area's coordinates.
    start: Point2,
    pointer: Point2,
    card: Point2,
    size: Size2,
    moved: bool,
}

impl Drag {
    fn card_now(&self) -> Point2 {
        match self.kind {
            DragKind::Move if self.moved => Point2 {
                x: self.card.x + self.pointer.x - self.start.x,
                y: self.card.y + self.pointer.y - self.start.y,
            },
            _ => self.card,
        }
    }

    fn size_now(&self, vp: Viewport) -> Size2 {
        match self.kind {
            DragKind::Resize => clamp_size(
                Size2 {
                    width: self.size.width + self.pointer.x - self.start.x,
                    height: self.size.height + self.pointer.y - self.start.y,
                },
                vp,
            ),
            DragKind::Move => self.size,
        }
    }
}

/// The one tile the card shows: a screen share (someone else's first), else whoever's speaking on
/// camera, else whoever's speaking, else the first other person, else me.
pub fn float_tile(model: &VoiceStageModel) -> Option<Tile> {
    let tiles = build_tiles(&model.voice);
    let others = |tile: &&Tile| !tile.participant.is_self;
    tiles
        .iter()
        .filter(others)
        .find(|tile| tile.is_screen())
        .or_else(|| tiles.iter().find(|tile| tile.is_screen()))
        .or_else(|| {
            tiles.iter().filter(others).find(|tile| {
                tile.participant.speaking && matches!(tile.content, TileContent::Camera(_))
            })
        })
        .or_else(|| {
            tiles
                .iter()
                .filter(others)
                .find(|tile| tile.participant.speaking)
        })
        .or_else(|| {
            tiles
                .iter()
                .filter(others)
                .find(|tile| matches!(tile.content, TileContent::Camera(_)))
        })
        .or_else(|| tiles.iter().find(others))
        .or_else(|| tiles.first())
        .cloned()
}

pub struct FloatCard {
    model: VoiceStageModel,
    frames: Arc<VideoFrames>,
    controller: Arc<dyn VoiceController>,
    placement: PipPlacement,
    /// The area's bounds in the window, from the last paint.
    area: Rc<Cell<Option<Bounds<Pixels>>>>,
    bottom_inset: f32,
    drag: Option<Drag>,
    /// A story's held drag, waiting for the area to be measured.
    pending_drag: Option<(f32, f32)>,
    hovered: bool,
    /// Touch screens never hover, and review screenshots want them: controls stay up.
    always_show_controls: bool,
    last_demands: Rc<RefCell<Option<Vec<TileDemand>>>>,
    _redraw: Task<()>,
}

impl EventEmitter<FloatEvent> for FloatCard {}

impl FloatCard {
    pub fn new(
        model: VoiceStageModel,
        frames: Arc<VideoFrames>,
        controller: Arc<dyn VoiceController>,
        placement: PipPlacement,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let watched = frames.clone();
        let redraw = cx.spawn_in(window, async move |this, cx| {
            loop {
                let poll = match this.read_with(cx, |card, _| card.has_video()) {
                    Ok(true) => FRAME_POLL,
                    Ok(false) => IDLE_POLL,
                    Err(_) => return,
                };
                cx.background_executor().timer(poll).await;
                if watched.take_dirty() && this.update(cx, |_, cx| cx.notify()).is_err() {
                    return;
                }
            }
        });
        let always_show_controls = model.always_show_overlays;
        Self {
            model,
            frames,
            controller,
            placement: if placement.is_valid() {
                placement
            } else {
                PipPlacement::default()
            },
            area: Rc::default(),
            bottom_inset: dock::REGION_BOTTOM_LANE,
            drag: None,
            pending_drag: None,
            hovered: false,
            always_show_controls,
            last_demands: Rc::default(),
            _redraw: redraw,
        }
    }

    pub fn set_model(&mut self, model: VoiceStageModel, cx: &mut Context<Self>) {
        if self.model != model {
            self.always_show_controls = model.always_show_overlays;
            self.model = model;
            cx.notify();
        }
    }

    pub fn set_placement(&mut self, placement: PipPlacement, cx: &mut Context<Self>) {
        if placement.is_valid() && self.placement != placement {
            self.placement = placement;
            cx.notify();
        }
    }

    pub fn placement(&self) -> PipPlacement {
        self.placement
    }

    /// The strip at the bottom of the area kept clear: `REGION_BOTTOM_LANE` over the message
    /// column, 0 over a whole window.
    pub fn set_bottom_inset(&mut self, inset: f32, cx: &mut Context<Self>) {
        self.bottom_inset = inset;
        cx.notify();
    }

    /// For stories: a drag held with the pointer at `pointer` (area coordinates), as the zones
    /// show it.
    pub fn preview_drag(&mut self, pointer: Option<(f32, f32)>, cx: &mut Context<Self>) {
        if self.viewport().is_none() {
            self.pending_drag = pointer;
            return;
        }
        self.drag = pointer.and_then(|(x, y)| {
            let vp = self.viewport()?;
            let size = clamp_size(self.placement.size, vp);
            let card = to_absolute(&self.placement, vp, size);
            let start = Point2 {
                x: card.x + size.width / 2.,
                y: card.y + HEADER_HEIGHT / 2.,
            };
            Some(Drag {
                kind: DragKind::Move,
                start,
                pointer: Point2 { x, y },
                card,
                size,
                moved: true,
            })
        });
        cx.notify();
    }

    fn has_video(&self) -> bool {
        float_tile(&self.model).is_some_and(|tile| tile.track_sid().is_some())
    }

    fn viewport(&self) -> Option<Viewport> {
        self.area.get().map(|bounds| Viewport {
            width: f32::from(bounds.size.width),
            height: f32::from(bounds.size.height),
            bottom_inset: self.bottom_inset,
        })
    }

    fn local(&self, position: Point<Pixels>) -> Point2 {
        let origin = self.area.get().map(|b| b.origin).unwrap_or_default();
        Point2 {
            x: f32::from(position.x - origin.x),
            y: f32::from(position.y - origin.y),
        }
    }

    fn start_drag(&mut self, kind: DragKind, position: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(vp) = self.viewport() else { return };
        let size = clamp_size(self.placement.size, vp);
        let start = self.local(position);
        self.drag = Some(Drag {
            kind,
            start,
            pointer: start,
            card: to_absolute(&self.placement, vp, size),
            size,
            moved: false,
        });
        cx.notify();
    }

    fn drag_to(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let pointer = self.local(position);
        if let Some(drag) = &mut self.drag {
            drag.pointer = pointer;
            if !drag.moved
                && ((pointer.x - drag.start.x).abs() > DRAG_THRESHOLD
                    || (pointer.y - drag.start.y).abs() > DRAG_THRESHOLD)
            {
                drag.moved = true;
            }
            cx.notify();
        }
    }

    fn end_drag(&mut self, cx: &mut Context<Self>) {
        let (Some(drag), Some(vp)) = (self.drag.take(), self.viewport()) else {
            self.drag = None;
            return;
        };
        cx.notify();
        if !drag.moved {
            return;
        }
        let next = match drag.kind {
            DragKind::Move => dock::drop_placement(
                &PipPlacement {
                    size: drag.size,
                    ..self.placement
                },
                drag.pointer,
                drag.card_now(),
                vp,
            ),
            DragKind::Resize => {
                // Grown from its top-left corner: re-anchor where it now sits.
                let size = drag.size_now(vp);
                let (anchor, offset) = dock::from_absolute(drag.card, size, vp);
                PipPlacement {
                    anchor,
                    offset,
                    size,
                    docked: false,
                    ..self.placement
                }
            }
        };
        self.placement = next;
        cx.emit(FloatEvent::PlacementChanged(next));
    }

    fn set_collapsed(&mut self, collapsed: bool, cx: &mut Context<Self>) {
        self.placement.collapsed = collapsed;
        cx.emit(FloatEvent::PlacementChanged(self.placement));
        cx.notify();
    }

    fn call_name(&self) -> String {
        if !self.model.channel_name.is_empty() {
            self.model.channel_name.clone()
        } else if self.model.is_dm {
            "DM Call".into()
        } else {
            "Voice".into()
        }
    }

    fn pill(&self, vp: Viewport, forced: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let pos = to_absolute(&self.placement, vp, PILL_SIZE);
        let count = self.model.voice.participants.len().max(1);
        div()
            .id("float-pill")
            .test_support()
            .role(Role::Button)
            .aria_label(if forced {
                format!("Open {}", self.call_name())
            } else {
                format!("Expand {}", self.call_name())
            })
            .absolute()
            .left(px(pos.x))
            .top(px(pos.y))
            .w(px(PILL_SIZE.width))
            .flex()
            .items_center()
            .gap(px(8.))
            .px(px(16.))
            .py(px(8.))
            .rounded(px(8.))
            .bg(sem.paper)
            .border_1()
            .border_color(sem.divider)
            .shadow_lg()
            .occlude()
            .cursor_pointer()
            .on_click(cx.listener(move |card, _, _, cx| {
                if forced {
                    cx.emit(FloatEvent::OpenCall);
                } else {
                    card.set_collapsed(false, cx);
                }
            }))
            .child(
                div()
                    .relative()
                    .flex_shrink_0()
                    .child(
                        Icon::new(IconName::People)
                            .size(24.)
                            .color(sem.action_active),
                    )
                    .child(
                        div()
                            .absolute()
                            .top(px(-6.))
                            .right(px(-8.))
                            .min_w(px(18.))
                            .h(px(18.))
                            .px(px(4.))
                            .rounded_full()
                            .bg(sem.primary)
                            .text_color(sem.primary_contrast)
                            .text_size(px(11.))
                            .font_weight(FontWeight::MEDIUM)
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(count.to_string()),
                    ),
            )
            .child(
                text(Variant::Body2, self.call_name())
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(sem.text_primary)
                    .flex_1()
                    .min_w_0()
                    .truncate(),
            )
            .child(
                Icon::new(IconName::OpenInFull)
                    .size(18.)
                    .color(sem.action_active),
            )
    }

    fn tile_body(&self, tile: &Tile) -> AnyElement {
        match tile.track_sid() {
            Some(sid) => {
                let frames = self.frames.clone();
                let sid = sid.to_owned();
                let fit = if tile.is_screen() {
                    Fit::Contain
                } else {
                    Fit::Cover {
                        corners: gpui_kit::black(),
                    }
                };
                div()
                    .size_full()
                    .bg(gpui_kit::black())
                    .child(
                        canvas(
                            |_, _, _| (),
                            move |bounds, _, window, cx| {
                                frames.paint(&sid, bounds, px(0.), fit, window, cx);
                            },
                        )
                        .size_full(),
                    )
                    .into_any_element()
            }
            None => {
                let tint = hsla(tile_hue(&tile.participant.identity) / 360., 0.65, 0.45, 1.0);
                let mut name = display_name(&tile.participant).to_owned();
                if tile.participant.is_self {
                    name.push_str(" (You)");
                }
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(8.))
                    .px(px(12.))
                    .pb(px(48.))
                    .pt(px(8.))
                    .bg(voice_theme::grey_900())
                    .child(
                        div()
                            .size(px(96.))
                            .min_w(px(32.))
                            .min_h(px(32.))
                            .flex_shrink(1.)
                            .rounded_full()
                            .bg(tint)
                            .border_3()
                            .border_color(if tile.participant.speaking {
                                voice_theme::positive()
                            } else {
                                gpui_kit::transparent_black()
                            })
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_color(voice_theme::white())
                            .text_size(px(40.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(initial(display_name(&tile.participant))),
                    )
                    .child(
                        div()
                            .max_w_full()
                            .min_w_0()
                            .text_sm()
                            .font_weight(FontWeight::BOLD)
                            .text_color(voice_theme::white())
                            .truncate()
                            .child(name),
                    )
                    .into_any_element()
            }
        }
    }

    fn controls(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let voice = &self.model.voice;
        let button_bg = voice_theme::alpha(sem.paper, 0.75);
        let round =
            |id: &'static str, glyph: icons::VoiceIcon, color: Hsla, label: &'static str| {
                div()
                    .id(id)
                    .test_support()
                    .role(Role::Button)
                    .aria_label(label)
                    .size(px(30.))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(button_bg)
                    .child(icon(glyph, px(18.), color))
            };
        let blocked = mic_blocked_reason(voice);
        let muted = voice.muted;
        let mic_label = blocked.unwrap_or(if muted { "Unmute" } else { "Mute" });
        let mic = round(
            "float-mic",
            if muted || blocked.is_some() {
                icons::MIC_OFF
            } else {
                icons::MIC
            },
            if blocked.is_some() {
                sem.text_disabled
            } else if muted {
                sem.error
            } else {
                sem.text_primary
            },
            mic_label,
        );
        let mic = if blocked.is_some() || self.model.ptt.is_some() {
            mic
        } else {
            let controller = self.controller.clone();
            mic.cursor_pointer()
                .on_click(move |_, _, _| controller.set_muted(!muted))
        };
        let look = ShareLook::of(&voice.local.camera, voice.local.may_camera);
        let camera_label = super::model::camera_label(look);
        let camera = round(
            "float-camera",
            if look == ShareLook::On {
                icons::VIDEOCAM
            } else {
                icons::VIDEOCAM_OFF
            },
            if look.clickable() {
                sem.text_primary
            } else {
                sem.text_disabled
            },
            camera_label,
        );
        let camera = if look.clickable() {
            let controller = self.controller.clone();
            camera
                .cursor_pointer()
                .on_click(move |_, _, _| controller.set_camera(look != ShareLook::On))
        } else {
            camera
        };
        let minimize = div()
            .id("float-minimize")
            .test_support()
            .role(Role::Button)
            .aria_label("Minimize")
            .size(px(30.))
            .rounded_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(button_bg)
            .cursor_pointer()
            .on_click(cx.listener(|card, _, _, cx| {
                cx.stop_propagation();
                card.set_collapsed(true, cx);
            }))
            .child(
                Icon::new(IconName::Minimize)
                    .size(18.)
                    .color(sem.text_primary),
            );
        div()
            .id("float-controls")
            .absolute()
            .bottom_0()
            .left_0()
            .right_0()
            .flex()
            .justify_center()
            .gap(px(8.))
            .p(px(8.))
            .bg(linear_gradient(
                180.,
                linear_color_stop(voice_theme::alpha(gpui_kit::black(), 0.), 0.),
                linear_color_stop(voice_theme::alpha(gpui_kit::black(), 0.6), 1.),
            ))
            .on_click(|_, _, cx| cx.stop_propagation())
            .child(with_tip(mic, mic_label))
            .child(with_tip(camera, camera_label))
            .child(with_tip(minimize, "Minimize"))
    }

    fn card(&self, vp: Viewport, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let fitted = clamp_size(self.placement.size, vp);
        let (pos, size) = match &self.drag {
            Some(drag) => {
                let size = drag.size_now(vp);
                (dock::clamp_position(drag.card_now(), size, vp), size)
            }
            None => (to_absolute(&self.placement, vp, fitted), fitted),
        };
        let dragging = self.drag.is_some_and(|drag| drag.moved);
        let tile = float_tile(&self.model);
        let show_controls = self.hovered || self.always_show_controls;
        let mut body = div()
            .id("float-body")
            .relative()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .cursor_pointer()
            .on_click(cx.listener(|_, _, _, cx| cx.emit(FloatEvent::OpenCall)))
            .children(tile.as_ref().map(|tile| self.tile_body(tile)));
        if show_controls {
            body = body.child(self.controls(cx));
        }
        div()
            .id("float-card")
            .test_support()
            .role(Role::Group)
            .aria_label(format!("{} call", self.call_name()))
            .absolute()
            .left(px(pos.x))
            .top(px(pos.y))
            .w(px(size.width))
            .h(px(size.height))
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(px(8.))
            .bg(sem.paper)
            .border_1()
            .border_color(sem.divider)
            .shadow_lg()
            .occlude()
            .on_hover(cx.listener(|card, hovered: &bool, _, cx| {
                card.hovered = *hovered;
                cx.notify();
            }))
            .child(
                div()
                    .id("float-header")
                    .h(px(HEADER_HEIGHT))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(8.))
                    .bg(voice_theme::alpha(sem.paper, 0.95))
                    .border_b_1()
                    .border_color(sem.divider)
                    .cursor(if dragging {
                        CursorStyle::ClosedHand
                    } else {
                        CursorStyle::OpenHand
                    })
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|card, event: &MouseDownEvent, _, cx| {
                            card.start_drag(DragKind::Move, event.position, cx);
                        }),
                    )
                    .child(
                        Icon::new(IconName::DragIndicator)
                            .size(18.)
                            .color(sem.text_secondary),
                    )
                    .child(
                        text(Variant::Caption, self.call_name())
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(sem.text_primary)
                            .flex_1()
                            .min_w_0()
                            .truncate(),
                    ),
            )
            .child(body)
            .child(
                div()
                    .id("float-resize")
                    .absolute()
                    .right_0()
                    .bottom_0()
                    .size(px(RESIZE_HANDLE))
                    .cursor(CursorStyle::ResizeUpLeftDownRight)
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|card, event: &MouseDownEvent, _, cx| {
                            cx.stop_propagation();
                            card.start_drag(DragKind::Resize, event.position, cx);
                        }),
                    ),
            )
    }

    /// Reports the card's video tile, so the engine sends that track and pauses the rest.
    fn demands(&self, vp: Option<Viewport>) -> Vec<TileDemand> {
        let (Some(vp), Some(tile)) = (vp, float_tile(&self.model)) else {
            return Vec::new();
        };
        if self.placement.collapsed || !vp.fits_card() {
            return Vec::new();
        }
        let Some(sid) = tile.track_sid() else {
            return Vec::new();
        };
        let size = clamp_size(self.placement.size, vp);
        vec![TileDemand {
            track_sid: sid.to_owned(),
            width_px: size.width as u32,
            height_px: (size.height - HEADER_HEIGHT).max(0.) as u32,
            focused: tile.is_screen(),
        }]
    }
}

impl Render for FloatCard {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(pointer) = self.pending_drag.filter(|_| self.viewport().is_some()) {
            self.pending_drag = None;
            self.preview_drag(Some(pointer), cx);
        }
        let vp = self.viewport();
        let area = self.area.clone();
        let demands = self.demands(vp);
        let last = self.last_demands.clone();
        let controller = self.controller.clone();
        let dragging = self.drag.is_some();
        let this = cx.entity().downgrade();
        let measure = canvas(
            move |bounds, window, _| {
                if area.get() != Some(bounds) {
                    area.set(Some(bounds));
                    window.refresh();
                }
            },
            move |_, _, window, _| {
                let mut last = last.borrow_mut();
                if last.as_ref() != Some(&demands) {
                    controller.set_video_demands(demands.clone());
                    *last = Some(demands);
                }
                if !dragging {
                    return;
                }
                // A drag follows the pointer anywhere in the window, and ends wherever it's let go.
                let moved = this.clone();
                window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Bubble {
                        let _ = moved.update(cx, |card, cx| card.drag_to(event.position, cx));
                    }
                });
                let released = this.clone();
                window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                    if phase == DispatchPhase::Bubble {
                        let _ = released.update(cx, |card, cx| card.end_drag(cx));
                    }
                });
            },
        )
        .absolute()
        .size_full();
        let mut root = div().absolute().inset_0().child(measure);
        let Some(vp) = vp else {
            return root;
        };
        let forced = !vp.fits_card();
        if forced || self.placement.collapsed {
            return root.child(self.pill(vp, forced, cx));
        }
        if let Some(drag) = self
            .drag
            .filter(|drag| drag.moved && drag.kind == DragKind::Move)
        {
            root = root.child(dock_zones(vp, hit_test_dock_zone(drag.pointer, vp), cx));
        }
        root.child(self.card(vp, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::{ParticipantView, UserView, VideoTrackView};
    use std::prelude::rust_2024::test;

    fn person(id: &str, is_self: bool) -> ParticipantView {
        ParticipantView {
            identity: id.into(),
            user: UserView {
                id: id.into(),
                username: id.into(),
                display_name: None,
                avatar_file_id: None,
            },
            is_self,
            ..ParticipantView::default()
        }
    }

    fn track(sid: &str) -> Option<VideoTrackView> {
        Some(VideoTrackView {
            track_sid: sid.into(),
            width: 1280,
            height: 720,
        })
    }

    fn model(people: Vec<ParticipantView>) -> VoiceStageModel {
        let mut model = VoiceStageModel::default();
        model.voice.participants = people;
        model
    }

    #[test]
    fn a_share_wins_then_a_speaker_on_camera_then_a_speaker() {
        let me = person("me", true);
        let mut ana = person("ana", false);
        let mut bo = person("bo", false);
        assert_eq!(
            float_tile(&model(vec![me.clone()])).unwrap().key,
            "me-avatar"
        );
        assert_eq!(
            float_tile(&model(vec![me.clone(), ana.clone(), bo.clone()]))
                .unwrap()
                .key,
            "ana-avatar"
        );
        bo.speaking = true;
        assert_eq!(
            float_tile(&model(vec![me.clone(), ana.clone(), bo.clone()]))
                .unwrap()
                .key,
            "bo-avatar"
        );
        ana.camera = track("cam-ana");
        assert_eq!(
            float_tile(&model(vec![me.clone(), ana.clone(), bo.clone()]))
                .unwrap()
                .key,
            "bo-avatar"
        );
        ana.speaking = true;
        assert_eq!(
            float_tile(&model(vec![me.clone(), ana.clone(), bo.clone()]))
                .unwrap()
                .key,
            "ana-camera"
        );
        bo.screen_share = track("screen-bo");
        assert_eq!(
            float_tile(&model(vec![me, ana, bo])).unwrap().key,
            "bo-screen"
        );
    }

    #[test]
    fn a_resize_drag_grows_from_the_corner_and_stays_in_bounds() {
        let vp = Viewport {
            width: 1000.,
            height: 800.,
            bottom_inset: 56.,
        };
        let drag = Drag {
            kind: DragKind::Resize,
            start: Point2 { x: 500., y: 500. },
            pointer: Point2 { x: 560., y: 9000. },
            card: Point2 { x: 10., y: 10. },
            size: Size2 {
                width: 400.,
                height: 300.,
            },
            moved: true,
        };
        let size = drag.size_now(vp);
        assert_eq!(size.width, 460.);
        assert_eq!(size.height, 800. - 56. - 16.);
        assert_eq!(drag.card_now(), drag.card);
    }
}
