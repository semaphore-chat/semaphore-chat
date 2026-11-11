//! [`HttpBackend`] for [`OnboardingBackend`]: registering, forgot password, invites and creating
//! communities.

use async_trait::async_trait;
use semaphore_core::backend::OnboardingBackend;

use super::*;

#[async_trait]
impl OnboardingBackend for HttpBackend {}
