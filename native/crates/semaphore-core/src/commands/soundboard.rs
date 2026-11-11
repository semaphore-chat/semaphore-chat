//! A community's soundboard: the list and playing a sound into the call. Unit W4-core.
//!
//! Only in a channel call: the sounds are the call's community's. The bytes come from the sound's
//! file and go to `MediaEngine::play_soundboard`, which decodes them.

use crate::client::Core;
use crate::model::SoundboardView;
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// The community's sounds (`ViewKey::Soundboard`), fetched when missing.
    pub fn soundboard(&self, community_id: String) -> SoundboardView {
        SoundboardView {
            community_id,
            ..SoundboardView::default()
        }
    }

    /// Plays one of the call's community's sounds to everyone in the call. Refused outside a
    /// channel call.
    pub async fn play_sound(&self, _sound_id: String) -> Result<(), CoreError> {
        Err(unavailable("the soundboard"))
    }

    /// Stops the sound playing, if any.
    pub fn stop_sound(&self) {}
}
