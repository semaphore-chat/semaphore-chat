//! Profiles: reading anyone's, editing this user's own with avatar and banner. Unit W3-core.
//!
//! An edit's text (name, bio, status) shows at once as an overlay numbered by the change, over
//! whatever the cache holds; a failure takes away only that overlay, so a later edit's fields
//! stay. Images show once the server agrees. The server's answer goes into the cache unless a
//! later edit's already has; `userProfileUpdated` reads the profile again, in either order.

use std::sync::Arc;

use crate::backend::{FileUpload, UploadProgress};
use crate::cache::{CacheValue, keys};
use crate::client::{Core, user_view};
use crate::model::{
    ErrorView, ImageChange, Profile, ProfileEditView, ProfileImage, ProfilePatch, ProfileUpload,
    ProfileView, UploadView, ViewKey,
};
use crate::platform::CoreError;
use semaphore_wire::enums::ResourceType;
use semaphore_wire::types as wire;

/// The text of one edit, shown until the server answers it.
#[derive(Debug, Clone, Default)]
pub(crate) struct ProfileText {
    display_name: Option<String>,
    bio: Option<String>,
    status: Option<String>,
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

fn invalid(field: &str) -> CoreError {
    CoreError::Failed {
        message: format!("the {field} isn't valid"),
    }
}

impl Core {
    /// A user's profile; this user's own when `user_id` is theirs. `ViewKey::Profile { user_id }`
    /// says when to read again.
    pub fn profile(&self, user_id: String) -> ProfileView {
        self.write(|state, _| {
            let is_me = !user_id.is_empty() && state.me_id() == user_id;
            let key = if is_me {
                keys::op(keys::PROFILE)
            } else {
                keys::scoped(keys::USER, &user_id)
            };
            state.ensure_query(key.clone());
            let load = state.query_load_state(&key);
            let entity = if is_me {
                state.cache.profile(&key)
            } else {
                state.cache.user(&key)
            };
            let Some(entity) = entity else {
                return ProfileView {
                    state: load,
                    profile: None,
                };
            };
            let mut profile = Profile {
                user: user_view(entity),
                bio: entity.bio.clone().filter(|bio| !bio.is_empty()),
                status: entity.status.clone().filter(|status| !status.is_empty()),
                banner_file_id: entity.banner_url.clone().filter(|id| !id.is_empty()),
                is_me,
            };
            if is_me {
                for (_, text) in &state.w3.profile_overlays {
                    if let Some(name) = &text.display_name {
                        profile.user.display_name = Some(name.clone());
                    }
                    if let Some(bio) = &text.bio {
                        profile.bio = non_empty(bio);
                    }
                    if let Some(status) = &text.status {
                        profile.status = non_empty(status);
                    }
                }
            }
            profile.user.avatar_file_id = profile.user.avatar_file_id.filter(|id| !id.is_empty());
            ProfileView {
                state: load,
                profile: Some(profile),
            }
        })
    }

    /// The edit on its way, for the edit form. `ViewKey::ProfileEdit` says when to read again.
    pub fn profile_edit(&self) -> ProfileEditView {
        self.read(|state| ProfileEditView {
            saving: state.w3.edits_running > 0,
            upload: state.w3.edit_upload.clone(),
            error: state.w3.edit_error.clone(),
        })
    }

    /// Changes what the patch sets. New images go up first (progress in `profile_edit`), then one
    /// update; the text shows at once and goes back if the server refuses, images once it agrees.
    /// Fails if an upload or the update fails, with nothing changed.
    pub async fn update_profile(&self, patch: ProfilePatch) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("editing the profile")?;
        let display_name = patch
            .display_name
            .as_deref()
            .map(|name| name.trim().parse::<wire::UpdateProfileDtoDisplayName>())
            .transpose()
            .map_err(|_| invalid("display name"))?;
        let bio = patch
            .bio
            .as_deref()
            .map(|bio| bio.trim().parse::<wire::UpdateProfileDtoBio>())
            .transpose()
            .map_err(|_| invalid("bio"))?;
        let status = patch
            .status
            .as_deref()
            .map(|status| status.trim().parse::<wire::UpdateProfileDtoStatus>())
            .transpose()
            .map_err(|_| invalid("status"))?;
        let text = ProfileText {
            display_name: patch
                .display_name
                .as_deref()
                .map(|name| name.trim().to_owned()),
            bio: patch.bio.clone(),
            status: patch.status.clone(),
        };
        let (change, me_id) = self.write(|state, _| {
            let change = state.next_change();
            state.w3.profile_overlays.push((change, text));
            state.w3.edits_running += 1;
            state.w3.edit_error = None;
            state.view_changed(ViewKey::ProfileEdit);
            let me_id = state.me_id().to_owned();
            state.view_changed(ViewKey::Profile {
                user_id: me_id.clone(),
            });
            (change, me_id)
        });

        let mut avatar = None;
        let mut banner = None;
        let mut upload_error: Option<ErrorView> = None;
        for (slot, change_of, resource_type) in [
            (&mut avatar, &patch.avatar, ResourceType::UserAvatar),
            (&mut banner, &patch.banner, ResourceType::UserBanner),
        ] {
            match change_of {
                None => {}
                Some(ImageChange::Remove) => *slot = Some(String::new()),
                Some(ImageChange::Set { file }) => {
                    match self
                        .upload_image(&services, change, file.clone(), resource_type)
                        .await
                    {
                        Ok(id) => *slot = Some(id),
                        Err(error) => {
                            upload_error = Some(error);
                            break;
                        }
                    }
                }
            }
        }
        let outcome: Result<wire::UserEntity, ErrorView> = match upload_error {
            Some(error) => Err(error),
            None => {
                let body = wire::UpdateProfileDto {
                    avatar,
                    banner,
                    bio,
                    display_name,
                    status,
                };
                services
                    .backend
                    .user_controller_update_profile(body)
                    .await
                    .map_err(|error| {
                        let view = error.view();
                        let _ = self.backend_failed(error);
                        view
                    })
            }
        };

        self.write(|state, now| {
            if state.session_epoch != epoch {
                return;
            }
            state
                .w3
                .profile_overlays
                .retain(|(overlay, _)| *overlay != change);
            state.w3.edits_running = state.w3.edits_running.saturating_sub(1);
            if state.w3.edit_upload_change == change {
                state.w3.edit_upload = None;
            }
            match &outcome {
                Ok(user) if change > state.w3.profile_applied => {
                    state.w3.profile_applied = change;
                    let key = keys::op(keys::PROFILE);
                    state.note_direct_update(&key);
                    state
                        .cache
                        .set(key.clone(), CacheValue::Profile(user.clone()), now);
                    let user_key = keys::scoped(keys::USER, &user.id);
                    if state.cache.user(&user_key).is_some() {
                        state.note_direct_update(&user_key);
                        state
                            .cache
                            .set(user_key.clone(), CacheValue::User(user.clone()), now);
                        state.query_changed(&user_key);
                    }
                    state.query_changed(&key);
                }
                Ok(_) => {}
                Err(error) => state.w3.edit_error = Some(error.clone()),
            }
            state.view_changed(ViewKey::ProfileEdit);
            state.view_changed(ViewKey::Profile {
                user_id: me_id.clone(),
            });
        });
        self.same_session(epoch)?;
        outcome.map(|_| ()).map_err(|error| CoreError::Failed {
            message: error.message,
        })
    }

    /// Uploads one image for an edit, showing its progress, and returns its file id.
    async fn upload_image(
        &self,
        services: &crate::client::Services,
        change: u64,
        file: crate::model::DraftFile,
        resource_type: ResourceType,
    ) -> Result<String, ErrorView> {
        let total = file.bytes.len() as u64;
        let image = if resource_type == ResourceType::UserBanner {
            ProfileImage::Banner
        } else {
            ProfileImage::Avatar
        };
        self.write(|state, _| {
            state.w3.edit_upload_change = change;
            state.w3.edit_upload = Some(ProfileUpload {
                image,
                upload: UploadView {
                    name: file.name.clone(),
                    size_bytes: total,
                    sent_bytes: 0,
                    failed: None,
                },
            });
            state.view_changed(ViewKey::ProfileEdit);
        });
        let core = self.clone();
        let progress: UploadProgress = Arc::new(move |sent| {
            core.write(|state, _| {
                if state.w3.edit_upload_change == change
                    && let Some(upload) = &mut state.w3.edit_upload
                {
                    upload.upload.sent_bytes = sent.min(total);
                    state.view_changed(ViewKey::ProfileEdit);
                }
            });
        });
        let upload = FileUpload {
            filename: file.name,
            mime_type: file.mime_type,
            bytes: Arc::new(file.bytes),
            resource_type,
            resource_id: None,
        };
        let result = services
            .backend
            .file_upload_controller_upload_file(upload, progress)
            .await;
        match result {
            Ok(uploaded) => Ok(uploaded.id),
            Err(error) => {
                let view = error.view();
                self.write(|state, _| {
                    if state.w3.edit_upload_change == change
                        && let Some(upload) = &mut state.w3.edit_upload
                    {
                        upload.upload.failed = Some(view.clone());
                        state.view_changed(ViewKey::ProfileEdit);
                    }
                });
                let _ = self.backend_failed(error);
                Err(view)
            }
        }
    }
}
