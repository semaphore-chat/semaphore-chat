//! [`HttpBackend`] for [`DmsBackend`]: Direct messages, groups and user search.

use async_trait::async_trait;
use semaphore_core::backend::DmsBackend;

use super::*;

#[async_trait]
impl DmsBackend for HttpBackend {}
