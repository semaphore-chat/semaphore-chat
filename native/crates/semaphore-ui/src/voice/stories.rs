//! Fixtures for rig-shot. Video tiles draw generated NV12 through the same path real frames take;
//! the real thing is in `semaphore-media-livekit`'s voice rig, whose screenshots show live tracks.

use super::frames::VideoFrames;
use super::model::{NoController, PttState, QualityLevel, VoiceStageModel};
use super::stage::VoiceStage;
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{ParticipantView, UserView, VideoTrackView, VoiceStatus, VoiceView};
use std::collections::HashMap;
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

fn person(index: usize) -> ParticipantView {
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

fn camera(index: usize) -> Option<VideoTrackView> {
    Some(VideoTrackView {
        track_sid: format!("TR_cam{index}"),
        width: 1280,
        height: 720,
    })
}

fn model(people: Vec<ParticipantView>) -> VoiceStageModel {
    VoiceStageModel {
        voice: VoiceView {
            status: VoiceStatus::Connected,
            channel_id: Some("general-voice".into()),
            muted: false,
            deafened: false,
            participants: people,
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
/// rounded corners can all be judged by eye.
fn test_card(frames: &VideoFrames, sid: &str, seed: usize, width: u32, height: u32) {
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

fn stage(model: VoiceStageModel, window: &mut Window, cx: &mut App) -> AnyView {
    let frames = VideoFrames::for_window(window);
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
                test_card(&frames, &track.track_sid, seed, track.width, track.height);
            }
        }
    }
    let controller = Arc::new(NoController);
    cx.new(|cx| VoiceStage::new(model, frames, controller, window, cx))
        .into()
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
        Story::new("voice-reconnecting", reconnecting),
        Story::new("voice-screen-share", screen_share),
        Story::new("voice-ptt-held", ptt_held),
        Story::new("voice-crowd", crowd),
        Story::new("voice-long-names", long_names),
    ]
}
