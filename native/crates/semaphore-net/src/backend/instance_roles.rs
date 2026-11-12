//! [`HttpBackend`] for [`InstanceRolesBackend`]: instance roles. W6-E fills it; until then every call answers the
//! trait's "unsupported" default.

use semaphore_core::backend::InstanceRolesBackend;

use super::*;

impl InstanceRolesBackend for HttpBackend {}
