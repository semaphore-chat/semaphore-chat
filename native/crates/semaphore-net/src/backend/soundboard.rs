//! [`HttpBackend`] for [`SoundboardBackend`]. Empty until W4-core.

use async_trait::async_trait;
use semaphore_core::backend::SoundboardBackend;

use super::HttpBackend;

#[async_trait]
impl SoundboardBackend for HttpBackend {}
