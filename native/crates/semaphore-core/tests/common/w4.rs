//! [`FakeBackend`] for W4: the replay and soundboard areas. Empty in the freeze; W4-core scripts
//! them as W3's are.

use super::FakeBackend;
use semaphore_core::backend::{ReplayBackend, SoundboardBackend};

impl ReplayBackend for FakeBackend {}

impl SoundboardBackend for FakeBackend {}
