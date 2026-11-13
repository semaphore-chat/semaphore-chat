//! Registering, a forgotten password, invites and creating a community. Unit W3-core. Register,
//! forgot password and the invite are public: they go out without a token, to the server set last.
//! Joining an invite as an existing account needs a session.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait OnboardingBackend: Send + Sync {
    /// Public. A valid invite `code` is required when the instance is invite-only, and optional
    /// when registration is open (`POST /users` honours the instance's registration mode).
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
    /// Public. Redeems a reset token for a new password. A wrong, used or expired token is the
    /// server's one message for all three ("Invalid or expired reset token").
    async fn auth_controller_reset_password(
        &self,
        _body: wire::ResetPasswordRequestDto,
    ) -> BackendResult<wire::ResetPasswordResponseDto> {
        Err(unsupported("resetting a password"))
    }
    /// Public. The server answers a code it won't honour with a 404 and an `INVITE_*` code
    /// (older builds sent an empty 200, which reads as no invite).
    async fn invite_controller_get_public_invite(
        &self,
        _code: String,
    ) -> BackendResult<Option<wire::PublicInviteDto>> {
        Err(unsupported("reading an invite"))
    }
    /// Public. W6: `needsSetup` says the instance has no users yet and must be set up in a
    /// browser (`ServerInfo::needs_setup`). The answer also carries a setup token: never log or
    /// keep it. `Core::probe_server` reads it.
    async fn onboarding_controller_get_status(&self) -> BackendResult<wire::OnboardingStatusDto> {
        Err(unsupported("the setup status"))
    }
    /// A session. Joins the communities an invite names, as an existing account: each is joined
    /// or skipped with why (already a member, banned).
    async fn invite_controller_accept_invite(
        &self,
        _code: String,
    ) -> BackendResult<wire::AcceptInviteResponseDto> {
        Err(unsupported("joining an invite"))
    }
    async fn community_controller_create(
        &self,
        _body: wire::CreateCommunityDto,
    ) -> BackendResult<wire::CommunityResponseDto> {
        Err(unsupported("creating communities"))
    }
}
