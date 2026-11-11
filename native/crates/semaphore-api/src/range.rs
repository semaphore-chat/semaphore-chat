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
                let size = headers
                    .get(CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(range_size);
                let bytes = response.bytes().await.map_err(Error::ResponseBodyError)?;
                let range = FileRange {
                    bytes: bytes.to_vec(),
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
}
