//! UV: a voice channel's pre-join: who's here, Join voice / Join muted, "you can listen",
//! "you don't have permission", "You're timed out until …", "You're in X; joining moves you
//! here", after `components/Voice/VoiceChannelPreJoin.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `PreJoinEvent`) is what the app
//! wiring lane builds against while UV draws the screen; change it only with the coordinator.
//! Until UV lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use crate::messages::TimeFormat;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{VoiceJoinOptions, VoicePreJoinView};

#[derive(Debug, Clone, PartialEq)]
pub enum PreJoinEvent {
    /// `Core::join_voice_with(channel_id, options)`.
    Join(VoiceJoinOptions),
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct PreJoinPanel {
    view: VoicePreJoinView,
    time: TimeFormat,
}

impl EventEmitter<PreJoinEvent> for PreJoinPanel {}

impl PreJoinPanel {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            view: VoicePreJoinView::default(),
            time: TimeFormat::default(),
        }
    }

    /// `Core::voice_prejoin(community_id, channel_id)`.
    pub fn set_view(&mut self, view: VoicePreJoinView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// The zone "timed out until" is written in.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }
}

impl Render for PreJoinPanel {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("prejoinpanel-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
