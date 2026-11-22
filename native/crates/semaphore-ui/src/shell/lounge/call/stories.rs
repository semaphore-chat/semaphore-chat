//! The call slot in the real template (AppFrame and ThreeIslands), as the web's
//! `CallBar.stories.tsx`, `CallSurface.stories.tsx` and the voice notice show it, under their
//! names (`shell-call-bar--muted` is `shell-call-bar-muted` here). Each fills the window, so the
//! UI review's phone, tablet and desktop sizes show the slot under the left island and above the
//! dock bar. Watched tiles show test cards.

use super::super::stories::sample_centre;
use super::super::{Act, column, text_line};
use super::*;
use crate::kit::{AppFrame, CallStack, PhonePane, ThreeIslands};
use crate::stories::Story;
use crate::theme::{self, DEFAULT_BASE, SemTheme, ThemeInput};
use crate::voice::{NoController, VideoFrames, test_card};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, SPACE_SM};
use semaphore_design::{Intensity, Mode};
use std::rc::Rc;
use std::sync::Arc;

#[derive(Clone)]
struct Scene {
    mode: Mode,
    bar: Option<CallBarModel>,
    tiles: Vec<SurfaceTile>,
    sharing: bool,
    /// Watched tiles have frames (otherwise they wait for their first).
    frames: bool,
    notice: Option<VoiceNoticeModel>,
}

fn connected() -> CallBarModel {
    CallBarModel {
        room: "Squad Up".into(),
        is_dm: false,
        phase: CallPhase::Connected,
        muted: false,
        transmitting: false,
        mode: MicMode::Toggle,
        server_muted: false,
        deafened: false,
        talking: None,
        sharing_screen: false,
    }
}

fn scene(bar: impl FnOnce(&mut CallBarModel)) -> Scene {
    let mut model = connected();
    bar(&mut model);
    Scene {
        mode: Mode::Dark,
        bar: Some(model),
        tiles: Vec::new(),
        sharing: false,
        frames: true,
        notice: None,
    }
}

fn light(mut scene: Scene) -> Scene {
    scene.mode = Mode::Light;
    scene
}

fn tile(id: &str, name: &str, kind: TileKind, watched: bool) -> SurfaceTile {
    SurfaceTile {
        id: id.into(),
        name: name.into(),
        kind,
        watched,
        speaking: false,
    }
}

fn screen(watched: bool) -> SurfaceTile {
    tile("dropbear-screen", "dropbear", TileKind::Screen, watched)
}

fn camera(watched: bool) -> SurfaceTile {
    tile("pri-camera", "pri", TileKind::Camera, watched)
}

fn with_tiles(tiles: Vec<SurfaceTile>, sharing: bool) -> Scene {
    let mut scene = scene(|bar| bar.sharing_screen = sharing);
    scene.tiles = tiles;
    scene.sharing = sharing;
    scene
}

fn notice(model: VoiceNoticeModel) -> Scene {
    Scene {
        mode: Mode::Dark,
        bar: None,
        tiles: Vec::new(),
        sharing: false,
        frames: false,
        notice: Some(model),
    }
}

struct Demo {
    scene: Scene,
    frames: Arc<VideoFrames>,
}

impl Render for Demo {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let s = &self.scene;
        let secondary = cx.sem().role.text_secondary;
        let left = column().gap(px(SPACE_SM)).children(
            ["general", "clips", "lfg", "memes"]
                .into_iter()
                .map(|name| text_line(t::TEXT_BODY, format!("# {name}")).text_color(secondary)),
        );
        let mut islands = ThreeIslands::new(left, "Couch Co-op", sample_centre(cx), "general")
            .phone_pane(PhonePane::Centre);
        if let Some(bar) = &s.bar {
            let controller = Arc::new(NoController);
            let mut stack = CallStack::new(CallBar::new(bar.clone(), controller));
            if shows_surface(&s.tiles, s.sharing) && bar.phase != CallPhase::Connecting {
                let nothing: Act = Rc::new(|_, _| {});
                stack = stack.surface(CallSurface::new(
                    s.tiles.clone(),
                    s.sharing,
                    Some(self.frames.clone()),
                    SurfaceActions {
                        watch: Rc::new(|_, _, _| {}),
                        stop_watching: nothing.clone(),
                        stop_sharing: nothing.clone(),
                        open_call_view: nothing,
                        demands: Rc::new(|_| {}),
                    },
                ));
            }
            islands = islands.call_bar(stack);
        } else if let Some(model) = &s.notice {
            islands = islands.call_bar(VoiceNoticeBar::new(
                model.clone(),
                Some(Rc::new(|_, _| {})),
                Rc::new(|_, _| {}),
            ));
        }
        AppFrame::new(islands)
    }
}

fn demo(scene: fn() -> Scene, window: &mut Window, cx: &mut App) -> AnyView {
    let scene = scene();
    theme::apply(
        ThemeInput::new(DEFAULT_BASE, scene.mode, Intensity::Minimal),
        cx,
    );
    let frames = VideoFrames::for_window(window);
    if scene.frames {
        for (index, tile) in scene.tiles.iter().enumerate() {
            let (width, height) = match tile.kind {
                TileKind::Screen => (1280, 720),
                TileKind::Camera => (640, 480),
            };
            test_card(&frames, &tile.id, index * 37 + 11, width, height);
        }
    }
    cx.new(|_| Demo { scene, frames }).into()
}

fn cameras(count: usize, watched: usize) -> Vec<SurfaceTile> {
    (0..count)
        .map(|n| {
            tile(
                &format!("camera-{n}"),
                &format!("friend{n}"),
                TileKind::Camera,
                n < watched,
            )
        })
        .collect()
}

pub fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $scene:expr) => {
            Story::new($name, |_, window, cx| demo($scene, window, cx))
        };
    }
    vec![
        // The bar (`CallBar.stories.tsx`).
        story!("shell-call-bar-connected", || scene(|_| {})),
        story!("shell-call-bar-connected-light", || light(scene(|_| {}))),
        story!("shell-call-bar-talking", || scene(
            |bar| bar.talking = Some("dropbear".into())
        )),
        story!("shell-call-bar-muted", || scene(|bar| bar.muted = true)),
        story!("shell-call-bar-muted-light", || light(scene(|bar| bar
            .muted =
            true))),
        story!("shell-call-bar-server-muted", || scene(|bar| bar
            .server_muted =
            true)),
        story!("shell-call-bar-deafened", || scene(|bar| {
            bar.muted = true;
            bar.deafened = true;
        })),
        story!("shell-call-bar-deafened-mic-on", || scene(|bar| bar
            .deafened =
            true)),
        story!("shell-call-bar-ptt-key", || scene(
            |bar| bar.mode = MicMode::PushToTalk { key: "V".into() }
        )),
        story!("shell-call-bar-ptt-key-held", || scene(|bar| {
            bar.mode = MicMode::PushToTalk { key: "V".into() };
            bar.transmitting = true;
        })),
        story!("shell-call-bar-joining", || scene(
            |bar| bar.phase = CallPhase::Connecting
        )),
        story!("shell-call-bar-reconnecting", || scene(
            |bar| bar.phase = CallPhase::Reconnecting(2)
        )),
        story!("shell-call-bar-long-name", || scene(|bar| {
            bar.room = "The extremely long voice room name for the Friday night raid".into();
            bar.talking = Some("a-person-with-a-very-long-display-name".into());
        })),
        story!("shell-call-bar-dm", || scene(|bar| {
            bar.room = "pri".into();
            bar.is_dm = true;
        })),
        // The surface (`CallSurface.stories.tsx`).
        story!("shell-call-surface-screen", || with_tiles(
            vec![screen(true)],
            false
        )),
        story!("shell-call-surface-screen-light", || light(with_tiles(
            vec![screen(true)],
            false
        ))),
        story!("shell-call-surface-camera", || with_tiles(
            vec![camera(true)],
            false
        )),
        story!("shell-call-surface-two-tiles", || with_tiles(
            vec![screen(true), camera(true)],
            false
        )),
        story!("shell-call-surface-four-tiles", || with_tiles(
            cameras(4, 4),
            false
        )),
        story!("shell-call-surface-subscribing", || {
            let mut scene = with_tiles(vec![screen(true)], false);
            scene.frames = false;
            scene
        }),
        story!("shell-call-surface-own-share", || with_tiles(
            Vec::new(),
            true
        )),
        story!("shell-call-surface-own-share-light", || light(with_tiles(
            Vec::new(),
            true
        ))),
        story!("shell-call-surface-not-watched", || with_tiles(
            vec![screen(false), camera(false)],
            false
        )),
        story!("shell-call-surface-not-watched-light", || light(
            with_tiles(vec![screen(false), camera(false)], false)
        )),
        story!("shell-call-surface-ten-cameras", || with_tiles(
            cameras(10, 0),
            false
        )),
        story!("shell-call-surface-mixed", || with_tiles(
            vec![screen(true), camera(false)],
            true
        )),
        story!("shell-call-surface-long-name-everything", || {
            let mut scene = with_tiles(
                vec![
                    tile(
                        "long-screen",
                        "a-person-with-a-very-long-display-name",
                        TileKind::Screen,
                        true,
                    ),
                    tile(
                        "long-camera",
                        "another-person-with-a-long-name",
                        TileKind::Camera,
                        false,
                    ),
                ],
                true,
            );
            if let Some(bar) = &mut scene.bar {
                bar.room = "The extremely long voice room name for the Friday night raid".into();
            }
            scene
        }),
        // The voice notice.
        story!("shell-voice-notice-join-failed", || notice(
            join_failed_notice()
        )),
        story!("shell-voice-notice-join-failed-light", || light(notice(
            join_failed_notice()
        ))),
        story!("shell-voice-notice-lost-connection", || notice(
            ended_notice(&semaphore_core::model::VoiceEnded {
                options: Default::default(),
                room: semaphore_core::model::VoiceRoom::Dm {
                    dm_group_id: "d".into()
                },
                while_reconnecting: true,
                error: None,
            })
        )),
        story!("shell-voice-notice-ended", || notice(ended_notice(
            &semaphore_core::model::VoiceEnded {
                room: semaphore_core::model::VoiceRoom::Dm {
                    dm_group_id: "d".into()
                },
                while_reconnecting: false,
                error: None,
                options: Default::default(),
            }
        ))),
    ]
}
