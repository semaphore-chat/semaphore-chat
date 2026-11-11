//! Sign-in, session restore and sign-out, and token refresh.

use super::{REAUTHENTICATE_TIMEOUT_MS, jwt_expiry_ms};
use crate::cache::{CacheValue, keys};
use crate::client::{Core, user_view};
use crate::model::{RestoreOutcome, ServerInfo, SessionState, SignOutReason, ViewKey};
use crate::platform::CoreError;
use crate::realtime::RealtimeEvent;
use crate::resync::{failed, unavailable};
use semaphore_wire::events::REAUTHENTICATE;
use semaphore_wire::types as wire;
use serde_json::json;

impl Core {
    /// `tokenExpiring`: a new token, then give it to the live socket so it outlives the old one.
    /// Failing is left to the expiry: the server ends the session, and the transport recovers.
    pub(crate) async fn refresh_token(&self) {
        let Some(services) = self.services() else {
            return;
        };
        let body = wire::RefreshRequestDto {
            refresh_token: None,
        };
        let token = match services.backend.auth_controller_refresh(body).await {
            Ok(response) => response.access_token,
            Err(error) => {
                log::warn!("token refresh failed: {error}");
                return;
            }
        };
        if let Some(expiry) = jwt_expiry_ms(&token) {
            self.set_token_expiry(expiry);
        }
        let payload = json!({ "token": format!("Bearer {token}") });
        let result = services
            .realtime
            .emit_with_ack(
                REAUTHENTICATE.to_owned(),
                payload,
                REAUTHENTICATE_TIMEOUT_MS,
            )
            .await;
        match result {
            Ok(args) => {
                if let Some(result) = args.into_iter().next() {
                    self.ingest(RealtimeEvent::Reauthenticated { result });
                }
            }
            Err(error) => log::warn!("reauthenticating the socket failed: {error}"),
        }
    }

    pub async fn sign_in(
        &self,
        server_url: String,
        username: String,
        password: String,
    ) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("signing in"))?
            .clone();
        self.write(|state, _| {
            state.session = SessionState::SigningIn;
            state.view_changed(ViewKey::Session);
            state.reading.server_url = Some(server_url.clone());
        });
        services.backend.set_server_url(server_url);
        let body = wire::LoginRequestDto { password, username };
        let signed_in = async {
            let login = services.backend.auth_controller_login(body).await?;
            let profile = services.backend.user_controller_get_profile().await?;
            Ok::<_, crate::backend::BackendError>((login, profile))
        }
        .await;
        match signed_in {
            Ok((login, profile)) => self.signed_in(&services, &login.access_token, profile),
            Err(error) => self.write(|state, _| {
                state.session = SessionState::SignInFailed {
                    error: error.view(),
                };
                state.view_changed(ViewKey::Session);
            }),
        }
        Ok(())
    }

    /// A session is established: what sign-in and restore share.
    fn signed_in(
        &self,
        services: &crate::client::Services,
        access_token: &str,
        profile: wire::UserEntity,
    ) {
        self.write(|state, now| {
            let me = user_view(&profile);
            state.me = Some(me.clone());
            state.session = SessionState::SignedIn { me };
            state.sign_out_reason = None;
            state.token_expires_at_ms = jwt_expiry_ms(access_token);
            state
                .cache
                .set(keys::op(keys::PROFILE), CacheValue::Profile(profile), now);
            state.view_changed(ViewKey::Session);
            state.ensure_query(keys::op(keys::COMMUNITIES));
            state.ensure_query(keys::op(keys::UNREAD));
        });
        services.realtime.connect();
    }

    /// Resumes the session stored for `server_url` at an earlier run, with no password: the
    /// backend refreshes it, then core reads the profile and connects, as `sign_in` does. A refused
    /// session is forgotten and the session says why (`last_sign_out`). An unreachable server
    /// keeps it, signed out for now, for the caller to offer a retry.
    pub async fn restore_session(&self, server_url: String) -> Result<RestoreOutcome, CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("restoring a session"))?
            .clone();
        let server_url = server_url.trim_end_matches('/').to_owned();
        self.write(|state, _| state.reading.server_url = Some(server_url.clone()));
        services.backend.set_server_url(server_url);
        if !services.backend.has_stored_session() {
            return Ok(RestoreOutcome::NoSession);
        }
        self.write(|state, _| {
            state.session = SessionState::SigningIn;
            state.view_changed(ViewKey::Session);
        });
        let restored = async {
            let body = wire::RefreshRequestDto {
                refresh_token: None,
            };
            let refreshed = services.backend.auth_controller_refresh(body).await?;
            let profile = services.backend.user_controller_get_profile().await?;
            Ok::<_, crate::backend::BackendError>((refreshed, profile))
        }
        .await;
        match restored {
            Ok((refreshed, profile)) => {
                self.signed_in(&services, &refreshed.access_token, profile);
                Ok(RestoreOutcome::SignedIn)
            }
            Err(error) => {
                let refused = matches!(error.status, 401 | 403);
                self.write(|state, _| {
                    state.reset_signed_out();
                    if refused {
                        state.sign_out_reason = Some(SignOutReason::Expired);
                    }
                });
                if refused {
                    Ok(RestoreOutcome::Refused)
                } else {
                    Ok(RestoreOutcome::Unreachable {
                        error: error.view(),
                    })
                }
            }
        }
    }

    /// Ends the session and forgets everything from it.
    pub async fn sign_out(&self) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("signing out"))?
            .clone();
        // Before the session goes: leaving tells the server, and a call mustn't outlive a sign-out.
        if self.read(|state| state.voice.channel_id.is_some())
            && let Err(error) = self.leave_voice().await
        {
            log::warn!("leaving voice on sign-out: {error}");
        }
        services.realtime.disconnect();
        let body = wire::LogoutRequestDto {
            refresh_token: None,
        };
        if let Err(error) = services.backend.auth_controller_logout(body).await {
            log::warn!("logout failed, signing out here anyway: {error}");
        }
        self.write(|state, _| {
            state.reset_signed_out();
            state.sign_out_reason = Some(SignOutReason::SignedOut);
        });
        Ok(())
    }

    /// Why the last session ended, while signed out. `None` before any session has.
    pub fn last_sign_out(&self) -> Option<SignOutReason> {
        self.read(|state| state.sign_out_reason)
    }

    /// Asks a server about itself before signing in: whether it answers at all, and its name. Points
    /// the backend at `server_url`, as `sign_in` does.
    pub async fn probe_server(&self, server_url: String) -> Result<ServerInfo, CoreError> {
        let services = self.services().ok_or_else(|| unavailable("the backend"))?;
        let url = server_url.trim().trim_end_matches('/').to_owned();
        services.backend.set_server_url(url.clone());
        let settings = services
            .backend
            .instance_controller_get_public_settings()
            .await
            .map_err(failed)?;
        Ok(ServerInfo {
            url,
            name: Some(settings.name).filter(|name| !name.trim().is_empty()),
            max_file_bytes: u64::try_from(settings.max_file_size_bytes)
                .ok()
                .filter(|bytes| *bytes > 0),
            password_reset: settings.password_reset_enabled,
        })
    }

    pub fn session(&self) -> SessionState {
        self.read(|state| state.session.clone())
    }
}
