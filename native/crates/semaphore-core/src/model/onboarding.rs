//! Before and around signing in: registering, a forgotten password, invites, sign in with browser,
//! and creating a community. Unit W3-core.

use super::{ErrorView, LoadState};

/// Who may register, as the server advertises it (`ServerInfo::registration`). Registering always
/// takes an invite code on today's backend, whatever the mode: hide Register when `Closed`, and ask
/// for a code otherwise.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum RegistrationMode {
    Open,
    #[default]
    InviteOnly,
    Closed,
}

/// `Core::register`. `Debug` doesn't show the password.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct RegisterForm {
    pub username: String,
    pub password: String,
    pub email: Option<String>,
    pub invite_code: String,
}

impl std::fmt::Debug for RegisterForm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RegisterForm")
            .field("username", &self.username)
            .field("password", &"<hidden>")
            .field("email", &self.email)
            .field("invite_code", &self.invite_code)
            .finish()
    }
}

/// A usable instance invite, from `GET /invite/public/{code}`, before signing in. Its limits are
/// shown as they stood when read ("3 of 5 used", "expires ...").
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InvitePreview {
    pub code: String,
    /// The inviter's username, when the server says.
    pub created_by: Option<String>,
    pub uses: u32,
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
}

/// `Core::invite_preview`. `ViewKey::InvitePreview { code }` says when to read again. `Ready` with
/// no `invite`: the code can't be used. The server answers the same for a code that's unknown,
/// expired, used up or disabled, so nobody can tell which. `Failed` is a read that didn't get an
/// answer at all.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InvitePreviewView {
    pub state: LoadState,
    pub invite: Option<InvitePreview>,
}

/// Why a browser sign-in stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserSignInFailure {
    /// The user pressed Cancel on the browser's confirm page.
    Denied,
    /// The browser didn't come back within `commands::browser_sign_in::BROWSER_SIGN_IN_TIMEOUT_MS`.
    TimedOut,
    /// The server refused the code: it expired, was used, or the approving session ended.
    Refused { error: ErrorView },
    /// The listener couldn't be started.
    ListenFailed { message: String },
    /// The server doesn't offer it (`ServerInfo::browser_sign_in` is false).
    NotOffered,
}

/// `Core::browser_sign_in`. `ViewKey::BrowserSignIn` says when to read again. Success shows as
/// `SessionState::SignedIn`, and this goes back to `Idle`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum BrowserSignInView {
    #[default]
    Idle,
    /// The browser is open; `Core::cancel_browser_sign_in` stops waiting.
    Waiting {
        expires_at_ms: u64,
    },
    /// The browser came back with a code, which is being redeemed. Can't be cancelled.
    Redeeming,
    Failed {
        reason: BrowserSignInFailure,
    },
}

/// `Core::create_community`. No images at creation, as the web.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NewCommunity {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CreatedCommunity {
    pub id: String,
}
