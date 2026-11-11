//! `POST /api/file-upload`, which progenitor cannot generate because the contract declares
//! it as `multipart/form-data`.

use progenitor_client::{ClientInfo, Error};
use semaphore_wire::{enums::ResourceType, types::FileUploadResponseDto};

use crate::{
    Client,
    error::{ApiError, from_progenitor},
};

/// One file to upload.
pub struct UploadFile<'a> {
    pub filename: &'a str,
    pub mime_type: &'a str,
    pub bytes: &'a [u8],
}

impl Client {
    /// Uploads one file and returns the record the server stored.
    pub async fn upload_file(
        &self,
        file: UploadFile<'_>,
        resource_type: &ResourceType,
        resource_id: Option<&str>,
    ) -> Result<FileUploadResponseDto, ApiError> {
        let part = reqwest::multipart::Part::bytes(file.bytes.to_vec())
            .file_name(file.filename.to_owned())
            .mime_str(file.mime_type)
            .map_err(|error| local_error(error.to_string()))?;
        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("resourceType", resource_type.as_str().into_owned());
        if let Some(resource_id) = resource_id {
            form = form.text("resourceId", resource_id.to_owned());
        }

        let response = self
            .client()
            .post(format!("{}/api/file-upload", self.baseurl()))
            .header("api-version", Self::api_version())
            .multipart(form)
            .send()
            .await;

        let response = match response {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => return Err(from_progenitor(Error::UnexpectedResponse(response)).await),
            Err(error) => return Err(from_progenitor(Error::CommunicationError(error)).await),
        };

        match response.json().await {
            Ok(file) => Ok(file),
            Err(error) => Err(from_progenitor(Error::ResponseBodyError(error)).await),
        }
    }
}

/// How big each piece of a streamed upload is, and so how often progress is heard.
const UPLOAD_CHUNK: usize = 64 * 1024;

impl Client {
    /// [`upload_file`](Self::upload_file) from shared bytes, streamed so `progress` hears how many
    /// have gone. Fails as the generated calls do, so a caller can refresh and retry the same way.
    pub async fn upload_file_streamed(
        &self,
        filename: &str,
        mime_type: &str,
        bytes: std::sync::Arc<Vec<u8>>,
        resource_type: &ResourceType,
        resource_id: Option<&str>,
        progress: std::sync::Arc<dyn Fn(u64) + Send + Sync>,
    ) -> Result<progenitor_client::ResponseValue<FileUploadResponseDto>, Error<()>> {
        let total = bytes.len();
        let chunks = futures_util::stream::iter((0..total.div_ceil(UPLOAD_CHUNK).max(1)).map(
            move |index| {
                let start = index * UPLOAD_CHUNK;
                let end = (start + UPLOAD_CHUNK).min(total);
                progress(end as u64);
                Ok::<_, std::io::Error>(bytes[start..end].to_vec())
            },
        ));
        let part = reqwest::multipart::Part::stream_with_length(
            reqwest::Body::wrap_stream(chunks),
            total as u64,
        )
        .file_name(filename.to_owned())
        .mime_str(mime_type)
        .map_err(|error| Error::InvalidRequest(error.to_string()))?;
        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("resourceType", resource_type.as_str().into_owned());
        if let Some(resource_id) = resource_id {
            form = form.text("resourceId", resource_id.to_owned());
        }
        let response = self
            .client()
            .post(format!("{}/api/file-upload", self.baseurl()))
            .header("api-version", Self::api_version())
            .multipart(form)
            .send()
            .await
            .map_err(Error::CommunicationError)?;
        if response.status().is_success() {
            progenitor_client::ResponseValue::from_response(response).await
        } else {
            Err(Error::UnexpectedResponse(response))
        }
    }
}

/// A failure before any request went out: no status, and nothing to retry.
fn local_error(message: String) -> ApiError {
    ApiError {
        status: 0,
        code: semaphore_wire::enums::ErrorCode::Unknown(String::from("UNKNOWN")),
        message,
        retryable: false,
        retry_after_ms: None,
    }
}
