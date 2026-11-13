//! The views the stories and the tests share: a channel in each mode and load state, a few people
//! and a crowd, and avatar pictures held in memory.

use crate::messages::{MediaRef, MediaSource};
use gpui_kit::RenderImage;
use image::{Frame, RgbaImage};
use semaphore_core::model::{
    AttachmentView, ErrorView, LoadState, UserView, VoiceJoinMode, VoicePreJoinView,
};
use std::collections::HashMap;
use std::sync::Arc;

pub(super) use crate::messages::fixture::NOW_MS;

const HOUR: i64 = 3_600_000;

pub(super) fn person(key: &str, name: &str, file: Option<&str>) -> UserView {
    UserView {
        id: format!("u-{key}"),
        username: key.to_owned(),
        display_name: Some(name.to_owned()),
        avatar_file_id: file.map(str::to_owned),
    }
}

/// Two with uploaded pictures, one with the sandbox's coloured initials, one with none.
pub(super) fn few() -> Vec<UserView> {
    vec![
        person("ana", "Ana Ruiz", Some("file-ana")),
        person("bo", "Bo Lindqvist", Some("avatar:bo:Bo%20Lindqvist")),
        person("chen", "Chen Wei", Some("file-chen")),
        person("dmitri", "dmitri", None),
    ]
}

/// 34 people, every fifth with a 100-character name.
pub(super) fn crowd() -> Vec<UserView> {
    const FIRST: [&str; 17] = [
        "Ana", "Bo", "Chen", "Dara", "Emeka", "Freya", "Goran", "Hana", "Ines", "Jonas", "Kofi",
        "Lena", "Mateo", "Nadia", "Omar", "Priya", "Quinn",
    ];
    const LAST: [&str; 2] = ["Okafor", "Salo"];
    (0..34)
        .map(|ix| {
            let short = format!("{} {}", FIRST[ix % FIRST.len()], LAST[ix / FIRST.len()]);
            let name: String = if ix % 5 == 0 {
                format!("{short} who picked a display name long enough to run off any tile it is ever drawn in at all, and then some")
                    .chars()
                    .take(100)
                    .collect()
            } else {
                short
            };
            let key = format!("member{ix:02}");
            let file = format!("avatar:{key}:{}", name.replace(' ', "%20"));
            person(&key, &name, Some(&file))
        })
        .collect()
}

pub(super) fn ready(mode: VoiceJoinMode, users: Vec<UserView>) -> VoicePreJoinView {
    VoicePreJoinView {
        state: LoadState::Ready,
        channel_id: "ch-lounge".into(),
        community_id: "c-1".into(),
        channel_name: "Lounge".into(),
        users,
        mode,
        timed_out_until_ms: None,
        connected_elsewhere: None,
        muted: false,
        deafened: false,
    }
}

pub(super) fn loading() -> VoicePreJoinView {
    VoicePreJoinView {
        state: LoadState::Loading,
        ..ready(VoiceJoinMode::Full, Vec::new())
    }
}

pub(super) fn failed() -> VoicePreJoinView {
    VoicePreJoinView {
        state: LoadState::Failed {
            error: ErrorView {
                code: "NETWORK".into(),
                message: "The server didn't answer".into(),
                retryable: true,
                retry_after_ms: None,
            },
        },
        ..ready(VoiceJoinMode::Full, Vec::new())
    }
}

pub(super) fn many() -> VoicePreJoinView {
    VoicePreJoinView {
        channel_name:
            "Late-night co-working, music and general hanging out for everyone in the community"
                .into(),
        ..ready(VoiceJoinMode::Full, crowd())
    }
}

/// Timed out until two hours from now (6:12 PM on the fixture clock), or the next day's noon.
pub(super) fn timed_out(next_day: bool) -> VoicePreJoinView {
    VoicePreJoinView {
        timed_out_until_ms: Some(NOW_MS + if next_day { 20 * HOUR } else { 2 * HOUR }),
        ..ready(VoiceJoinMode::ListenOnly, few())
    }
}

pub(super) fn elsewhere() -> VoicePreJoinView {
    VoicePreJoinView {
        connected_elsewhere: Some("Gaming".into()),
        ..ready(VoiceJoinMode::Full, few())
    }
}

pub(super) fn deafened() -> VoicePreJoinView {
    VoicePreJoinView {
        muted: true,
        deafened: true,
        ..ready(VoiceJoinMode::Full, few())
    }
}

/// A smooth two-colour picture, as decoded bytes would give.
fn picture(from: [u8; 3], to: [u8; 3]) -> Arc<RenderImage> {
    let size = 96;
    let buffer = RgbaImage::from_fn(size, size, |x, y| {
        let t = (x + y) as f32 / (2 * size) as f32;
        let mix = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t) as u8;
        // GPUI's RenderImage frames are BGRA.
        image::Rgba([
            mix(from[2], to[2]),
            mix(from[1], to[1]),
            mix(from[0], to[0]),
            255,
        ])
    });
    Arc::new(RenderImage::new(vec![Frame::new(buffer)]))
}

/// Avatar pictures in memory for `file-ana` and `file-chen`; any other file is `Missing`.
pub(super) struct Pictures(HashMap<&'static str, Arc<RenderImage>>);

impl Pictures {
    pub(super) fn new() -> Self {
        Self(HashMap::from([
            ("file-ana", picture([0xf5, 0x9e, 0x0b], [0xdb, 0x27, 0x77])),
            ("file-chen", picture([0x0e, 0xa5, 0xe9], [0x7c, 0x3a, 0xed])),
        ]))
    }
}

impl MediaSource for Pictures {
    fn attachment(&self, _: &AttachmentView) -> MediaRef {
        MediaRef::Missing
    }
    fn emoji(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
    fn avatar(&self, file_id: &str) -> MediaRef {
        self.0
            .get(file_id)
            .map_or(MediaRef::Missing, |image| MediaRef::Ready(image.clone()))
    }
}
