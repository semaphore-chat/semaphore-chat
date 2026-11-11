//! [`HttpBackend`] for [`CommunityAdminBackend`]. Empty in the W5 freeze: W5-A fills these in.

use async_trait::async_trait;
use semaphore_core::backend::CommunityAdminBackend;

use super::*;

#[async_trait]
impl CommunityAdminBackend for HttpBackend {}
