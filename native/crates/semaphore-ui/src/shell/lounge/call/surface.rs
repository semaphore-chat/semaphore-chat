//! The call surface (design §3.6, §5), the native side of
//! `frontend/src/shell/lounge/call/surface/CallSurface.tsx` and `callSurfaceText.ts`: the video
//! of the call you are in, in the call slot above the call bar, while you are away from the call
//! view. The kit's CallStack bounds it (two fifths of the height) and it scrolls inside itself.
//!
//! - A share or camera you do not watch is a row with Watch: nothing is received until you choose
//!   it, as on the web (and as Discord asks you to click to watch a stream). Beyond
//!   [`OFFERED_ROWS`] of them a summary row counts them all and offers the call view.
//! - A watched one is a kit MediaTile with its video; shares first, then cameras. On a phone (the
//!   slot spans the window) two to a row; in the 288 px left column, one under the other.
//! - Stop watching stops every picture you watch, so no stream stays received with nothing on
//!   screen.
//! - Your own share: a row with Stop sharing.

use super::super::Act;
use crate::kit::{Button, ButtonSize, Card, Icon, ListRow, MediaKind, MediaTile, Padding};
use crate::theme::SemTheme;
use crate::voice::{Fit, TileDemand, VideoFrames, display_name};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::VoiceView;
use semaphore_design::LoungeIcon;
use semaphore_design::lounge::{SPACE_SM, SPACE_XS};
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::rc::Rc;
use std::sync::Arc;

/// How many unwatched shares and cameras get a row of their own; past that, a summary row first.
pub const OFFERED_ROWS: usize = 3;

/// A share or a camera.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TileKind {
    Screen,
    Camera,
}

/// One remote share or camera of the call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceTile {
    /// The track's sid: what Watch asks for and the frames are keyed by.
    pub id: String,
    pub name: String,
    pub kind: TileKind,
    pub watched: bool,
    pub speaking: bool,
}

/// Everyone else's shares, then their cameras, in the view's order. Our own aren't offered.
pub fn surface_tiles(voice: &VoiceView, watched: &BTreeSet<String>) -> Vec<SurfaceTile> {
    let others = || voice.participants.iter().filter(|person| !person.is_self);
    let tile = |person: &semaphore_core::model::ParticipantView, sid: &str, kind| SurfaceTile {
        id: sid.to_owned(),
        name: display_name(person).to_owned(),
        kind,
        watched: watched.contains(sid),
        speaking: person.speaking,
    };
    let screens = others().filter_map(|person| {
        let track = person.screen_share.as_ref()?;
        Some(tile(person, &track.track_sid, TileKind::Screen))
    });
    let cameras = others().filter_map(|person| {
        let track = person.camera.as_ref()?;
        Some(tile(person, &track.track_sid, TileKind::Camera))
    });
    screens.chain(cameras).collect()
}

/// "pri's screen", or "pri" for a camera.
pub fn tile_label(tile: &SurfaceTile) -> String {
    match tile.kind {
        TileKind::Screen => format!("{}'s screen", tile.name),
        TileKind::Camera => tile.name.clone(),
    }
}

fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

/// "2 screens shared · 8 cameras on": what is published, by kind. Empty for none.
pub fn offered_summary(tiles: &[SurfaceTile]) -> String {
    let screens = tiles
        .iter()
        .filter(|tile| tile.kind == TileKind::Screen)
        .count();
    let cameras = tiles.len() - screens;
    let mut parts = Vec::new();
    if screens > 0 {
        parts.push(format!("{} shared", plural(screens, "screen", "screens")));
    }
    if cameras > 0 {
        parts.push(format!("{} on", plural(cameras, "camera", "cameras")));
    }
    parts.join(" \u{b7} ")
}

/// Whether the slot shows a surface: something to offer, or our own share.
pub fn shows_surface(tiles: &[SurfaceTile], sharing_screen: bool) -> bool {
    !tiles.is_empty() || sharing_screen
}

/// Watch, with the track's sid.
pub type WatchAct = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// What the surface's buttons do.
#[derive(Clone)]
pub struct SurfaceActions {
    pub watch: WatchAct,
    pub stop_watching: Act,
    pub stop_sharing: Act,
    pub open_call_view: Act,
    /// The watched tiles on screen and their sizes, every frame the surface paints.
    pub demands: Rc<dyn Fn(Vec<TileDemand>)>,
}

#[derive(IntoElement)]
pub struct CallSurface {
    tiles: Vec<SurfaceTile>,
    sharing_screen: bool,
    frames: Option<Arc<VideoFrames>>,
    actions: SurfaceActions,
}

impl CallSurface {
    pub fn new(
        tiles: Vec<SurfaceTile>,
        sharing_screen: bool,
        frames: Option<Arc<VideoFrames>>,
        actions: SurfaceActions,
    ) -> Self {
        Self {
            tiles,
            sharing_screen,
            frames,
            actions,
        }
    }
}

/// A watched tile: the video once its frames come, the label until then; it reports its size.
fn video_tile(
    tile: &SurfaceTile,
    frames: Option<Arc<VideoFrames>>,
    visible: Rc<RefCell<Vec<TileDemand>>>,
) -> MediaTile {
    let kind = match tile.kind {
        TileKind::Screen => MediaKind::Screen,
        TileKind::Camera => MediaKind::Camera,
    };
    let sid = tile.id.clone();
    let screen = tile.kind == TileKind::Screen;
    MediaTile::new(
        SharedString::from(format!("call-tile-{}", tile.id)),
        tile_label(tile),
        kind,
    )
    .speaking(tile.speaking)
    .video(move |slot| {
        let paint_sid = sid.clone();
        canvas(
            move |bounds, window, _| {
                let scale = window.scale_factor();
                visible.borrow_mut().push(TileDemand {
                    track_sid: sid,
                    width_px: (f32::from(bounds.size.width) * scale) as u32,
                    height_px: (f32::from(bounds.size.height) * scale) as u32,
                    focused: screen,
                });
            },
            move |bounds, _, window, cx| {
                if let Some(frames) = &frames {
                    let fit = if screen {
                        Fit::Contain
                    } else {
                        // The tile masks its own corners.
                        Fit::Cover {
                            corners: transparent_black(),
                        }
                    };
                    frames.paint(&paint_sid, bounds, slot.radius, fit, window, cx);
                }
            },
        )
        .absolute()
        .size_full()
        .into_any_element()
    })
}

impl RenderOnce for CallSurface {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let pairs = crate::kit::WidthRange::current(window).is_phone();
        let (watched, offered): (Vec<_>, Vec<_>) =
            self.tiles.iter().cloned().partition(|tile| tile.watched);
        let visible: Rc<RefCell<Vec<TileDemand>>> = Rc::default();

        let per_row = if pairs { 2 } else { 1 };
        let tiles = (!watched.is_empty()).then(|| {
            div()
                .flex()
                .flex_col()
                .gap(px(SPACE_SM))
                .children(watched.chunks(per_row).map(|row| {
                    div()
                        .flex()
                        .gap(px(SPACE_SM))
                        .children(row.iter().map(|tile| {
                            div().flex_1().min_w_0().child(video_tile(
                                tile,
                                self.frames.clone(),
                                visible.clone(),
                            ))
                        }))
                }))
        });
        let watching = (!watched.is_empty()).then(|| {
            let stop = self.actions.stop_watching.clone();
            ListRow::new(
                "call-watching",
                if watched.len() == 1 {
                    format!("Watching {}", tile_label(&watched[0]))
                } else {
                    format!("Watching {}", watched.len())
                },
            )
            .trailing(
                Button::new("call-stop-watching", "Stop watching")
                    .soft()
                    .size(ButtonSize::Sm)
                    .on_click(move |_, window, cx| stop(window, cx)),
            )
        });
        let many = offered.len() > OFFERED_ROWS;
        let summary = many.then(|| {
            let open = self.actions.open_call_view.clone();
            ListRow::new("call-offered-summary", offered_summary(&offered)).trailing(
                Button::new("call-see-all", "See all")
                    .accessibility_label("See all in the call view")
                    .ghost()
                    .size(ButtonSize::Sm)
                    .on_click(move |_, window, cx| open(window, cx)),
            )
        });
        // Watch buttons by row (`call-watch-0`): the rigs can't know a track's sid.
        let rows = offered
            .iter()
            .take(OFFERED_ROWS)
            .enumerate()
            .map(|(index, tile)| {
                let watch = self.actions.watch.clone();
                let sid = tile.id.clone();
                let (icon, words) = match tile.kind {
                    TileKind::Screen => (
                        LoungeIcon::ScreenShare,
                        format!("{} is sharing their screen", tile.name),
                    ),
                    TileKind::Camera => {
                        (LoungeIcon::Video, format!("{}'s camera is on", tile.name))
                    }
                };
                ListRow::new(SharedString::from(format!("call-offer-{}", tile.id)), words)
                    .leading(Icon::lounge(icon).color(sem.role.text_secondary))
                    .trailing(
                        Button::new(SharedString::from(format!("call-watch-{index}")), "Watch")
                            .accessibility_label(format!("Watch {}", tile_label(tile)))
                            .soft()
                            .size(ButtonSize::Sm)
                            .on_click(move |_, window, cx| watch(&sid, window, cx)),
                    )
            });
        let offered_rows = (!offered.is_empty()).then(|| {
            div()
                .flex()
                .flex_col()
                .gap(px(SPACE_XS))
                .children(summary)
                .children(rows)
        });
        let own = self.sharing_screen.then(|| {
            let stop = self.actions.stop_sharing.clone();
            ListRow::new("call-own-share", "You're sharing your screen")
                .leading(Icon::lounge(LoungeIcon::ScreenShare).color(sem.role.accent))
                .trailing(
                    Button::new("call-stop-sharing", "Stop sharing")
                        .danger()
                        .size(ButtonSize::Sm)
                        .on_click(move |_, window, cx| stop(window, cx)),
                )
        });

        // Last in paint order: every watched tile has said where it is by now.
        let demands = self.actions.demands.clone();
        let reported = visible.clone();
        let report = canvas(
            |_, _, _| (),
            move |_, _, _, _| {
                let mut list = reported.borrow().clone();
                list.sort_by(|a, b| a.track_sid.cmp(&b.track_sid));
                demands(list);
            },
        )
        .absolute()
        .size_0();

        div()
            .id("call-surface")
            .test_support()
            .role(Role::Region)
            .aria_label("Call video")
            .relative()
            .child(
                Card::new("call-surface-card")
                    .padding(Padding::Md)
                    .children(tiles)
                    .children(watching)
                    .children(offered_rows)
                    .children(own),
            )
            .child(report)
    }
}
