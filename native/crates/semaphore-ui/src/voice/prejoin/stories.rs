//! The pre-join's stories: loading, a failed read, nobody here, a few people (pictures and
//! initials), a crowd with long names, listen-only (a timeout today, tomorrow, or a role without
//! SPEAK), no permission, in another call, and deafened. `rigs/shot/scripts/uv-voice-prejoin.steps`
//! renders them on a desktop (dark) and a phone (light).

use super::PreJoinPanel;
use super::fixtures::*;
use crate::messages::TimeFormat;
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{VoiceJoinMode, VoicePreJoinView};
use std::rc::Rc;

fn panel(view: VoicePreJoinView, pictures: bool, window: &mut Window, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut panel = PreJoinPanel::new(window, cx);
        panel.set_time(TimeFormat::fixed(NOW_MS), cx);
        if pictures {
            panel.set_media(Rc::new(Pictures::new()), cx);
        }
        panel.set_view(view, cx);
        panel
    })
    .into()
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(super) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        ("voice-prejoin-loading", |_, w, cx| {
            panel(loading(), true, w, cx)
        }),
        ("voice-prejoin-failed", |_, w, cx| {
            panel(failed(), true, w, cx)
        }),
        ("voice-prejoin-empty", |_, w, cx| {
            panel(ready(VoiceJoinMode::Full, Vec::new()), true, w, cx)
        }),
        ("voice-prejoin-few", |_, w, cx| {
            panel(ready(VoiceJoinMode::Full, few()), true, w, cx)
        }),
        ("voice-prejoin-initials", |_, w, cx| {
            panel(ready(VoiceJoinMode::Full, few()), false, w, cx)
        }),
        ("voice-prejoin-many", |_, w, cx| panel(many(), true, w, cx)),
        ("voice-prejoin-listen-timeout", |_, w, cx| {
            panel(timed_out(false), true, w, cx)
        }),
        ("voice-prejoin-listen-timeout-tomorrow", |_, w, cx| {
            panel(timed_out(true), true, w, cx)
        }),
        ("voice-prejoin-listen-only", |_, w, cx| {
            panel(ready(VoiceJoinMode::ListenOnly, few()), true, w, cx)
        }),
        ("voice-prejoin-not-allowed", |_, w, cx| {
            panel(ready(VoiceJoinMode::None, few()), true, w, cx)
        }),
        ("voice-prejoin-elsewhere", |_, w, cx| {
            panel(elsewhere(), true, w, cx)
        }),
        ("voice-prejoin-deafened", |_, w, cx| {
            panel(deafened(), true, w, cx)
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
