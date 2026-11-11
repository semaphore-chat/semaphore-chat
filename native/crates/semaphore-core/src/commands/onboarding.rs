//! Registering, a forgotten password, invites and creating a community. Unit W3-core.
//!
//! Register, forgot password and the invite preview go to the server set last
//! (`Core::probe_server`), before anyone signs in.

use crate::client::Core;
use crate::model::{CreatedCommunity, InvitePreviewView, NewCommunity, RegisterForm};
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// Creates the account, then signs in with it, as the web does: the session shows how. Joining
    /// by invite is this with the invite's code. A refusal (taken name, bad code) is the server's
    /// message in `CoreError::Failed`.
    pub async fn register(&self, _form: RegisterForm) -> Result<(), CoreError> {
        Err(unavailable("registering"))
    }

    /// Asks the server to email a reset link. The reset itself happens in the web app the email
    /// opens. Succeeds whether or not the address has an account.
    pub async fn forgot_password(&self, _email: String) -> Result<(), CoreError> {
        Err(unavailable("password reset"))
    }

    /// An invite, before signing in. `ViewKey::InvitePreview { code }` says when to read again.
    pub fn invite_preview(&self, _code: String) -> InvitePreviewView {
        InvitePreviewView::default()
    }

    /// Creates a community this user owns. It joins `communities` at once.
    pub async fn create_community(
        &self,
        _community: NewCommunity,
    ) -> Result<CreatedCommunity, CoreError> {
        Err(unavailable("creating communities"))
    }
}
