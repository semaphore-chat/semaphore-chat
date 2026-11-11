//! `GET /api/file/{id}` with a `Range` header, by hand: the contract has no way to describe a
//! 206 body, so the generated call reads the whole file. The backend's `FileController.getFile`
//! answers a range with 206 and `Content-Range: bytes start-end/size`.

use crate::Client;
use progenitor_client::{ClientInfo, Error, ResponseValue, encode_path};
use reqwest::header::{CONTENT_RANGE, RANGE};

/// Part of a file, and the whole file's size when the server said it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRange {
    pub bytes: Vec<u8>,
    pub size: Option<u64>,
}

/// The size in `Content-Range: bytes 0-99/1234`.
fn range_size(value: &str) -> Option<u64> {
    value.rsplit_once('/')?.1.trim().parse().ok()
}

/// The first byte in `Content-Range: bytes 0-99/1234`, if it says.
fn range_start(value: &str) -> Option<u64> {
    let range = value.trim().strip_prefix("bytes")?.trim_start();
    range.split_once('-')?.0.trim().parse().ok()
}

impl Client {
    /// Bytes `start..=end` of file `id`. A server that ignores `Range` (200) still yields just
    /// those bytes, cut from the whole body; any other status is an error.
    // The generated calls' error type, so `rpc!` and `from_progenitor` take it as they are.
    #[allow(clippy::result_large_err)]
    pub async fn file_controller_get_file_range(
        &self,
        id: &str,
        start: u64,
        end: u64,
    ) -> Result<ResponseValue<FileRange>, Error<()>> {
        let url = format!("{}/api/file/{}", self.baseurl(), encode_path(id));
        let response = self
            .client()
            .get(url)
            .header(RANGE, format!("bytes={start}-{end}"))
            .send()
            .await
            .map_err(Error::CommunicationError)?;
        let status = response.status();
        let headers = response.headers().clone();
        match status.as_u16() {
            206 => {
                let content_range = headers.get(CONTENT_RANGE).and_then(|v| v.to_str().ok());
                let size = content_range.and_then(range_size);
                // Bytes from somewhere else are not the ones asked for, whatever their length.
                if let Some(sent) = content_range.and_then(range_start)
                    && sent != start
                {
                    return Err(Error::Custom(format!(
                        "asked for bytes from {start}, the server sent them from {sent}"
                    )));
                }
                let bytes = response.bytes().await.map_err(Error::ResponseBodyError)?;
                // More than asked for is cut: a caller places these bytes by the range it asked for.
                let wanted = end.saturating_sub(start).saturating_add(1);
                let kept = bytes
                    .len()
                    .min(usize::try_from(wanted).unwrap_or(usize::MAX));
                let range = FileRange {
                    bytes: bytes[..kept].to_vec(),
                    size,
                };
                Ok(ResponseValue::new(range, status, headers))
            }
            200 => {
                let bytes = response.bytes().await.map_err(Error::ResponseBodyError)?;
                let size = bytes.len() as u64;
                let from = start.min(size) as usize;
                let to = end.saturating_add(1).min(size) as usize;
                let range = FileRange {
                    bytes: bytes[from..to.max(from)].to_vec(),
                    size: Some(size),
                };
                Ok(ResponseValue::new(range, status, headers))
            }
            _ => Err(Error::UnexpectedResponse(response)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_range_gives_the_size() {
        assert_eq!(range_size("bytes 0-99/1234"), Some(1234));
        assert_eq!(range_size("bytes */1234"), Some(1234));
        assert_eq!(range_size("bytes 0-99/*"), None);
    }

    #[test]
    fn a_content_range_that_is_not_one_has_no_size() {
        for value in [
            "",
            "/",
            "bytes 0-99/",
            "bytes 0-99/abc",
            "bytes 0-99/-5",
            "bytes 0-99/1e3",
            "bytes 0-99/99999999999999999999999",
        ] {
            assert_eq!(range_size(value), None, "{value:?}");
        }
        assert_eq!(range_size("bytes 0-99/ 1234 "), Some(1234));
    }

    #[test]
    fn content_range_gives_the_first_byte() {
        assert_eq!(range_start("bytes 0-99/1234"), Some(0));
        assert_eq!(range_start(" bytes 500-999/1234"), Some(500));
        for value in [
            "",
            "bytes */1234",
            "items 0-1/2",
            "bytes x-1/2",
            "bytes -5/10",
        ] {
            assert_eq!(range_start(value), None, "{value:?}");
        }
    }

    /// Answers one request with `status`, `headers` and `body`, and returns its base URL.
    async fn answer_once(status: &str, headers: &str, body: &'static [u8]) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let head = format!(
            "HTTP/1.1 {status}\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        );
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 1024];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                let read = stream.read(&mut chunk).await.unwrap();
                if read == 0 {
                    return;
                }
                request.extend_from_slice(&chunk[..read]);
            }
            stream.write_all(head.as_bytes()).await.unwrap();
            stream.write_all(body).await.unwrap();
        });
        url
    }

    async fn get(url: &str, start: u64, end: u64) -> Result<FileRange, String> {
        // See the dev-dependency: the workspace build leaves reqwest without a provider.
        let _ = rustls::crypto::ring::default_provider().install_default();
        Client::new(url)
            .file_controller_get_file_range("f", start, end)
            .await
            .map(ResponseValue::into_inner)
            .map_err(|error| error.to_string())
    }

    const TEN: &[u8] = b"0123456789";

    #[tokio::test]
    async fn a_partial_answer_gives_its_bytes_and_the_size() {
        let url = answer_once("206 Partial", "content-range: bytes 2-5/10\r\n", b"2345").await;
        assert_eq!(
            get(&url, 2, 5).await,
            Ok(FileRange {
                bytes: b"2345".to_vec(),
                size: Some(10)
            })
        );
    }

    #[tokio::test]
    async fn a_whole_file_answer_is_cut_to_the_range() {
        for (start, end, want) in [
            (0, 9, TEN),
            (2, 5, &b"2345"[..]),
            (8, 50, &b"89"[..]),
            (10, 20, &b""[..]),
            (40, 50, &b""[..]),
        ] {
            let url = answer_once("200 OK", "", TEN).await;
            assert_eq!(
                get(&url, start, end).await,
                Ok(FileRange {
                    bytes: want.to_vec(),
                    size: Some(10)
                }),
                "{start}-{end}"
            );
        }
    }

    #[tokio::test]
    async fn a_range_past_the_end_or_an_error_status_fails() {
        for status in [
            "416 Range Not Satisfiable",
            "404 Not Found",
            "500 Oops",
            "302 Found",
        ] {
            let url = answer_once(status, "", b"").await;
            assert!(get(&url, 0, 9).await.is_err(), "{status}");
        }
    }

    #[tokio::test]
    async fn a_partial_answer_for_another_range_fails() {
        // Asked for 5-9, sent 0-4: those bytes are not the ones asked for.
        let url = answer_once("206 Partial", "content-range: bytes 0-4/10\r\n", b"01234").await;
        assert!(get(&url, 5, 9).await.is_err());
    }

    #[tokio::test]
    async fn a_partial_answer_longer_than_asked_is_cut_to_the_range() {
        let url = answer_once(
            "206 Partial",
            "content-range: bytes 2-9/10\r\n",
            b"23456789",
        )
        .await;
        assert_eq!(
            get(&url, 2, 5).await,
            Ok(FileRange {
                bytes: b"2345".to_vec(),
                size: Some(10)
            })
        );
    }
}
