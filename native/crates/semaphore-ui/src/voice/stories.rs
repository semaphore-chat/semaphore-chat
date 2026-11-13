//! Fixtures for rig-shot. Video tiles draw generated NV12 through the same path real frames take;
//! the real thing is in `semaphore-media-livekit`'s voice rig, whose screenshots show live tracks.

use super::frames::VideoFrames;
use super::model::{NoController, PttState, QualityLevel, VoiceStageModel};
use super::picker::{PickerActions, PickerModel, PickerSource, source_picker, thumbnail_image};
use super::stage::VoiceStage;
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{
    LocalMediaView, LocalShare, ParticipantView, UserView, VideoTrackView, VoiceStatus, VoiceView,
};
use semaphore_core::platform::{CaptureKind, Thumbnail};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

const NAMES: [&str; 12] = [
    "Maya Chen",
    "Tobias Weber",
    "Priya Raman",
    "Lucas Moreau",
    "Ana Souza",
    "Jonas Berg",
    "Fatima Khan",
    "Oliver Grant",
    "Yuki Tanaka",
    "Sofia Rossi",
    "Daniel Okafor",
    "Elena Petrova",
];

pub(super) fn person(index: usize) -> ParticipantView {
    let name = NAMES[index % NAMES.len()];
    let identity = name.to_lowercase().replace(' ', ".");
    ParticipantView {
        identity: identity.clone(),
        user: UserView {
            id: identity.clone(),
            username: identity,
            display_name: Some(name.to_owned()),
            avatar_file_id: None,
        },
        is_self: index == 0,
        ..ParticipantView::default()
    }
}

pub(super) fn camera(index: usize) -> Option<VideoTrackView> {
    Some(VideoTrackView {
        track_sid: format!("TR_cam{index}"),
        width: 1280,
        height: 720,
    })
}

pub(super) fn model(people: Vec<ParticipantView>) -> VoiceStageModel {
    VoiceStageModel {
        voice: VoiceView {
            status: VoiceStatus::Connected,
            channel_id: Some("general-voice".into()),
            muted: false,
            deafened: false,
            participants: people,
            local: LocalMediaView {
                may_camera: true,
                may_share: true,
                may_speak: true,
                ..LocalMediaView::default()
            },
            ..VoiceView::default()
        },
        channel_name: "general-voice".into(),
        is_dm: false,
        quality: HashMap::new(),
        local_quality: QualityLevel::Excellent,
        reconnect_attempt: None,
        ptt: None,
        always_show_overlays: true,
    }
}

/// A camera's worth of test card: a hue per person and a brightness ramp, so stretching, colour and
/// rounded corners can all be judged by eye. The settings page's camera test uses it too, as a
/// stand-in for a live camera.
pub(crate) fn test_card(frames: &VideoFrames, sid: &str, seed: usize, width: u32, height: u32) {
    let (w, h) = (width as usize, height as usize);
    let mut y = vec![0u8; w * h];
    for row in 0..h {
        for col in 0..w {
            let base = 60 + (col * 120 / w) as u32 + (row * 60 / h) as u32;
            // A diagonal band, so tearing or a wrong stride would be obvious.
            let band = (col + row * 2) / 64 % 2 == 0;
            y[row * w + col] = (base + if band { 12 } else { 0 }) as u8;
        }
    }
    let angle = seed as f32 * 2.399963;
    let (u, v) = (128.0 + 60.0 * angle.cos(), 128.0 + 60.0 * angle.sin());
    let uv_stride = w.div_ceil(2) * 2;
    let mut uv = vec![0u8; uv_stride * h.div_ceil(2)];
    for pair in uv.as_chunks_mut::<2>().0 {
        pair[0] = u as u8;
        pair[1] = v as u8;
    }
    frames.push(
        sid,
        &Nv12Frame {
            width,
            height,
            y: &y,
            y_stride: width,
            uv: &uv,
            uv_stride: uv_stride as u32,
        },
    );
}

/// Test cards for every camera and screen in the model.
pub(super) fn push_cards(frames: &VideoFrames, model: &VoiceStageModel) {
    for participant in &model.voice.participants {
        for (index, track) in [&participant.camera, &participant.screen_share]
            .iter()
            .enumerate()
        {
            if let Some(track) = track {
                let seed = track
                    .track_sid
                    .bytes()
                    .fold(index * 7, |acc, byte| acc + usize::from(byte));
                test_card(frames, &track.track_sid, seed, track.width, track.height);
            }
        }
    }
}

pub(super) fn stage_entity(
    model: VoiceStageModel,
    window: &mut Window,
    cx: &mut App,
) -> Entity<VoiceStage> {
    let frames = VideoFrames::for_window(window);
    push_cards(&frames, &model);
    let controller = Arc::new(NoController);
    cx.new(|cx| VoiceStage::new(model, frames, controller, window, cx))
}

fn stage(model: VoiceStageModel, window: &mut Window, cx: &mut App) -> AnyView {
    stage_entity(model, window, cx).into()
}

/// `count` people on camera, the first one speaking, the fourth muted.
fn cameras(count: usize) -> Vec<ParticipantView> {
    (0..count)
        .map(|index| {
            let mut p = person(index);
            p.camera = camera(index);
            p.speaking = index == 1;
            p.muted = index == 3;
            p
        })
        .collect()
}

fn empty(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(Vec::new());
    m.voice.status = VoiceStatus::Connecting;
    stage(m, window, cx)
}

fn one(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(model(vec![person(0)]), window, cx)
}

fn nine(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(model(cameras(9)), window, cx)
}

fn ten(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(model(cameras(10)), window, cx)
}

fn avatars(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people: Vec<_> = (0..4).map(person).collect();
    people[1].speaking = true;
    people[2].muted = true;
    people[3].muted = true;
    people[3].deafened = true;
    stage(model(people), window, cx)
}

fn muted(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.muted = true;
    m.voice.participants[0].muted = true;
    stage(m, window, cx)
}

fn failed(message: &str) -> LocalShare {
    LocalShare::Failed {
        message: message.into(),
    }
}

/// `count` people on camera, with our own camera on as the engine reports it: a track under our
/// publication's sid, which the preview frames go to.
fn camera_model(count: usize, camera: LocalShare) -> VoiceStageModel {
    let mut people = cameras(count);
    if camera != LocalShare::On {
        people[0].camera = None;
    }
    let mut m = model(people);
    m.voice.local.camera = camera;
    m
}

fn camera_starting(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(camera_model(4, LocalShare::Starting), window, cx)
}

fn camera_on(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(camera_model(4, LocalShare::On), window, cx)
}

fn camera_failed(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(
        camera_model(4, failed("the camera is in use by another application")),
        window,
        cx,
    )
}

/// Our own screen, as the engine reports it: a track on our own participant, on the main stage.
fn own_share(screen_audio: LocalShare) -> VoiceStageModel {
    let mut people = cameras(4);
    people[0].screen_share = Some(VideoTrackView {
        track_sid: "TR_own_screen".into(),
        width: 1920,
        height: 1080,
    });
    let mut m = model(people);
    m.voice.local.screen = LocalShare::On;
    m.voice.local.screen_audio = screen_audio;
    m
}

fn share_starting(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.local.screen = LocalShare::Starting;
    m.voice.local.screen_audio = LocalShare::Starting;
    stage(m, window, cx)
}

fn share_on_self(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(own_share(LocalShare::On), window, cx)
}

fn share_audio_failed(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    stage(
        own_share(failed("no PipeWire session to capture from")),
        window,
        cx,
    )
}

fn share_failed(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.local.screen = failed("the screen picker was closed");
    stage(m, window, cx)
}

/// A call whose permissions send neither: both buttons stay, greyed.
fn no_permission(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.local.may_camera = false;
    m.voice.local.may_share = false;
    stage(m, window, cx)
}

/// Long reasons must truncate in the bar, not push the buttons off it.
fn long_failure(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.local.screen = failed(
        "the capture backend refused the request because the compositor does not expose a \
         screencast interface on this session",
    );
    stage(m, window, cx)
}

/// A screen-ish test pattern, BGRA.
fn fake_thumbnail(seed: u32, width: u32, height: u32) -> Thumbnail {
    let mut bgra = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let bar = y < height / 10;
            let (b, g, r) = if bar {
                (40, 40, 48)
            } else {
                (
                    (60 + (seed * 50) % 150 + x * 40 / width) as u8,
                    (70 + y * 80 / height) as u8,
                    (90 + (seed * 90) % 120) as u8,
                )
            };
            bgra.extend([b, g, r, 255]);
        }
    }
    Thumbnail {
        width,
        height,
        bgra,
    }
}

fn picker_sources() -> Vec<PickerSource> {
    let mut sources = Vec::new();
    for (index, name) in ["Screen 1", "Screen 2"].iter().enumerate() {
        sources.push(PickerSource {
            id: format!("screen-{index}"),
            name: (*name).into(),
            kind: CaptureKind::Screen,
            image: thumbnail_image(&fake_thumbnail(index as u32, 320, 180)),
        });
    }
    let windows = [
        "Semaphore Chat",
        "Terminal",
        "A document with a very long title that needs to be truncated - Editor",
        "Browser",
        "Music",
    ];
    for (index, name) in windows.iter().enumerate() {
        sources.push(PickerSource {
            id: format!("window-{index}"),
            name: (*name).into(),
            kind: CaptureKind::Window,
            // One without a thumbnail: a minimised window has none.
            image: (index != 4)
                .then(|| thumbnail_image(&fake_thumbnail(index as u32 + 3, 320, 200)))
                .flatten(),
        });
    }
    sources
}

/// The picker over a call, as the app shows it.
struct PickerStory {
    stage: AnyView,
    picker: PickerModel,
}

impl Render for PickerStory {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let actions = PickerActions {
            on_tab: Rc::new(|_, _, _| {}),
            on_select: Rc::new(|_, _, _| {}),
            on_share: Rc::new(|_, _, _| {}),
            on_cancel: Rc::new(|_, _| {}),
        };
        div()
            .size_full()
            .relative()
            .child(self.stage.clone())
            .child(source_picker(&self.picker, actions))
    }
}

fn picker_story(picker: PickerModel, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.local.screen = LocalShare::Starting;
    let stage = stage(m, window, cx);
    cx.new(|_| PickerStory { stage, picker }).into()
}

fn picker(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut picker = PickerModel::ready(picker_sources());
    picker.select("screen-1");
    picker_story(picker, window, cx)
}

fn picker_windows(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut picker = PickerModel::ready(picker_sources());
    picker.set_tab(CaptureKind::Window);
    picker.select("window-2");
    picker_story(picker, window, cx)
}

fn picker_loading(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    picker_story(PickerModel::loading(), window, cx)
}

fn picker_empty(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    picker_story(PickerModel::ready(Vec::new()), window, cx)
}

fn picker_error(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    picker_story(
        PickerModel::failed("the X server refused the connection".into()),
        window,
        cx,
    )
}

fn deafened(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.muted = true;
    m.voice.deafened = true;
    m.voice.participants[0].muted = true;
    m.voice.participants[0].deafened = true;
    m.voice.participants[2].deafened = true;
    m.voice.participants[2].muted = true;
    stage(m, window, cx)
}

fn reconnecting(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(4));
    m.voice.status = VoiceStatus::Reconnecting;
    m.reconnect_attempt = Some(3);
    m.local_quality = QualityLevel::Lost;
    m.quality.insert("lucas.moreau".into(), QualityLevel::Lost);
    m.quality.insert("priya.raman".into(), QualityLevel::Poor);
    stage(m, window, cx)
}

fn screen_share(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people = cameras(9);
    people[2].screen_share = Some(VideoTrackView {
        track_sid: "TR_screen".into(),
        width: 1920,
        height: 1080,
    });
    stage(model(people), window, cx)
}

fn ptt_held(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(2));
    m.ptt = Some(PttState {
        held: true,
        key_label: "Space".into(),
    });
    stage(m, window, cx)
}

fn ptt_idle(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut m = model(cameras(2));
    m.ptt = Some(PttState {
        held: false,
        key_label: "Space".into(),
    });
    stage(m, window, cx)
}

fn crowd(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people: Vec<_> = (0..12).map(person).collect();
    people[1].speaking = true;
    people[2].muted = true;
    people[4].deafened = true;
    people[4].muted = true;
    people[5].camera = camera(5);
    stage(model(people), window, cx)
}

fn long_names(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people = cameras(4);
    for person in &mut people {
        person.user.display_name = Some(
            "A display name far longer than any tile could ever hope to show in one line".into(),
        );
        person.muted = true;
        person.deafened = true;
    }
    let mut m = model(people);
    m.channel_name = "a voice channel with a name that runs right off the end of the bar".into();
    stage(m, window, cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("voice-empty", empty),
        Story::new("voice-one", one),
        Story::new("voice-nine", nine),
        Story::new("voice-ten", ten),
        Story::new("voice-avatars", avatars),
        Story::new("voice-muted", muted),
        Story::new("voice-deafened", deafened),
        Story::new("voice-camera-starting", camera_starting),
        Story::new("voice-camera-on", camera_on),
        Story::new("voice-camera-failed", camera_failed),
        Story::new("voice-share-starting", share_starting),
        Story::new("voice-share-on-self", share_on_self),
        Story::new("voice-share-audio-failed", share_audio_failed),
        Story::new("voice-share-failed", share_failed),
        Story::new("voice-share-long-failure", long_failure),
        Story::new("voice-no-permission", no_permission),
        Story::new("voice-picker", picker),
        Story::new("voice-picker-windows", picker_windows),
        Story::new("voice-picker-loading", picker_loading),
        Story::new("voice-picker-empty", picker_empty),
        Story::new("voice-picker-error", picker_error),
        Story::new("voice-reconnecting", reconnecting),
        Story::new("voice-screen-share", screen_share),
        Story::new("voice-ptt-held", ptt_held),
        Story::new("voice-ptt-idle", ptt_idle),
        Story::new("voice-crowd", crowd),
        Story::new("voice-long-names", long_names),
    ]
}
