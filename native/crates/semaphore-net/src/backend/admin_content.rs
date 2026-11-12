//! [`HttpBackend`] for [`AdminContentBackend`]: every community and force delete (instance invites are W5-A's `CommunityAdminBackend` calls). W6-D fills it; until then every call answers the
//! trait's "unsupported" default.

use semaphore_core::backend::AdminContentBackend;

use super::*;

impl AdminContentBackend for HttpBackend {}
