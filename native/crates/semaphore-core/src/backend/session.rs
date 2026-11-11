//! Sessions, users and what a server says before sign-in.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend).
#[async_trait]
pub trait SessionBackend: Send + Sync {
    /// Where the next requests go, from `Core::sign_in`. The client is built per server.
    fn set_server_url(&self, server_url: String);

    /// A session for the server set last survives from an earlier run: a refresh can resume it
    /// without a password. `Core::restore_session` asks before refreshing.
    fn has_stored_session(&self) -> bool {
        false
    }

    // Session
    async fn auth_controller_login(
        &self,
        body: wire::LoginRequestDto,
    ) -> BackendResult<wire::LoginResponseDto>;
    /// An empty `refresh_token` means the one this implementation holds.
    async fn auth_controller_refresh(
        &self,
        body: wire::RefreshRequestDto,
    ) -> BackendResult<wire::LoginResponseDto>;
    async fn auth_controller_logout(
        &self,
        body: wire::LogoutRequestDto,
    ) -> BackendResult<wire::LogoutResponseDto>;
    /// Sign in with browser, the last step: the code the browser handed back and the PKCE verifier,
    /// for a session of this device's own. Stores the tokens as `auth_controller_login` does. The
    /// body holds secrets: never log it.
    async fn auth_controller_redeem_desktop_login(
        &self,
        _body: wire::DesktopLoginTokenRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        Err(unsupported("sign in with browser"))
    }
    async fn user_controller_get_profile(&self) -> BackendResult<wire::UserEntity>;
    async fn user_controller_get_user_by_id(&self, id: String) -> BackendResult<wire::UserEntity>;

    // Instance
    /// Before sign-in, against the server URL set last. A backend that has no such call says so.
    async fn instance_controller_get_public_settings(
        &self,
    ) -> BackendResult<wire::PublicSettingsResponseDto> {
        Err(unsupported("reading a server's public settings"))
    }
}
