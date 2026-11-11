//! W4-ui-replay: the capture dialog, the trim timeline, the clip library and the share dialog,
//! from `components/Voice/CaptureReplayModal.tsx`, `TrimPreview.tsx`, `TrimTimeline.tsx`,
//! `components/Profile/ClipLibrary.tsx` and `ShareClipDialog.tsx`.
//!
//! - [`CaptureReplayDialog`]: a preset (1, 2, 5, 10 min) or a custom trim, and where the clip goes
//!   (my library, a channel, a DM, or a download only), with the buffer's state (not recording,
//!   starting, warming up, recording, failed). It holds a [`TrimTimeline`].
//! - [`TrimTimeline`]: start and end handles over the buffer, in seconds from the buffer's start
//!   (what the server reads). No preview yet: [`TrimTimeline::preview`] is where it goes.
//! - [`ClipLibrary`]: my clips or another user's public ones, each in the W3 video player.
//! - [`ShareClipDialog`]: a library clip to a channel or a DM.
//!
//! The views take plain data and emit what the user asked for; the owner calls core. Channel, DM
//! and community lists come in as [`PickOption`]s, which the owner builds from its own views.

mod capture;
mod library;
pub mod model;
mod picker;
mod share;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;
mod trim;

pub use capture::CaptureReplayDialog;
pub use library::ClipLibrary;
pub use model::{Choices, PickOption};
pub use share::ShareClipDialog;
pub use trim::{TrimEvent, TrimTimeline};

use semaphore_core::model::{CaptureRequest, ClipDestination, ReplayMinutes};

/// A channel or a DM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestinationKind {
    Channel,
    Dm,
}

/// The capture dialog's destination radios.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureTarget {
    Library,
    Channel,
    Dm,
    Download,
}

/// What the capture dialog asks of its owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureEvent {
    /// The user picked "Share to channel" or "Share to DM" and the list isn't loaded: answer with
    /// `set_channels` (the current community's text channels) or `set_dms`.
    NeedDestinations(DestinationKind),
    /// Capture: `Core::capture_replay(request)`. With a trim, its seconds are from the buffer's
    /// start and `minutes` is ignored by the server. The owner calls `set_busy(true)`, then on
    /// success drops the dialog (the web says "Recording saved"), or on failure `set_busy(false)`
    /// and `set_failed` with the server's message.
    Capture(CaptureRequest),
    /// "Download only": `Core::download_replay(minutes)`, saved to the user's downloads. The
    /// stream endpoint takes a preset only, so a trim isn't applied, as on the web.
    DownloadOnly { minutes: ReplayMinutes },
    /// The trim's session view failed and the user asked again: `Core::retry_failed`.
    Retry,
    /// Cancel, Escape or the backdrop: the owner drops the dialog.
    Close,
}

/// What the clip library asks of its owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipEvent {
    /// The public switch: `Core::set_clip_public`.
    SetPublic { clip_id: String, public: bool },
    /// Download (the card's button, or the player's own): save `/file/{file_id}` as `filename`,
    /// with `set_downloading` while it runs.
    Download {
        clip_id: String,
        file_id: String,
        filename: String,
    },
    /// Share: the owner opens a [`ShareClipDialog`] for the clip.
    Share { clip_id: String },
    /// Delete, after the confirm: `Core::delete_clip`. The confirm says "Deleting..." until the
    /// clip leaves the view or stops being busy (a failure shows in `ClipsView::error`).
    Delete { clip_id: String },
    /// The list failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// What the share dialog asks of its owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShareEvent {
    /// A community was picked: answer with `set_channels(community_id, ..)`, its text channels.
    PickCommunity { community_id: String },
    /// "Share to DM" was picked and the list isn't loaded: answer with `set_dms`.
    NeedDms,
    /// Share: `Core::share_clip(clip_id, destination)`, with `set_busy` and `set_failed` as the
    /// capture dialog does. On success the owner drops the dialog ("Clip shared successfully").
    Share {
        clip_id: String,
        destination: ClipDestination,
    },
    /// Cancel, Escape or the backdrop.
    Close,
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
