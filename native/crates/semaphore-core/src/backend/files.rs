//! Files: downloads, uploads and attachments.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, FileUpload, UploadProgress, unsupported};
use crate::model::FileRange;

/// Part of [`Backend`](super::Backend).
#[async_trait]
pub trait FilesBackend: Send + Sync {
    // Files
    async fn file_controller_get_file(&self, id: String) -> BackendResult<Vec<u8>>;
    async fn file_controller_get_file_thumbnail(&self, id: String) -> BackendResult<Vec<u8>>;

    /// Bytes `start..=end` of `id` (`GET /api/file/{id}` with `Range`), for a client that writes
    /// an opened file as it arrives instead of holding all of it.
    async fn file_controller_get_file_range(
        &self,
        _id: String,
        _start: u64,
        _end: u64,
    ) -> BackendResult<FileRange> {
        Err(unsupported("ranged file reads"))
    }

    /// `POST /api/file-upload`, multipart. `progress` hears the bytes sent so far.
    async fn file_upload_controller_upload_file(
        &self,
        _file: FileUpload,
        _progress: UploadProgress,
    ) -> BackendResult<wire::FileUploadResponseDto> {
        Err(unsupported("uploading files"))
    }

    /// `POST /api/messages/{id}/attachments`: attaches an uploaded file, or with no file releases
    /// one of the message's pending slots.
    async fn messages_controller_add_attachment(
        &self,
        _id: String,
        _body: wire::AddAttachmentDto,
    ) -> BackendResult<wire::MessageDto> {
        Err(unsupported("attaching files"))
    }
}
