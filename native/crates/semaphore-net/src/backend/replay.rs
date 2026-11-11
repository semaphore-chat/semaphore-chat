//! [`HttpBackend`] for [`ReplayBackend`]: the replay buffer and clips. Empty until W4-core.

use async_trait::async_trait;
use semaphore_core::backend::ReplayBackend;

use super::HttpBackend;

#[async_trait]
impl ReplayBackend for HttpBackend {}
