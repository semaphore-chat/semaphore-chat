//! One error type for every REST call.

use progenitor_client::Error;
use semaphore_wire::{
    enums::ErrorCode,
    types::{ErrorResponseDto, ErrorResponseDtoMessage},
};

/// A failed REST call, whether the server answered or not.
#[derive(Clone, Debug, PartialEq)]
pub struct ApiError {
    /// The HTTP status, or 0 when the request never got a response.
    pub status: u16,
    /// The server's stable error code, kept verbatim even when this build has not heard of
    /// it.
    pub code: ErrorCode,
    /// What to show a person.
    pub message: String,
    /// Whether the same request may be retried automatically.
    pub retryable: bool,
    /// How long to wait first, when the server said.
    pub retry_after_ms: Option<u64>,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} ({}): {}",
            self.code.as_str(),
            self.status,
            self.message
        )
    }
}

impl std::error::Error for ApiError {}

/// Converts a generated client's error into one the rest of the app can handle.
///
/// No operation declares a typed error (the contract's `default` responses are stripped
/// when generating), so a server error arrives as [`Error::UnexpectedResponse`] with its
/// body unread. That body is an `ErrorResponseDto`, whose `message` is either a string or a
/// list of strings. A body that will not parse still yields the HTTP status, with
/// [`ErrorCode::Unknown`] and a retry only for 502, 503 and 504.
pub async fn from_progenitor(error: Error<()>) -> ApiError {
    match error {
        Error::UnexpectedResponse(response) => {
            let status = response.status().as_u16();
            let header_wait = retry_after_header_ms(response.headers());
            let body = response.text().await.unwrap_or_default();
            let mut error = from_body(status, &body);
            // The body's `retryAfterMs` is the server's own word; the throttler only sets headers.
            if error.retry_after_ms.is_none() {
                error.retry_after_ms = header_wait;
            }
            error
        }
        Error::ErrorResponse(value) => {
            // No body survives on a response the contract declared without content.
            ApiError {
                retry_after_ms: retry_after_header_ms(value.headers()),
                ..unparsed(value.status().as_u16(), String::new())
            }
        }
        other => from_other(other),
    }
}

/// How long the response's `Retry-After` headers say to wait, in milliseconds: the longest of
/// `Retry-After` and the named throttlers' `Retry-After-<name>` (`@nestjs/throttler` sends one per
/// throttler that refused, e.g. `Retry-After-short`). Only delta-seconds are read; an HTTP-date,
/// or anything else, is ignored.
pub fn retry_after_header_ms(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .iter()
        .filter(|(name, _)| {
            let name = name.as_str();
            name == "retry-after" || name.starts_with("retry-after-")
        })
        .filter_map(|(_, value)| retry_after_seconds_ms(value.to_str().ok()?))
        .max()
}

/// A delta-seconds `Retry-After` value in milliseconds. Fractions are accepted; negative,
/// non-finite and non-numeric values are not.
fn retry_after_seconds_ms(value: &str) -> Option<u64> {
    let seconds: f64 = value.trim().parse().ok()?;
    (seconds.is_finite() && seconds >= 0.0).then(|| (seconds * 1000.0).min(u64::MAX as f64) as u64)
}

/// The field name in serde's "missing field `name` at line L column C", if that's the whole
/// message. The name comes from the type being decoded, never from the response, so it's safe to
/// log; any other message (which may quote a value) gives `None`.
fn missing_field(error: &serde_json::Error) -> Option<String> {
    let text = error.to_string();
    let rest = text.strip_prefix("missing field `")?;
    let (field, rest) = rest.split_once('`')?;
    let safe = !field.is_empty() && field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    (safe && rest.starts_with(" at line ")).then(|| field.to_owned())
}

/// The longest raw body kept in a message, in bytes; the rest is dropped and marked.
pub const MAX_BODY_IN_MESSAGE: usize = 512;

/// Every other failure. A response that came back but would not parse
/// ([`Error::InvalidResponsePayload`]) says how long it was and where it stopped parsing, never
/// what it held: progenitor's own text prints the whole body, and a login or refresh response
/// carries the tokens. serde's message is left out too, since it quotes the value it choked on,
/// except a missing field's name, which comes from the type ([`missing_field`]).
fn from_other(other: Error<()>) -> ApiError {
    let message = match &other {
        Error::InvalidResponsePayload(body, error) => {
            let mut message = format!(
                "Invalid Response Payload ({} bytes): {:?} error at line {} column {}",
                body.len(),
                error.classify(),
                error.line(),
                error.column()
            );
            if let Some(field) = missing_field(error) {
                message.push_str(&format!(": missing field `{field}`"));
            }
            message
        }
        _ => other.to_string(),
    };
    ApiError {
        status: other.status().map_or(0, |status| status.as_u16()),
        code: ErrorCode::Unknown(String::from("UNKNOWN")),
        message: capped(message),
        retryable: other.is_retryable(),
        retry_after_ms: None,
    }
}

/// `text` cut to [`MAX_BODY_IN_MESSAGE`] bytes at a character boundary, with a marker.
fn capped(mut text: String) -> String {
    if text.len() <= MAX_BODY_IN_MESSAGE {
        return text;
    }
    let mut end = MAX_BODY_IN_MESSAGE;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push_str("…(truncated)");
    text
}

/// A 502, 503 or 504 is worth retrying even when the body says nothing.
fn retryable_by_status(status: u16) -> bool {
    matches!(status, 502..=504)
}

fn from_body(status: u16, body: &str) -> ApiError {
    let Ok(dto) = serde_json::from_str::<ErrorResponseDto>(body) else {
        return unparsed(status, body.to_owned());
    };
    let message = match dto.message {
        ErrorResponseDtoMessage::String(message) => message,
        ErrorResponseDtoMessage::Array(messages) => messages.join(", "),
    };
    let message = match (message.is_empty(), dto.error) {
        (true, Some(error)) => error,
        _ => message,
    };
    ApiError {
        status,
        code: dto.error_code,
        message,
        retryable: dto.retryable,
        retry_after_ms: dto
            .retry_after_ms
            .filter(|millis| millis.is_finite() && *millis >= 0.0)
            .map(|millis| millis as u64),
    }
}

/// A body that isn't an `ErrorResponseDto` (a proxy's HTML page, say), kept as the message but
/// cut to [`MAX_BODY_IN_MESSAGE`] bytes.
fn unparsed(status: u16, body: String) -> ApiError {
    ApiError {
        status,
        code: ErrorCode::Unknown(String::from("UNKNOWN")),
        message: capped(body),
        retryable: retryable_by_status(status),
        retry_after_ms: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unreadable_payload_never_puts_the_body_in_the_message() {
        let body = br#"{"accessToken":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln","refreshToken":"rt-secret-1","expiresAt":17}"#;
        // A field of the wrong type: serde's own message would quote the value.
        let error = serde_json::from_slice::<std::collections::HashMap<String, String>>(body)
            .expect_err("expiresAt is not a string");
        let converted = from_other(Error::InvalidResponsePayload(body.to_vec().into(), error));
        assert_eq!(converted.status, 0);
        for secret in ["eyJ", "rt-secret-1", "accessToken", "integer"] {
            assert!(
                !converted.message.contains(secret),
                "{secret} in {:?}",
                converted.message
            );
        }
        assert!(
            converted
                .message
                .starts_with(&format!("Invalid Response Payload ({} bytes)", body.len())),
            "{}",
            converted.message
        );
    }

    #[test]
    fn a_missing_field_is_named_and_nothing_else_from_serde_is_kept() {
        #[derive(Debug, serde::Deserialize)]
        #[allow(dead_code)]
        struct Caps {
            #[serde(rename = "deleteAny")]
            delete_any: bool,
            token: String,
        }
        let body = br#"{"token":"rt-secret-1"}"#;
        let error = serde_json::from_slice::<Caps>(body).expect_err("deleteAny is missing");
        let converted = from_other(Error::InvalidResponsePayload(body.to_vec().into(), error));
        assert_eq!(
            converted.message,
            "Invalid Response Payload (23 bytes): Data error at line 1 column 23: missing field `deleteAny`"
        );
        assert!(!converted.message.contains("rt-secret-1"));

        // A wrong type quotes the value: no serde text at all.
        let body = br#"{"deleteAny":"rt-secret-2","token":"x"}"#;
        let error = serde_json::from_slice::<Caps>(body).expect_err("deleteAny is not a bool");
        let converted = from_other(Error::InvalidResponsePayload(body.to_vec().into(), error));
        assert!(
            !converted.message.contains("rt-secret-2"),
            "{}",
            converted.message
        );
        assert!(
            !converted.message.contains("missing"),
            "{}",
            converted.message
        );
    }

    #[test]
    fn missing_field_takes_only_a_plain_name() {
        let custom = |text: &str| <serde_json::Error as serde::de::Error>::custom(text);
        assert_eq!(
            missing_field(&custom("missing field `pin` at line 1 column 2")).as_deref(),
            Some("pin")
        );
        assert_eq!(
            missing_field(&custom("missing field `pin`")),
            None,
            "no position"
        );
        assert_eq!(
            missing_field(&custom("missing field `a b` at line 1 column 2")),
            None
        );
        assert_eq!(
            missing_field(&custom("missing field `` at line 1 column 2")),
            None
        );
        assert_eq!(missing_field(&custom("invalid type: string \"x\"")), None);
    }

    #[test]
    fn retry_after_reads_delta_seconds_from_every_throttler_header() {
        use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
        let headers = |pairs: &[(&str, &str)]| {
            let mut map = HeaderMap::new();
            for (name, value) in pairs {
                map.append(
                    HeaderName::from_bytes(name.as_bytes()).unwrap(),
                    HeaderValue::from_str(value).unwrap(),
                );
            }
            map
        };
        assert_eq!(retry_after_header_ms(&headers(&[])), None);
        assert_eq!(
            retry_after_header_ms(&headers(&[("Retry-After", "3")])),
            Some(3_000)
        );
        assert_eq!(
            retry_after_header_ms(&headers(&[("Retry-After", " 1.5 ")])),
            Some(1_500)
        );
        assert_eq!(
            retry_after_header_ms(&headers(&[("Retry-After", "0")])),
            Some(0)
        );
        assert_eq!(
            retry_after_header_ms(&headers(&[
                ("Retry-After-short", "1"),
                ("Retry-After-long", "42")
            ])),
            Some(42_000),
            "the longest wait wins"
        );
        for ignored in ["Wed, 21 Oct 2015 07:28:00 GMT", "-1", "NaN", "inf", "soon"] {
            assert_eq!(
                retry_after_header_ms(&headers(&[("Retry-After", ignored)])),
                None,
                "{ignored}"
            );
        }
        assert_eq!(
            retry_after_header_ms(&headers(&[("X-Retry-After", "5"), ("Retry-Afterx", "5")])),
            None,
            "other headers"
        );
    }

    #[test]
    fn a_raw_body_is_cut_short() {
        let page = format!("<html>{}</html>", "é".repeat(4096));
        let error = unparsed(502, page);
        assert!(error.message.len() <= MAX_BODY_IN_MESSAGE + "…(truncated)".len());
        assert!(error.message.ends_with("…(truncated)"));
        assert!(error.retryable);
        assert_eq!(unparsed(500, "short".into()).message, "short");
    }
}
