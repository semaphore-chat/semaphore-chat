//! Making text safe for a log line.
//!
//! A log a user may attach to a report must not carry an access or refresh token, a password, an
//! invite code, a sign-in `code`/`state` or a URL whose query string names one. The app's file
//! sink runs every line through [`redact`]; core's own voice events use it before the message
//! reaches any sink, so a rig that only prints to stderr keeps the same guarantee.
//!
//! What it finds, in one pass that never looks at a byte more than a fixed number of times:
//!
//! - `key=value`, `key: value`, `"key":"value"`, escaped JSON (`\"key\":\"value\"`) and Debug's
//!   `key: Some("value")`, for any key whose name, compared without case and without `_`/`-`, ends
//!   in `token`, `password`, `passwd`, `secret`, `apikey` or `verifier` (`accessToken`,
//!   `refresh_token`, `newPassword`, `code_verifier`, `activation_token`, ...). `code` and `state`
//!   (the browser sign-in's) count only with `=` or a quoted value, so Debug's `state: Connected`
//!   and `code: 502` stay readable.
//! - `Bearer <token>`, and a bare JWT (three base64url segments, the first starting `eyJ`).
//! - A URL's query and fragment (`https`, `http`, `wss`, `ws`, `semaphore`), and an invite link's
//!   code.
//!
//! Input past [`MAX_INPUT`] bytes is cut first, with a `…(truncated)` marker: a log line never
//! needs more, and it bounds the work on hostile text.
//!
//! This is defence in depth, not the only rule: the places that log never put message text, a
//! token or a full server address in a line in the first place.

/// The longest text redacted; the rest is dropped and marked.
pub const MAX_INPUT: usize = 8 * 1024;

/// What replaces the dropped tail of an over-long text.
pub const TRUNCATED: &str = "…(truncated)";

const REDACTED: &str = "<redacted>";

/// URL schemes whose query string and fragment are dropped whole: even a harmless-looking one
/// could name a token, and a report never needs it.
const URL_SCHEMES: [&str; 5] = ["https://", "http://", "wss://", "ws://", "semaphore://"];

/// The invite link's path segment that carries the code.
const INVITE_PATH: &str = "semaphore://join/";

/// Normalised key endings (lowercase, no `_` or `-`) whose value is always a secret.
const SECRET_SUFFIXES: [&str; 6] = [
    "token", "password", "passwd", "secret", "apikey", "verifier",
];

/// Normalised keys whose value is a secret when written `key=value` or with a quoted value.
const WEAK_KEYS: [&str; 2] = ["code", "state"];

/// A key longer than this is not one of ours.
const MAX_KEY: usize = 64;

/// `text` with secrets replaced by `<redacted>`, cut at [`MAX_INPUT`] bytes. Copies unchanged
/// text as it was.
pub fn redact(text: &str) -> String {
    let (text, truncated) = capped(text);
    let mut out = redact_all(text).0;
    if truncated {
        out.push_str(TRUNCATED);
    }
    out
}

/// `text` cut to at most [`MAX_INPUT`] bytes at a character boundary, and whether it was cut.
fn capped(text: &str) -> (&str, bool) {
    if text.len() <= MAX_INPUT {
        return (text, false);
    }
    let mut end = MAX_INPUT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

/// The redacted text, uncapped, and how many byte inspections it took (for the linear-time test).
fn redact_all(text: &str) -> (String, usize) {
    let lower = text.to_ascii_lowercase();
    if !might_hold_a_secret(&lower) {
        return (text.to_owned(), lower.len());
    }
    Redactor {
        text,
        lower: &lower,
        bytes: text.as_bytes(),
        work: 0,
        no_query_until: 0,
    }
    .run()
}

fn might_hold_a_secret(lower: &str) -> bool {
    [
        "token", "password", "passwd", "secret", "apikey", "api_key", "api-key", "verifier",
        "bearer", "code", "state", "eyj", "://",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

struct Redactor<'a> {
    text: &'a str,
    /// `text` in ASCII lowercase: the same byte offsets.
    lower: &'a str,
    bytes: &'a [u8],
    /// Bytes inspected so far, every scan included.
    work: usize,
    /// The end of a URL already found to have no query: a scheme inside it isn't scanned again.
    no_query_until: usize,
}

type Hit = Option<(String, usize)>;

impl Redactor<'_> {
    fn run(mut self) -> (String, usize) {
        let mut out = String::with_capacity(self.text.len());
        let mut at = 0;
        while at < self.text.len() {
            self.work += 1;
            let hit = self
                .invite_code(at)
                .or_else(|| self.url(at))
                .or_else(|| self.bearer_token(at))
                .or_else(|| self.jwt(at))
                .or_else(|| self.secret_value(at));
            if let Some((replacement, consumed)) = hit {
                out.push_str(&replacement);
                at += consumed;
            } else {
                let ch = self.text[at..].chars().next().expect("at < len");
                out.push(ch);
                at += ch.len_utf8();
            }
        }
        (out, self.work)
    }

    /// The first index from `from` where `keep` stops holding.
    fn scan(&mut self, from: usize, keep: impl Fn(u8) -> bool) -> usize {
        let mut end = from;
        while end < self.bytes.len() && keep(self.bytes[end]) {
            end += 1;
        }
        self.work += end - from + 1;
        end
    }

    fn skip_space(&mut self, from: usize) -> usize {
        self.scan(from, |byte| matches!(byte, b' ' | b'\t'))
    }

    fn at_word_start(&self, at: usize) -> bool {
        at == 0 || !is_word_byte(self.bytes[at - 1])
    }

    /// `semaphore://join/<code>` with the code, and any query after it, dropped.
    fn invite_code(&mut self, at: usize) -> Hit {
        if !self.lower[at..].starts_with(INVITE_PATH) {
            return None;
        }
        let end = self.scan(at, |byte| !is_url_end(byte) && byte != b',');
        let mut replacement = String::from(&self.text[at..at + INVITE_PATH.len()]);
        replacement.push_str(REDACTED);
        Some((replacement, end - at))
    }

    /// A URL whose query (or fragment) becomes `?<redacted>` (`#<redacted>`). The whole URL is
    /// consumed then. A URL with neither is remembered, so a scheme inside it costs nothing more.
    fn url(&mut self, at: usize) -> Hit {
        if at < self.no_query_until
            || !URL_SCHEMES
                .iter()
                .any(|scheme| self.lower[at..].starts_with(scheme))
        {
            return None;
        }
        let end = self.scan(at, |byte| !is_url_end(byte));
        let token = &self.text[at..end];
        let Some(query) = token.find(['?', '#']) else {
            self.no_query_until = end;
            return None;
        };
        let mut replacement = String::with_capacity(query + REDACTED.len() + 1);
        replacement.push_str(&token[..=query]);
        replacement.push_str(REDACTED);
        Some((replacement, end - at))
    }

    /// `Bearer <token>`, whatever case and however much space.
    fn bearer_token(&mut self, at: usize) -> Hit {
        if !self.lower[at..].starts_with("bearer") || !self.at_word_start(at) {
            return None;
        }
        let after = at + "bearer".len();
        if self.bytes.get(after).copied().is_some_and(is_word_byte) {
            return None;
        }
        let start = self.skip_space(after);
        let end = self.scan(start, |byte| !is_value_end(byte));
        if end == start {
            return None;
        }
        let mut replacement = String::from(&self.text[at..start]);
        replacement.push_str(REDACTED);
        Some((replacement, end - at))
    }

    /// A bare JWT: `eyJ<base64url>.<base64url>.<base64url>`.
    fn jwt(&mut self, at: usize) -> Hit {
        if !self.text[at..].starts_with("eyJ")
            || (at > 0 && (is_base64url(self.bytes[at - 1]) || self.bytes[at - 1] == b'.'))
        {
            return None;
        }
        let first = self.scan(at, is_base64url);
        if self.bytes.get(first) != Some(&b'.') {
            return None;
        }
        let second = self.scan(first + 1, is_base64url);
        if second == first + 1 || self.bytes.get(second) != Some(&b'.') {
            return None;
        }
        let third = self.scan(second + 1, is_base64url);
        if third == second + 1 {
            return None;
        }
        Some((REDACTED.to_owned(), third - at))
    }

    /// `key=value`, `key: value`, `"key":"value"`, `\"key\":\"value\"` or `key: Some("value")`:
    /// the value replaced for a sensitive key.
    fn secret_value(&mut self, at: usize) -> Hit {
        if !self.bytes[at].is_ascii_alphabetic() || !self.at_word_start(at) {
            return None;
        }
        let key_end = self.scan(at, is_word_byte);
        let weak = match key_kind(&self.lower[at..key_end])? {
            KeyKind::Secret => false,
            KeyKind::Weak => true,
        };
        let mut i = self.skip_space(key_end);
        if self.text[i..].starts_with("\\\"") {
            i += 2;
        } else if matches!(self.bytes.get(i), Some(b'"' | b'\'')) {
            i += 1;
        }
        i = self.skip_space(i);
        let separator = *self.bytes.get(i)?;
        if !matches!(separator, b'=' | b':') || self.bytes.get(i + 1) == Some(&separator) {
            // Not a separator, or `::` (a Rust path) / `==`.
            return None;
        }
        i = self.skip_space(i + 1);
        if self.text[i..].starts_with("Some(") {
            i += "Some(".len();
        }
        let (value_start, value_end, closing, after) = if self.text[i..].starts_with("\\\"") {
            self.quoted(i + 2, true)
        } else if self.bytes.get(i) == Some(&b'"') {
            self.quoted(i + 1, false)
        } else if self.bytes.get(i) == Some(&b'\'') {
            let end = self.scan(i + 1, |byte| byte != b'\'');
            if end < self.bytes.len() {
                (i + 1, end, "'", end + 1)
            } else {
                (i + 1, end, "", end)
            }
        } else {
            if weak && separator == b':' {
                // `state: Connected`: a Debug enum, not a sign-in secret.
                return None;
            }
            let end = self.scan(i, |byte| !is_value_end(byte));
            (i, end, "", end)
        };
        if value_end == value_start && after == value_start {
            // An empty unquoted value, or an opening quote at the very end: nothing to hide.
            return None;
        }
        let mut replacement = String::from(&self.text[at..value_start]);
        replacement.push_str(REDACTED);
        replacement.push_str(closing);
        Some((replacement, after - at))
    }

    /// A quoted value from `start` (just past its opening quote): where it ends, the closing quote
    /// as written, and where the text continues. `escaped`: the value is inside a JSON string
    /// itself (`\"...\"`), so its closing quote is `\"` and a quote in it is `\\\"`. An unclosed
    /// value runs to the end of the text.
    fn quoted(&mut self, start: usize, escaped: bool) -> (usize, usize, &'static str, usize) {
        let mut backslashes = 0usize;
        let mut i = start;
        while i < self.bytes.len() {
            self.work += 1;
            match self.bytes[i] {
                b'\\' => backslashes += 1,
                b'"' => {
                    if escaped && backslashes % 4 == 1 {
                        return (start, i - 1, "\\\"", i + 1);
                    }
                    if backslashes.is_multiple_of(2) {
                        return (start, i, "\"", i + 1);
                    }
                    backslashes = 0;
                }
                _ => backslashes = 0,
            }
            i += 1;
        }
        (start, self.bytes.len(), "", self.bytes.len())
    }
}

enum KeyKind {
    Secret,
    Weak,
}

/// Whether a key (in lowercase) names a secret: compared without `_` and `-`.
fn key_kind(lower_key: &str) -> Option<KeyKind> {
    if lower_key.len() > MAX_KEY {
        return None;
    }
    let normal: String = lower_key
        .chars()
        .filter(|ch| !matches!(ch, '_' | '-'))
        .collect();
    if SECRET_SUFFIXES
        .iter()
        .any(|suffix| normal.ends_with(suffix))
    {
        Some(KeyKind::Secret)
    } else if WEAK_KEYS.contains(&normal.as_str()) {
        Some(KeyKind::Weak)
    } else {
        None
    }
}

/// A byte of a key: `accessToken`, `refresh_token`, `x-api-key`.
fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
}

fn is_base64url(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
}

fn is_url_end(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'"' | b'\'' | b'<' | b'>' | b')' | b']' | b'}')
}

/// Where an unquoted value ends.
fn is_value_end(byte: u8) -> bool {
    byte.is_ascii_whitespace()
        || matches!(
            byte,
            b'&' | b',' | b';' | b'"' | b'\'' | b')' | b']' | b'}' | b'\\'
        )
}

#[cfg(test)]
mod tests {
    use super::{MAX_INPUT, TRUNCATED, redact, redact_all};

    #[test]
    fn ordinary_text_is_left_alone() {
        for text in [
            "token refresh failed: the server said no",
            "the password screen was shown",
            "GET https://chat.example.org/api/health returned 200",
            "the join took 812 ms",
            "VoiceView { state: Connected, code: 502 }",
            "ApiError { status: 401, code: Unknown(\"UNKNOWN\"), retryable: false }",
            "use semaphore_core::token::refresh",
            "the tokens field is empty",
            "password_reset: true, browser_sign_in: false",
            "eyJ is how a JWT starts",
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
        assert_eq!(
            redact("opened https://chat.example.org/#/reset-password?token=abc123"),
            "opened https://chat.example.org/#<redacted>"
        );
        assert_eq!(
            redact("semaphore://reset-password?token=abc123"),
            "semaphore://reset-password?<redacted>"
        );
    }

    /// The backend's real shapes (camelCase DTOs, snake_case cookies, the browser sign-in's
    /// authorize redirect), as a body, a Debug, an escaped body and a header would put them in a
    /// line. Every secret is distinct, so a leak names its row.
    #[test]
    fn the_backends_secrets_go_in_every_spelling() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.c2lnbmF0dXJlLXZhbHVl";
        let rows: [(&str, &str, &[&str]); 21] = [
            // POST /api/auth/login, /refresh, /register: `AuthResponseDto`.
            (
                r#"{"accessToken":"at-c1","refreshToken":"rt-c1","expiresAt":"2026-11-13"}"#,
                r#"{"accessToken":"<redacted>","refreshToken":"<redacted>","expiresAt":"2026-11-13"}"#,
                &["at-c1", "rt-c1"],
            ),
            (
                r#"{"access_token": "at-s1", "refresh_token": "rt-s1"}"#,
                r#"{"access_token": "<redacted>", "refresh_token": "<redacted>"}"#,
                &["at-s1", "rt-s1"],
            ),
            // The same body as a string inside JSON (a body logged by another JSON layer).
            (
                r#"body: "{\"accessToken\":\"at-e1\",\"refreshToken\":\"rt-e1\",\"user\":\"me\"}""#,
                r#"body: "{\"accessToken\":\"<redacted>\",\"refreshToken\":\"<redacted>\",\"user\":\"me\"}""#,
                &["at-e1", "rt-e1"],
            ),
            (
                r#"{\"refresh_token\":\"rt-e2\"}"#,
                r#"{\"refresh_token\":\"<redacted>\"}"#,
                &["rt-e2"],
            ),
            // An escaped quote inside an escaped value doesn't end it early.
            (
                r#"{\"password\":\"pw-\\\"q-e3\"}"#,
                r#"{\"password\":\"<redacted>\"}"#,
                &["pw-", "q-e3"],
            ),
            // `ResetPasswordRequestDto`, `ChangePasswordDto`, `LoginRequestDto` as Debug.
            (
                "ResetPasswordRequestDto { token: \"tok-d1\", new_password: \"pw-d1\" }",
                "ResetPasswordRequestDto { token: \"<redacted>\", new_password: \"<redacted>\" }",
                &["tok-d1", "pw-d1"],
            ),
            (
                r#"{"newPassword":"pw-c2","currentPassword":"pw-c3"}"#,
                r#"{"newPassword":"<redacted>","currentPassword":"<redacted>"}"#,
                &["pw-c2", "pw-c3"],
            ),
            (
                "LoginRequest { username: \"ava\", password: \"pw-d2\" }",
                "LoginRequest { username: \"ava\", password: \"<redacted>\" }",
                &["pw-d2"],
            ),
            // Option fields.
            (
                "Session { refresh_token: Some(\"rt-o1\"), access_token: Some(at-o1) }",
                "Session { refresh_token: Some(\"<redacted>\"), access_token: Some(<redacted>) }",
                &["rt-o1", "at-o1"],
            ),
            // The browser sign-in: authorize redirect, callback target, token exchange body.
            (
                "/callback?code=code-b1&state=state-b1",
                "/callback?code=<redacted>&state=<redacted>",
                &["code-b1", "state-b1"],
            ),
            (
                r#"{"code":"code-b2","codeVerifier":"ver-b2","state":"state-b2"}"#,
                r#"{"code":"<redacted>","codeVerifier":"<redacted>","state":"<redacted>"}"#,
                &["code-b2", "ver-b2", "state-b2"],
            ),
            (
                "TokenExchange { code: Some(\"code-b3\"), code_verifier: \"ver-b3\" }",
                "TokenExchange { code: Some(\"<redacted>\"), code_verifier: \"<redacted>\" }",
                &["code-b3", "ver-b3"],
            ),
            // Cookies and headers.
            (
                "set-cookie: refresh_token=rt-k1; Path=/api/auth; HttpOnly",
                "set-cookie: refresh_token=<redacted>; Path=/api/auth; HttpOnly",
                &["rt-k1"],
            ),
            (
                "Authorization: Bearer at-h1 (expired)",
                "Authorization: Bearer <redacted> (expired)",
                &["at-h1"],
            ),
            ("X-Api-Key: key-h2", "X-Api-Key: <redacted>", &["key-h2"]),
            // Other tokens: activation, LiveKit, invites, a single-quoted value.
            (
                "activation_token=act-1&next=/",
                "activation_token=<redacted>&next=/",
                &["act-1"],
            ),
            (
                r#"{"token":"lk-1","url":"wss://lk.example.org"}"#,
                r#"{"token":"<redacted>","url":"wss://lk.example.org"}"#,
                &["lk-1"],
            ),
            (
                "opened semaphore://join/inv-1?x=1, then semaphore://join/inv-2",
                "opened semaphore://join/<redacted>, then semaphore://join/<redacted>",
                &["inv-1", "inv-2"],
            ),
            (
                "secret: 's3-1' again",
                "secret: '<redacted>' again",
                &["s3-1"],
            ),
            // A value that never closes runs to the end.
            (
                r#"{"refreshToken":"rt-u1"#,
                r#"{"refreshToken":"<redacted>"#,
                &["rt-u1"],
            ),
            // `x-access-token`, `ACCESS-TOKEN`: case and dashes don't matter.
            (
                "ACCESS-TOKEN=at-x1 x-access-token: at-x2",
                "ACCESS-TOKEN=<redacted> x-access-token: <redacted>",
                &["at-x1", "at-x2"],
            ),
        ];
        for (input, expected, secrets) in rows {
            let output = redact(input);
            assert_eq!(output, expected, "{input}");
            for secret in secrets {
                assert!(!output.contains(secret), "{secret} survived in {output}");
            }
        }
        // A bare JWT, anywhere: a key it isn't under, a Debug, a sentence.
        for (input, expected) in [
            (
                format!("jwt {jwt} expired"),
                "jwt <redacted> expired".to_owned(),
            ),
            (
                format!("Claims(\"{jwt}\")"),
                "Claims(\"<redacted>\")".to_owned(),
            ),
            (
                format!("authorization={jwt}"),
                "authorization=<redacted>".to_owned(),
            ),
        ] {
            assert_eq!(redact(&input), expected, "{input}");
        }
    }

    #[test]
    fn a_token_inside_a_longer_word_is_not_a_key() {
        assert_eq!(
            redact("the tokens field is empty"),
            "the tokens field is empty"
        );
        assert_eq!(redact("barcode=1234"), "barcode=1234");
        assert_eq!(redact("statement=ok"), "statement=ok");
    }

    #[test]
    fn long_text_is_cut_with_a_marker_and_never_splits_a_character() {
        let long = "é".repeat(MAX_INPUT);
        let out = redact(&long);
        assert!(out.ends_with(TRUNCATED), "{}", &out[out.len() - 20..]);
        assert!(out.len() <= MAX_INPUT + TRUNCATED.len());
        // A secret cut in its value is still redacted to the cut.
        let cut = format!(
            "{} refresh_token=\"{}",
            "x".repeat(MAX_INPUT - 20),
            "r".repeat(100)
        );
        let out = redact(&cut);
        assert!(!out.contains("rrr"), "{}", &out[out.len() - 60..]);
        assert_eq!(redact("short"), "short");
    }

    /// The work (bytes inspected, every scan counted) stays within a constant factor of the input's
    /// size for the inputs that made the old redactor quadratic, and for others built to make each
    /// rule scan and fail. A quadratic redactor needs millions of steps on these 64 KiB inputs.
    #[test]
    fn hostile_input_takes_linear_work() {
        const SIZE: usize = 64 * 1024;
        let jwt_ish = "eyJa.eyJb ";
        let patterns = [
            "http://",
            "http://a",
            "https://x/eyJa.b",
            "token ",
            "token\"",
            "token=",
            "state: ",
            "\"password\":\"\\\\",
            "bearer ",
            jwt_ish,
            "eyJ.",
            "semaphore://",
            "a_b-c_d-e_f-",
            "\\\"",
        ];
        for pattern in patterns {
            let input = pattern.repeat(SIZE / pattern.len() + 1);
            let (_, work) = redact_all(&input);
            assert!(
                work <= 16 * input.len(),
                "{pattern:?}: {work} steps for {} bytes",
                input.len()
            );
        }
        // One long run with no delimiter: a single URL, a single key, spaces after a key.
        for input in [
            format!("http://{}", "a".repeat(SIZE)),
            format!("token{}", " ".repeat(SIZE)),
            format!("{}=x", "a".repeat(SIZE)),
        ] {
            let (_, work) = redact_all(&input);
            assert!(work <= 16 * input.len(), "{work} steps");
        }
        // And whatever the input, redact() never looks past MAX_INPUT bytes of it.
        let huge = "http://".repeat(1 << 20);
        let out = redact(&huge);
        assert!(out.len() <= MAX_INPUT + TRUNCATED.len());
    }
}
