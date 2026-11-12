//! [`HttpBackend`] for [`InstanceAdminBackend`]: the admin dashboard and instance settings. W6-A fills it; until then every call answers the
//! trait's "unsupported" default.

use semaphore_core::backend::InstanceAdminBackend;

use super::*;

impl InstanceAdminBackend for HttpBackend {}
