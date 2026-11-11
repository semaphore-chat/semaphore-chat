//! [`HttpBackend`] for [`SessionBackend`].

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, SessionBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl SessionBackend for HttpBackend {
    fn set_server_url(&self, server_url: String) {
        let url = server_url.trim_end_matches('/').to_owned();
        if self.inner.lock().server_url.as_deref() == Some(url.as_str()) {
            return;
        }
        let anon = self.inner.build(&url, None);
        let mut state = self.inner.lock();
        if state.server_url.as_deref() == Some(url.as_str()) {
            return;
        }
        // Tokens belong to one server. Its stored refresh token stays, under its own key.
        state.next_generation();
        state.access = None;
        // The session stored at the last run, if it was this server's.
        state.refresh = {
            let mut stored = self
                .inner
                .stored
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match stored.take() {
                Some((stored_url, token)) if stored_url == url => Some(token),
                other => {
                    *stored = other;
                    None
                }
            }
        };
        state.authed = anon.clone();
        state.anon = anon;
        state.server_url = Some(url);
    }

    fn has_stored_session(&self) -> bool {
        self.inner.lock().refresh.is_some()
    }

    async fn auth_controller_login(
        &self,
        body: wire::LoginRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        let (client, url, generation) = self.anon_client()?;
        let device_id = self.inner.device_id;
        let response = match client
            .auth_controller_login(
                Some(wire::AuthControllerLoginXClientType::DesktopNative),
                Some(&device_id),
                super::device_name().as_ref(),
                &body,
            )
            .await
        {
            Ok(response) => response.into_inner(),
            Err(error) => return Err(convert(error).await),
        };
        self.establish(response, url, generation).await
    }

    async fn auth_controller_redeem_desktop_login(
        &self,
        body: wire::DesktopLoginTokenRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        let (client, url, generation) = self.anon_client()?;
        let device_id = self.inner.device_id;
        let response = match client
            .auth_controller_redeem_desktop_login(
                Some(wire::AuthControllerRedeemDesktopLoginXClientType::DesktopNative),
                Some(&device_id),
                super::device_name().as_ref(),
                &body,
            )
            .await
        {
            Ok(response) => response.into_inner(),
            Err(error) => return Err(convert(error).await),
        };
        self.establish(response, url, generation).await
    }

    async fn auth_controller_refresh(
        &self,
        body: wire::RefreshRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        let seen = self.inner.lock().seen();
        let explicit = body.refresh_token.filter(|token| !token.is_empty());
        let access = self.refresh_shared(seen, explicit).await?;
        Ok(wire::LoginResponseDto {
            access_token: access.0,
            refresh_token: None,
        })
    }

    async fn auth_controller_logout(
        &self,
        body: wire::LogoutRequestDto,
    ) -> BackendResult<wire::LogoutResponseDto> {
        let explicit = body.refresh_token.filter(|token| !token.is_empty());
        tokio::spawn(self.inner.clone().logout(explicit))
            .await
            .unwrap_or_else(|_| Err(failure("the sign-out was interrupted")))
    }

    async fn user_controller_get_profile(&self) -> BackendResult<wire::UserEntity> {
        rpc!(self, c => c.user_controller_get_profile())
    }

    async fn user_controller_get_user_by_id(&self, id: String) -> BackendResult<wire::UserEntity> {
        let id = id.as_str();
        rpc!(self, c => c.user_controller_get_user_by_id(id))
    }

    /// Public, so it goes out without a token: it's how a server is tested before signing in.
    async fn instance_controller_get_public_settings(
        &self,
    ) -> BackendResult<wire::PublicSettingsResponseDto> {
        let client = self
            .inner
            .lock()
            .anon
            .clone()
            .ok_or_else(|| failure("no server URL is set"))?;
        match client.instance_controller_get_public_settings().await {
            Ok(response) => Ok(response.into_inner()),
            Err(error) => Err(convert(error).await),
        }
    }
}

impl HttpBackend {
    /// The client for calls made before there's a session, with what a sign-in checks it against.
    pub(super) fn anon_client(&self) -> BackendResult<(Arc<Client>, Option<String>, u64)> {
        let state = self.inner.lock();
        let client = state
            .anon
            .clone()
            .ok_or_else(|| failure("no server URL is set"))?;
        Ok((client, state.server_url.clone(), state.generation))
    }

    /// A sign-in's tokens become the session: login and sign in with browser share this. Only the
    /// access token goes back to core.
    async fn establish(
        &self,
        response: wire::LoginResponseDto,
        url: Option<String>,
        generation: u64,
    ) -> BackendResult<wire::LoginResponseDto> {
        let access = Token(response.access_token);
        let refresh = response.refresh_token.map(Token);
        let authed = url
            .as_deref()
            .and_then(|url| self.inner.build(url, Some(&access)));
        let stored = {
            let mut state = self.inner.lock();
            // Signed out or moved to another server while this ran: it answers for nothing now.
            if state.generation != generation {
                return Err(session_changed());
            }
            // A refresh of the session before this one must not overwrite it.
            state.next_generation();
            state.authed = authed;
            state.access = Some(access.clone());
            let op = url.as_deref().map(|url| {
                let key = secret_key(url);
                match &refresh {
                    Some(refresh) => StoreOp::Save {
                        key,
                        value: refresh.0.clone(),
                    },
                    // What's stored belongs to a session this client no longer holds.
                    None => {
                        log::warn!(
                            "the server sent no refresh token; the session cannot be renewed"
                        );
                        StoreOp::Delete { key }
                    }
                }
            });
            state.refresh = refresh;
            op.and_then(|op| self.inner.store(op))
        };
        self.inner.stored(stored).await;
        Ok(wire::LoginResponseDto {
            access_token: access.0,
            refresh_token: None,
        })
    }
}
