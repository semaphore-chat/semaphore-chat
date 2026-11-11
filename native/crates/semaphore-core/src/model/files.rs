//! Files on their way to a message.

use super::ErrorView;

/// A file to send with a message.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DraftFile {
    pub name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

/// A file of this client's on its way to a message it sent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UploadView {
    pub name: String,
    pub size_bytes: u64,
    pub sent_bytes: u64,
    /// Why it stopped, until it's retried or removed.
    pub failed: Option<ErrorView>,
}
