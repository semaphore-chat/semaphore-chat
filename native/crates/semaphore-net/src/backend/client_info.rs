//! Who this install says it is: [`ClientInfo`], and the rules that keep its values valid on the wire.

use std::fmt;

use super::{DESKTOP_DEVICE_NAME, DESKTOP_USER_AGENT};

/// What the sessions list shows when a mobile host gives no usable device name.
const MOBILE_FALLBACK_NAME: &str = "Semaphore Mobile";

/// The most characters `X-Device-Name` may carry. The generated header type
/// (`AuthControllerLoginXDeviceName`) checks it on the percent-encoded string, which is ASCII, so
/// it bounds the encoded length, and with it the decoded name (one character is at least one
/// encoded byte).
const MAX_DEVICE_NAME_LEN: usize = 64;

/// Which native client this process is.
///
/// The server tells them apart (`backend/src/auth/client-type.util.ts`): both are native, both
/// get their refresh token in the response body, and both must send `X-Device-Id` and a
/// `User-Agent`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientKind {
    /// The desktop app.
    DesktopNative,
    /// An Android (or later iOS) app.
    MobileNative,
}

impl ClientKind {
    /// The `X-Client-Type` value, the same string as the contract's `*XClientType` variants.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DesktopNative => "desktop-native",
            Self::MobileNative => "mobile-native",
        }
    }
}

/// Why a [`ClientInfo`] could not be built.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClientInfoError {
    /// The user agent is empty, or has a byte outside visible ASCII (0x20 to 0x7E). The server
    /// refuses a native sign-in without a usable one.
    InvalidUserAgent,
}

impl fmt::Display for ClientInfoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUserAgent => {
                f.write_str("the user agent must be non-empty visible ASCII (0x20 to 0x7E)")
            }
        }
    }
}

impl std::error::Error for ClientInfoError {}

/// Who this install says it is, as the server reads it.
///
/// The host builds it once and passes it to [`HttpBackend::new`](super::HttpBackend::new):
/// [`desktop`](Self::desktop) is exactly what the desktop app sent before it could choose, and
/// [`mobile`](Self::mobile) checks what a mobile app supplies. The fields are private so every
/// value that reaches the wire went through those two.
#[derive(Clone, Debug)]
pub struct ClientInfo {
    kind: ClientKind,
    user_agent: String,
    device_name: String,
}

impl ClientInfo {
    /// The desktop app's identity, unchanged from the one it sent before the host chose it.
    pub fn desktop() -> Self {
        Self {
            kind: ClientKind::DesktopNative,
            user_agent: DESKTOP_USER_AGENT.to_owned(),
            device_name: DESKTOP_DEVICE_NAME.to_owned(),
        }
    }

    /// A mobile app's identity: its user agent, and the name it shows in the sessions list.
    ///
    /// `user_agent` must be non-empty visible ASCII, or this returns
    /// [`ClientInfoError::InvalidUserAgent`].
    ///
    /// `device_name` is plain text, in any script. It is normalised here, the one place that
    /// knows the contract: control characters are dropped, the ends trimmed, and the name cut on a
    /// character boundary so that its percent-encoded form (what `X-Device-Name` carries, and
    /// what the backend reverses with `decodeURIComponent`) fits the 64 characters the contract
    /// allows. Nothing is left out for being too long, and a name that is empty once normalised
    /// becomes "Semaphore Mobile".
    pub fn mobile(
        user_agent: impl Into<String>,
        device_name: impl AsRef<str>,
    ) -> Result<Self, ClientInfoError> {
        let user_agent = user_agent.into();
        if user_agent.is_empty() || !user_agent.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
            return Err(ClientInfoError::InvalidUserAgent);
        }
        Ok(Self {
            kind: ClientKind::MobileNative,
            user_agent,
            device_name: encode_device_name(device_name.as_ref()),
        })
    }

    /// Sent as `X-Client-Type` on sign-in and refresh.
    pub fn kind(&self) -> ClientKind {
        self.kind
    }

    /// Sent as `User-Agent` on every request.
    pub fn user_agent(&self) -> &str {
        &self.user_agent
    }

    /// Sent as `X-Device-Name` on sign-in. For a mobile client this is the percent-encoded form
    /// of the normalised name; the desktop's is a fixed ASCII constant.
    pub fn device_name(&self) -> &str {
        &self.device_name
    }
}

/// Percent-encodes every byte outside `A-Z a-z 0-9 - _ . ! ~ * ' ( )`: what JS
/// `encodeURIComponent` leaves alone.
fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn encode_device_name(raw: &str) -> String {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let mut name: &str = cleaned.trim();
    let mut encoded = percent_encode(name);
    while encoded.len() > MAX_DEVICE_NAME_LEN {
        // Drop the last character, never half of one.
        let cut = name.char_indices().next_back().map_or(0, |(at, _)| at);
        name = name[..cut].trim_end();
        encoded = percent_encode(name);
    }
    if name.is_empty() {
        percent_encode(MOBILE_FALLBACK_NAME)
    } else {
        encoded
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_wire::types::AuthControllerLoginXDeviceName;

    fn name_of(raw: &str) -> String {
        ClientInfo::mobile("UA/1", raw)
            .unwrap()
            .device_name()
            .to_owned()
    }

    /// What the backend's `decodeURIComponent` gives back.
    fn decode(encoded: &str) -> String {
        let bytes = encoded.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                out.push(u8::from_str_radix(&encoded[i + 1..i + 3], 16).unwrap());
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn a_non_ascii_name_is_percent_encoded_utf8() {
        assert_eq!(name_of("María’s Galaxy"), "Mar%C3%ADa%E2%80%99s%20Galaxy");
    }

    #[test]
    fn a_literal_percent_is_escaped() {
        assert_eq!(name_of("100% Phone"), "100%25%20Phone");
    }

    #[test]
    fn unreserved_characters_stay_as_they_are() {
        assert_eq!(name_of("a-b_c.d!e~f*g'h(i)"), "a-b_c.d!e~f*g'h(i)");
    }

    #[test]
    fn a_long_cjk_name_is_cut_to_fit_and_still_sent() {
        let raw = "漢".repeat(70);
        let encoded = name_of(&raw);
        assert!(encoded.len() <= 64, "{encoded}");
        // The header type the backend client sends it as accepts it.
        assert!(encoded.parse::<AuthControllerLoginXDeviceName>().is_ok());
        let decoded = decode(&encoded);
        assert!(!decoded.is_empty() && decoded.chars().count() <= 64);
        assert!(decoded.chars().all(|c| c == '漢'));
        // 3 bytes per character, 9 encoded bytes each: 7 fit in 64.
        assert_eq!(decoded.chars().count(), 7);
    }

    #[test]
    fn a_long_ascii_name_is_cut_to_64_characters() {
        let encoded = name_of(&"x".repeat(100));
        assert_eq!(encoded, "x".repeat(64));
    }

    #[test]
    fn control_characters_are_stripped() {
        assert_eq!(name_of("Pixel\n 8\r\u{0}\tPro\u{7f}"), "Pixel%208Pro");
    }

    #[test]
    fn the_name_is_trimmed_before_and_after_the_cut() {
        assert_eq!(name_of("  Pixel  "), "Pixel");
        // Cutting at 64 would end on a space: that goes too.
        let raw = format!("{} tail", "y".repeat(63));
        assert_eq!(name_of(&raw), "y".repeat(63));
    }

    #[test]
    fn an_empty_name_falls_back() {
        for raw in ["", "   ", "\n\t", "\u{0}"] {
            assert_eq!(name_of(raw), "Semaphore%20Mobile", "{raw:?}");
        }
    }

    #[test]
    fn a_bad_user_agent_is_an_error() {
        for agent in [
            "",
            "Semaphore-Android/é",
            "line\nbreak",
            "tab\t",
            "del\u{7f}",
        ] {
            assert_eq!(
                ClientInfo::mobile(agent, "Pixel").unwrap_err(),
                ClientInfoError::InvalidUserAgent,
                "{agent:?}"
            );
        }
        assert!(ClientInfo::mobile("Semaphore-Android/0.1 (Pixel 8)", "Pixel").is_ok());
    }

    #[test]
    fn desktop_is_the_constants_unchanged() {
        let info = ClientInfo::desktop();
        assert_eq!(info.kind(), ClientKind::DesktopNative);
        assert_eq!(info.user_agent(), DESKTOP_USER_AGENT);
        assert_eq!(info.device_name(), DESKTOP_DEVICE_NAME);
        assert!(
            info.device_name()
                .parse::<AuthControllerLoginXDeviceName>()
                .is_ok()
        );
    }
}
