//! [`HttpBackend`] for [`ModerationBackend`]: Pins, moderator removal and channel roles. The trait's defaults answer until each call is
//! implemented here.

use async_trait::async_trait;
use semaphore_core::backend::ModerationBackend;

use super::HttpBackend;

#[async_trait]
impl ModerationBackend for HttpBackend {}
