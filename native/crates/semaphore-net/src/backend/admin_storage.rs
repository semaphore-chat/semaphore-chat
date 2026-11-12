//! [`HttpBackend`] for [`AdminStorageBackend`]: per-user storage. W6-C fills it; until then every call answers the
//! trait's "unsupported" default.

use semaphore_core::backend::AdminStorageBackend;

use super::*;

impl AdminStorageBackend for HttpBackend {}
