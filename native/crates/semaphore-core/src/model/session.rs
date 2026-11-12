//! Signing in and out, and what a server says before anyone has.

use super::{ErrorView, RegistrationMode, UserView};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum SessionState {
    #[default]
    SignedOut,
    SigningIn,
    SignedIn {
        me: UserView,
    },
    SignInFailed {
        error: ErrorView,
    },
}

/// Why the last session ended, for the sign-in screen to say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignOutReason {
    /// The user signed out.
    SignedOut,
    /// The server refused the session: it expired, or was revoked elsewhere.
    Expired,
}

/// What a server says about itself before anyone signs in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerInfo {
    /// The URL requests go to, as it was normalised.
    pub url: String,
    pub name: Option<String>,
    pub max_file_bytes: Option<u64>,
    pub password_reset: bool,
    /// Who may register. Hide Register when `Closed`.
    pub registration: RegistrationMode,
    /// The server offers sign in with browser (`Core::start_browser_sign_in`).
    pub browser_sign_in: bool,
    /// W7: the server offers GIF search (`gifSearchEnabled`).
    pub gif_search: bool,
    /// W6: the server has no users yet and must be set up in a browser first (`GET
    /// /onboarding/status`'s `needsSetup`). The native app doesn't set an instance up: the
    /// connect screen says so and offers to open `url` in the browser. False until W6-app reads it.
    pub needs_setup: bool,
}

/// How `Core::restore_session` went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RestoreOutcome {
    /// Signed in as the stored session's user.
    SignedIn,
    /// Nothing stored for this server: sign in.
    NoSession,
    /// The server refused the stored session. It's forgotten; sign in again.
    Refused,
    /// The server didn't answer, or failed. The stored session is kept: try again.
    Unreachable { error: ErrorView },
}
