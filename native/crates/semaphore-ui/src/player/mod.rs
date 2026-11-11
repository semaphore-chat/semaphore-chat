//! Attachment players, unit W3-player-ui: [`VideoPlayer`] and [`AudioPlayer`].
//!
//! - **Driven through core.** A view opens its attachment on the first play through the owner's
//!   [`PlayerOpener`] and then speaks only `semaphore_core::player::MediaPlayer`; what comes back
//!   is `PlayerEvent`s (state, metadata, position, buffered ranges). Nothing here fetches bytes
//!   or knows the engine.
//! - **Frames.** Video goes through the call tiles' `VideoFrames` under `player:<file_id>`
//!   ([`PlayerSurface`], which the app wraps as the engine's `VideoSink`). While video plays the
//!   view requests animation frames; otherwise a frame landing wakes it.
//! - **Events out.** [`PlayerViewEvent`]: Download and Open externally (the owner has the file
//!   routes and the OS), and the expanded view opening or closing.
//! - **Keys** when focused: space plays or pauses, left and right seek 5 s, up and down change the
//!   volume, m mutes, f expands (video), Escape closes the expanded view.

mod audio;
mod controls;
#[cfg(any(test, feature = "stories"))]
pub mod fake;
pub mod model;
mod registry;
mod session;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;
mod video;

pub use audio::AudioPlayer;
pub use model::{Phase, file_size, surface_key, video_box};
pub use registry::{AttachmentPlayer, ListPlayers, Players};
pub use session::{FactoryOpener, PlayerOpener, PlayerSurface};
pub use video::VideoPlayer;

/// What a player asks of its owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlayerViewEvent {
    /// Save the file (`/file/{id}`), as the file card's download does.
    Download { file_id: String },
    /// Hand the file to the OS's default app: this client can't play it.
    OpenExternally { file_id: String },
    /// The in-window expanded view opened (`true`) or closed.
    Expanded(bool),
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
