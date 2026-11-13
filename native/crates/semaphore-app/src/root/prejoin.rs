//! WP: a voice channel's pre-join in the app: a voice channel you aren't in shows `PreJoinPanel`
//! (fed from `Core::voice_prejoin`, its Join running `Core::join_voice_with`) instead of the plain
//! "Join voice" button. (Seen-by's half is `conversation/seen.rs`.)
//!
//! Hub file from the UI freeze: `root.rs` calls the functions below once each (core events,
//! navigation, the route's content, overlays, and the not-joined voice channel's content below), and nothing else in the app does; WP
//! fills them. Copy the shape of `root/community.rs` (W5-app): one state struct here, feeds that
//! read core when they run, continuations that hold a ticket.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_ui::nav::Route;

/// WP's state: what it has on screen. Gone with the session.
#[derive(Default)]
pub struct PreJoinArea {}

impl AppRoot {
    pub(super) fn prejoin_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    pub(super) fn prejoin_navigated(
        &mut self,
        _route: &Route,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }

    pub(super) fn prejoin_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// The content for a voice channel this user isn't in; `None` keeps the plain "Join voice".
    pub(super) fn prejoin_voice_channel(
        &self,
        _channel: &semaphore_core::model::ChannelRow,
        _cx: &App,
    ) -> Option<AnyElement> {
        None
    }
}
