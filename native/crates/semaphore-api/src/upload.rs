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
