//! Sign in with browser (PKCE, loopback): the desktop app's half. Unit W3-core.
//!
//! Core makes the PKCE verifier and `state`, has the platform's [`Loopback`] bind a one-shot
//! listener on `127.0.0.1`, and hands back the instance's `/#/desktop-login` URL for the app to
//! open. The user signs in there and approves; the page sends the browser to
//! `http://127.0.0.1:<port>/callback?code=...&state=...`. Core answers only that, and only with the
//! attempt's `state`, then redeems the code with the verifier, which never leaves core.

use std::sync::Arc;

use crate::client::Core;
use crate::model::BrowserSignInView;
use crate::platform::{CoreError, Loopback};
use crate::resync::unavailable;

/// How long the app waits for the browser: long enough to sign in from scratch.
pub const BROWSER_SIGN_IN_TIMEOUT_MS: u64 = 10 * 60 * 1000;

impl Core {
    /// The listener sign in with browser uses. Without one, `start_browser_sign_in` is
    /// unavailable.
    pub fn set_loopback(&self, _loopback: Arc<dyn Loopback>) {}

    /// Starts a browser sign-in against the server set last, replacing any attempt still waiting.
    /// Returns the URL to open in the browser. It carries the attempt's `state`: open it, never
    /// log it.
    pub async fn start_browser_sign_in(&self) -> Result<String, CoreError> {
        Err(unavailable("sign in with browser"))
    }

    /// Stops waiting for the browser. Nothing once the code is being redeemed.
    pub fn cancel_browser_sign_in(&self) {}

    /// `ViewKey::BrowserSignIn` says when to read again.
    pub fn browser_sign_in(&self) -> BrowserSignInView {
        BrowserSignInView::default()
    }
}
