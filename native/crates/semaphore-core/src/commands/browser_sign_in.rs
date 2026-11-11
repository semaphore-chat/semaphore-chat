//! Sign in with browser (PKCE, loopback): the desktop app's half. Unit W3-core.
//!
//! Core makes the PKCE verifier and `state`, has the platform's [`Loopback`] bind a one-shot
//! listener on `127.0.0.1`, and hands back the instance's `/#/desktop-login` URL for the app to
//! open. The user signs in there and approves; the page sends the browser to
//! `http://127.0.0.1:<port>/callback?code=...&state=...`. Core answers only that, and only with the
//! attempt's `state`, then redeems the code with the verifier, which never leaves core.
//!
//! One attempt at a time, numbered: starting one, cancelling, a password sign-in or a change of
//! server ends the one before, and whatever it was still waiting for is dropped when it arrives.
//! The listener closes as soon as a code (or a cancel from the browser) arrives, at the timeout,
//! or when the attempt ends. A code being redeemed can't be cancelled: the server has made a
//! session for it by the time it answers.

use std::collections::HashMap;
use std::sync::Arc;

use crate::client::{Core, Effect, State};
use crate::model::{
    BrowserSignInFailure, BrowserSignInView, InvitePreviewView, ServerInfo, SessionState, ViewKey,
};
use crate::pkce::{self, Callback, Secret};
use crate::platform::{CoreError, Loopback, LoopbackListener, LoopbackPage};
use crate::resync::unavailable;
use semaphore_wire::types as wire;

/// How long the app waits for the browser: long enough to sign in from scratch.
pub const BROWSER_SIGN_IN_TIMEOUT_MS: u64 = 10 * 60 * 1000;

/// What outlives a session: the server in use and what was learned of it before signing in.
#[derive(Default)]
pub struct AuthState {
    /// The server set last, by a probe, sign-in or restore.
    pub(crate) server_url: Option<String>,
    /// What the last probe of `server_url` said.
    pub(crate) server_info: Option<ServerInfo>,
    pub(crate) loopback: Option<Arc<dyn Loopback>>,
    /// The number of the newest attempt. Anything carrying another is over.
    pub(crate) attempt: u64,
    pub(crate) browser: BrowserSignInView,
    /// The newest attempt's listener and secrets, while it waits.
    pub(crate) waiting: Option<Attempt>,
    /// Invite previews, by code.
    pub(crate) invites: HashMap<String, InvitePreviewView>,
}

pub(crate) struct Attempt {
    number: u64,
    listener: Arc<dyn LoopbackListener>,
    verifier: Secret,
    state: Secret,
    server_url: String,
    deadline_ms: u64,
}

impl State {
    /// Requests go to this server from now on. Another server's invites and attempt are over.
    pub(crate) fn use_server(&mut self, server_url: &str) {
        let url = server_url.trim().trim_end_matches('/').to_owned();
        if self.auth.server_url.as_deref() == Some(url.as_str()) {
            return;
        }
        self.auth.server_url = Some(url);
        self.auth.server_info = None;
        let codes: Vec<String> = self.auth.invites.drain().map(|(code, _)| code).collect();
        for code in codes {
            self.view_changed(ViewKey::InvitePreview { code });
        }
        self.end_attempt();
    }

    pub(crate) fn server_probed(&mut self, info: &ServerInfo) {
        self.use_server(&info.url);
        self.auth.server_info = Some(info.clone());
    }

    /// Ends the waiting attempt, if any, and closes its listener. Not one being redeemed.
    fn end_attempt(&mut self) {
        if matches!(self.auth.browser, BrowserSignInView::Redeeming) {
            return;
        }
        self.auth.attempt += 1;
        if let Some(attempt) = self.auth.waiting.take() {
            attempt.listener.close();
        }
        if !matches!(self.auth.browser, BrowserSignInView::Idle) {
            self.auth.browser = BrowserSignInView::Idle;
            self.view_changed(ViewKey::BrowserSignIn);
        }
    }

    fn browser_failed(&mut self, reason: BrowserSignInFailure) {
        self.auth.browser = BrowserSignInView::Failed { reason };
        self.view_changed(ViewKey::BrowserSignIn);
    }
}

impl Core {
    /// The listener sign in with browser uses. Without one, `start_browser_sign_in` is
    /// unavailable.
    pub fn set_loopback(&self, loopback: Arc<dyn Loopback>) {
        self.write(|state, _| state.auth.loopback = Some(loopback));
    }

    /// Starts a browser sign-in against the server set last, replacing any attempt still waiting.
    /// Returns the URL to open in the browser. It carries the attempt's `state`: open it, never
    /// log it.
    pub async fn start_browser_sign_in(&self) -> Result<String, CoreError> {
        self.services()
            .ok_or_else(|| unavailable("sign in with browser"))?;
        let (loopback, server_url, info, number) = self.write(|state, _| {
            if matches!(state.session, SessionState::SignedIn { .. }) {
                return Err(CoreError::Failed {
                    message: "already signed in".into(),
                });
            }
            if matches!(state.auth.browser, BrowserSignInView::Redeeming) {
                return Err(CoreError::Failed {
                    message: "a browser sign-in is finishing".into(),
                });
            }
            let loopback = state
                .auth
                .loopback
                .clone()
                .ok_or_else(|| unavailable("sign in with browser"))?;
            let server_url = state
                .auth
                .server_url
                .clone()
                .ok_or_else(|| CoreError::Failed {
                    message: "no server is set".into(),
                })?;
            state.end_attempt();
            Ok((
                loopback,
                server_url,
                state.auth.server_info.clone(),
                state.auth.attempt,
            ))
        })?;
        let info = match info {
            Some(info) => info,
            None => self.probe_server(server_url.clone()).await?,
        };
        let current = |core: &Core| core.read(|state| state.auth.attempt == number);
        if !current(self) {
            return Err(replaced());
        }
        if !info.browser_sign_in {
            self.write(|state, _| {
                if state.auth.attempt == number {
                    state.browser_failed(BrowserSignInFailure::NotOffered);
                }
            });
            return Err(CoreError::Failed {
                message: "this server doesn't offer sign in with browser".into(),
            });
        }
        let secrets =
            pkce::random_token().and_then(|verifier| Ok((verifier, pkce::random_token()?)));
        let (verifier, attempt_state) = match secrets {
            Ok(secrets) => secrets,
            Err(message) => {
                self.write(|state, _| {
                    if state.auth.attempt == number {
                        state.browser_failed(BrowserSignInFailure::ListenFailed {
                            message: message.clone(),
                        });
                    }
                });
                return Err(CoreError::Failed { message });
            }
        };
        let listener = match loopback.bind().await {
            Ok(listener) => listener,
            Err(error) => {
                let message = error.to_string();
                self.write(|state, _| {
                    if state.auth.attempt == number {
                        state.browser_failed(BrowserSignInFailure::ListenFailed {
                            message: message.clone(),
                        });
                    }
                });
                return Err(error);
            }
        };
        let port = listener.port();
        let url = pkce::sign_in_url(
            &server_url,
            &pkce::challenge(&verifier),
            &attempt_state,
            port,
        );
        let started = self.write(|state, now| {
            // Cancelled, or replaced, while the listener was starting.
            if state.auth.attempt != number || state.auth.server_url.as_deref() != Some(&server_url)
            {
                return false;
            }
            let deadline_ms = now + BROWSER_SIGN_IN_TIMEOUT_MS;
            state.auth.waiting = Some(Attempt {
                number,
                listener: listener.clone(),
                verifier,
                state: attempt_state,
                server_url: server_url.clone(),
                deadline_ms,
            });
            state.auth.browser = BrowserSignInView::Waiting {
                expires_at_ms: deadline_ms,
            };
            state.view_changed(ViewKey::BrowserSignIn);
            state.push_effect(Effect::BrowserSignIn(number));
            true
        });
        if !started {
            listener.close();
            return Err(replaced());
        }
        Ok(url)
    }

    /// Stops waiting for the browser. Nothing once the code is being redeemed.
    pub fn cancel_browser_sign_in(&self) {
        self.write(|state, _| state.end_attempt());
    }

    /// `ViewKey::BrowserSignIn` says when to read again.
    pub fn browser_sign_in(&self) -> BrowserSignInView {
        self.read(|state| state.auth.browser.clone())
    }

    /// `Effect::BrowserSignIn`: answers the listener's requests until a code, a cancel from the
    /// browser, the timeout or the end of the attempt, then redeems the code.
    pub(crate) async fn run_browser_sign_in(&self, number: u64) {
        let Some((listener, port, attempt_state, deadline_ms)) = self.read(|state| {
            state
                .auth
                .waiting
                .as_ref()
                .filter(|attempt| attempt.number == number)
                .map(|attempt| {
                    (
                        attempt.listener.clone(),
                        attempt.listener.port(),
                        attempt.state.clone(),
                        attempt.deadline_ms,
                    )
                })
        }) else {
            return;
        };
        let code = loop {
            let remaining = deadline_ms.saturating_sub(self.now_ms());
            let request = if remaining == 0 {
                None
            } else {
                listener.next(remaining).await
            };
            let current = self.read(|state| state.auth.attempt == number);
            let Some(request) = request else {
                listener.close();
                self.write(|state, _| {
                    if state.auth.attempt == number {
                        state.auth.waiting = None;
                        state.browser_failed(BrowserSignInFailure::TimedOut);
                    }
                });
                return;
            };
            if !current {
                listener.reply(request.id, LoopbackPage::BadRequest);
                listener.close();
                return;
            }
            match pkce::check_callback(&request, port, &attempt_state) {
                Callback::Bad => {
                    log::debug!("browser sign-in: refused {request:?}");
                    listener.reply(request.id, LoopbackPage::BadRequest);
                }
                Callback::Denied => {
                    listener.reply(request.id, LoopbackPage::Denied);
                    listener.close();
                    self.write(|state, _| {
                        if state.auth.attempt == number {
                            state.auth.waiting = None;
                            state.browser_failed(BrowserSignInFailure::Denied);
                        }
                    });
                    return;
                }
                Callback::Code(code) => {
                    listener.reply(request.id, LoopbackPage::SignedIn);
                    listener.close();
                    break code;
                }
            }
        };
        let Some((verifier, server_url)) = self.write(|state, _| {
            let attempt = state
                .auth
                .waiting
                .take_if(|attempt| attempt.number == number)?;
            state.auth.browser = BrowserSignInView::Redeeming;
            state.view_changed(ViewKey::BrowserSignIn);
            Some((attempt.verifier, attempt.server_url))
        }) else {
            return;
        };
        self.redeem(number, code, verifier, server_url).await;
    }

    async fn redeem(&self, number: u64, code: Secret, verifier: Secret, server_url: String) {
        let Some(services) = self.services().cloned() else {
            return;
        };
        let body = match (code.expose().parse(), verifier.expose().parse()) {
            (Ok(code), Ok(code_verifier)) => wire::DesktopLoginTokenRequestDto {
                code,
                code_verifier,
            },
            // Neither can happen: both were checked, or made, here. Say nothing of their values.
            _ => {
                self.write(|state, _| {
                    state.browser_failed(BrowserSignInFailure::ListenFailed {
                        message: "the sign-in code was malformed".into(),
                    })
                });
                return;
            }
        };
        let redeemed = async {
            let login = services
                .backend
                .auth_controller_redeem_desktop_login(body)
                .await?;
            let profile = services.backend.user_controller_get_profile().await?;
            Ok::<_, crate::backend::BackendError>((login, profile))
        }
        .await;
        let still = self.read(|state| {
            state.auth.attempt == number
                && state.auth.server_url.as_deref() == Some(server_url.as_str())
                && !matches!(state.session, SessionState::SignedIn { .. })
        });
        match redeemed {
            Ok((login, profile)) if still => {
                self.write(|state, _| {
                    state.auth.browser = BrowserSignInView::Idle;
                    state.view_changed(ViewKey::BrowserSignIn);
                    state.reading.server_url = Some(server_url.clone());
                });
                self.signed_in(&services, &login.access_token, profile);
            }
            Ok(_) => {
                log::warn!("a browser sign-in finished after it was replaced; dropped");
                self.write(|state, _| {
                    if matches!(state.auth.browser, BrowserSignInView::Redeeming) {
                        state.auth.browser = BrowserSignInView::Idle;
                        state.view_changed(ViewKey::BrowserSignIn);
                    }
                });
            }
            Err(error) => {
                log::warn!("redeeming a browser sign-in failed: {error}");
                self.write(|state, _| {
                    if matches!(state.auth.browser, BrowserSignInView::Redeeming) {
                        state.browser_failed(BrowserSignInFailure::Refused {
                            error: error.view(),
                        });
                    }
                });
            }
        }
    }
}

fn replaced() -> CoreError {
    CoreError::Failed {
        message: "replaced by another sign-in".into(),
    }
}
