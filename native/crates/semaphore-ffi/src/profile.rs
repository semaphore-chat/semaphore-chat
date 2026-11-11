//! W3's profiles.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    DraftFile, ErrorView, ImageChange, LoadState, Profile, ProfileEditView, ProfileImage,
    ProfilePatch, ProfileUpload, ProfileView, UploadView, UserView,
};

#[uniffi::remote(Record)]
pub struct Profile {
    pub user: UserView,
    pub bio: Option<String>,
    pub status: Option<String>,
    pub banner_file_id: Option<String>,
    pub is_me: bool,
}

#[uniffi::remote(Record)]
pub struct ProfileView {
    pub state: LoadState,
    pub profile: Option<Profile>,
}

#[uniffi::remote(Enum)]
pub enum ImageChange {
    Remove,
    Set { file: DraftFile },
}

#[uniffi::remote(Record)]
pub struct ProfilePatch {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub status: Option<String>,
    pub avatar: Option<ImageChange>,
    pub banner: Option<ImageChange>,
}

#[uniffi::remote(Enum)]
pub enum ProfileImage {
    Avatar,
    Banner,
}

#[uniffi::remote(Record)]
pub struct ProfileUpload {
    pub image: ProfileImage,
    pub upload: UploadView,
}

#[uniffi::remote(Record)]
pub struct ProfileEditView {
    pub saving: bool,
    pub upload: Option<ProfileUpload>,
    pub error: Option<ErrorView>,
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn profile(&self, user_id: String) -> ProfileView {
        self.core.profile(user_id)
    }

    pub fn profile_edit(&self) -> ProfileEditView {
        self.core.profile_edit()
    }

    pub async fn update_profile(&self, patch: ProfilePatch) -> Result<(), CoreError> {
        self.core.update_profile(patch).await
    }
}
