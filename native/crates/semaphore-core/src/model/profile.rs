//! Profiles: anyone's, and editing this user's own. Unit W3-core.

use super::{DraftFile, ErrorView, LoadState, UploadView, UserView};

/// A user's profile, from `GET /users/profile` (this user) or `GET /users/{id}`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Profile {
    /// Name and avatar. `avatar_file_id` is a file id for `Core::file`.
    pub user: UserView,
    pub bio: Option<String>,
    /// The custom status line.
    pub status: Option<String>,
    pub banner_file_id: Option<String>,
    /// This signed-in user's own profile: it can be edited.
    pub is_me: bool,
}

/// `Core::profile`. `ViewKey::Profile { user_id }` says when to read again. While an edit is on its
/// way, this user's own profile shows the text it sets.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProfileView {
    pub state: LoadState,
    pub profile: Option<Profile>,
}

/// A new avatar or banner, or none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageChange {
    Remove,
    Set { file: DraftFile },
}

/// What `Core::update_profile` changes: each `None` is left as it is. An empty `bio` or `status`
/// clears it; `display_name` is 1 to 32 characters once trimmed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProfilePatch {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub status: Option<String>,
    pub avatar: Option<ImageChange>,
    pub banner: Option<ImageChange>,
}

/// The profile edit on its way, for the edit form. `ViewKey::ProfileEdit` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProfileEditView {
    /// An edit is on its way: the form's Save waits.
    pub saving: bool,
    /// The image going up now, while it does.
    pub upload: Option<UploadView>,
    /// Why the last edit failed, until the next one starts.
    pub error: Option<ErrorView>,
}
