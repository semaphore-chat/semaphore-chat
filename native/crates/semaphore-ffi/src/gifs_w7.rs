//! W7-A: GIFs. The records mirror `semaphore_core::model::gifs`.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{GifEmbed, GifResultsView, GifView, LoadState};

#[uniffi::remote(Record)]
pub struct GifView {
    pub id: String,
    pub title: String,
    pub url: String,
    pub preview_url: String,
    pub width: u32,
    pub height: u32,
}

#[uniffi::remote(Record)]
pub struct GifResultsView {
    pub state: LoadState,
    pub query: String,
    pub results: Vec<GifView>,
    pub more: bool,
    pub loading_more: bool,
    pub enabled: bool,
    pub needs_permission: bool,
}

#[uniffi::remote(Record)]
pub struct GifEmbed {
    pub url: String,
    pub host: String,
}

/// `semaphore_core::text::gif::lone_gif_url`.
#[uniffi::export]
pub fn lone_gif_url(text: String) -> Option<GifEmbed> {
    semaphore_core::text::gif::lone_gif_url(&text)
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn gifs(&self, query: String) -> GifResultsView {
        self.core.gifs(query)
    }

    pub fn third_party_media(&self) -> bool {
        self.core.third_party_media()
    }

    /// The host stores the choice (its settings file); core only remembers it for its views.
    pub fn set_third_party_media(&self, enabled: bool) {
        self.core.set_third_party_media(enabled);
    }

    pub async fn load_more_gifs(&self, query: String) -> Result<(), CoreError> {
        self.core.load_more_gifs(query).await
    }
}
