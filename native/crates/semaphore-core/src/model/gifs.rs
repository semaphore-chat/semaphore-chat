//! GIFs: the picker's results and a message that is one GIF. Wave 7 (lane W7-A,
//! `commands/gifs.rs`, `text/gif.rs`).
//!
//! The picker's previews and a GIF message's image come from the GIF service's own servers
//! (Giphy), which see the viewer's address: the app loads them only while the "Load images from
//! other sites" setting is on. Core only hands out the URLs.

use super::LoadState;

/// One GIF result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GifView {
    pub id: String,
    pub title: String,
    /// The full animated GIF: what a pick sends as the message's whole text.
    pub url: String,
    /// A small animated preview for the picker grid.
    pub preview_url: String,
    pub width: u32,
    pub height: u32,
}

/// `Core::gifs`. `ViewKey::Gifs { query }` says when to read again. An empty query is the
/// featured list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GifResultsView {
    pub state: LoadState,
    /// Trimmed, as the key has it.
    pub query: String,
    pub results: Vec<GifView>,
    /// The server has more: `Core::load_more_gifs`.
    pub more: bool,
    pub loading_more: bool,
    /// The server offers GIF search (`ServerInfo::gif_search`). False: hide the GIF button.
    pub enabled: bool,
    /// The "Load images from other sites" setting is off (`Core::third_party_media`): the picker
    /// offers the choice instead of results, and `Core::gifs` read nothing. Enabling it is
    /// `Core::set_third_party_media(true)`, which the host stores. False when `enabled` is false.
    pub needs_permission: bool,
}

/// A message whose whole text is one GIF URL (`text::gif::lone_gif_url`): drawn as the image,
/// not as a link with a preview card.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GifEmbed {
    pub url: String,
    /// Lower-case, for "GIF from <host>".
    pub host: String,
}
