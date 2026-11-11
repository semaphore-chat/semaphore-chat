//! REST, as core sees it. `semaphore-net` implements this over the generated `semaphore-api`
//! client, so core never depends on reqwest. Single-flight token refresh lives in that
//! implementation, which also keeps the tokens: core sees them only to learn when they expire.
//!
//! Every method is named after its `operationId` in snake case, so a generated trait can replace
//! this one later, and takes the generated client's arguments as owned values. Everything else
//! core calls goes through them.
//!
//! The methods are grouped by area, one supertrait each in its own file, so endpoints for different
//! areas are added without touching the same lines. Callers hold `dyn Backend`; an implementor
//! implements each area trait, and gets `Backend` from the blanket impl.

mod communities;
mod dms;
mod files;
mod messages;
mod moderation;
mod notify;
mod search;
mod session;
mod social;
mod threads;
mod voice;

pub use communities::CommunitiesBackend;
pub use dms::DmsBackend;
pub use files::FilesBackend;
pub use messages::MessagesBackend;
pub use moderation::ModerationBackend;
pub use notify::NotifyBackend;
pub use search::SearchBackend;
pub use session::SessionBackend;
pub use social::SocialBackend;
pub use threads::ThreadsBackend;
pub use voice::VoiceBackend;

use semaphore_wire::enums::ErrorCode;

use crate::model::ErrorView;
use std::sync::Arc;

/// One file for [`FilesBackend::file_upload_controller_upload_file`]. The bytes are shared, so a failed
/// upload can be tried again without a copy, and freed when the last holder lets go.
#[derive(Clone)]
pub struct FileUpload {
    pub filename: String,
    pub mime_type: String,
    pub bytes: Arc<Vec<u8>>,
    pub resource_type: semaphore_wire::enums::ResourceType,
    pub resource_id: Option<String>,
}

/// Told how many bytes of an upload have gone so far.
pub type UploadProgress = Arc<dyn Fn(u64) + Send + Sync>;

/// A failed REST call, whether the server answered or not. `semaphore_api::ApiError` field for
/// field, because core can't name that crate: it pulls in reqwest.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
#[error("{} ({status}): {message}", code.as_str())]
pub struct BackendError {
    /// The HTTP status, or 0 when the request never got a response.
    pub status: u16,
    /// The server's code, kept verbatim even when this build hasn't heard of it.
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

impl BackendError {
    pub fn view(&self) -> ErrorView {
        ErrorView {
            code: self.code.as_str().into_owned(),
            message: self.message.clone(),
            retryable: self.retryable,
            retry_after_ms: self.retry_after_ms,
        }
    }
}

pub type BackendResult<T> = Result<T, BackendError>;

/// REST, as core sees it: every area's calls, behind one object-safe trait.
pub trait Backend:
    Send
    + Sync
    + SessionBackend
    + CommunitiesBackend
    + MessagesBackend
    + VoiceBackend
    + FilesBackend
    + ModerationBackend
    + ThreadsBackend
    + SearchBackend
    + DmsBackend
    + SocialBackend
    + NotifyBackend
{
}

impl<T> Backend for T where
    T: ?Sized
        + Send
        + Sync
        + SessionBackend
        + CommunitiesBackend
        + MessagesBackend
        + VoiceBackend
        + FilesBackend
        + ModerationBackend
        + ThreadsBackend
        + SearchBackend
        + DmsBackend
        + SocialBackend
        + NotifyBackend
{
}

fn unsupported(what: &str) -> BackendError {
    BackendError {
        status: 0,
        code: ErrorCode::Unknown("UNSUPPORTED".into()),
        message: format!("this backend can't do this: {what}"),
        retryable: false,
        retry_after_ms: None,
    }
}
