//! Signing in and out, and what a server says before anyone has.

use super::{ErrorView, UserView};

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
