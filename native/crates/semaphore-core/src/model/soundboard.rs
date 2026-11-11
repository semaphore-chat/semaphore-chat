//! W4: a community's soundboard, played into the call on its own `soundboard` track.

use super::{ErrorView, LoadState};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundboardSound {
    pub id: String,
    pub name: String,
    pub emoji: Option<String>,
    pub file_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SoundboardView {
    pub community_id: String,
    pub state: LoadState,
    pub sounds: Vec<SoundboardSound>,
    /// The sound playing now, if any.
    pub playing: Option<String>,
    /// Why the last play failed.
    pub error: Option<ErrorView>,
}
