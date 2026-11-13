//! The players' stories: every state of both, a long name, past an hour, a tall video, the
//! expanded view, and a conversation with a video and an audio attachment. Each player is
//! driven by the fake, the same way the engine drives it.

use super::fake::{FakeOpener, Script};
use super::{AudioPlayer, VideoPlayer};
use crate::kit::{Variant, text};
use crate::stories::Story;
use crate::theme::SemTheme as _;
use crate::voice::VideoFrames;
use gpui_kit::prelude::*;
use gpui_kit::*;
use image::{Frame, RgbaImage};
use semaphore_core::player::{AttachmentSource, PlaybackState, PlayerError};
use std::sync::Arc;
use std::time::Duration;

const LONG_NAME: &str = "2026-11-08 quarterly all-hands recording, full session with the Q&A \
                         and the demo that broke halfway through (final, really final).mp4";

fn secs(s: u64) -> Duration {
    Duration::from_secs(s)
}

fn video_source(file_id: &str, filename: &str) -> AttachmentSource {
    AttachmentSource {
        file_id: file_id.into(),
        filename: filename.into(),
        mime_type: "video/mp4".into(),
        size: 18_400_000,
        has_thumbnail: true,
    }
}

fn audio_source(file_id: &str, filename: &str) -> AttachmentSource {
    AttachmentSource {
        file_id: file_id.into(),
        filename: filename.into(),
        mime_type: "audio/ogg".into(),
        size: 3_350_000,
        has_thumbnail: false,
    }
}

/// A dusk gradient standing in for a thumbnail, BGRA as `RenderImage` wants it.
fn poster(width: u32, height: u32) -> ImageSource {
    let image = RgbaImage::from_fn(width, height, |x, y| {
        let t = y as f32 / height as f32;
        let s = x as f32 / width as f32;
        let r = (40. + 150. * t) as u8;
        let g = (60. + 50. * s) as u8;
        let b = (130. - 60. * t) as u8;
        image::Rgba([b, g, r, 255])
    });
    Arc::new(RenderImage::new(vec![Frame::new(image)])).into()
}

/// Where the players sit: the page's background, padded like a message's attachments.
struct PlayerFrame {
    children: Vec<AnyView>,
}

impl Render for PlayerFrame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(cx.sem().background_default)
            .p(px(16.))
            .flex()
            .flex_col()
            .gap(px(16.))
            .children(self.children.iter().cloned())
    }
}

fn framed(children: Vec<AnyView>, cx: &mut App) -> AnyView {
    cx.new(|_| PlayerFrame { children }).into()
}

struct VideoStory {
    source: AttachmentSource,
    dimensions: (Option<u32>, Option<u32>),
    script: Script,
    play: bool,
    poster: bool,
    expanded: bool,
}

impl VideoStory {
    fn new(script: Script) -> Self {
        Self {
            source: video_source("story-clip", "launch-demo.mp4"),
            dimensions: (Some(1280), Some(720)),
            script,
            play: true,
            poster: true,
            expanded: false,
        }
    }

    fn idle() -> Self {
        Self {
            play: false,
            ..Self::new(Script::video())
        }
    }

    fn build(self, window: &mut Window, cx: &mut App) -> Entity<VideoPlayer> {
        let (opener, _) = FakeOpener::rc(self.script);
        let frames = VideoFrames::for_window(window);
        let (w, h) = (
            self.dimensions.0.unwrap_or(16),
            self.dimensions.1.unwrap_or(9),
        );
        let poster = self.poster.then(|| poster(w.min(320), h * w.min(320) / w));
        let player = cx.new(|cx| {
            let mut player = VideoPlayer::new(self.source, self.dimensions, opener, frames, cx);
            player.set_poster(poster, cx);
            player
        });
        if self.play {
            player.update(cx, |player, cx| player.toggle(cx));
        }
        if self.expanded {
            player.update(cx, |player, cx| player.set_expanded(true, window, cx));
        }
        player
    }

    fn story(self, window: &mut Window, cx: &mut App) -> AnyView {
        let player = self.build(window, cx);
        framed(vec![player.into()], cx)
    }
}

struct AudioStory {
    source: AttachmentSource,
    script: Script,
    play: bool,
}

impl AudioStory {
    fn new(script: Script) -> Self {
        Self {
            source: audio_source("story-track", "standup-notes.ogg"),
            script,
            play: true,
        }
    }

    fn build(self, cx: &mut App) -> Entity<AudioPlayer> {
        let (opener, _) = FakeOpener::rc(self.script);
        let player = cx.new(|cx| AudioPlayer::new(self.source, opener, cx));
        if self.play {
            player.update(cx, |player, cx| player.toggle(cx));
        }
        player
    }

    fn story(self, cx: &mut App) -> AnyView {
        let player = self.build(cx);
        framed(vec![player.into()], cx)
    }
}

fn paused_at(s: u64) -> Script {
    Script::video().at(secs(s), PlaybackState::Paused)
}

fn audio_at(s: u64, state: PlaybackState) -> Script {
    Script::audio().at(secs(s), state)
}

/// Two messages, one with a video and one with a voice note, as the list will show them.
struct Conversation {
    video: Entity<VideoPlayer>,
    audio: Entity<AudioPlayer>,
}

fn message(
    initial: &'static str,
    name: &'static str,
    time: &'static str,
    body: &'static str,
    colour: Hsla,
    attachment: AnyView,
    cx: &App,
) -> impl IntoElement {
    let sem = cx.sem();
    div()
        .flex()
        .gap(px(12.))
        .min_w_0()
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(40.))
                .rounded_full()
                .bg(colour)
                .text_color(white())
                .child(text(Variant::Subtitle2, initial)),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .gap(px(8.))
                        .child(text(Variant::Subtitle2, name).text_color(sem.text_primary))
                        .child(text(Variant::Caption, time).text_color(sem.text_secondary)),
                )
                .child(text(Variant::MessageBody, body).text_color(sem.text_primary))
                .child(div().mt(px(4.)).child(attachment)),
        )
}

impl Render for Conversation {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .size_full()
            .bg(sem.background_default)
            .flex()
            .flex_col()
            .child(
                div()
                    .px(px(16.))
                    .py(px(12.))
                    .border_b_1()
                    .border_color(sem.divider)
                    .child(text(Variant::H6, "# launch").text_color(sem.text_primary)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.))
                    .p(px(16.))
                    .min_w_0()
                    .child(message(
                        "A",
                        "Ava Chen",
                        "Today at 10:42",
                        "Here's the demo from yesterday, the sync bit is at 0:40.",
                        hsla(0.58, 0.55, 0.45, 1.),
                        self.video.clone().into(),
                        cx,
                    ))
                    .child(message(
                        "M",
                        "Mike",
                        "Today at 10:47",
                        "Notes from standup, in case you missed it.",
                        hsla(0.08, 0.6, 0.45, 1.),
                        self.audio.clone().into(),
                        cx,
                    )),
            )
    }
}

fn conversation(window: &mut Window, cx: &mut App) -> AnyView {
    let video = VideoStory::new(paused_at(42)).build(window, cx);
    let audio = AudioStory {
        play: false,
        ..AudioStory::new(Script::audio())
    }
    .build(cx);
    cx.new(|_| Conversation { video, audio }).into()
}

pub fn stories() -> Vec<Story> {
    vec![
        // The video player, state by state.
        Story::new("player-video-idle", |_, window, cx| {
            VideoStory::idle().story(window, cx)
        }),
        Story::new("player-video-idle-no-poster", |_, window, cx| {
            VideoStory {
                poster: false,
                ..VideoStory::idle()
            }
            .story(window, cx)
        }),
        Story::new("player-video-loading", |_, window, cx| {
            VideoStory::new(Script::loading()).story(window, cx)
        }),
        Story::new("player-video-playing", |_, window, cx| {
            VideoStory::new(Script::video().at(secs(42), PlaybackState::Playing)).story(window, cx)
        }),
        Story::new("player-video-paused", |_, window, cx| {
            VideoStory::new(paused_at(42)).story(window, cx)
        }),
        Story::new("player-video-buffering", |_, window, cx| {
            VideoStory::new(
                Script::video()
                    .at(secs(43), PlaybackState::Buffering)
                    .buffered(vec![0.0..0.35, 0.6..0.7]),
            )
            .story(window, cx)
        }),
        Story::new("player-video-ended", |_, window, cx| {
            VideoStory::new(
                Script::video()
                    .at(secs(125), PlaybackState::Ended)
                    .buffered(vec![0.0..1.0]),
            )
            .story(window, cx)
        }),
        Story::new("player-video-error", |_, window, cx| {
            VideoStory::new(Script::failing(PlayerError::Network)).story(window, cx)
        }),
        Story::new("player-video-unsupported", |_, window, cx| {
            VideoStory {
                source: video_source("story-avi", "old-camcorder-clip.avi"),
                ..VideoStory::new(Script::failing(PlayerError::Unsupported))
            }
            .story(window, cx)
        }),
        Story::new("player-video-long-name", |_, window, cx| {
            VideoStory {
                source: video_source("story-long", LONG_NAME),
                poster: false,
                dimensions: (None, None),
                ..VideoStory::idle()
            }
            .story(window, cx)
        }),
        Story::new("player-video-over-an-hour", |_, window, cx| {
            VideoStory::new(
                Script::video()
                    .duration(secs(5530))
                    .at(secs(3723), PlaybackState::Paused)
                    .buffered(vec![0.6..0.7]),
            )
            .story(window, cx)
        }),
        Story::new("player-video-tall", |_, window, cx| {
            let mut script = paused_at(8);
            if let Some(Ok(meta)) = &mut script.open {
                meta.width = 720;
                meta.height = 1280;
            }
            VideoStory {
                dimensions: (Some(720), Some(1280)),
                ..VideoStory::new(script)
            }
            .story(window, cx)
        }),
        Story::new("player-video-expanded", |_, window, cx| {
            VideoStory {
                expanded: true,
                ..VideoStory::new(paused_at(42))
            }
            .story(window, cx)
        }),
        // The audio row.
        Story::new("player-audio-idle", |_, _, cx| {
            AudioStory {
                play: false,
                ..AudioStory::new(Script::audio())
            }
            .story(cx)
        }),
        Story::new("player-audio-loading", |_, _, cx| {
            AudioStory::new(Script::loading()).story(cx)
        }),
        Story::new("player-audio-playing", |_, _, cx| {
            AudioStory::new(audio_at(71, PlaybackState::Playing)).story(cx)
        }),
        Story::new("player-audio-paused", |_, _, cx| {
            AudioStory::new(audio_at(71, PlaybackState::Paused)).story(cx)
        }),
        Story::new("player-audio-buffering", |_, _, cx| {
            AudioStory::new(audio_at(72, PlaybackState::Buffering).buffered(vec![0.0..0.4]))
                .story(cx)
        }),
        Story::new("player-audio-ended", |_, _, cx| {
            AudioStory::new(audio_at(184, PlaybackState::Ended).buffered(vec![0.0..1.0])).story(cx)
        }),
        Story::new("player-audio-error", |_, _, cx| {
            AudioStory::new(Script::failing(PlayerError::Network)).story(cx)
        }),
        Story::new("player-audio-unsupported", |_, _, cx| {
            AudioStory {
                source: audio_source("story-wma", "voicemail.wma"),
                ..AudioStory::new(Script::failing(PlayerError::Unsupported))
            }
            .story(cx)
        }),
        Story::new("player-audio-long-name", |_, _, cx| {
            AudioStory {
                source: audio_source("story-long-audio", &LONG_NAME.replace(".mp4", ".ogg")),
                ..AudioStory::new(audio_at(71, PlaybackState::Paused))
            }
            .story(cx)
        }),
        Story::new("player-audio-over-an-hour", |_, _, cx| {
            AudioStory::new(
                Script::audio()
                    .duration(secs(4210))
                    .at(secs(605), PlaybackState::Paused),
            )
            .story(cx)
        }),
        Story::new("player-conversation", |_, window, cx| {
            conversation(window, cx)
        }),
    ]
}
