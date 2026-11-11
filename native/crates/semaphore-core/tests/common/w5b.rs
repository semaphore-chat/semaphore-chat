//! [`FakeBackend`] for W5-B: roles and overrides. Empty in the freeze; W5-B scripts it (and the
//! moderation calls in `ModerationBackend`, whose W5 methods default) as W4's areas are.

use super::FakeBackend;
use semaphore_core::backend::RolesBackend;

impl RolesBackend for FakeBackend {}
