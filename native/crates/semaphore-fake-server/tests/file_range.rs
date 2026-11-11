//! `GET /api/file/{id}` with `Range`, as the backend's `FileController.getFile` answers it.

mod common;

use common::*;

async fn get(range: Option<&str>) -> (u16, reqwest::header::HeaderMap, Vec<u8>) {
    let server = start("big-community").await;
    let mut request = http()
        .get(format!("{}/api/file/range-test", server.base_url()))
        .header("Authorization", TOKEN);
    if let Some(range) = range {
        request = request.header("Range", range);
    }
    let response = request.send().await.expect("answers");
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let body = response.bytes().await.expect("a body").to_vec();
    (status, headers, body)
}

fn header<'a>(headers: &'a reqwest::header::HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

#[tokio::test]
async fn without_range_the_whole_file_says_it_accepts_ranges() {
    let (status, headers, body) = get(None).await;
    assert_eq!(status, 200);
    assert_eq!(header(&headers, "accept-ranges"), Some("bytes"));
    assert!(body.len() > 100, "{} bytes", body.len());
}

#[tokio::test]
async fn a_range_answers_206_with_its_bytes_and_content_range() {
    let (_, _, whole) = get(None).await;
    let size = whole.len();
    let (status, headers, body) = get(Some("bytes=10-19")).await;
    assert_eq!(status, 206);
    assert_eq!(body, whole[10..20]);
    assert_eq!(
        header(&headers, "content-range"),
        Some(format!("bytes 10-19/{size}").as_str())
    );
    assert_eq!(header(&headers, "content-length"), Some("10"));
    assert_eq!(header(&headers, "accept-ranges"), Some("bytes"));
}

#[tokio::test]
async fn an_open_or_overlong_range_runs_to_the_end() {
    let (_, _, whole) = get(None).await;
    let size = whole.len();
    let (status, headers, body) = get(Some("bytes=5-")).await;
    assert_eq!(status, 206);
    assert_eq!(body, whole[5..]);
    let expected = format!("bytes 5-{}/{size}", size - 1);
    assert_eq!(header(&headers, "content-range"), Some(expected.as_str()));

    let (status, _, body) = get(Some("bytes=0-999999999")).await;
    assert_eq!(status, 206, "the end is clamped, not refused");
    assert_eq!(body, whole);
}

#[tokio::test]
async fn a_range_past_the_end_or_inverted_answers_416() {
    let (_, _, whole) = get(None).await;
    let size = whole.len();
    for range in [format!("bytes={size}-"), "bytes=20-10".to_owned()] {
        let (status, headers, body) = get(Some(&range)).await;
        assert_eq!(status, 416, "{range}");
        assert_eq!(
            header(&headers, "content-range"),
            Some(format!("bytes */{size}").as_str()),
            "{range}"
        );
        assert!(body.is_empty());
    }
}

#[tokio::test]
async fn a_range_it_cannot_read_is_ignored() {
    let (_, _, whole) = get(None).await;
    let (status, _, body) = get(Some("items=0-5")).await;
    assert_eq!(status, 200);
    assert_eq!(body, whole);
}
