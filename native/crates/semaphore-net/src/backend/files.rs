//! [`HttpBackend`] for [`FilesBackend`].

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, FilesBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl FilesBackend for HttpBackend {
    async fn file_controller_get_file(&self, id: String) -> BackendResult<Vec<u8>> {
        let id = id.as_str();
        bytes(rpc!(self, c => c.file_controller_get_file(id))?).await
    }

    async fn file_controller_get_file_thumbnail(&self, id: String) -> BackendResult<Vec<u8>> {
        let id = id.as_str();
        bytes(rpc!(self, c => c.file_controller_get_file_thumbnail(id))?).await
    }

    /// On a client of its own: the usual read deadline covers sending the whole request too, which a
    /// large file on a slow link outlasts. Retried once after a refresh, as other calls are.
    async fn file_upload_controller_upload_file(
        &self,
        file: semaphore_core::backend::FileUpload,
        progress: semaphore_core::backend::UploadProgress,
    ) -> BackendResult<wire::FileUploadResponseDto> {
        let upload_timeouts = Timeouts {
            read: std::time::Duration::from_secs(600),
            ..self.inner.timeouts
        };
        let mut refreshed = false;
        loop {
            let (client, seen, can_refresh) = {
                let state = self.inner.lock();
                let url = state
                    .server_url
                    .clone()
                    .ok_or_else(|| failure("no server URL is set"))?;
                let client = self
                    .inner
                    .build_with(&url, state.access.as_ref(), upload_timeouts)
                    .ok_or_else(|| failure("cannot build the HTTP client"))?;
                (client, state.seen(), state.refresh.is_some())
            };
            let result = client
                .upload_file_streamed(
                    &file.filename,
                    &file.mime_type,
                    file.bytes.clone(),
                    &file.resource_type,
                    file.resource_id.as_deref(),
                    progress.clone(),
                )
                .await;
            let error = match result {
                Ok(value) => return Ok(value.into_inner()),
                Err(error) => convert(error).await,
            };
            if refreshed || !can_refresh || !is_unauthenticated(&error) {
                return Err(error);
            }
            refreshed = true;
            self.refresh_shared(seen, None).await?;
        }
    }

    async fn messages_controller_add_attachment(
        &self,
        id: String,
        body: wire::AddAttachmentDto,
    ) -> BackendResult<wire::MessageDto> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.messages_controller_add_attachment(id, body))
    }
}
