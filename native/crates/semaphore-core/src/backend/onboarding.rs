//! Registering, a forgotten password, invites and creating a community. Unit W3-core. Register,
//! forgot password and the invite are public: they go out without a token, to the server set last.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait OnboardingBackend: Send + Sync {
    /// Public. Today's backend needs a valid invite `code` whatever the registration mode.
    async fn user_controller_register(
        &self,
        _body: wire::CreateUserDto,
    ) -> BackendResult<wire::UserEntity> {
        Err(unsupported("registering"))
    }
    /// Public. Answers the same whether or not the address has an account.
    async fn auth_controller_forgot_password(
        &self,
        _body: wire::ForgotPasswordRequestDto,
    ) -> BackendResult<wire::ForgotPasswordResponseDto> {
        Err(unsupported("password reset"))
    }
    /// Public. `None`: the server's empty answer for a code that is unknown, expired, used up or
    /// disabled, all alike.
    async fn invite_controller_get_public_invite(
        &self,
        _code: String,
    ) -> BackendResult<Option<wire::PublicInviteDto>> {
        Err(unsupported("reading an invite"))
    }
    async fn community_controller_create(
        &self,
        _body: wire::CreateCommunityDto,
    ) -> BackendResult<wire::CommunityResponseDto> {
        Err(unsupported("creating communities"))
    }
}
