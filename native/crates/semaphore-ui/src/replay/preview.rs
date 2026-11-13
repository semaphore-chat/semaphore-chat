//! The trim preview, after `TrimPreview.tsx`: the replay buffer's video, played through the
//! window's [`Players`] (`PlaybackSource::ReplayBuffer`; the app's engine reads the HLS segments),
//! and the web's controls under it: jump to the selection's start, play or pause, play the
//! selection from its start, jump to its end (end less 1 s), Loop (off at first) and Refresh.
//!
//! - **Opens paused** at the selection's start, as the web seeks there once the playlist loads.
//! - **The selection's end** is core's rule ([`selection_step`]): at each position while playing,
//!   within 0.1 s of the end, loop back to the start or pause.
//! - **States:** loading (a spinner on the black box), failed (the web's "Could not load the video
//!   preview. Please try again." and Retry), and a build that doesn't decode the preview's sound
//!   (AAC is behind a feature): video only, said under the controls.
//! - **Refresh** is the timeline's: it takes the buffer's new length and reopens here, at the
//!   playhead, so the newest segments are listed.

use crate::kit::{
    Alert, Button, ButtonSize, IconButton, Severity, Spinner, Variant, text, with_tip,
};
use crate::panel::common::is_phone;
use crate::player::model::Phase;
use crate::player::{Playback, Players};
use crate::theme::SemTheme as _;
use crate::voice::frames::Fit;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::player::{
    PlaybackSource, SELECTION_END_SLACK, SelectionAction, selection_step,
};
use semaphore_design::Icon as IconName;
use std::sync::atomic::Ordering;
use std::time::Duration;

/// The web's error line.
pub const PREVIEW_ERROR: &str = "Could not load the video preview. Please try again.";
/// Under the controls when the preview has no sound this build plays.
pub const VIDEO_ONLY: &str = "Video only: the preview plays without sound.";
/// Jump to end lands this far before the selection's end.
const BEFORE_END: Duration = Duration::from_secs(1);

/// What the preview asks of the timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreviewEvent {
    /// Refresh segments: the timeline takes the buffer's new length, then reopens the preview.
    Refresh,
}

pub struct TrimPreview {
    playback: Playback,
    session_id: String,
    start: Duration,
    end: Duration,
    looping: bool,
    /// A loop's seek back is on its way: positions at the end until it lands don't seek again.
    wrapping: bool,
    /// The buffer grew since the timeline froze its length: Refresh shows it.
    has_more: bool,
    _inbox: Task<()>,
}

impl EventEmitter<PreviewEvent> for TrimPreview {}

impl TrimPreview {
    /// Opens the buffer of session `session_id` paused at `start`, the selection `start..end`.
    pub fn new(
        players: &Players,
        session_id: String,
        start: Duration,
        end: Duration,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut playback = Playback::new(
            PlaybackSource::replay_buffer(session_id.clone(), start),
            players.opener(),
            Some(players.frames()),
        );
        playback.autoplay = false;
        let inbox = playback.inbox.clone();
        let task = cx.spawn(async move |this, cx| {
            loop {
                inbox.next().await;
                if this.update(cx, |view, cx| view.sync(cx)).is_err() {
                    return;
                }
            }
        });
        playback.open();
        let mut preview = Self {
            playback,
            session_id,
            start,
            end,
            looping: false,
            wrapping: false,
            has_more: false,
            _inbox: task,
        };
        preview.sync(cx);
        preview
    }

    pub fn phase(&self) -> &Phase {
        &self.playback.phase
    }

    /// The playhead, on the buffer's timeline.
    pub fn position(&self) -> Duration {
        self.playback.position
    }

    pub fn looping(&self) -> bool {
        self.looping
    }

    /// A frame of the buffer is on the surface.
    pub fn has_frame(&self) -> bool {
        self.playback.has_frame()
    }

    /// The preview has a sound track this build decodes.
    pub fn has_audio(&self) -> bool {
        self.playback.has_audio
    }

    /// The selection, from the timeline's handles.
    pub fn set_selection(&mut self, start: Duration, end: Duration, cx: &mut Context<Self>) {
        self.start = start;
        self.end = end;
        cx.notify();
    }

    pub fn set_has_more(&mut self, has_more: bool, cx: &mut Context<Self>) {
        if self.has_more != has_more {
            self.has_more = has_more;
            cx.notify();
        }
    }

    pub fn set_looping(&mut self, looping: bool, cx: &mut Context<Self>) {
        self.looping = looping;
        cx.notify();
    }

    /// Moves the playhead (a click on the timeline, the start handle passing it).
    pub fn seek(&mut self, to: Duration, cx: &mut Context<Self>) {
        self.playback.seek(to);
        self.commanded(cx);
    }

    pub fn jump_to_start(&mut self, cx: &mut Context<Self>) {
        self.seek(self.start, cx);
    }

    /// End less a second, never before the start (the web's `handleJumpToEnd`).
    pub fn jump_to_end(&mut self, cx: &mut Context<Self>) {
        let to = self.end.saturating_sub(BEFORE_END).max(self.start);
        self.seek(to, cx);
    }

    /// Play or pause. Play at the selection's end starts it again, rather than stopping at once.
    pub fn toggle(&mut self, cx: &mut Context<Self>) {
        match self.playback.phase {
            Phase::Playing | Phase::Buffering => self.playback.pause(),
            Phase::Paused | Phase::Ended => {
                if self.playback.position + SELECTION_END_SLACK >= self.end {
                    self.playback.seek(self.start);
                }
                self.playback.play();
            }
            Phase::Idle | Phase::Loading | Phase::Failed(_) => return,
        }
        self.commanded(cx);
    }

    /// From the selection's start.
    pub fn play_selection(&mut self, cx: &mut Context<Self>) {
        if !self.playback.phase.is_open() {
            return;
        }
        self.playback.seek(self.start);
        self.playback.play();
        self.commanded(cx);
    }

    /// Opens the buffer again at `at`, listing its segments anew; plays on if it was playing.
    pub fn reopen(&mut self, at: Duration, cx: &mut Context<Self>) {
        self.playback.autoplay = self.playback.phase.is_playing();
        self.playback
            .set_source(PlaybackSource::replay_buffer(self.session_id.clone(), at));
        self.wrapping = false;
        self.playback.open();
        self.commanded(cx);
    }

    /// Refresh's half here: the newest segments, at the playhead.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let at = self.playback.position;
        self.reopen(at, cx);
    }

    /// After a failure: open again at the selection's start, paused.
    pub fn retry(&mut self, cx: &mut Context<Self>) {
        self.playback.phase = Phase::Idle;
        let start = self.start;
        self.reopen(start, cx);
    }

    fn commanded(&mut self, cx: &mut Context<Self>) {
        self.sync(cx);
        cx.notify();
    }

    /// Takes the player's events, then applies the selection's end.
    fn sync(&mut self, cx: &mut Context<Self>) {
        if !self.playback.drain() {
            return;
        }
        let position = self.playback.position;
        if position + SELECTION_END_SLACK < self.end {
            self.wrapping = false;
        }
        if self.playback.phase.is_playing() {
            match selection_step(position, self.start, self.end, self.looping) {
                Some(SelectionAction::SeekTo(start)) if !self.wrapping => {
                    self.wrapping = true;
                    self.playback.seek(start);
                }
                Some(SelectionAction::Pause) => self.playback.pause(),
                _ => {}
            }
        } else if self.playback.phase == Phase::Ended && self.looping && !self.wrapping {
            // The buffer ended before a position reached the selection's end (positions come
            // every 250 ms): the end all the same, and the player stopped there, so play on.
            self.wrapping = true;
            let start = self.start;
            self.playback.seek(start);
            self.playback.play();
        }
        cx.notify();
    }

    fn controls(&self, phone: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let playing = self.playback.phase.is_playing();
        let tip = |id: &'static str, button: IconButton, tip: &'static str| {
            with_tip(div().id(id).child(button), tip)
        };
        div()
            .id("trim-preview-controls")
            .test_support()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_center()
            // A phone fits the six in one row only this close.
            .gap(px(if phone { 0. } else { 8. }))
            .child(tip(
                "trim-jump-start-tip",
                IconButton::new(
                    "trim-jump-start",
                    IconName::SkipPrevious,
                    "Jump to start of selection",
                )
                .small()
                .on_click(cx.listener(|view, _, _, cx| view.jump_to_start(cx))),
                "Jump to start",
            ))
            .child(tip(
                "trim-play-tip",
                if playing {
                    IconButton::new("trim-play", IconName::Pause, "Pause playback")
                } else {
                    IconButton::new("trim-play", IconName::PlayArrow, "Play video")
                }
                .small()
                .on_click(cx.listener(|view, _, _, cx| view.toggle(cx))),
                if playing { "Pause" } else { "Play" },
            ))
            .child(tip(
                "trim-play-selection-tip",
                IconButton::new(
                    "trim-play-selection",
                    IconName::Replay,
                    "Play selection from start",
                )
                .color(sem.primary)
                .on_click(cx.listener(|view, _, _, cx| view.play_selection(cx))),
                "Play selection from start",
            ))
            .child(tip(
                "trim-jump-end-tip",
                IconButton::new(
                    "trim-jump-end",
                    IconName::SkipNext,
                    "Jump to end of selection",
                )
                .small()
                .on_click(cx.listener(|view, _, _, cx| view.jump_to_end(cx))),
                "Jump to end",
            ))
            .child({
                let loop_button = Button::new(
                    "trim-loop",
                    if self.looping { "Loop ON" } else { "Loop OFF" },
                )
                .size(ButtonSize::Small)
                .on_click(cx.listener(|view, _, _, cx| {
                    let looping = !view.looping;
                    view.set_looping(looping, cx);
                }));
                div()
                    .mx(px(if phone { 4. } else { 8. }))
                    .child(if self.looping {
                        loop_button.contained()
                    } else {
                        loop_button.outlined()
                    })
            })
            .child(with_tip(
                div().id("trim-refresh-tip").child(
                    IconButton::new("trim-refresh", IconName::Refresh, "Refresh segments")
                        .small()
                        .selected(self.has_more)
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(PreviewEvent::Refresh))),
                ),
                if self.has_more {
                    "Refresh segments: more has been recorded"
                } else {
                    "Refresh segments"
                },
            ))
    }

    fn stage(&self, phone: bool, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let frames = self.playback.frames().cloned();
        let key = self.playback.key();
        let radius = px(4.);
        let picture = canvas(
            |_, _, _| {},
            move |bounds, _, window, cx| {
                if let Some(frames) = &frames {
                    frames.paint(&key, bounds, radius, Fit::Contain, window, cx);
                }
            },
        )
        .absolute()
        .size_full();
        let loading = matches!(
            self.playback.phase,
            Phase::Idle | Phase::Loading | Phase::Buffering
        );
        let failed = matches!(self.playback.phase, Phase::Failed(_));
        // As wide as the dialog, a third of the window tall (the picture letterboxed in it), so
        // the controls and the timeline stay on screen under it.
        let viewport = f32::from(window.viewport_size().height);
        let height = (viewport * if phone { 0.28 } else { 0.32 }).clamp(160., 420.);
        div()
            .id("trim-preview-video")
            .test_support()
            .role(Role::Group)
            .aria_label("Replay buffer preview")
            .relative()
            .w_full()
            .h(px(height))
            .rounded(radius)
            .overflow_hidden()
            .bg(black())
            .child(picture)
            .when(loading && !failed, |el| {
                el.child(
                    div()
                        .id("trim-preview-loading")
                        .test_support()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            Spinner::new("trim-preview-spinner")
                                .size(40.)
                                .color(white()),
                        ),
                )
            })
            .when(failed, |el| {
                el.child(
                    div()
                        .id("trim-preview-error")
                        .test_support()
                        .absolute()
                        .top_0()
                        .left_0()
                        .right_0()
                        .m(px(8.))
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(200.))
                                .child(Alert::new(Severity::Error, PREVIEW_ERROR)),
                        )
                        .child(
                            Button::new("trim-preview-retry", "Retry")
                                .size(ButtonSize::Small)
                                .contained()
                                .start_icon(IconName::Refresh)
                                .on_click(cx.listener(|view, _, _, cx| view.retry(cx))),
                        ),
                )
            })
    }
}

impl Render for TrimPreview {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Frames write their textures off-thread; while video plays, draw every frame.
        let animating = self.playback.phase == Phase::Playing && self.playback.has_video;
        self.playback
            .inbox
            .animating
            .store(animating, Ordering::Release);
        if animating {
            window.request_animation_frame();
        }
        let phone = is_phone(window);
        let sem = cx.sem().clone();
        let video_only = self.playback.phase.is_open() && !self.playback.has_audio;
        div()
            .id("trim-preview")
            .test_support()
            .flex()
            .flex_col()
            .gap(px(12.))
            .mb(px(16.))
            .child(self.stage(phone, window, cx))
            .child(self.controls(phone, cx))
            .when(video_only, |el| {
                el.child(
                    div()
                        .id("trim-preview-video-only")
                        .test_support()
                        .flex()
                        .justify_center()
                        .text_color(sem.text_secondary)
                        .child(text(Variant::Caption, VIDEO_ONLY)),
                )
            })
    }
}
