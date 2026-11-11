//! PKCE (RFC 7636, S256) and the loopback callback check for sign in with browser.
//!
//! Every secret here is a [`Secret`]: its `Debug` hides it, so a stray `{:?}` can't log it.

use crate::platform::LoopbackRequest;
use sha2::{Digest, Sha256};

/// A string that mustn't reach logs, `Debug` output or events.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Secret(String);

impl Secret {
    #[cfg(test)]
    pub(crate) fn new(value: String) -> Self {
        Self(value)
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("<secret>")
    }
}

/// base64url without padding.
pub(crate) fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        let digits = chunk.len() + 1;
        for index in 0..digits {
            out.push(ALPHABET[((n >> (18 - 6 * index)) & 63) as usize] as char);
        }
    }
    out
}

/// 32 bytes from the OS's random source, as 43 base64url characters.
pub(crate) fn random_token() -> Result<Secret, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("no random source: {error}"))?;
    Ok(Secret(base64url(&bytes)))
}

/// The S256 challenge of a verifier: base64url(SHA-256(verifier)).
pub(crate) fn challenge(verifier: &Secret) -> String {
    base64url(&Sha256::digest(verifier.0.as_bytes()))
}

/// Equal, in time that doesn't depend on where they differ.
pub(crate) fn same_secret(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

/// A sign-in code as the server mints them: 43 base64url characters.
fn code_shaped(code: &str) -> bool {
    code.len() == 43
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// What one request to the listener is.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Callback {
    /// The browser came back with a code.
    Code(Secret),
    /// The user pressed Cancel on the browser's confirm page.
    Denied,
    /// Anything else: wrong method, Host, path or `state`, or a code of the wrong shape. The
    /// attempt keeps waiting.
    Bad,
}

/// Checks a request against the attempt it reached: only `GET /callback` on exactly
/// `127.0.0.1:<port>` (so a DNS-rebound page can't reach it), with the attempt's `state`, each
/// parameter once.
pub(crate) fn check_callback(request: &LoopbackRequest, port: u16, state: &Secret) -> Callback {
    if request.method != "GET" || request.host.as_deref() != Some(&format!("127.0.0.1:{port}")) {
        return Callback::Bad;
    }
    let (path, query) = request
        .target
        .split_once('?')
        .unwrap_or((request.target.as_str(), ""));
    if path != "/callback" || query.contains('#') {
        return Callback::Bad;
    }
    let mut given_state = None;
    let mut code = None;
    let mut error = None;
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        let slot = match name {
            "state" => &mut given_state,
            "code" => &mut code,
            "error" => &mut error,
            _ => continue,
        };
        if slot.replace(value).is_some() {
            return Callback::Bad;
        }
    }
    if !given_state.is_some_and(|given| same_secret(given, state.expose())) {
        return Callback::Bad;
    }
    match (error, code) {
        (Some("access_denied"), None) => Callback::Denied,
        (None, Some(code)) if code_shaped(code) => Callback::Code(Secret(code.to_owned())),
        _ => Callback::Bad,
    }
}

/// The instance's sign-in page for an attempt. The web app routes in the fragment, which the
/// browser never sends to the server, so the challenge and `state` stay out of its logs.
pub(crate) fn sign_in_url(server_url: &str, challenge: &str, state: &Secret, port: u16) -> String {
    format!(
        "{}/#/desktop-login?challenge={challenge}&state={}&port={port}",
        server_url.trim_end_matches('/'),
        state.expose()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, host: Option<&str>, target: &str) -> LoopbackRequest {
        LoopbackRequest {
            id: 1,
            method: method.into(),
            host: host.map(Into::into),
            target: target.into(),
        }
    }

    const STATE: &str = "s7ateS7ateS7ateS7ateS7ateS7ateS7ateS7ate123";
    const CODE: &str = "c0deC0deC0deC0deC0deC0deC0deC0deC0deC0de_-x";

    #[test]
    fn rfc_7636_appendix_b() {
        let verifier = Secret::new("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        assert_eq!(
            challenge(&verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn base64url_pads_nothing() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn random_tokens_are_43_characters_and_differ() {
        let a = random_token().unwrap();
        let b = random_token().unwrap();
        assert_eq!(a.expose().len(), 43);
        assert_ne!(a, b);
        assert_eq!(format!("{a:?}"), "<secret>");
    }

    #[test]
    fn only_the_callback_with_the_attempts_state_counts() {
        let state = Secret::new(STATE.into());
        let host = Some("127.0.0.1:4100");
        let good = format!("/callback?code={CODE}&state={STATE}");
        assert_eq!(
            check_callback(&request("GET", host, &good), 4100, &state),
            Callback::Code(Secret::new(CODE.into()))
        );
        let denied = format!("/callback?error=access_denied&state={STATE}");
        assert_eq!(
            check_callback(&request("GET", host, &denied), 4100, &state),
            Callback::Denied
        );
        let bad = [
            request("POST", host, &good),
            request("GET", None, &good),
            request("GET", Some("localhost:4100"), &good),
            request("GET", Some("127.0.0.1:4101"), &good),
            request("GET", Some("evil.example:4100"), &good),
            request("GET", host, &good.replace("/callback", "/")),
            request("GET", host, &good.replace("/callback", "/callback/")),
            request("GET", host, "/favicon.ico"),
            request("GET", host, &format!("/callback?code={CODE}")),
            request("GET", host, &format!("/callback?code={CODE}&state=x")),
            request(
                "GET",
                host,
                &format!("/callback?code={CODE}&state={}", &STATE[..42]),
            ),
            request("GET", host, &format!("/callback?code=short&state={STATE}")),
            request(
                "GET",
                host,
                &format!("/callback?code={CODE}&code={CODE}&state={STATE}"),
            ),
            request(
                "GET",
                host,
                &format!("/callback?code={CODE}&state={STATE}&state={STATE}"),
            ),
            request(
                "GET",
                host,
                &format!("/callback?code={CODE}&error=access_denied&state={STATE}"),
            ),
            request("GET", host, &format!("/callback?error=other&state={STATE}")),
            request(
                "GET",
                host,
                &format!("/callback?code={}&state={STATE}", "%41".repeat(15)),
            ),
        ];
        for request in bad {
            assert_eq!(
                check_callback(&request, 4100, &state),
                Callback::Bad,
                "{request:?}"
            );
        }
    }

    #[test]
    fn debug_shows_no_secret() {
        let target = format!("/callback?code={CODE}&state={STATE}");
        let shown = format!("{:?}", request("GET", Some("127.0.0.1:1"), &target));
        assert!(!shown.contains(CODE) && !shown.contains(STATE), "{shown}");
        assert!(shown.contains("/callback"));
        let shown = format!("{:?}", Callback::Code(Secret::new(CODE.into())));
        assert!(!shown.contains(CODE));
    }

    #[test]
    fn the_url_carries_the_challenge_state_and_port_in_the_fragment() {
        let state = Secret::new(STATE.into());
        assert_eq!(
            sign_in_url("https://chat.example/", "CH", &state, 4100),
            format!("https://chat.example/#/desktop-login?challenge=CH&state={STATE}&port=4100")
        );
    }
}
