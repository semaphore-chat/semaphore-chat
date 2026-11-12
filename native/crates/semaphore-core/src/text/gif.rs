//! A message whose whole text is one GIF URL, as the GIF picker sends it: the web's
//! `getLoneGifUrl` (`frontend/src/components/Message/messageUtils.ts`). Lane W7-A fills it.

use crate::model::GifEmbed;

/// The scheme's length when one starts at `index` of `bytes`: `https://` or `http://`, in any
/// case.
fn scheme_at(bytes: &[u8], index: usize) -> Option<usize> {
    let rest = bytes.get(index..)?;
    if rest.len() >= 8 && rest[..5].eq_ignore_ascii_case(b"https") && &rest[5..8] == b"://" {
        return Some(8);
    }
    if rest.len() >= 7 && rest[..4].eq_ignore_ascii_case(b"http") && &rest[4..7] == b"://" {
        return Some(7);
    }
    None
}

/// A Giphy or Tenor media CDN host: `media.giphy.com`, `media4.giphy.com`, `media12.tenor.com`,
/// ... (`/^media\d*\.(giphy|tenor)\.com$/i`).
fn gif_host(host: &str) -> bool {
    let numbered = |site: &str| {
        host.strip_prefix("media")
            .and_then(|rest| rest.strip_suffix(&format!(".{site}.com")))
            .is_some_and(|number| number.bytes().all(|byte| byte.is_ascii_digit()))
    };
    numbered("giphy") || numbered("tenor")
}

/// Whether `path` ends in `.gif`, in any case.
fn gif_path(path: &str) -> bool {
    path.get(path.len().saturating_sub(4)..)
        .is_some_and(|tail| tail.eq_ignore_ascii_case(".gif"))
}

/// `Some` when `text`, trimmed, is exactly one http(s) URL to GIF media: a Giphy or Tenor media
/// host (`media.giphy.com`, `media2.giphy.com`, `media.tenor.com`, ...) or any host whose path
/// ends in `.gif`. Never panics.
pub fn lone_gif_url(text: &str) -> Option<GifEmbed> {
    let text = text.trim();
    // A lone URL has no whitespace; this also keeps "look at https://..." out.
    if text.is_empty() || text.chars().any(char::is_whitespace) {
        return None;
    }
    // Exactly one scheme, and the text starts with it: a second URL glued on is no lone URL.
    let bytes = text.as_bytes();
    let mut occurrences = 0usize;
    let mut length = 0usize;
    for index in 0..bytes.len() {
        if let Some(found) = scheme_at(bytes, index) {
            occurrences += 1;
            if occurrences > 1 {
                return None;
            }
            length = found;
        }
    }
    if occurrences != 1 || scheme_at(bytes, 0) != Some(length) {
        return None;
    }

    // After the scheme the host runs to the first `/`, `?` or `#`; a port isn't part of it.
    let rest = &text[length..];
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..host_end];
    if authority.is_empty() {
        return None;
    }
    let host = authority.split(':').next().unwrap_or_default();
    if host.is_empty() {
        return None;
    }
    let host = host.to_ascii_lowercase();
    // The path is what follows the host's `/`, up to a query or a fragment.
    let after = &rest[host_end..];
    let path = if after.starts_with('/') {
        let end = after.find(['?', '#']).unwrap_or(after.len());
        &after[..end]
    } else {
        ""
    };
    if !gif_host(&host) && !gif_path(path) {
        return None;
    }
    Some(GifEmbed {
        url: text.to_owned(),
        host,
    })
}

/// The lower-case host of one http(s) URL, without a port, for "Image from <host>". `None` for
/// anything that isn't one (a relative path, another scheme, an empty host). Never panics.
pub fn url_host(url: &str) -> Option<String> {
    let url = url.trim();
    let length = scheme_at(url.as_bytes(), 0)?;
    let rest = &url[length..];
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = rest[..host_end].split(':').next().unwrap_or_default();
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}
