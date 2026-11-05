//! Auto-link detection. The rule is `MessageSpan.tsx`'s and `link-preview.utils.ts`'s:
//! `/(https?:\/\/[^\s<>)"']*[^\s<>)"'.,!?;:])/g`, lowercase scheme, http and https only.
//! That allow-list is the security rule: `javascript:`, `file:`, `ftp:` and the rest never link.

use super::js::is_space;

/// How many distinct URLs a message is previewed for (`MAX_URLS_PER_MESSAGE`).
pub const MAX_URLS_PER_MESSAGE: usize = 5;

/// A run of text and whether it renders as a link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkPart {
    pub text: String,
    pub link: bool,
}

fn url_char(c: char) -> bool {
    !is_space(c) && !matches!(c, '<' | '>' | ')' | '"' | '\'')
}

fn trailing_punct(c: char) -> bool {
    matches!(c, '.' | ',' | '!' | '?' | ';' | ':')
}

/// The end of the URL that starts at byte `at`, if one does.
fn match_at(text: &str, at: usize) -> Option<usize> {
    let rest = &text[at..];
    let scheme = if rest.starts_with("https://") {
        8
    } else if rest.starts_with("http://") {
        7
    } else {
        return None;
    };
    let run: usize = rest[scheme..]
        .chars()
        .take_while(|c| url_char(*c))
        .map(char::len_utf8)
        .sum();
    let body = rest[scheme..scheme + run].trim_end_matches(trailing_punct);
    (!body.is_empty()).then_some(at + scheme + body.len())
}

/// Every URL in `text`, in order, with duplicates.
fn matches(text: &str) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if text.as_bytes()[i] == b'h'
            && let Some(end) = match_at(text, i)
        {
            found.push((i, end));
            i = end;
            continue;
        }
        i += text[i..].chars().next().map_or(1, char::len_utf8);
    }
    found
}

/// What `MessageSpan` renders for a text span: `text.split(pattern)`, then every part that starts
/// with `http://` or `https://` is a link, including a part the pattern did not match (`http://.`).
/// Empty parts are dropped, since they render nothing.
pub fn link_parts(text: &str) -> Vec<LinkPart> {
    let mut parts = Vec::new();
    let mut last = 0;
    let mut push = |s: &str| {
        if !s.is_empty() {
            parts.push(LinkPart {
                text: s.to_owned(),
                link: s.starts_with("http://") || s.starts_with("https://"),
            });
        }
    };
    for (start, end) in matches(text) {
        push(&text[last..start]);
        push(&text[start..end]);
        last = end;
    }
    push(&text[last..]);
    parts
}

/// The distinct URLs of a message, at most [`MAX_URLS_PER_MESSAGE`] (`extractUrls`).
pub fn extract_urls(text: &str) -> Vec<String> {
    let mut urls: Vec<String> = Vec::new();
    for (start, end) in matches(text) {
        let url = &text[start..end];
        if !urls.iter().any(|u| u == url) {
            urls.push(url.to_owned());
        }
    }
    urls.truncate(MAX_URLS_PER_MESSAGE);
    urls
}
