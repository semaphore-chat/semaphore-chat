//! [`HttpBackend`] for [`SearchBackend`]: Message search. The trait's defaults answer until each call is
//! implemented here.

use async_trait::async_trait;
use semaphore_core::backend::SearchBackend;

use super::HttpBackend;

#[async_trait]
impl SearchBackend for HttpBackend {}
