//! What the replay views decide, with no GPUI in it: the presets, the buffer's status line, the
//! trim range and its ruler, and how a clip card reads.

use semaphore_core::model::{
    AttachmentKind, AttachmentView, Clip, LoadState, ReplayMinutes, ReplaySessionView, ReplayState,
    ReplayTrim,
};

/// The four presets, in the web's order (`CaptureReplayModal.tsx`, `DURATION_PRESETS`).
pub const PRESETS: [ReplayMinutes; 4] = [
    ReplayMinutes::One,
    ReplayMinutes::Two,
    ReplayMinutes::Five,
    ReplayMinutes::Ten,
];

/// The web opens on 5 minutes.
pub const DEFAULT_PRESET: ReplayMinutes = ReplayMinutes::Five;

/// "5 min".
pub fn preset_label(minutes: ReplayMinutes) -> String {
    format!("{} min", minutes.minutes())
}

/// "~225MB": the web's estimate, 45 MB a minute.
pub fn preset_size(minutes: ReplayMinutes) -> String {
    format!("~{}MB", minutes.minutes() * 45)
}

/// What the dialog says about the buffer, from core's `VoiceView::replay` and the session view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BufferStatus {
    /// No buffer: not sharing, a DM call, or not in a call.
    NotRecording,
    /// The share is up and the server is starting the buffer.
    Starting,
    /// Recording, with nothing to capture yet.
    WarmingUp,
    /// Recording, with this much buffered (`None` while the session view loads).
    Recording {
        seconds: Option<u32>,
    },
    Failed {
        message: String,
    },
}

pub fn buffer_status(state: &ReplayState, session: &ReplaySessionView) -> BufferStatus {
    match state {
        ReplayState::Off => BufferStatus::NotRecording,
        ReplayState::Starting => BufferStatus::Starting,
        ReplayState::Failed { message } => BufferStatus::Failed {
            message: message.clone(),
        },
        ReplayState::Recording { .. } => match session.state {
            LoadState::Ready if session.total_seconds == 0 => BufferStatus::WarmingUp,
            LoadState::Ready => BufferStatus::Recording {
                seconds: Some(session.total_seconds),
            },
            _ => BufferStatus::Recording { seconds: None },
        },
    }
}

impl BufferStatus {
    /// Capture asks the server for a clip only while it records.
    pub fn can_capture(&self) -> bool {
        matches!(self, Self::Recording { .. })
    }

    /// The line under the title.
    pub fn line(&self) -> String {
        match self {
            Self::NotRecording => {
                "Not recording. Share your screen in a channel call to record a replay.".into()
            }
            Self::Starting => "Starting the replay buffer...".into(),
            Self::WarmingUp => {
                "Getting your replay ready — keep sharing your screen for a few seconds.".into()
            }
            Self::Recording { seconds: Some(s) } => {
                format!("Recording. {} buffered.", clock(*s))
            }
            Self::Recording { seconds: None } => "Recording.".into(),
            Self::Failed { message } => format!("The replay buffer stopped: {message}"),
        }
    }
}

/// `m:ss`, or `h:mm:ss` from an hour, as `formatPlaybackTime` writes it.
pub fn clock(seconds: u32) -> String {
    let (h, m, s) = (seconds / 3600, (seconds / 60) % 60, seconds % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// The shortest clip a trim makes, in seconds (the web keeps the handles a second apart).
pub const MIN_TRIM: u32 = 1;
/// A fresh trim covers the last minute, or the whole buffer when it's shorter.
pub const DEFAULT_TRIM: u32 = 60;

/// Which handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Handle {
    Start,
    End,
}

/// A trim over the buffer, in whole seconds from the buffer's start, which is what the server
/// reads (`startSeconds`/`endSeconds`). `max` is the buffer's length when the timeline last
/// loaded: like the web, it doesn't move as the buffer grows until Refresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrimRange {
    pub max: u32,
    pub start: u32,
    pub end: u32,
}

impl TrimRange {
    /// The last [`DEFAULT_TRIM`] seconds of a buffer `max` long. `None` for an empty buffer.
    pub fn new(max: u32) -> Option<Self> {
        (max > 0).then(|| Self {
            max,
            start: max.saturating_sub(DEFAULT_TRIM),
            end: max,
        })
    }

    pub fn duration(&self) -> u32 {
        self.end - self.start
    }

    pub fn trim(&self) -> ReplayTrim {
        ReplayTrim {
            start_seconds: self.start,
            end_seconds: self.end,
        }
    }

    /// Moves one handle to `seconds`, kept inside the buffer and [`MIN_TRIM`] from the other.
    pub fn set(&mut self, handle: Handle, seconds: u32) {
        match handle {
            Handle::Start => {
                self.start = seconds.min(self.end.saturating_sub(MIN_TRIM));
            }
            Handle::End => {
                self.end = seconds.clamp(self.start + MIN_TRIM, self.max);
            }
        }
    }

    /// Moves one handle by `delta` seconds (the arrow keys).
    pub fn nudge(&mut self, handle: Handle, delta: i64) {
        let at = match handle {
            Handle::Start => self.start,
            Handle::End => self.end,
        };
        let to = (i64::from(at) + delta).clamp(0, i64::from(self.max)) as u32;
        self.set(handle, to);
    }

    /// The second under a fraction of the track, to the nearest second.
    pub fn seconds_at(&self, fraction: f32) -> u32 {
        (fraction.clamp(0., 1.) * self.max as f32).round() as u32
    }

    /// Where a handle sits, as a fraction of the track.
    pub fn fraction(&self, handle: Handle) -> f32 {
        let at = match handle {
            Handle::Start => self.start,
            Handle::End => self.end,
        };
        at as f32 / self.max as f32
    }

    /// The handle a press at `fraction` takes: the start left of the range, the end right of
    /// it, and the nearer one inside it (the start on a tie).
    pub fn nearest(&self, fraction: f32) -> Handle {
        let at = fraction.clamp(0., 1.) * self.max as f32;
        let (start, end) = (self.start as f32, self.end as f32);
        if at <= start {
            Handle::Start
        } else if at >= end {
            Handle::End
        } else if at - start <= end - at {
            Handle::Start
        } else {
            Handle::End
        }
    }

    /// The buffer is now `max` long (Refresh). An end at the old edge follows the new edge, as on
    /// the web; a shorter buffer pulls both handles inside it.
    pub fn refresh(&mut self, max: u32) {
        if max == 0 || max == self.max {
            return;
        }
        let at_edge = self.end >= self.max;
        self.max = max;
        self.end = if at_edge { max } else { self.end.min(max) };
        self.end = self.end.max(MIN_TRIM.min(max));
        self.start = self.start.min(self.end.saturating_sub(MIN_TRIM));
    }
}

/// The ruler's labelled seconds: every 30 s, or every 60 s past 5 minutes (`TrimTimeline.tsx`),
/// spaced further (2, 5, 10 min) when that would be more than `most` labels (a phone's track).
pub fn ruler_marks(max: u32, most: usize) -> Vec<u32> {
    let first = if max > 300 { 60 } else { 30 };
    let every = [first, 60, 120, 300, 600]
        .into_iter()
        .filter(|every| *every >= first)
        .find(|every| ((max / every) as usize) < most.max(2))
        .unwrap_or(600);
    (0..=max).step_by(every as usize).collect()
}

/// One choice in a channel, DM or community picker: the app fills these from its own views
/// (text channels as `#name`, DMs by their members' names).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickOption {
    pub id: String,
    pub label: String,
}

impl PickOption {
    pub fn new(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
        }
    }
}

/// A picker's list: `None` while it loads.
pub type Choices = Option<Vec<PickOption>>;

/// The clip as an attachment, for `Players::create`.
pub fn clip_attachment(clip: &Clip) -> AttachmentView {
    AttachmentView {
        file_id: clip.file_id.clone(),
        filename: clip.filename.clone(),
        mime_type: clip.mime_type.clone(),
        size_bytes: clip.size_bytes,
        kind: AttachmentKind::Video,
        has_thumbnail: clip.has_thumbnail,
        width: None,
        height: None,
    }
}

/// "Nov 8, 2026 3:04 PM", the web's `MMM d, yyyy h:mm a`, in local time.
pub fn captured_at(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format("%b %-d, %Y %-I:%M %p")
                .to_string()
        })
        .unwrap_or_default()
}

/// "3 public clips", under another user's library title.
pub fn public_count(count: usize) -> String {
    format!("{count} public clip{}", if count == 1 { "" } else { "s" })
}
