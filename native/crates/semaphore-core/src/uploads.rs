//! Files sent with a message, as the web's `attachmentSend.ts` does: the message goes first with
//! `pendingAttachments` set to how many, then each file uploads against the message's id
//! (`MESSAGE_ATTACHMENT`) and is attached to it. The server answers each attach with
//! `updateMessage`, which settles the row like any edit.
//!
//! A failed upload stays on its row with the server's reason until it's retried or removed; removing
//! one releases its pending slot (an attach with no file). Core holds each file's bytes only until
//! that file has been attached or removed.

use crate::backend::{FileUpload, UploadProgress};
use crate::client::{Core, Effect, State};
use crate::model::{Conversation, DraftFile, ErrorView, UploadView};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::enums::ResourceType;
use semaphore_wire::types as wire;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Progress goes to the row at most this often, or every this many bytes, whichever comes first.
const PROGRESS_EVERY_MS: u64 = 100;
const PROGRESS_EVERY_FRACTION: u64 = 20;

pub(crate) struct UploadFile {
    /// Stable while others are removed, so progress lands on the right one.
    id: u64,
    name: String,
    mime_type: String,
    bytes: Arc<Vec<u8>>,
    sent: u64,
    failed: Option<ErrorView>,
    running: bool,
}

/// One message's files, keyed by its send's nonce.
pub(crate) struct UploadJob {
    pub conversation: Conversation,
    pub client_id: String,
    /// Known once the send is acknowledged; uploads wait for it.
    pub message_id: Option<String>,
    files: Vec<UploadFile>,
}

impl UploadJob {
    pub fn new(
        conversation: Conversation,
        client_id: String,
        files: Vec<DraftFile>,
        next: &mut u64,
    ) -> Self {
        let files = files
            .into_iter()
            .map(|file| {
                *next += 1;
                UploadFile {
                    id: *next,
                    name: file.name,
                    mime_type: file.mime_type,
                    bytes: Arc::new(file.bytes),
                    sent: 0,
                    failed: None,
                    running: false,
                }
            })
            .collect();
        Self {
            conversation,
            client_id,
            message_id: None,
            files,
        }
    }

    pub fn views(&self) -> Vec<UploadView> {
        self.files
            .iter()
            .map(|file| UploadView {
                name: file.name.clone(),
                size_bytes: file.bytes.len() as u64,
                sent_bytes: file.sent,
                failed: file.failed.clone(),
            })
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

impl State {
    /// Every upload in progress, by the client id of the row it belongs to.
    pub(crate) fn upload_views(&self) -> HashMap<String, Vec<UploadView>> {
        self.uploads
            .values()
            .map(|job| (job.client_id.clone(), job.views()))
            .collect()
    }

    /// Asks for the job's row to be drawn again.
    fn touch_upload_row(&mut self, nonce: &str) {
        let Some(job) = self.uploads.get(nonce) else {
            return;
        };
        let ids = [job.message_id.clone(), Some(job.client_id.clone())];
        if let Some(window) = self.windows.get_mut(&job.conversation) {
            for id in ids.into_iter().flatten() {
                if window.edit(&id, |_| {}) {
                    break;
                }
            }
        }
    }

    /// The send behind these uploads was acknowledged: they can start.
    pub(crate) fn uploads_may_start(&mut self, nonce: &str, message_id: &str) {
        if let Some(job) = self.uploads.get_mut(nonce)
            && job.message_id.is_none()
        {
            job.message_id = Some(message_id.to_owned());
            self.push_effect(Effect::Upload(nonce.to_owned()));
        }
    }
}

fn failed(error: &crate::backend::BackendError) -> ErrorView {
    let mut view = error.view();
    if error.status == 413 && view.message.is_empty() {
        view.message = "The file is too large for this server".into();
    }
    view
}

impl Core {
    /// Uploads the job's waiting files one at a time, attaching each as it lands.
    pub(crate) async fn run_uploads(&self, nonce: String) {
        let Some(services) = self.services().cloned() else {
            return;
        };
        loop {
            let next = self.write(|state, _| {
                let job = state.uploads.get_mut(&nonce)?;
                let message_id = job.message_id.clone()?;
                if job.files.iter().any(|file| file.running) {
                    return None;
                }
                let file = job.files.iter_mut().find(|file| file.failed.is_none())?;
                file.running = true;
                file.sent = 0;
                Some((
                    message_id.clone(),
                    file.id,
                    FileUpload {
                        filename: file.name.clone(),
                        mime_type: file.mime_type.clone(),
                        bytes: file.bytes.clone(),
                        resource_type: ResourceType::MessageAttachment,
                        resource_id: Some(message_id.clone()),
                    },
                ))
            });
            let Some((message_id, file_id, upload)) = next else {
                return;
            };
            let total = upload.bytes.len() as u64;
            let progress = self.progress(nonce.clone(), file_id, total);
            let uploaded = services
                .backend
                .file_upload_controller_upload_file(upload, progress)
                .await;
            let attached = match uploaded {
                Ok(file) => match uuid::Uuid::parse_str(&file.id) {
                    Ok(id) => services
                        .backend
                        .messages_controller_add_attachment(
                            message_id,
                            wire::AddAttachmentDto { file_id: Some(id) },
                        )
                        .await
                        .map(|_| ())
                        .map_err(|error| failed(&error)),
                    Err(_) => Err(ErrorView {
                        code: "FAILED".into(),
                        message: format!("the server named the upload oddly: {}", file.id),
                        retryable: false,
                        retry_after_ms: None,
                    }),
                },
                Err(error) => Err(failed(&error)),
            };
            self.write(|state, _| {
                if let Some(job) = state.uploads.get_mut(&nonce) {
                    match attached {
                        // Its bytes go with it.
                        Ok(()) => job.files.retain(|file| file.id != file_id),
                        Err(error) => {
                            if let Some(file) = job.files.iter_mut().find(|file| file.id == file_id)
                            {
                                file.running = false;
                                file.failed = Some(error);
                            }
                        }
                    }
                    let done = job.is_empty();
                    state.touch_upload_row(&nonce);
                    if done {
                        state.uploads.remove(&nonce);
                    }
                }
            });
        }
    }

    /// Reports an upload's progress to its row, now and then.
    fn progress(&self, nonce: String, file_id: u64, total: u64) -> UploadProgress {
        let core = self.clone();
        let last = Mutex::new((0u64, 0u64));
        Arc::new(move |sent: u64| {
            let now = core.now_ms();
            {
                let mut last = last.lock().unwrap_or_else(|p| p.into_inner());
                let step = (total / PROGRESS_EVERY_FRACTION).max(1);
                if sent < total && sent < last.0 + step && now < last.1 + PROGRESS_EVERY_MS {
                    return;
                }
                *last = (sent, now);
            }
            core.write(|state, _| {
                if let Some(file) = state
                    .uploads
                    .get_mut(&nonce)
                    .and_then(|job| job.files.iter_mut().find(|file| file.id == file_id))
                {
                    file.sent = sent.min(total);
                }
                state.touch_upload_row(&nonce);
            });
        })
    }

    /// Tries a failed upload again. `index` is its place in the row's `uploads`.
    pub async fn retry_upload(&self, client_nonce: String, index: u32) -> Result<(), CoreError> {
        self.services().ok_or_else(|| unavailable("uploading"))?;
        self.write(|state, _| {
            let Some(job) = state.uploads.get_mut(&client_nonce) else {
                return;
            };
            if let Some(file) = job.files.get_mut(index as usize) {
                file.failed = None;
            }
            state.touch_upload_row(&client_nonce);
            if state
                .uploads
                .get(&client_nonce)
                .is_some_and(|job| job.message_id.is_some())
            {
                state.push_effect(Effect::Upload(client_nonce.clone()));
            }
        });
        Ok(())
    }

    /// Gives up on an upload that isn't running: its bytes are dropped and, once the message
    /// exists, its pending slot is released, so the message stops waiting for it.
    pub async fn remove_upload(&self, client_nonce: String, index: u32) -> Result<(), CoreError> {
        self.write(|state, _| {
            let Some(job) = state.uploads.get_mut(&client_nonce) else {
                return;
            };
            if job
                .files
                .get(index as usize)
                .is_none_or(|file| file.running)
            {
                return;
            }
            job.files.remove(index as usize);
            let message_id = job.message_id.clone();
            let done = job.is_empty();
            state.touch_upload_row(&client_nonce);
            if done {
                state.uploads.remove(&client_nonce);
            }
            if let Some(message_id) = message_id {
                state.push_effect(Effect::ReleaseSlot(message_id));
            }
        });
        Ok(())
    }

    pub(crate) async fn release_slot(&self, message_id: String) {
        let Some(services) = self.services() else {
            return;
        };
        if let Err(error) = services
            .backend
            .messages_controller_add_attachment(
                message_id,
                wire::AddAttachmentDto { file_id: None },
            )
            .await
        {
            log::warn!("releasing an upload's slot failed: {error}");
        }
    }

    /// A file's bytes, with the session's auth: an attachment, its thumbnail, an avatar or an
    /// emoji. Nothing is kept here; the caller caches.
    pub async fn file(&self, file_id: String, thumbnail: bool) -> Result<Vec<u8>, CoreError> {
        let services = self.services().ok_or_else(|| unavailable("files"))?;
        let fetched = if thumbnail {
            services
                .backend
                .file_controller_get_file_thumbnail(file_id)
                .await
        } else {
            services.backend.file_controller_get_file(file_id).await
        };
        fetched.map_err(|error| self.backend_failed(error))
    }
}
