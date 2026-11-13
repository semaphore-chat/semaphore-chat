//! Making text safe for a log line.
//!
//! A log a user may attach to a report must not carry an access or refresh token, a password, an
//! invite code or a URL whose query string names one. The app's file sink runs every line through
//! [`redact`]; core's own voice events use it before the message reaches any sink, so a rig that
//! only prints to stderr keeps the same guarantee.
//!
//! This is defence in depth, not the only rule: the places that log never put message text, a
//! token or a full server address in a line in the first place.

/// Keys whose value is a secret, compared without case and at a word boundary.
const SECRET_KEYS: [&str; 5] = [
    "access_token",
    "refresh_token",
    "password",
    "secret",
    "token",
];

/// URL schemes whose query string is dropped whole: even a harmless-looking one could name a
/// token, and a report never needs it.
const URL_SCHEMES: [&str; 4] = ["https://", "http://", "wss://", "ws://"];

/// The invite link's path segment that carries the code.
const INVITE_PATH: &str = "semaphore://join/";

/// `text` with secrets replaced by `<redacted>`. Copies unchanged text as it was.
pub fn redact(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if !might_hold_a_secret(&lower) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        if let Some((replacement, consumed)) = url_with_query(text, &lower, at)
            .or_else(|| invite_code(text, &lower, at))
            .or_else(|| bearer_token(text, &lower, at))
            .or_else(|| secret_value(text, &lower, at))
        {
            out.push_str(&replacement);
            at += consumed;
        } else {
            let ch = text[at..].chars().next().expect("at < len");
            out.push(ch);
            at += ch.len_utf8();
        }
    }
    out
}

fn might_hold_a_secret(lower: &str) -> bool {
    lower.contains("token")
        || lower.contains("password")
        || lower.contains("secret")
        || lower.contains("bearer")
        || lower.contains(INVITE_PATH)
        || lower.contains("://")
}

/// A URL token whose query string becomes `?<redacted>`. The whole token is consumed, query and
/// fragment included: a report never needs them.
fn url_with_query(text: &str, lower: &str, at: usize) -> Option<(String, usize)> {
    if !URL_SCHEMES
        .iter()
        .any(|scheme| lower[at..].starts_with(scheme))
    {
        return None;
    }
    let rest = &text[at..];
    let end = rest.find(is_url_end).unwrap_or(rest.len());
    let token = &rest[..end];
    let query = token.find('?')?;
    let mut replacement = String::with_capacity(query + 12);
    replacement.push_str(&token[..query]);
    replacement.push_str("?<redacted>");
    Some((replacement, end))
}

fn is_url_end(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '"' | '\'' | '<' | '>' | ')' | ']' | '}')
}

/// `semaphore://join/<code>` with the code, and any query after it, dropped.
fn invite_code(text: &str, lower: &str, at: usize) -> Option<(String, usize)> {
    if !lower[at..].starts_with(INVITE_PATH) {
        return None;
    }
    let rest = &text[at..];
    let end = rest
        .find(|ch: char| is_url_end(ch) || ch == ',')
        .unwrap_or(rest.len());
    let mut replacement = String::from(&text[at..at + INVITE_PATH.len()]);
    replacement.push_str("<redacted>");
    Some((replacement, end))
}

/// `Bearer <token>`, whatever case and however much space.
fn bearer_token(text: &str, lower: &str, at: usize) -> Option<(String, usize)> {
    if !lower[at..].starts_with("bearer") || !at_boundary(text, at) {
        return None;
    }
    let after = at + "bearer".len();
    let start = after + skip_space(&text[after..]);
    let end = unquoted_value_end(text, start);
    if end == start {
        return None;
    }
    let mut replacement = String::from(&text[at..start]);
    replacement.push_str("<redacted>");
    Some((replacement, end - at))
}

/// `key=value`, `key: value` or `"key":"value"`: the value replaced for a sensitive key.
fn secret_value(text: &str, lower: &str, at: usize) -> Option<(String, usize)> {
    let key = SECRET_KEYS
        .iter()
        .find(|key| lower[at..].starts_with(**key))?;
    if !at_boundary(text, at) {
        return None;
    }
    let after = at + key.len();
    let bytes = &text.as_bytes()[after..];
    let mut i = skip_space(&text[after..]);
    if matches!(bytes.get(i), Some(b'"' | b'\'')) {
        i += 1;
        i += skip_space(&text[after + i..]);
    }
    if !matches!(bytes.get(i), Some(b'=' | b':')) {
        return None;
    }
    i += 1;
    i += skip_space(&text[after + i..]);
    let quoted = matches!(bytes.get(i), Some(b'"' | b'\''));
    if quoted {
        i += 1;
    }
    let value_start = after + i;
    let (after_value, closing) = if quoted {
        match text[value_start..].find(['"', '\'']) {
            Some(len) => (
                value_start + len + 1,
                Some(text.as_bytes()[value_start + len] as char),
            ),
            None => (text.len(), None),
        }
    } else {
        (unquoted_value_end(text, value_start), None)
    };
    let mut replacement = String::from(&text[at..value_start]);
    replacement.push_str("<redacted>");
    if let Some(quote) = closing {
        replacement.push(quote);
    }
    Some((replacement, after_value.min(text.len()) - at))
}

/// Where an unquoted or quoted value ends, from `start`.
fn unquoted_value_end(text: &str, start: usize) -> usize {
    let mut i = start;
    while i < text.len() {
        let ch = text[i..].chars().next().expect("i < len");
        if ch.is_whitespace() || matches!(ch, '&' | ',' | ';' | '"' | '\'' | ')' | ']' | '}') {
            break;
        }
        i += ch.len_utf8();
    }
    i
}

fn skip_space(text: &str) -> usize {
    text.bytes()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count()
}

/// A key only counts as a key at the start of a word: `access_token` is not the key `token`.
fn at_boundary(text: &str, at: usize) -> bool {
    match text[..at].chars().next_back() {
        None => true,
        Some(ch) => !(ch.is_ascii_alphanumeric() || ch == '_'),
    }
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn ordinary_text_is_left_alone() {
        for text in [
            "token refresh failed: the server said no",
            "the password screen was shown",
            "GET https://chat.example.org/api/health returned 200",
            "the join took 812 ms",
        ] {
            assert_eq!(redact(text), text, "{text}");
        }
    }

    #[test]
    fn a_urls_query_string_is_dropped_whole() {
        assert_eq!(
            redact("GET https://chat.example.org/api?access_token=at-1&refresh_token=rt-1 failed"),
            "GET https://chat.example.org/api?<redacted> failed"
        );
        assert_eq!(
            redact("wss://livekit.example.org/rtc?access_token=at-1"),
            "wss://livekit.example.org/rtc?<redacted>"
        );
    }

    #[test]
    fn a_secret_value_is_replaced_in_every_spelling() {
        for (input, expected) in [
            (
                "request LoginRequest { password: \"pw-hunter2\" }",
                "request LoginRequest { password: \"<redacted>\" }",
            ),
            (
                r#"{"refresh_token":"rt-secret","user":"me"}"#,
                r#"{"refresh_token":"<redacted>","user":"me"}"#,
            ),
            (
                "access_token=at-secret&next=1",
                "access_token=<redacted>&next=1",
            ),
            ("secret: s3cr3t, again", "secret: <redacted>, again"),
        ] {
            assert_eq!(redact(input), expected, "{input}");
        }
    }

    #[test]
    fn bearer_tokens_go() {
        assert_eq!(
            redact("Authorization: Bearer at-secret-9f3c (expired)"),
            "Authorization: Bearer <redacted> (expired)"
        );
    }

    #[test]
    fn invite_codes_go() {
        assert_eq!(
            redact("opened semaphore://join/abc123?x=1"),
            "opened semaphore://join/<redacted>"
        );
        assert_eq!(
            redact("opened semaphore://join/abc123, then joined"),
            "opened semaphore://join/<redacted>, then joined"
        );
    }

    #[test]
    fn a_token_inside_a_longer_word_is_not_a_key() {
        assert_eq!(
            redact("the tokens field is empty"),
            "the tokens field is empty"
        );
    }
}
