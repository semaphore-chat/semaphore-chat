//! [`HttpBackend`] for [`SocialBackend`]: Friends and friend requests.

use async_trait::async_trait;
use semaphore_core::backend::SocialBackend;

use super::*;

#[async_trait]
impl SocialBackend for HttpBackend {}
