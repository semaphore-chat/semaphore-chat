//! [`FakeBackend`] for W2: direct messages, friends and notifications, scripted through
//! `FakeBackend::w2`.

use super::FakeBackend;
use semaphore_core::backend::{DmsBackend, NotifyBackend, SocialBackend};

#[derive(Default)]
pub struct W2Fakes {}

#[async_trait::async_trait]
impl DmsBackend for FakeBackend {}

#[async_trait::async_trait]
impl SocialBackend for FakeBackend {}

#[async_trait::async_trait]
impl NotifyBackend for FakeBackend {}
