//! The call slot: its words (pure, the web's `callBarLine` and `callSurfaceText` cases) and what
//! the bar, the surface and the notice draw and do.

use super::*;
use crate::dms::rig::{Rig, rig};
use crate::kit::BehaviourRoot;
use crate::voice::{PttState, TileDemand, VoiceController, VoiceStageModel};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_core::model::{
    LocalShare, ParticipantView, UserView, VideoTrackView, VoiceEnded, VoiceJoinOptions, VoiceRoom,
    VoiceStatus, VoiceView,
};
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------------------------
// The model and its words

fn person(id: &str, is_self: bool) -> ParticipantView {
    ParticipantView {
        identity: id.into(),
        user: UserView {
            id: id.into(),
            username: id.into(),
            ..UserView::default()
        },
        is_self,
        ..ParticipantView::default()
    }
}

fn stage(status: VoiceStatus) -> VoiceStageModel {
    VoiceStageModel {
        voice: VoiceView {
            status,
            room: Some(VoiceRoom::Channel {
                channel_id: "vc".into(),
                community_id: Some("c".into()),
            }),
            participants: vec![person("me", true), person("pri", false)],
            ..VoiceView::default()
        },
        channel_name: "Squad Up".into(),
        ..VoiceStageModel::default()
    }
}

fn bar(edit: impl FnOnce(&mut CallBarModel)) -> CallBarModel {
    let mut model = CallBarModel::from_stage(&stage(VoiceStatus::Connected)).expect("a call");
    edit(&mut model);
    model
}

fn text(model: &CallBarModel) -> Option<(String, LineTone, bool)> {
    call_bar_line(model).map(|line| (line.text, line.tone, line.full))
}

fn ptt(key: &str) -> MicMode {
    MicMode::PushToTalk { key: key.into() }
}

#[test]
fn no_call_no_bar_and_the_phase_follows_the_call() {
    assert_eq!(CallBarModel::from_stage(&VoiceStageModel::default()), None);
    let phase = |status, attempt| {
        let mut model = stage(status);
        model.reconnect_attempt = attempt;
        CallBarModel::from_stage(&model).map(|model| model.phase)
    };
    assert_eq!(
        phase(VoiceStatus::Connecting, None),
        Some(CallPhase::Connecting)
    );
    assert_eq!(
        phase(VoiceStatus::Connected, None),
        Some(CallPhase::Connected)
    );
    assert_eq!(
        phase(VoiceStatus::Reconnecting, None),
        Some(CallPhase::Reconnecting(1))
    );
    assert_eq!(
        phase(VoiceStatus::Connected, Some(3)),
        Some(CallPhase::Reconnecting(3))
    );
    let mut gone = stage(VoiceStatus::Disconnected);
    gone.voice.room = None;
    assert_eq!(CallBarModel::from_stage(&gone), None);
}

#[test]
fn the_model_reads_the_room_the_key_and_who_talks() {
    let mut model = stage(VoiceStatus::Connected);
    model.voice.participants[1].speaking = true;
    model.voice.participants[0].speaking = true;
    model.voice.local.screen = LocalShare::On;
    model.ptt = Some(PttState {
        held: true,
        key_label: "V".into(),
    });
    let bar = CallBarModel::from_stage(&model).expect("a call");
    assert_eq!(bar.room, "Squad Up");
    assert_eq!(bar.talking.as_deref(), Some("pri"), "never yourself");
    assert_eq!(bar.mode, ptt("V"));
    assert!(bar.transmitting && bar.live());
    assert!(bar.sharing_screen);
    model.channel_name.clear();
    model.is_dm = true;
    assert_eq!(
        CallBarModel::from_stage(&model).expect("a call").room,
        "Direct Message"
    );
}

#[test]
fn the_line_says_the_most_important_thing_first() {
    use LineTone::*;
    let s = |text: &str, tone, full| Some((text.to_owned(), tone, full));
    assert_eq!(
        text(&bar(|m| m.phase = CallPhase::Connecting)),
        s("Joining\u{2026}", Secondary, false)
    );
    assert_eq!(
        text(&bar(|m| m.server_muted = true)),
        s("Muted by a moderator", Danger, true)
    );
    assert_eq!(
        text(&bar(|m| m.deafened = true)),
        s("Deafened \u{b7} your mic is on", Danger, true)
    );
    assert_eq!(
        text(&bar(|m| {
            m.deafened = true;
            m.muted = true;
        })),
        s("Deafened", Secondary, false)
    );
    assert_eq!(text(&bar(|m| m.phase = CallPhase::Reconnecting(2))), None);
    assert_eq!(
        text(&bar(|m| {
            m.phase = CallPhase::Reconnecting(2);
            m.muted = true;
        })),
        s("Muted", Secondary, false)
    );
    assert_eq!(
        text(&bar(|m| {
            m.mode = ptt("V");
            m.transmitting = true;
        })),
        s("You're talking", Accent, false)
    );
    assert_eq!(
        text(&bar(|m| m.mode = ptt("V"))),
        s("Hold V to talk", Secondary, false)
    );
    assert_eq!(
        text(&bar(|m| m.mode = ptt(""))),
        s("Hold the key to talk", Secondary, false)
    );
    assert_eq!(text(&bar(|m| m.muted = true)), s("Muted", Secondary, false));
    assert_eq!(
        text(&bar(|m| m.talking = Some("dropbear".into()))),
        s("dropbear is talking", Accent, false)
    );
    assert_eq!(text(&bar(|_| {})), s("Voice connected", Secondary, false));
    assert_eq!(
        text(&bar(|m| m.is_dm = true)),
        s("Call connected", Secondary, false)
    );
}

#[test]
fn the_mic_says_why_it_can_do_nothing() {
    assert_eq!(mic_unavailable_reason(&bar(|_| {})), None);
    assert_eq!(
        mic_unavailable_reason(&bar(|m| m.server_muted = true)).as_deref(),
        Some("Muted by a moderator")
    );
    assert_eq!(
        mic_unavailable_reason(&bar(|m| m.mode = ptt("V"))).as_deref(),
        Some("Hold V to talk")
    );
    // A moderator's mute closes the mic whatever you chose.
    assert!(!bar(|m| m.server_muted = true).live());
}

fn track(sid: &str) -> VideoTrackView {
    VideoTrackView {
        track_sid: sid.into(),
        width: 640,
        height: 480,
    }
}

#[test]
fn the_surface_offers_others_shares_first_then_cameras() {
    let mut voice = stage(VoiceStatus::Connected).voice;
    voice.participants[0].screen_share = Some(track("my-screen"));
    voice.participants[1].camera = Some(track("pri-cam"));
    let mut sol = person("sol", false);
    sol.screen_share = Some(track("sol-screen"));
    sol.speaking = true;
    voice.participants.push(sol);
    let watched: BTreeSet<String> = ["pri-cam".to_owned()].into();
    let tiles = surface_tiles(&voice, &watched);
    let shown: Vec<(&str, TileKind, bool)> = tiles
        .iter()
        .map(|tile| (tile.id.as_str(), tile.kind, tile.watched))
        .collect();
    assert_eq!(
        shown,
        [
            ("sol-screen", TileKind::Screen, false),
            ("pri-cam", TileKind::Camera, true)
        ]
    );
    assert!(tiles[0].speaking);
    assert_eq!(tile_label(&tiles[0]), "sol's screen");
    assert_eq!(tile_label(&tiles[1]), "pri");
    assert!(shows_surface(&tiles, false));
    assert!(shows_surface(&[], true));
    assert!(!shows_surface(&[], false));
}

#[test]
fn the_summary_counts_by_kind_shares_first() {
    let tile = |kind| SurfaceTile {
        id: String::new(),
        name: String::new(),
        kind,
        watched: false,
        speaking: false,
    };
    assert_eq!(offered_summary(&[]), "");
    assert_eq!(offered_summary(&[tile(TileKind::Camera)]), "1 camera on");
    assert_eq!(
        offered_summary(&[
            tile(TileKind::Camera),
            tile(TileKind::Screen),
            tile(TileKind::Screen),
            tile(TileKind::Camera),
        ]),
        "2 screens shared \u{b7} 2 cameras on"
    );
}

#[test]
fn a_lost_connection_offers_retry_and_a_plain_ending_does_not() {
    let room = VoiceRoom::Channel {
        channel_id: "vc".into(),
        community_id: None,
    };
    let lost = ended_notice(&VoiceEnded {
        room: room.clone(),
        while_reconnecting: true,
        error: Some("no route".into()),
        options: VoiceJoinOptions::default(),
    });
    assert!(lost.retry);
    assert_eq!(lost.severity, NoticeSeverity::Error);
    assert_eq!(
        lost.title,
        "Lost connection to voice and could not reconnect"
    );
    let plain = ended_notice(&VoiceEnded {
        room,
        while_reconnecting: false,
        error: None,
        options: VoiceJoinOptions::default(),
    });
    assert!(!plain.retry);
    assert!(join_failed_notice().retry);
}

// ---------------------------------------------------------------------------------------------
// The views

#[derive(Default)]
struct Recorder(Mutex<Vec<String>>);

impl Recorder {
    fn calls(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
    fn push(&self, call: impl Into<String>) {
        self.0.lock().unwrap().push(call.into());
    }
}

impl VoiceController for Recorder {
    fn set_muted(&self, muted: bool) {
        self.push(format!("muted {muted}"));
    }
    fn set_deafened(&self, deafened: bool) {
        self.push(format!("deafened {deafened}"));
    }
    fn leave(&self) {
        self.push("leave");
    }
    fn set_video_demands(&self, _: Vec<TileDemand>) {}
    fn open_call_view(&self) {
        self.push("open");
    }
}

type Body = Box<dyn Fn(&mut Window, &mut App) -> AnyElement>;

struct Host(Body);

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        BehaviourRoot::new(div().w(px(288.)).child((self.0)(window, cx)))
    }
}

fn bar_rig(cx: &mut TestAppContext, model: CallBarModel) -> (Rig<Host, ()>, Arc<Recorder>) {
    let recorder = Arc::new(Recorder::default());
    let controller = recorder.clone();
    let rig = rig(cx, 900., move |_, _| {
        Host(Box::new(move |_, _| {
            CallBar::new(model.clone(), controller.clone()).into_any_element()
        }))
    });
    (rig, recorder)
}

#[gpui_kit::test]
fn the_bar_mutes_deafens_leaves_and_opens_the_call_view(cx: &mut TestAppContext) {
    let (rig, calls) = bar_rig(cx, bar(|_| {}));
    rig.click(cx, "call-bar-mic");
    rig.click(cx, "call-bar-deafen");
    rig.click(cx, "call-bar-open");
    rig.click(cx, "call-bar-leave");
    assert_eq!(
        calls.calls(),
        ["muted true", "deafened true", "open", "leave"]
    );
    assert!(!rig.has(cx, "call-bar-reconnecting"));
    assert!(!rig.has(cx, "call-bar-line"), "a short line shares the row");
}

/// What the announcer has said through the bar's `BehaviourRoot`.
fn said(rig: &Rig<Host, ()>, cx: &mut TestAppContext) -> Vec<String> {
    rig.with(cx, |_, window, _| {
        window
            .find_all_by_role(Role::Status)
            .iter()
            .filter_map(|node| node.label().map(str::to_owned))
            .collect()
    })
}

#[gpui_kit::test]
fn an_unavailable_mic_does_nothing_and_its_reason_is_the_line(cx: &mut TestAppContext) {
    let (rig, calls) = bar_rig(cx, bar(|m| m.server_muted = true));
    rig.click(cx, "call-bar-mic");
    assert!(calls.calls().is_empty(), "the mic stays shut");
    assert_eq!(
        said(&rig, cx),
        ["Muted by a moderator"],
        "pressing says why nobody hears a thing"
    );
    assert!(
        rig.has(cx, "call-bar-line"),
        "read in full, on its own line"
    );
    let (rig, calls) = bar_rig(cx, bar(|m| m.mode = ptt("V")));
    rig.click(cx, "call-bar-mic");
    assert!(calls.calls().is_empty());
    assert_eq!(said(&rig, cx), ["Hold V to talk"]);
}

#[gpui_kit::test]
fn joining_offers_nothing_to_press(cx: &mut TestAppContext) {
    let (rig, calls) = bar_rig(cx, bar(|m| m.phase = CallPhase::Connecting));
    assert!(rig.has(cx, "call-bar-open"));
    for id in ["call-bar-mic", "call-bar-deafen", "call-bar-leave"] {
        assert!(!rig.has(cx, id), "{id}");
    }
    rig.click(cx, "call-bar-open");
    assert!(calls.calls().is_empty());
}

#[gpui_kit::test]
fn reconnecting_has_cancel_and_never_says_connected(cx: &mut TestAppContext) {
    let (rig, calls) = bar_rig(cx, bar(|m| m.phase = CallPhase::Reconnecting(2)));
    assert!(rig.has(cx, "call-bar-reconnecting"));
    let description = |rig: &Rig<Host, ()>, cx: &mut TestAppContext| {
        rig.with(cx, |_, window, _| {
            window
                .find("call-bar-open")
                .description()
                .map(str::to_owned)
        })
    };
    // The mic is open, so the line says nothing at all: the status row above says what's up, and
    // nothing here claims the call is connected while it isn't.
    assert_eq!(description(&rig, cx), None);
    rig.click(cx, "call-bar-cancel");
    assert_eq!(calls.calls(), ["leave"]);
    // Muted, it says so, still without "connected".
    let (rig, _) = bar_rig(
        cx,
        bar(|m| {
            m.phase = CallPhase::Reconnecting(2);
            m.muted = true;
        }),
    );
    assert_eq!(description(&rig, cx).as_deref(), Some("Muted"));
}

type Log = Rc<RefCell<Vec<String>>>;

fn surface_rig(
    cx: &mut TestAppContext,
    tiles: Vec<SurfaceTile>,
    sharing: bool,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, _| {
        let log = shared.clone();
        Host(Box::new(move |_, _| {
            let (watch, stop, share, open, demands) = (
                log.clone(),
                log.clone(),
                log.clone(),
                log.clone(),
                log.clone(),
            );
            CallSurface::new(
                tiles.clone(),
                sharing,
                None,
                SurfaceActions {
                    watch: Rc::new(move |id, _, _| watch.borrow_mut().push(format!("watch {id}"))),
                    stop_watching: Rc::new(move |_, _| stop.borrow_mut().push("stop".into())),
                    stop_sharing: Rc::new(move |_, _| share.borrow_mut().push("unshare".into())),
                    open_call_view: Rc::new(move |_, _| open.borrow_mut().push("open".into())),
                    demands: Rc::new(move |list: Vec<TileDemand>| {
                        let ids: Vec<String> =
                            list.into_iter().map(|demand| demand.track_sid).collect();
                        let line = format!("demands {}", ids.join(","));
                        let mut log = demands.borrow_mut();
                        if log.last() != Some(&line) {
                            log.push(line);
                        }
                    }),
                },
            )
            .into_any_element()
        }))
    });
    (rig, log)
}

fn offered(id: &str, kind: TileKind, watched: bool) -> SurfaceTile {
    SurfaceTile {
        id: id.into(),
        name: id.into(),
        kind,
        watched,
        speaking: false,
    }
}

fn entries(log: &Log) -> Vec<String> {
    log.borrow().clone()
}

fn actions(log: &Log) -> Vec<String> {
    entries(log)
        .into_iter()
        .filter(|line| !line.starts_with("demands"))
        .collect()
}

fn asked(log: &Log) -> Vec<String> {
    let mut lines: Vec<String> = entries(log)
        .into_iter()
        .filter(|line| line.starts_with("demands"))
        .collect();
    lines.dedup();
    lines
}

#[gpui_kit::test]
fn nothing_is_received_until_watch_and_stop_watching_stops_it(cx: &mut TestAppContext) {
    let (rig, log) = surface_rig(cx, vec![offered("s1", TileKind::Screen, false)], false);
    assert_eq!(asked(&log), ["demands "], "an offer asks for no video");
    rig.click(cx, "call-watch-0");
    assert_eq!(actions(&log), ["watch s1"]);
    let (rig, log) = surface_rig(cx, vec![offered("s1", TileKind::Screen, true)], false);
    assert_eq!(
        asked(&log),
        ["demands s1"],
        "a watched tile asks for its video"
    );
    rig.click(cx, "call-stop-watching");
    assert_eq!(actions(&log), ["stop"]);
}

#[gpui_kit::test]
fn demands_cover_the_watched_tiles_only(cx: &mut TestAppContext) {
    let (_, log) = surface_rig(
        cx,
        vec![
            offered("screen", TileKind::Screen, false),
            offered("camera", TileKind::Camera, true),
        ],
        false,
    );
    assert_eq!(
        asked(&log),
        ["demands camera"],
        "the offered screen is never received"
    );
    assert!(actions(&log).is_empty());
}

#[gpui_kit::test]
fn past_three_offers_a_summary_with_see_all_comes_first(cx: &mut TestAppContext) {
    let tiles: Vec<SurfaceTile> = (0..5)
        .map(|n| offered(&format!("c{n}"), TileKind::Camera, false))
        .collect();
    let (rig, log) = surface_rig(cx, tiles, true);
    assert!(rig.has(cx, "call-offered-summary"));
    assert!(rig.has(cx, "call-watch-2"));
    assert!(!rig.has(cx, "call-watch-3"), "three rows at most");
    rig.click(cx, "call-see-all");
    rig.click(cx, "call-stop-sharing");
    assert_eq!(actions(&log), ["open", "unshare"]);
}

#[gpui_kit::test]
fn the_notice_retries_only_when_it_can_help(cx: &mut TestAppContext) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, _| {
        let log = shared.clone();
        Host(Box::new(move |_, _| {
            let (retry, dismiss) = (log.clone(), log.clone());
            let model = if log.borrow().is_empty() {
                join_failed_notice()
            } else {
                ended_notice(&VoiceEnded {
                    room: VoiceRoom::Dm {
                        dm_group_id: "d".into(),
                    },
                    while_reconnecting: false,
                    error: None,
                    options: VoiceJoinOptions::default(),
                })
            };
            VoiceNoticeBar::new(
                model,
                Some(Rc::new(move |_, _| retry.borrow_mut().push("retry".into()))),
                Rc::new(move |_, _| dismiss.borrow_mut().push("dismiss".into())),
            )
            .into_any_element()
        }))
    });
    rig.click(cx, "voice-notice-action");
    assert_eq!(entries(&log), ["retry"]);
    // A plain ending now: no Retry, only Dismiss.
    assert!(!rig.has(cx, "voice-notice-action"));
    rig.click(cx, "voice-notice-dismiss");
    assert_eq!(entries(&log), ["retry", "dismiss"]);
}
