//! [`HttpBackend`] for [`ThreadsBackend`]: Thread metadata and subscriptions. The trait's defaults answer until each call is
//! implemented here.

use async_trait::async_trait;
use semaphore_core::backend::ThreadsBackend;

use super::HttpBackend;

#[async_trait]
impl ThreadsBackend for HttpBackend {}
