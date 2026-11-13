//! Pictures from other sites: a GIF message's image and a link preview's picture.
//!
//! Loading one tells that site the viewer's address, so while the "Load images from other sites"
//! setting is off nothing may ask the media source for one. This module is the only code in the
//! list that calls [`MediaSource::gif`] or [`MediaSource::link_image`] (a test reads the sources to
//! keep it so), and it doesn't call them unless `allowed`. Rows only ever see a [`ThirdParty`].

use super::media::{MediaRef, MediaSource};
use gpui_kit::SharedString;
use semaphore_core::model::{GifEmbed, LinkPreviewView};

/// The widest and tallest a GIF is drawn, as the web's `GifEmbed` (`maxWidth: 400`,
/// `maxHeight: 300`). It is also the box held for one still loading, so the row only shrinks when
/// the picture arrives.
pub(crate) const GIF_MAX: (f32, f32) = (400., 300.);

/// What a row may draw for a third-party picture.
#[derive(Clone)]
pub(crate) enum ThirdParty {
    /// The setting is off: a "Load" card naming the host; the source was not asked.
    Blocked { host: SharedString },
    /// The setting is on: whatever the source answered.
    Allowed(MediaRef),
}

/// A GIF message's picture.
pub(crate) fn gif(allowed: bool, source: &dyn MediaSource, embed: &GifEmbed) -> ThirdParty {
    if !allowed {
        return ThirdParty::Blocked {
            host: host_label(Some(&embed.host)),
        };
    }
    ThirdParty::Allowed(source.gif(&embed.url))
}

/// A link preview's picture; `None` when the preview has none.
pub(crate) fn link_image(
    allowed: bool,
    source: &dyn MediaSource,
    preview: &LinkPreviewView,
) -> Option<ThirdParty> {
    let url = preview.image_url.as_deref().filter(|url| !url.is_empty())?;
    if !allowed {
        return Some(ThirdParty::Blocked {
            host: host_label(preview.image_host.as_deref()),
        });
    }
    Some(ThirdParty::Allowed(source.link_image(url)))
}

/// The host as core gave it (lower-case already), or "another site" when it has none.
pub(crate) fn host_label(host: Option<&str>) -> SharedString {
    match host.map(str::trim).filter(|host| !host.is_empty()) {
        Some(host) => SharedString::from(host.to_owned()),
        None => SharedString::new_static("another site"),
    }
}

pub(crate) fn gif_title(host: &str) -> String {
    format!("GIF from {host}")
}

pub(crate) fn image_title(host: &str) -> String {
    format!("Image from {host}")
}

pub(crate) const GIF_NOTE: &str = "Loading shows your address to that site, and turns on images from other sites for all messages.";

/// A GIF's box: its own size, scaled down to fit [`GIF_MAX`] keeping its shape, never up. A
/// picture with no size takes the whole box.
pub(crate) fn gif_box(width: f32, height: f32) -> (f32, f32) {
    if !(width.is_finite() && height.is_finite()) || width <= 0. || height <= 0. {
        return GIF_MAX;
    }
    let scale = (GIF_MAX.0 / width).min(GIF_MAX.1 / height).min(1.);
    // Never thinner than a pixel, however extreme the shape.
    ((width * scale).max(1.), (height * scale).max(1.))
}
