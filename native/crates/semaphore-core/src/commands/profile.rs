//! Profiles: reading anyone's, editing this user's own with avatar and banner. Unit W3-core.

use crate::client::Core;
use crate::model::{ProfileEditView, ProfilePatch, ProfileView};
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// A user's profile; this user's own when `user_id` is theirs. `ViewKey::Profile { user_id }`
    /// says when to read again.
    pub fn profile(&self, _user_id: String) -> ProfileView {
        ProfileView::default()
    }

    /// The edit on its way, for the edit form. `ViewKey::ProfileEdit` says when to read again.
    pub fn profile_edit(&self) -> ProfileEditView {
        ProfileEditView::default()
    }

    /// Changes what the patch sets. New images go up first (progress in `profile_edit`), then one
    /// update; the text shows at once and goes back if the server refuses, images once it agrees.
    /// Fails if an upload or the update fails, with nothing changed.
    pub async fn update_profile(&self, _patch: ProfilePatch) -> Result<(), CoreError> {
        Err(unavailable("editing the profile"))
    }
}
