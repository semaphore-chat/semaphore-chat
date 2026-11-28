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
    /// Stable while the others come and go, so Retry and Remove name this file, not a place.
    pub id: u64,
    pub name: String,
    pub size_bytes: u64,
    pub sent_bytes: u64,
    /// Why it stopped, until it's retried or removed.
    pub failed: Option<ErrorView>,
}

/// Part of a file, and the whole file's size when the server said it: enough for a client to write
/// an opened file without holding all of it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileRange {
    pub bytes: Vec<u8>,
    pub size: Option<u64>,
}
