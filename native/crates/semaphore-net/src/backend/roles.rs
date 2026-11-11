//! [`HttpBackend`] for [`RolesBackend`]. Empty in the W5 freeze: W5-B fills these in.

use async_trait::async_trait;
use semaphore_core::backend::RolesBackend;

use super::*;

#[async_trait]
impl RolesBackend for HttpBackend {}
