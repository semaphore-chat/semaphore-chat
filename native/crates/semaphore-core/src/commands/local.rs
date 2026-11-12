//! Local choices the host keeps (its settings store) and core only remembers, so view models can be
//! shaped for them. Today: third-party media. Core never writes a settings file.
//!
//! Images on someone else's server (a link preview's picture, a GIF in the picker or a message)
//! tell that site who looked at them. The owner's decision: one setting, "Load images from other
//! sites (link previews, GIFs)", off by default. The host reads it from its store at start and on
//! every change and hands it here (`Core::set_third_party_media`); core then says in its views that
//! an image waits for the user's consent, and reads no GIF list meanwhile.

use crate::client::{Core, State};
use crate::model::ViewKey;

/// The local choices core's views depend on. Kept across sign-outs: they are this install's, not
/// the session's.
#[derive(Debug, Default)]
pub(crate) struct LocalState {
    /// "Load images from other sites": false until the host says otherwise.
    pub third_party_media: bool,
}

impl Core {
    /// Whether third-party images may load: the host's stored setting, as last handed over.
    pub fn third_party_media(&self) -> bool {
        self.read(|state| state.local.third_party_media)
    }

    /// What the user chose: the host stores it and tells core. Every GIF view says to read again:
    /// while it's off the picker offers the choice instead of results, and reads nothing.
    pub fn set_third_party_media(&self, enabled: bool) {
        self.write(|state, _| {
            if state.local.third_party_media == enabled {
                return;
            }
            state.local.third_party_media = enabled;
            let keys: Vec<_> = state
                .cache
                .keys_with_op(crate::commands::gifs::keys::FEATURED)
                .into_iter()
                .chain(
                    state
                        .cache
                        .keys_with_op(crate::commands::gifs::keys::SEARCH),
                )
                .collect();
            for key in keys {
                if let Some(view) = crate::commands::gifs::view_for(&key) {
                    state.view_changed(view);
                }
            }
            // The featured list's view, which a picker reads before any query is cached.
            state.view_changed(ViewKey::Gifs {
                query: String::new(),
            });
        });
    }
}

impl State {
    /// Whether a GIF list waits for the user's consent instead of reading.
    pub(crate) fn gif_needs_permission(&self) -> bool {
        !self.local.third_party_media
    }
}
