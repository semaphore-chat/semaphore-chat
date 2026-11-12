//! A message whose whole text is one GIF URL, as the GIF picker sends it: the web's
//! `getLoneGifUrl` (`frontend/src/components/Message/messageUtils.ts`). Lane W7-A fills it.

use crate::model::GifEmbed;

/// `Some` when `text`, trimmed, is exactly one http(s) URL to GIF media: a Giphy or Tenor media
/// host (`media.giphy.com`, `media2.giphy.com`, `media.tenor.com`, ...) or any host whose path
/// ends in `.gif`. Never panics.
pub fn lone_gif_url(_text: &str) -> Option<GifEmbed> {
    None
}
