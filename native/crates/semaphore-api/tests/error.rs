//! [`from_progenitor`] against a real HTTP response.
//!
//! The generated client cannot produce a typed error (no operation declares one), so a
//! failed call always arrives as an unread response. These tests put a real
//! `ErrorResponseDto` body on a real socket and check what comes out.

use semaphore_api::{ApiError, Client, from_progenitor};
use semaphore_wire::enums::ErrorCode;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Serves one canned response, then stops.
async fn serve(status: u16, body: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let address = listener.local_addr().expect("an address");
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut request = [0u8; 4096];
        let _ = socket.read(&mut request).await;
        let response = format!(
            "HTTP/1.1 {status} error\r\n\
             content-type: application/json\r\n\
             content-length: {}\r\n\
             connection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.expect("write");
        socket.shutdown().await.ok();
    });
    format!("http://{address}")
}

/// Calls a generated operation against that server and converts its error.
async fn failed_call(base: &str) -> ApiError {
    let client = Client::new(base);
    match client.app_controller_get_hello().await {
        Ok(response) => panic!("expected an error, got {response:?}"),
        Err(error) => from_progenitor(error).await,
    }
}

#[tokio::test]
async fn reads_a_string_message() {
    let base = serve(
        400,
        r#"{"statusCode":400,"message":"Nope","errorCode":"BAD_REQUEST","retryable":false}"#,
    )
    .await;

    let error = failed_call(&base).await;

    assert_eq!(error.status, 400);
    assert_eq!(error.code, ErrorCode::BadRequest);
    assert_eq!(error.message, "Nope");
    assert!(!error.retryable);
    assert_eq!(error.retry_after_ms, None);
}

#[tokio::test]
async fn reads_a_list_message_and_the_retry_delay() {
    let base = serve(
        429,
        r#"{"statusCode":429,"message":["too fast","try later"],"errorCode":"SLOWMODE","retryable":true,"retryAfterMs":2500}"#,
    )
    .await;

    let error = failed_call(&base).await;

    assert_eq!(error.status, 429);
    assert_eq!(error.code, ErrorCode::Slowmode);
    assert_eq!(error.message, "too fast, try later");
    assert!(error.retryable);
    assert_eq!(error.retry_after_ms, Some(2500));
}

#[tokio::test]
async fn a_body_that_is_not_an_error_response_keeps_the_status() {
    let base = serve(503, "<html>Service Unavailable</html>").await;

    let error = failed_call(&base).await;

    assert_eq!(error.status, 503);
    assert_eq!(error.code, ErrorCode::Unknown(String::from("UNKNOWN")));
    assert_eq!(error.message, "<html>Service Unavailable</html>");
    assert!(error.retryable, "503 is worth retrying even unparsed");
}

#[tokio::test]
async fn an_unparsed_body_is_not_retryable_unless_the_status_says_so() {
    let base = serve(400, "not json at all").await;

    let error = failed_call(&base).await;

    assert_eq!(error.status, 400);
    assert_eq!(error.code, ErrorCode::Unknown(String::from("UNKNOWN")));
    assert!(!error.retryable);
}
