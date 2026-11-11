//! [`FakeBackend`] for W1 part B: threads and search. The traits' defaults answer until a test
//! needs a call.

use super::FakeBackend;
use semaphore_core::backend::{SearchBackend, ThreadsBackend};

#[async_trait::async_trait]
impl ThreadsBackend for FakeBackend {}

#[async_trait::async_trait]
impl SearchBackend for FakeBackend {}
