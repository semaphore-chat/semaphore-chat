//! The call view: a grid of tiles, or one large tile with a strip when someone shares a screen.

use super::bar::voice_bar;
use super::frames::{Fit, VideoFrames};
use super::icons::{self, icon};
use super::model::{
    QualityLevel, StageLayout, Tile, TileContent, TileDemand, VoiceController, VoiceStageModel,
    build_tiles, choose_layout, display_name, grid_columns, initial, tile_hue,
};
use super::soundboard::SoundboardBar;
use super::theme::{self, alpha};
use gpui_kit::*;
use semaphore_core::model::ParticipantView;
use semaphore_core::model::VoiceStatus;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

/// `isMobile` on the web.
const NARROW_WIDTH: f32 = 768.;
/// `GRID_TILE_MAX_WIDTH`, `GRID_TILE_MAX_HEIGHT`: a tile needn't grow past what a person needs.
const GRID_TILE_MAX: (f32, f32) = (640., 480.);
const STRIP_WIDTH: f32 = 200.;
const STRIP_TILE_HEIGHT: f32 = 150.;
const PHONE_ROW_HEIGHT: f32 = 120.;
/// `PHONE_COMPACT_TILE_THRESHOLD` and friends: past this many on a phone, tiles stop shrinking.
const PHONE_COMPACT_THRESHOLD: usize = 6;
const COMPACT_TILE_MIN_WIDTH: f32 = 96.;
const COMPACT_TILE_HEIGHT: f32 = 104.;
const COMPACT_AVATAR: f32 = 52.;
const COMPACT_GAP: f32 = 6.;
/// How often the view looks for new frames. Half a vsync, so a frame waits at most that long, and
/// it costs next to nothing when none arrived.
const FRAME_POLL: Duration = Duration::from_millis(8);
const IDLE_POLL: Duration = Duration::from_millis(100);

pub struct VoiceStage {
    model: VoiceStageModel,
    frames: Arc<VideoFrames>,
    controller: Arc<dyn VoiceController>,
    pinned: Option<String>,
    soundboard: SoundboardBar,
    /// Filled while tiles prepaint, read at the end of paint.
    visible: Rc<RefCell<Vec<TileDemand>>>,
    last_demands: Rc<RefCell<Option<Vec<TileDemand>>>>,
    _redraw: Task<()>,
}

impl VoiceStage {
    pub fn new(
        model: VoiceStageModel,
        frames: Arc<VideoFrames>,
        controller: Arc<dyn VoiceController>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        // Frames arrive off-thread and write their textures directly, so all the UI has to do is
        // draw again, and only if something came in.
        let watched = frames.clone();
        let redraw = cx.spawn_in(window, async move |this, cx| {
            loop {
                let poll = match this.read_with(cx, |stage, _| stage.has_video()) {
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
        Self {
            model,
            frames,
            controller,
            pinned: None,
            soundboard: SoundboardBar::default(),
            visible: Rc::default(),
            last_demands: Rc::default(),
            _redraw: redraw,
        }
    }

    pub fn set_model(&mut self, model: VoiceStageModel, cx: &mut Context<Self>) {
        if self.model != model {
            self.model = model;
            cx.notify();
        }
    }

    /// W4: the soundboard's button and popover on the bar (`view: Some` in a channel call).
    pub fn set_soundboard(&mut self, soundboard: SoundboardBar, cx: &mut Context<Self>) {
        if self.soundboard != soundboard {
            self.soundboard = soundboard;
            cx.notify();
        }
    }

    pub fn frames(&self) -> &Arc<VideoFrames> {
        &self.frames
    }

    /// Sets the tile shown large, as a click on one does.
    pub fn set_pinned(&mut self, key: Option<String>, cx: &mut Context<Self>) {
        self.pinned = key;
        cx.notify();
    }

    fn has_video(&self) -> bool {
        self.model
            .voice
            .participants
            .iter()
            .any(|p| p.camera.is_some() || p.screen_share.is_some())
    }

    fn quality_of(&self, tile: &Tile) -> QualityLevel {
        if tile.participant.is_self {
            self.model.local_quality
        } else {
            self.model
                .quality
                .get(&tile.participant.identity)
                .copied()
                .unwrap_or_default()
        }
    }

    fn tile(
        &self,
        tile: &Tile,
        focused: bool,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let speaking = tile.participant.speaking && !tile.is_screen();
        let positive = theme::positive();
        let key = tile.key.clone();
        let mut card = div()
            .id(SharedString::from(format!("tile-{key}")))
            .group(SharedString::from(format!("tile-{key}")))
            .relative()
            .size_full()
            .overflow_hidden()
            .rounded(theme::TILE_RADIUS)
            .bg(theme::grey_900())
            // Always 2px, transparent when quiet, so speaking never moves anything.
            .border_2()
            .border_color(if speaking {
                positive
            } else {
                gpui_kit::transparent_black()
            })
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, _, cx| {
                let next = (this.pinned.as_deref() != Some(key.as_str())).then(|| key.clone());
                this.set_pinned(next, cx);
            }))
            .on_mouse_down(MouseButton::Right, {
                let controller = self.controller.clone();
                let identity = tile.participant.identity.clone();
                move |event, _, cx| {
                    cx.stop_propagation();
                    controller.open_participant_menu(identity.clone(), event.position);
                }
            });
        if speaking {
            card = card.shadow(vec![BoxShadow {
                color: alpha(positive, 0.45),
                offset: point(px(0.), px(0.)),
                blur_radius: px(18.),
                spread_radius: px(0.),
                inset: false,
            }]);
        }
        match tile.track_sid() {
            Some(sid) => {
                let sid = sid.to_owned();
                // Faces fill their tile. A screen keeps every pixel, and so does anyone focused.
                let fit = if tile.is_screen() || focused {
                    Fit::Contain
                } else {
                    Fit::Cover {
                        corners: if speaking {
                            positive
                        } else {
                            gpui_kit::black()
                        },
                    }
                };
                card = card
                    .bg(gpui_kit::black())
                    // A share on stage gets its top layer, the only one with the full frame rate.
                    // A big camera is big enough to ask for that by size alone.
                    .child(self.video_surface(sid, focused && tile.is_screen(), fit))
                    .child(self.overlay(tile, narrow));
            }
            None => card = card.child(self.avatar_body(tile, narrow)),
        }
        let quality = self.quality_of(tile);
        if quality.is_trouble() {
            card = card.child(
                div()
                    .absolute()
                    .top(px(8.))
                    .right(px(8.))
                    .p(px(4.))
                    .rounded(px(4.))
                    .bg(alpha(gpui_kit::black(), 0.6))
                    .child(quality_bars(quality)),
            );
        }
        // Found by id in rigs (`right-click tile-…`).
        card.test_support()
    }

    /// Draws frames, and reports whether this tile is really on screen and how big.
    fn video_surface(&self, track_sid: String, top_layer: bool, fit: Fit) -> impl IntoElement {
        let frames = self.frames.clone();
        let visible = self.visible.clone();
        let sid = track_sid.clone();
        canvas(
            move |bounds, window, _| {
                let on_screen = window.content_mask().bounds.intersect(&bounds);
                if f32::from(on_screen.size.width) > 0.0 && f32::from(on_screen.size.height) > 0.0 {
                    let scale = window.scale_factor();
                    visible.borrow_mut().push(TileDemand {
                        track_sid: sid,
                        width_px: (f32::from(bounds.size.width) * scale) as u32,
                        height_px: (f32::from(bounds.size.height) * scale) as u32,
                        focused: top_layer,
                    });
                }
            },
            move |bounds, _, window, cx| {
                frames.paint(
                    &track_sid,
                    bounds,
                    theme::TILE_RADIUS - px(2.),
                    fit,
                    window,
                    cx,
                );
            },
        )
        .absolute()
        .size_full()
    }

    /// Name and the unusual states. Hover only, unless on touch where nothing ever hovers.
    fn overlay(&self, tile: &Tile, narrow: bool) -> impl IntoElement {
        let always = narrow || self.model.always_show_overlays;
        let name = tile_label(tile);
        let group = SharedString::from(format!("tile-{}", tile.key));
        let mut strip = div()
            .absolute()
            .bottom_0()
            .left_0()
            .right_0()
            .flex()
            .items_center()
            .gap(px(6.))
            .p(px(8.))
            .bg(linear_gradient(
                180.,
                linear_color_stop(alpha(gpui_kit::black(), 0.), 0.),
                linear_color_stop(alpha(gpui_kit::black(), 0.7), 1.),
            ))
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme::white())
                    .min_w_0()
                    .truncate()
                    .child(name),
            )
            .children(status_badges(tile, 16.));
        if !always {
            strip = strip
                .invisible()
                .group_hover(group, |style| style.visible());
        }
        strip
    }

    fn avatar_body(&self, tile: &Tile, narrow: bool) -> impl IntoElement {
        let hue = tile_hue(&tile.participant.identity) / 360.;
        let tint = hsla(hue, 0.65, 0.45, 1.0);
        let name = tile_label(tile);
        let speaking = tile.participant.speaking;
        let size = if narrow { 64. } else { 96. };
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(if narrow { 6. } else { 12. }))
            .px(px(8.))
            // The web's radial tint, at its mean. GPUI only has linear gradients.
            .bg(alpha(tint, 0.2))
            .child(
                div()
                    .size(px(size))
                    .min_w(px(28.))
                    .min_h(px(28.))
                    .flex_shrink(1.)
                    .rounded_full()
                    .bg(tint)
                    .flex()
                    .items_center()
                    .justify_center()
                    .border_3()
                    .border_color(if speaking {
                        theme::positive()
                    } else {
                        gpui_kit::transparent_black()
                    })
                    .text_color(theme::white())
                    .text_size(px(size * 0.42))
                    .font_weight(FontWeight::MEDIUM)
                    .child(initial(display_name(&tile.participant))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .max_w_full()
                    .min_w_0()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme::grey_100())
                            .min_w_0()
                            .truncate()
                            .child(name),
                    )
                    .children(status_badges(tile, 16.)),
            )
    }

    fn grid(
        &self,
        tiles: &[Tile],
        narrow: bool,
        portrait: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let columns = grid_columns(tiles.len(), narrow, portrait);
        let rows = tiles.len().div_ceil(columns);
        let capped = !narrow && !tiles.iter().any(Tile::is_screen);
        let mut grid = div().size_full().flex().flex_wrap().overflow_hidden();
        if capped {
            grid = grid.justify_center().content_center();
        }
        for tile in tiles {
            let mut slot = div()
                .w(relative(1. / columns as f32))
                .h(relative(1. / rows as f32))
                .p(px(4.));
            if capped {
                slot = slot.max_w(px(GRID_TILE_MAX.0)).max_h(px(GRID_TILE_MAX.1));
            }
            grid = grid.child(slot.child(self.tile(tile, false, narrow, cx)));
        }
        grid
    }

    /// Phone, big call: a scrolling list that doesn't squeeze anyone. Voice-only people get a small
    /// avatar; video spans the row, because a thumbnail of a face on a phone is worth nobody's data.
    fn compact_grid(&self, tiles: &[Tile], width: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let columns =
            (((width + COMPACT_GAP) / (COMPACT_TILE_MIN_WIDTH + COMPACT_GAP)) as usize).max(1);
        let mut grid = div()
            .id("voice-compact")
            .size_full()
            .overflow_y_scroll()
            .flex()
            .flex_wrap()
            .content_start();
        for tile in tiles {
            grid = grid.child(if tile.track_sid().is_some() {
                div()
                    .w_full()
                    .h(px(width * 9. / 16.))
                    .flex_shrink_0()
                    .p(px(COMPACT_GAP / 2.))
                    .child(self.tile(tile, false, true, cx))
                    .into_any_element()
            } else {
                div()
                    .w(relative(1. / columns as f32))
                    .h(px(COMPACT_TILE_HEIGHT + COMPACT_GAP))
                    .flex_shrink_0()
                    .p(px(COMPACT_GAP / 2.))
                    .child(compact_avatar(tile))
                    .into_any_element()
            });
        }
        grid
    }

    fn stage(
        &self,
        tiles: &[Tile],
        main: &str,
        narrow: bool,
        portrait: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let (focused, others): (Vec<&Tile>, Vec<&Tile>) =
            tiles.iter().partition(|tile| tile.key == main);
        let stacked = narrow && portrait;
        let mut strip = div().id("voice-strip").overflow_y_scroll();
        strip = if stacked {
            // Only a row gap: two half-width slots plus a column gap wouldn't fit on one line.
            strip
                .flex()
                .flex_row()
                .flex_wrap()
                .content_start()
                .flex_1()
                .min_h_0()
                .w_full()
                .gap_y(px(8.))
        } else {
            strip
                .flex()
                .flex_col()
                .flex_shrink_0()
                .gap(px(8.))
                .w(px(STRIP_WIDTH))
                .h_full()
        };
        for tile in &others {
            let slot = if stacked {
                // Two columns, with the gap shared between them.
                div()
                    .w(relative(0.5))
                    .h(px(PHONE_ROW_HEIGHT))
                    .flex_shrink_0()
                    .px(px(4.))
            } else {
                div().w_full().h(px(STRIP_TILE_HEIGHT)).flex_shrink_0()
            };
            strip = strip.child(slot.child(self.tile(tile, false, narrow, cx)));
        }
        let main_tile = focused
            .first()
            .map(|tile| self.tile(tile, true, narrow, cx));
        let mut stage = div().size_full().flex().gap(px(8.)).overflow_hidden();
        if stacked {
            stage = stage.flex_col();
        }
        let main_box = if stacked {
            div().w_full().h(relative(0.4)).flex_shrink_0()
        } else {
            div().flex_1().min_w_0().h_full()
        };
        stage = stage.children(main_tile.map(|tile| main_box.child(tile)));
        if !others.is_empty() {
            stage = stage.child(strip);
        }
        stage
    }

    fn solo(&self, tile: Option<&Tile>, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let title = if self.model.is_dm {
            "Waiting for others to join\u{2026}"
        } else {
            "You're the only one here"
        };
        let (w, h, inset) = if narrow {
            (128., 96., 8.)
        } else {
            (240., 150., 16.)
        };
        div()
            .relative()
            .size_full()
            .overflow_hidden()
            .child(
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(if narrow { 8. } else { 12. }))
                    .px(px(16.))
                    .child(
                        div()
                            .text_size(px(if narrow { 20. } else { 24. }))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme::grey_100())
                            .text_center()
                            .child(title),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .text_color(theme::grey_400())
                            .child(icon(icons::VOLUME_UP, px(20.), theme::grey_400()))
                            .child(
                                div()
                                    .text_sm()
                                    .truncate()
                                    .child(self.model.channel_name.clone()),
                            ),
                    ),
            )
            .children(tile.map(|tile| {
                div()
                    .absolute()
                    .right(px(inset))
                    .bottom(px(inset))
                    .w(px(w))
                    .h(px(h))
                    .rounded(px(4.))
                    .child(self.tile(tile, false, true, cx))
            }))
    }

    fn empty(&self) -> impl IntoElement {
        let text = match self.model.voice.status {
            VoiceStatus::Connecting => "Connecting\u{2026}",
            VoiceStatus::Reconnecting => "Reconnecting\u{2026}",
            _ => "Not in a voice channel",
        };
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .text_color(theme::text_secondary())
            .child(text)
    }
}

fn compact_avatar(tile: &Tile) -> impl IntoElement {
    let tint = hsla(tile_hue(&tile.participant.identity) / 360., 0.65, 0.45, 1.0);
    let speaking = tile.participant.speaking;
    // Room for one: server-muted (red) over deafened over muted, as the web's `pickCompactBadge`.
    let badge = voice_badges(&tile.participant)
        .into_iter()
        .min_by_key(|badge| match badge.kind {
            VoiceBadgeKind::ServerMuted => 0,
            VoiceBadgeKind::Deafened => 1,
            VoiceBadgeKind::Muted => 2,
        });
    let mut card = div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(6.))
        .px(px(6.))
        .overflow_hidden()
        .rounded(theme::TILE_RADIUS)
        .bg(theme::grey_900())
        .border_2()
        .border_color(if speaking {
            theme::positive()
        } else {
            gpui_kit::transparent_black()
        })
        .child(
            div()
                .relative()
                .size(px(COMPACT_AVATAR))
                .flex_shrink_0()
                .rounded_full()
                .bg(tint)
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme::white())
                .text_size(px(COMPACT_AVATAR * 0.42))
                .font_weight(FontWeight::MEDIUM)
                .child(initial(display_name(&tile.participant)))
                .children(badge.map(|badge| {
                    div()
                        .absolute()
                        .right(px(-4.))
                        .bottom(px(-4.))
                        .size(px(20.))
                        .rounded_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .bg(if badge.danger {
                            theme::error_main()
                        } else {
                            rgb(0x616161).into()
                        })
                        .border_2()
                        .border_color(theme::grey_900())
                        .child(icon(badge.icon(), px(12.), theme::white()))
                })),
        )
        .child(
            div()
                .w_full()
                .text_xs()
                .text_center()
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme::grey_100())
                .truncate()
                .child(tile_label(tile)),
        );
    if speaking {
        card = card.shadow(vec![BoxShadow {
            color: alpha(theme::positive(), 0.45),
            offset: point(px(0.), px(0.)),
            blur_radius: px(12.),
            spread_radius: px(0.),
            inset: false,
        }]);
    }
    card
}

fn tile_label(tile: &Tile) -> String {
    let mut name = display_name(&tile.participant).to_owned();
    if tile.participant.is_self {
        name.push_str(" (You)");
    }
    if matches!(tile.content, TileContent::Screen(_)) {
        name.push_str(" - Screen");
    }
    name
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceBadgeKind {
    Muted,
    /// A moderator's: red, and it wins over a self-mute, since it's the one they can't undo.
    ServerMuted,
    Deafened,
}

/// One of the out-of-the-ordinary voice states worth drawing on a tile or a row (the web's
/// `voiceStatusBadges`). The channel list's voice rows use these too.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoiceBadge {
    pub kind: VoiceBadgeKind,
    pub label: &'static str,
    /// Imposed by a moderator: drawn red rather than grey.
    pub danger: bool,
}

impl VoiceBadge {
    pub(super) fn icon(self) -> icons::VoiceIcon {
        match self.kind {
            VoiceBadgeKind::Deafened => icons::HEADSET_OFF,
            VoiceBadgeKind::Muted | VoiceBadgeKind::ServerMuted => icons::MIC_OFF,
        }
    }
}

pub fn voice_badges(participant: &ParticipantView) -> Vec<VoiceBadge> {
    let mut badges = Vec::new();
    if participant.server_muted {
        badges.push(VoiceBadge {
            kind: VoiceBadgeKind::ServerMuted,
            label: "Muted by a moderator",
            danger: true,
        });
    } else if participant.muted {
        badges.push(VoiceBadge {
            kind: VoiceBadgeKind::Muted,
            label: "Muted",
            danger: false,
        });
    }
    if participant.deafened {
        badges.push(VoiceBadge {
            kind: VoiceBadgeKind::Deafened,
            label: "Deafened",
            danger: false,
        });
    }
    badges
}

/// Only the out-of-the-ordinary: muted (grey), server-muted (red), deafened.
fn status_badges(tile: &Tile, size: f32) -> Vec<AnyElement> {
    voice_badges(&tile.participant)
        .into_iter()
        .map(|badge| {
            div()
                .flex_shrink_0()
                .child(icon(
                    badge.icon(),
                    px(size),
                    if badge.danger {
                        theme::error_main()
                    } else {
                        theme::grey_400()
                    },
                ))
                .into_any_element()
        })
        .collect()
}

pub(super) fn quality_bars(quality: QualityLevel) -> impl IntoElement {
    let lit = match quality {
        QualityLevel::Excellent | QualityLevel::Good => theme::positive(),
        QualityLevel::Poor => theme::warning(),
        QualityLevel::Lost => theme::error_main(),
        QualityLevel::Unknown => theme::text_disabled(),
    };
    div()
        .flex()
        .items_end()
        .gap(px(2.))
        .h(px(14.))
        .children([6., 10., 14.].iter().enumerate().map(|(index, height)| {
            div()
                .w(px(4.))
                .h(px(*height))
                .rounded(px(1.))
                .bg(if index < quality.bars() {
                    lit
                } else {
                    theme::disabled_background()
                })
        }))
}

impl Render for VoiceStage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.visible.borrow_mut().clear();
        let viewport = window.viewport_size();
        let narrow = f32::from(viewport.width) < NARROW_WIDTH;
        let portrait = viewport.height > viewport.width;
        let tiles = build_tiles(&self.model.voice);
        let layout = choose_layout(&tiles, self.pinned.as_deref());
        let body = match layout {
            StageLayout::Empty => self.empty().into_any_element(),
            StageLayout::Solo => self.solo(tiles.first(), narrow, cx).into_any_element(),
            StageLayout::Grid if narrow && tiles.len() > PHONE_COMPACT_THRESHOLD => self
                .compact_grid(&tiles, f32::from(viewport.width) - 8., cx)
                .into_any_element(),
            StageLayout::Grid => self.grid(&tiles, narrow, portrait, cx).into_any_element(),
            StageLayout::Stage { main } => self
                .stage(&tiles, &main, narrow, portrait, cx)
                .into_any_element(),
        };
        let visible = self.visible.clone();
        let last = self.last_demands.clone();
        let controller = self.controller.clone();
        // No call, no bar, as on the web. A reconnect keeps it: that's where Cancel lives.
        let in_call = matches!(
            self.model.voice.status,
            VoiceStatus::Connected | VoiceStatus::Reconnecting
        );
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(theme::page())
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .p(px(if narrow { 4. } else { 8. }))
                    .child(body),
            )
            .children(in_call.then(|| {
                voice_bar(
                    &self.model,
                    &self.soundboard,
                    narrow,
                    self.controller.clone(),
                    cx,
                )
            }))
            // Last in paint order, so every tile has reported by now.
            .child(
                canvas(
                    |_, _, _| (),
                    move |_, _, _, _| {
                        let mut demands = visible.borrow().clone();
                        demands.sort_by(|a, b| a.track_sid.cmp(&b.track_sid));
                        let mut last = last.borrow_mut();
                        if last.as_ref() != Some(&demands) {
                            controller.set_video_demands(demands.clone());
                            *last = Some(demands);
                        }
                    },
                )
                .absolute()
                .size_0(),
            )
    }
}

#[cfg(test)]
mod badge_tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn a_server_mute_outranks_a_self_mute_and_deafened_comes_too() {
        let mut person = ParticipantView {
            muted: true,
            ..ParticipantView::default()
        };
        assert_eq!(
            voice_badges(&person)
                .iter()
                .map(|b| b.kind)
                .collect::<Vec<_>>(),
            vec![VoiceBadgeKind::Muted]
        );
        person.server_muted = true;
        person.deafened = true;
        let badges = voice_badges(&person);
        assert_eq!(
            badges.iter().map(|b| b.kind).collect::<Vec<_>>(),
            vec![VoiceBadgeKind::ServerMuted, VoiceBadgeKind::Deafened]
        );
        assert!(badges[0].danger);
        assert_eq!(badges[0].label, "Muted by a moderator");
        assert!(voice_badges(&ParticipantView::default()).is_empty());
    }
}
