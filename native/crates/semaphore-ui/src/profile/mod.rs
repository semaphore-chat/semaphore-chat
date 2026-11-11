//! W3-ui-profile: the profile modal and page, the edit form, and the avatar and banner pickers, from
//! `pages/ProfilePage.tsx`, `pages/ProfileEditPage.tsx` and `components/Profile/`. Reads
//! `ProfileView` and `ProfileEditView`.
//!
//! - `ProfileModal` (`UserProfileModal.tsx`): banner, avatar, name, status, "About Me", and
//!   "Message" / "View Profile". A dialog over whatever opened it.
//! - `ProfilePage` (`ProfilePage.tsx` with `ProfileHeader.tsx`): Back, "Edit Profile" on this
//!   user's own, the larger header. Route `Profile { user_id }`.
//! - `ProfileEditForm` (`ProfileEditPage.tsx`, `ProfileEditForm.tsx`, `UserAvatarUpload.tsx`,
//!   `UserBannerUpload.tsx`): the banner and avatar pickers, display name, status and bio, with the
//!   web's limits, upload progress and Save. Route `ProfileEdit`.
//!
//! Like every view here they emit what the user asked for; the owner calls core.

mod edit;
mod header;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;
mod view;

pub use edit::{
    BIO_MAX, DISPLAY_NAME_MAX, ProfileDraft, ProfileField, STATUS_MAX, check_image,
    validate_profile,
};
pub use header::profile_initials;

use gpui_kit::component::input::{InputState, TextareaState};
use gpui_kit::*;
use semaphore_core::model::{DraftFile, Profile, ProfileEditView, ProfileView};

/// Which picture a picker changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ImageSlot {
    Avatar,
    Banner,
}

/// Where this user stands with the profile's user, for an "Add Friend" button. The web's modal has
/// none, so `None` (the default) shows nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FriendAction {
    #[default]
    None,
    /// "Add Friend".
    Add,
    /// A request is on its way either way: a disabled "Request pending".
    Pending,
    /// Already friends: a "Friends" chip.
    Friends,
}

/// What the profile offers beyond viewing. Ignored on this user's own profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProfileActions {
    /// "Message": the owner opens (or creates) the DM, `Core::create_dm(vec![user_id], None)`.
    pub can_message: bool,
    pub friend: FriendAction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileEvent {
    /// The modal's close button, Escape or the backdrop.
    Close,
    /// "View Profile" in the modal: the owner closes it and opens `ProfilePage`.
    OpenPage {
        user_id: String,
    },
    /// "Edit Profile" on this user's own page.
    Edit,
    Message {
        user_id: String,
    },
    AddFriend {
        user_id: String,
    },
    /// The page's Back.
    Back,
    /// The view failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// `UserProfileModal`: a small card over the page.
pub struct ProfileModal {
    view: ProfileView,
    actions: ProfileActions,
    user_id: String,
    /// Decoded pictures standing in for the files, for stories: (avatar, banner).
    images: (Option<ImageSource>, Option<ImageSource>),
}

impl EventEmitter<ProfileEvent> for ProfileModal {}

impl ProfileModal {
    /// `user_id` is whose profile this is, for the events, before it has loaded.
    pub fn new(user_id: impl Into<String>, _: &mut Context<Self>) -> Self {
        Self {
            view: ProfileView::default(),
            actions: ProfileActions::default(),
            user_id: user_id.into(),
            images: (None, None),
        }
    }

    /// `Core::profile(user_id)`, read again on `ViewChanged { Profile { user_id } }`.
    pub fn set_view(&mut self, view: ProfileView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    pub fn set_actions(&mut self, actions: ProfileActions, cx: &mut Context<Self>) {
        self.actions = actions;
        cx.notify();
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    #[cfg(feature = "stories")]
    pub(crate) fn set_images(&mut self, avatar: Option<ImageSource>, banner: Option<ImageSource>) {
        self.images = (avatar, banner);
    }
}

/// `ProfilePage`: Back, "Edit Profile" on this user's own, and the header.
pub struct ProfilePage {
    view: ProfileView,
    actions: ProfileActions,
    user_id: String,
    /// Decoded pictures standing in for the files, for stories: (avatar, banner).
    images: (Option<ImageSource>, Option<ImageSource>),
}

impl EventEmitter<ProfileEvent> for ProfilePage {}

impl ProfilePage {
    pub fn new(user_id: impl Into<String>, _: &mut Context<Self>) -> Self {
        Self {
            view: ProfileView::default(),
            actions: ProfileActions::default(),
            user_id: user_id.into(),
            images: (None, None),
        }
    }

    pub fn set_view(&mut self, view: ProfileView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    pub fn set_actions(&mut self, actions: ProfileActions, cx: &mut Context<Self>) {
        self.actions = actions;
        cx.notify();
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    #[cfg(feature = "stories")]
    pub(crate) fn set_images(&mut self, avatar: Option<ImageSource>, banner: Option<ImageSource>) {
        self.images = (avatar, banner);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileEditEvent {
    /// "Change" on a picker: the owner opens the system's file picker for an image and answers
    /// with `ProfileEditForm::set_picked` (or `set_pick_error`).
    PickImage { slot: ImageSlot },
    /// "Save Changes" with a valid form: `Core::update_profile(patch)`. Only what changed is set.
    Save {
        patch: Box<semaphore_core::model::ProfilePatch>,
    },
    /// "Cancel" or Back: the owner leaves the form.
    Cancel,
    /// The profile failed to load and the user asked again.
    Retry,
}

/// A picked image, waiting for Save.
pub(crate) struct Picked {
    pub file: DraftFile,
    pub preview: Option<ImageSource>,
}

/// `ProfileEditPage`.
pub struct ProfileEditForm {
    view: ProfileView,
    edit: ProfileEditView,
    /// What the fields were filled from: the patch is what differs from it.
    base: Option<Profile>,
    display_name: Entity<InputState>,
    status: Entity<InputState>,
    bio: Entity<TextareaState>,
    avatar: Option<Picked>,
    banner: Option<Picked>,
    remove_avatar: bool,
    remove_banner: bool,
    pick_errors: Vec<(ImageSlot, String)>,
    max_file_bytes: Option<u64>,
    /// Save was pressed once: errors show from then on, as they change.
    tried: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ProfileEditEvent> for ProfileEditForm {}

impl ProfileEditForm {
    /// `Core::profile(own id)` for the fields; `None` until it's read.
    pub fn set_view(&mut self, view: ProfileView, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(profile) = view.profile.clone() {
            self.set_profile(profile, window, cx);
        }
        self.view = view;
        cx.notify();
    }

    /// Fills the fields from this profile, unless the user has already changed them.
    pub fn set_profile(&mut self, profile: Profile, window: &mut Window, cx: &mut Context<Self>) {
        if self.base.as_ref() == Some(&profile) {
            return;
        }
        let dirty = self
            .base
            .as_ref()
            .is_some_and(|base| self.draft(cx).is_dirty(base));
        if !dirty {
            let name = profile
                .user
                .display_name
                .clone()
                .unwrap_or_else(|| profile.user.username.clone());
            let status = profile.status.clone().unwrap_or_default();
            let bio = profile.bio.clone().unwrap_or_default();
            self.display_name
                .update(cx, |field, cx| field.set_value(name, window, cx));
            self.status
                .update(cx, |field, cx| field.set_value(status, window, cx));
            self.bio
                .update(cx, |field, cx| field.set_value(bio, window, cx));
        }
        if self.view.profile.is_none() {
            self.view = ProfileView {
                state: semaphore_core::model::LoadState::Ready,
                profile: Some(profile.clone()),
            };
        }
        self.base = Some(profile);
        cx.notify();
    }

    /// `Core::profile_edit`, read again on `ViewChanged { ProfileEdit }`.
    pub fn set_edit(&mut self, edit: ProfileEditView, cx: &mut Context<Self>) {
        let finished = (self.edit.saving || self.edit.upload.is_some())
            && !edit.saving
            && edit.upload.is_none()
            && edit.error.is_none();
        self.edit = edit;
        if finished {
            // Saved: the picks are the profile's now.
            self.avatar = None;
            self.banner = None;
            self.remove_avatar = false;
            self.remove_banner = false;
            self.tried = false;
        }
        cx.notify();
    }

    /// The file the system's picker gave for `slot`. One that isn't an image, or is too large, shows
    /// its error instead.
    pub fn set_picked(&mut self, slot: ImageSlot, file: DraftFile, cx: &mut Context<Self>) {
        self.pick_errors.retain(|(at, _)| *at != slot);
        if let Err(message) = check_image(&file, self.max_file_bytes) {
            self.pick_errors.push((slot, message));
            cx.notify();
            return;
        }
        let preview = edit::preview_of(&file);
        let picked = Picked { file, preview };
        match slot {
            ImageSlot::Avatar => {
                self.avatar = Some(picked);
                self.remove_avatar = false;
            }
            ImageSlot::Banner => {
                self.banner = Some(picked);
                self.remove_banner = false;
            }
        }
        cx.notify();
    }

    /// The picker couldn't read the file.
    pub fn set_pick_error(&mut self, slot: ImageSlot, message: String, cx: &mut Context<Self>) {
        self.pick_errors.retain(|(at, _)| *at != slot);
        self.pick_errors.push((slot, message));
        cx.notify();
    }

    /// `ServerInfo::max_file_bytes`.
    pub fn set_max_file_bytes(&mut self, max: Option<u64>, cx: &mut Context<Self>) {
        self.max_file_bytes = max;
        cx.notify();
    }

    /// An edit is on its way: the form waits.
    pub fn is_busy(&self) -> bool {
        self.edit.saving || self.edit.upload.is_some()
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
