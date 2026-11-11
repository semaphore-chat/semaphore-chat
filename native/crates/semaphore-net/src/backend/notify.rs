//! [`HttpBackend`] for [`NotifyBackend`]: The notification centre, settings and channel levels.

use async_trait::async_trait;
use semaphore_core::backend::NotifyBackend;

use super::*;

#[async_trait]
impl NotifyBackend for HttpBackend {}
