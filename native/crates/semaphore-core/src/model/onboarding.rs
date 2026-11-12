//! Before and around signing in: registering, a forgotten password, invites, sign in with browser,
//! and creating a community. Unit W3-core.

use super::{ErrorView, LoadState};

/// Who may register, as the server advertises it (`ServerInfo::registration`). `Closed` takes no
/// registrations at all, `InviteOnly` needs a usable invite code, and `Open` takes an account
/// without one (a code, when given, still joins its communities).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum RegistrationMode {
    Open,
    #[default]
    InviteOnly,
    Closed,
}

/// Whether the register screen offers an account, and whether its invite-code field is required.
/// `Core::register_requirements`, read from the probed server's mode: hide Register when
/// `can_register` is false, and mark the code required when it is.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RegisterRequirements {
    pub mode: RegistrationMode,
    pub can_register: bool,
    /// The instance is invite-only: a code is needed (and `Core::register` refuses without one).
    pub invite_required: bool,
}

/// `Core::register`. `Debug` doesn't show the password.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct RegisterForm {
    pub username: String,
    pub password: String,
    pub email: Option<String>,
    /// Empty on an open instance, where the account joins no community.
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
/// no `invite`: the code can't be used, and `reason` is the server's own words ("This invite has
/// expired.") when it said why. `Failed` is a read that didn't get an answer at all.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InvitePreviewView {
    pub state: LoadState,
    pub invite: Option<InvitePreview>,
    /// Why the code can't be used: the server's `INVITE_EXPIRED` / `INVITE_EXHAUSTED` /
    /// `INVITE_DISABLED` / `INVITE_NOT_FOUND` message, or `None` when it didn't say (an older
    /// server answers every unusable code the same, with nothing).
    pub reason: Option<String>,
}

/// A community an invite joined, from `Core::accept_invite`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct JoinedCommunity {
    pub id: String,
    pub name: String,
}

/// Why an invite skipped a community.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum InviteSkipReason {
    /// Already a member: the invite spent no use on it.
    #[default]
    AlreadyMember,
    Banned,
    /// A reason this build doesn't know.
    Other,
}

/// A community an invite didn't join, and why.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SkippedInviteCommunity {
    pub id: String,
    pub name: String,
    pub reason: InviteSkipReason,
}

/// What `Core::accept_invite` did: an invite's communities, joined or skipped with why. Both can be
/// empty (an invite that names no community), and `joined` is what the join screen opens first.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InviteJoin {
    pub joined: Vec<JoinedCommunity>,
    pub skipped: Vec<SkippedInviteCommunity>,
}

impl InviteJoin {
    /// Nothing was joined and nothing was skipped: an invite for the instance alone.
    pub fn is_empty(&self) -> bool {
        self.joined.is_empty() && self.skipped.is_empty()
    }
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
