//! [`HttpBackend`] for [`AdminUsersBackend`]: users: the list, one user, owner role, ban, password, delete and instance role assignment. W6-B fills it; until then every call answers the
//! trait's "unsupported" default.

use semaphore_core::backend::AdminUsersBackend;

use super::*;

impl AdminUsersBackend for HttpBackend {}
