//! The players' pure half: what each state shows, the scrubber's maths, time and size labels,
//! keys, and the box a video takes in a message. No GPUI here, so all of it is tested directly.

use semaphore_core::player::{PlaybackState, PlayerError};
use std::time::Duration;

/// Controls hide after this long without the pointer moving, while playing.
pub const HIDE_AFTER: Duration = Duration::from_secs(3);
/// Left and right seek this far.
pub const SEEK_STEP: Duration = Duration::from_secs(5);
/// Up and down change the volume this much.
pub const VOLUME_STEP: f32 = 0.1;

/// The web's video box: 100% wide up to the row's width, at most 400 px tall, the whole frame.
pub const VIDEO_MAX_WIDTH: f32 = 480.;
pub const VIDEO_MAX_HEIGHT: f32 = 400.;
/// Below this a video's controls don't fit; a small video is scaled up to it.
pub const VIDEO_MIN_WIDTH: f32 = 280.;
/// With no dimensions from the server: 16:9, so a late size can't move the rows below.
pub const VIDEO_DEFAULT: (f32, f32) = (480., 270.);
/// The audio row's width cap: the web's file card.
pub const AUDIO_MAX_WIDTH: f32 = 480.;

/// Where a player is, as the UI sees it: core's [`PlaybackState`] plus "nothing opened yet".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Phase {
    /// Nothing opened: the poster and a play button. No bytes fetched.
    Idle,
    Loading,
    Playing,
    Paused,
    Buffering,
    Ended,
    Failed(PlayerError),
}

impl From<PlaybackState> for Phase {
    fn from(state: PlaybackState) -> Self {
        match state {
            PlaybackState::Loading => Phase::Loading,
            PlaybackState::Paused => Phase::Paused,
            PlaybackState::Playing => Phase::Playing,
            PlaybackState::Buffering => Phase::Buffering,
            PlaybackState::Ended => Phase::Ended,
            PlaybackState::Failed(error) => Phase::Failed(error),
        }
    }
}

impl Phase {
    /// Playing or waiting for data to keep playing: the button shows Pause.
    pub fn is_playing(&self) -> bool {
        matches!(self, Phase::Playing | Phase::Buffering)
    }

    /// Opened and not failed: seeking and the scrubber work.
    pub fn is_open(&self) -> bool {
        matches!(
            self,
            Phase::Playing | Phase::Paused | Phase::Buffering | Phase::Ended
        )
    }
}

/// How a failure is offered to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// "Can't play this here": Download and Open externally. A codec or container this client
    /// doesn't play, or a file that doesn't parse (another player may manage it).
    Unsupported,
    /// "Couldn't play this": Retry, and Download.
    Retryable,
}

pub fn failure_of(error: &PlayerError) -> Failure {
    match error {
        PlayerError::Unsupported | PlayerError::Corrupt => Failure::Unsupported,
        PlayerError::Network | PlayerError::AudioDevice => Failure::Retryable,
    }
}

/// What fills the video box.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Picture {
    /// The thumbnail, or a placeholder without one.
    Poster,
    /// Decoded frames.
    Surface,
}

/// What sits over the picture, centred.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Center {
    Nothing,
    BigPlay,
    Spinner,
    Replay,
    Failed(Failure),
}

/// What the video player draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shown {
    pub picture: Picture,
    pub center: Center,
    pub controls: bool,
}

/// The state-to-element mapping of the video player. `has_frame`: a decoded frame is on the
/// surface (the engine shows the first one on open); `controls_awake`: the pointer moved within
/// [`HIDE_AFTER`], which only matters while playing.
pub fn video_shown(phase: &Phase, has_frame: bool, controls_awake: bool) -> Shown {
    let picture = if has_frame && !matches!(phase, Phase::Idle | Phase::Failed(_)) {
        Picture::Surface
    } else {
        Picture::Poster
    };
    let (center, controls) = match phase {
        Phase::Idle => (Center::BigPlay, false),
        Phase::Loading => (Center::Spinner, false),
        Phase::Playing => (Center::Nothing, controls_awake),
        Phase::Paused => (Center::Nothing, true),
        Phase::Buffering => (Center::Spinner, true),
        Phase::Ended => (Center::Replay, true),
        Phase::Failed(error) => (Center::Failed(failure_of(error)), false),
    };
    Shown {
        picture,
        center,
        controls,
    }
}

/// The audio row's main button.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainButton {
    Play,
    Pause,
    Replay,
    /// Loading: a spinner where the button was.
    Spinner,
}

/// What the audio row draws: its button, and a failure line in place of the controls.
pub fn audio_shown(phase: &Phase) -> (MainButton, Option<Failure>) {
    match phase {
        Phase::Idle | Phase::Paused => (MainButton::Play, None),
        Phase::Loading => (MainButton::Spinner, None),
        Phase::Playing | Phase::Buffering => (MainButton::Pause, None),
        Phase::Ended => (MainButton::Replay, None),
        Phase::Failed(error) => (MainButton::Play, Some(failure_of(error))),
    }
}

/// `m:ss` under an hour, `h:mm:ss` from one.
pub fn format_time(time: Duration) -> String {
    let total = time.as_secs();
    let (hours, minutes, seconds) = (total / 3600, (total / 60) % 60, total % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

/// "current / duration", both in the duration's form so the label doesn't change width when the
/// position passes an hour. With no duration yet, the position alone.
pub fn time_label(position: Duration, duration: Option<Duration>) -> String {
    match duration {
        Some(duration) if duration.as_secs() >= 3600 => {
            let long = |t: Duration| {
                let total = t.as_secs();
                format!(
                    "{}:{:02}:{:02}",
                    total / 3600,
                    (total / 60) % 60,
                    total % 60
                )
            };
            format!("{} / {}", long(position.min(duration)), long(duration))
        }
        Some(duration) => format!(
            "{} / {}",
            format_time(position.min(duration)),
            format_time(duration)
        ),
        None => format_time(position),
    }
}

/// The fraction of the track under `x`, clamped to it.
pub fn fraction_at(x: f32, track_left: f32, track_width: f32) -> f32 {
    if track_width <= 0. || !x.is_finite() {
        return 0.;
    }
    ((x - track_left) / track_width).clamp(0., 1.)
}

/// The time at a fraction of the track.
pub fn time_at(fraction: f32, duration: Duration) -> Duration {
    duration.mul_f64(f64::from(fraction.clamp(0., 1.)))
}

/// How far along the track `position` is.
pub fn played_fraction(position: Duration, duration: Option<Duration>) -> f32 {
    match duration {
        Some(duration) if !duration.is_zero() => {
            (position.as_secs_f64() / duration.as_secs_f64()).clamp(0., 1.) as f32
        }
        _ => 0.,
    }
}

/// `position` moved by `by` (forwards or back), inside the file.
pub fn seek_by(
    position: Duration,
    forward: bool,
    by: Duration,
    duration: Option<Duration>,
) -> Duration {
    let moved = if forward {
        position.saturating_add(by)
    } else {
        position.saturating_sub(by)
    };
    match duration {
        Some(duration) => moved.min(duration),
        None => moved,
    }
}

pub fn step_volume(volume: f32, up: bool) -> f32 {
    let next = if up {
        volume + VOLUME_STEP
    } else {
        volume - VOLUME_STEP
    };
    // Rounded to the step, so ten presses from full reach exactly zero.
    ((next * 10.).round() / 10.).clamp(0., 1.)
}

/// What a key does to a focused player.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum KeyCommand {
    Toggle,
    Seek { forward: bool },
    Volume { up: bool },
    Mute,
    Expand,
    Collapse,
}

/// GPUI key names to commands. `video`: expand and collapse exist.
pub fn key_command(key: &str, video: bool) -> Option<KeyCommand> {
    Some(match key {
        "space" => KeyCommand::Toggle,
        "left" => KeyCommand::Seek { forward: false },
        "right" => KeyCommand::Seek { forward: true },
        "up" => KeyCommand::Volume { up: true },
        "down" => KeyCommand::Volume { up: false },
        "m" => KeyCommand::Mute,
        "f" if video => KeyCommand::Expand,
        "escape" if video => KeyCommand::Collapse,
        _ => return None,
    })
}

/// The box a video takes in a message, from the attachment's dimensions: the whole frame, at
/// most [`VIDEO_MAX_WIDTH`] by [`VIDEO_MAX_HEIGHT`] and at least [`VIDEO_MIN_WIDTH`] wide (a
/// tall video gets bars at the sides). Unknown dimensions take [`VIDEO_DEFAULT`]. The row caps
/// the width again at its own (`max_w_full`), keeping the shape.
pub fn video_box(width: Option<u32>, height: Option<u32>) -> (f32, f32) {
    let (Some(w), Some(h)) = (width, height) else {
        return VIDEO_DEFAULT;
    };
    if w == 0 || h == 0 {
        return VIDEO_DEFAULT;
    }
    let (w, h) = (w as f32, h as f32);
    let scale = (VIDEO_MAX_WIDTH / w).min(VIDEO_MAX_HEIGHT / h);
    let (fit_w, fit_h) = (w * scale, h * scale);
    if fit_w < VIDEO_MIN_WIDTH {
        (VIDEO_MIN_WIDTH, fit_h)
    } else {
        (fit_w, fit_h)
    }
}

/// The file card's size label, as the message list writes it.
pub fn file_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64 / 1024.0;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

/// The surface key the call tiles' `VideoFrames` holds this attachment's frames under.
pub fn surface_key(file_id: &str) -> String {
    format!("player:{file_id}")
}
