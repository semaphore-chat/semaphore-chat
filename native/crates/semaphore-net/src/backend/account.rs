//! [`HttpBackend`] for [`AccountBackend`]: the profile, sessions and appearance settings.

use async_trait::async_trait;
use semaphore_core::backend::AccountBackend;

use super::*;

#[async_trait]
impl AccountBackend for HttpBackend {}
