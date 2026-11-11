//! [`FakeBackend`] for W1 part A: pins, moderator removal, channel roles. The trait's defaults
//! answer until a test needs a call.

use super::FakeBackend;
use semaphore_core::backend::ModerationBackend;

#[async_trait::async_trait]
impl ModerationBackend for FakeBackend {}
