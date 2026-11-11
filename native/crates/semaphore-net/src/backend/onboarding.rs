//! [`HttpBackend`] for [`OnboardingBackend`]: registering, forgot password, invites and creating
//! communities. The first three are public: they go out without a token.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, OnboardingBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl OnboardingBackend for HttpBackend {
    async fn user_controller_register(
        &self,
        body: wire::CreateUserDto,
    ) -> BackendResult<wire::UserEntity> {
        let (client, _, _) = self.anon_client()?;
        match client.user_controller_register(&body).await {
            Ok(response) => Ok(response.into_inner()),
            Err(error) => Err(convert(error).await),
        }
    }

    async fn auth_controller_forgot_password(
        &self,
        body: wire::ForgotPasswordRequestDto,
    ) -> BackendResult<wire::ForgotPasswordResponseDto> {
        let (client, _, _) = self.anon_client()?;
        match client.auth_controller_forgot_password(&body).await {
            Ok(response) => Ok(response.into_inner()),
            Err(error) => Err(convert(error).await),
        }
    }

    async fn invite_controller_get_public_invite(
        &self,
        code: String,
    ) -> BackendResult<wire::PublicInviteDto> {
        let (client, _, _) = self.anon_client()?;
        match client.invite_controller_get_public_invite(&code).await {
            Ok(response) => Ok(response.into_inner()),
            Err(error) => Err(convert(error).await),
        }
    }

    async fn community_controller_create(
        &self,
        body: wire::CreateCommunityDto,
    ) -> BackendResult<wire::CommunityResponseDto> {
        let body = &body;
        rpc!(self, c => c.community_controller_create(body))
    }
}
