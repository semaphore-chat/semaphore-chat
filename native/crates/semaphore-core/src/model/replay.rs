//! W4: the replay buffer (the server's recording of my screen share), capturing clips from it, and
//! the clip library.

use super::{ErrorView, LoadState};

/// The replay buffer of my screen share. It starts by itself when a share is published in a
/// channel call (as on the web) and stops with the share or the call.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ReplayState {
    #[default]
    Off,
    Starting,
    Recording {
        session_id: String,
    },
    /// It didn't start, or the server stopped it (`replayBufferFailed`), and why.
    Failed {
        message: String,
    },
}

/// How far back a capture reaches. The server takes these four only.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ReplayMinutes {
    #[default]
    One,
    Two,
    Five,
    Ten,
}

impl ReplayMinutes {
    pub fn minutes(self) -> u32 {
        match self {
            Self::One => 1,
            Self::Two => 2,
            Self::Five => 5,
            Self::Ten => 10,
        }
    }
}

/// Where a captured or shared clip goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipDestination {
    /// My clip library only. Not for `Core::share_clip`.
    Library,
    Channel {
        channel_id: String,
    },
    Dm {
        dm_group_id: String,
    },
}

/// A part of the replay buffer, in seconds from the BUFFER's start (as the trim timeline shows
/// it, from `ReplaySessionView`), not from the end of a `ReplayMinutes` window: the server keeps
/// about 20 minutes. `end_seconds > start_seconds`, and within `ReplaySessionView::total_seconds`
/// when that's known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayTrim {
    pub start_seconds: u32,
    pub end_seconds: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureRequest {
    /// The last this many minutes. Not used with a `trim`, which names its own part.
    pub minutes: ReplayMinutes,
    pub trim: Option<ReplayTrim>,
    pub destination: ClipDestination,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedClip {
    pub clip_id: String,
    pub file_id: String,
    pub duration_seconds: u32,
    pub size_bytes: u64,
    pub download_url: String,
    /// The message it was posted as, for a channel or DM destination.
    pub message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clip {
    pub id: String,
    pub file_id: String,
    pub channel_id: Option<String>,
    pub duration_seconds: u32,
    pub is_public: bool,
    pub captured_at_ms: i64,
    pub download_url: String,
    pub size_bytes: u64,
    pub filename: String,
    /// The clip's file type. The server's `ClipResponseDto` doesn't carry it; clips are MP4.
    pub mime_type: String,
    /// The server's `ClipResponseDto` doesn't say; false until it does.
    pub has_thumbnail: bool,
}

/// Clips: mine (`ViewKey::Clips`, all of them) or another user's public ones
/// (`ViewKey::UserClips`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClipsView {
    pub state: LoadState,
    pub clips: Vec<Clip>,
    /// Clips with an update, delete or share on its way.
    pub busy: Vec<String>,
    pub error: Option<ErrorView>,
}

/// What the replay buffer holds now, for the trim timeline (`replay/session-info`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReplaySessionView {
    pub state: LoadState,
    pub active: bool,
    pub total_segments: u32,
    pub total_seconds: u32,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

/// One HLS segment of the buffer's preview. Fetching it needs the session's `Authorization`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewSegment {
    pub url: String,
    pub duration_ms: u32,
}

/// Why a preview segment didn't come (`Core::fetch_replay_segment`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentFailure {
    /// No response, a 5xx or a 429: trying again may work.
    pub transient: bool,
    pub error: crate::platform::CoreError,
}
