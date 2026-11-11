//! [`FakeBackend`] for W5-A: running a community. Empty in the freeze; W5-A scripts it as W4's
//! areas are.

use super::FakeBackend;
use semaphore_core::backend::CommunityAdminBackend;

impl CommunityAdminBackend for FakeBackend {}
