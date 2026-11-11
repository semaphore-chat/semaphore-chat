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
            let body = response.text().await.unwrap_or_default();
            from_body(status, &body)
        }
        Error::ErrorResponse(value) => {
            // No body survives on a response the contract declared without content.
            unparsed(value.status().as_u16(), String::new())
        }
        other => ApiError {
            status: other.status().map_or(0, |status| status.as_u16()),
            code: ErrorCode::Unknown(String::from("UNKNOWN")),
            message: other.to_string(),
            retryable: other.is_retryable(),
            retry_after_ms: None,
        },
    }
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

fn unparsed(status: u16, body: String) -> ApiError {
    ApiError {
        status,
        code: ErrorCode::Unknown(String::from("UNKNOWN")),
        message: body,
        retryable: retryable_by_status(status),
        retry_after_ms: None,
    }
}
