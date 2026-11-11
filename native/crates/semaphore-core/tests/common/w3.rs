//! [`FakeBackend`] for W3: the account and onboarding areas.

use super::FakeBackend;
use semaphore_core::backend::{AccountBackend, OnboardingBackend};

#[async_trait::async_trait]
impl AccountBackend for FakeBackend {}

#[async_trait::async_trait]
impl OnboardingBackend for FakeBackend {}
