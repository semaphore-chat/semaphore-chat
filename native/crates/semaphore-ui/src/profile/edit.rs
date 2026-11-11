//! `ProfileEditForm`: the web's limits (`useProfileForm.ts`), the patch, the pickers and the form
//! drawn.

use super::header::{banner, ringed_avatar};
use super::{ImageSlot, Picked, ProfileEditEvent, ProfileEditForm};
use crate::kit::{
    Alert, Button, ButtonSize, LinearProgress, Paper, Severity, Spinner, TextField, Variant,
    floating_label, notched, spacing, text, text_state,
};
use crate::panel::common::{design_icon, error_block, is_phone};
use crate::theme::{FONT_FAMILY, SemTheme};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{Textarea, TextareaState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    DraftFile, ImageChange, LoadState, Profile, ProfileEditView, ProfileImage, ProfilePatch,
    ProfileView,
};
use semaphore_design::Icon as DesignIcon;
use std::sync::Arc;

/// "Your display name (1-32 characters)", once trimmed.
pub const DISPLAY_NAME_MAX: usize = 32;
/// "What are you up to? (max 128 characters)".
pub const STATUS_MAX: usize = 128;
/// "{n}/500 characters".
pub const BIO_MAX: usize = 500;

/// From this window width the pictures sit beside the fields.
const WIDE: f32 = 960.;

/// The images the server takes for an avatar or banner.
const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProfileField {
    DisplayName,
    Status,
    Bio,
}

/// What the form holds, as text: the fields, and the picture changes waiting for Save.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProfileDraft {
    pub display_name: String,
    pub status: String,
    pub bio: String,
    pub avatar: Option<ImageChange>,
    pub banner: Option<ImageChange>,
}

impl ProfileDraft {
    /// The fields as `set_profile` fills them.
    pub fn from_profile(profile: &Profile) -> Self {
        Self {
            display_name: profile
                .user
                .display_name
                .clone()
                .unwrap_or_else(|| profile.user.username.clone()),
            status: profile.status.clone().unwrap_or_default(),
            bio: profile.bio.clone().unwrap_or_default(),
            avatar: None,
            banner: None,
        }
    }

    /// Only what differs from `base`: an unchanged field is `None`, a cleared one `Some("")`.
    pub fn patch(&self, base: &Profile) -> ProfilePatch {
        let was = Self::from_profile(base);
        let name = self.display_name.trim().to_owned();
        ProfilePatch {
            display_name: (name != was.display_name.trim()).then_some(name),
            status: (self.status.trim() != was.status.trim())
                .then(|| self.status.trim().to_owned()),
            bio: (self.bio != was.bio).then(|| self.bio.clone()),
            avatar: self.avatar.clone(),
            banner: self.banner.clone(),
        }
    }

    pub fn is_dirty(&self, base: &Profile) -> bool {
        self.patch(base) != ProfilePatch::default()
    }
}

/// `validateForm`: what's wrong with each field, in the web's words.
pub fn validate_profile(draft: &ProfileDraft) -> Vec<(ProfileField, String)> {
    let mut errors = Vec::new();
    let name = draft.display_name.trim();
    if name.is_empty() {
        errors.push((
            ProfileField::DisplayName,
            "Display name is required".to_owned(),
        ));
    } else if name.chars().count() > DISPLAY_NAME_MAX {
        errors.push((
            ProfileField::DisplayName,
            format!("Display name must be {DISPLAY_NAME_MAX} characters or less"),
        ));
    }
    if draft.bio.chars().count() > BIO_MAX {
        errors.push((
            ProfileField::Bio,
            format!("Bio must be {BIO_MAX} characters or less"),
        ));
    }
    if draft.status.chars().count() > STATUS_MAX {
        errors.push((
            ProfileField::Status,
            format!("Status must be {STATUS_MAX} characters or less"),
        ));
    }
    errors
}

fn megabytes(bytes: u64) -> String {
    let mb = bytes as f64 / (1024. * 1024.);
    if mb >= 10. || mb.fract() < 0.05 {
        format!("{mb:.0} MB")
    } else {
        format!("{mb:.1} MB")
    }
}

/// Whether a picked file can be an avatar or banner: PNG, JPEG, GIF or WebP, within the server's
/// size limit.
pub fn check_image(file: &DraftFile, max_bytes: Option<u64>) -> Result<(), String> {
    if !IMAGE_TYPES.contains(&file.mime_type.as_str()) {
        return Err("Choose a PNG, JPEG, GIF or WebP image".to_owned());
    }
    let size = file.bytes.len() as u64;
    if let Some(max) = max_bytes
        && size > max
    {
        return Err(format!(
            "That image is {}; the limit is {}",
            megabytes(size),
            megabytes(max)
        ));
    }
    Ok(())
}

/// The picked bytes as something `img` decodes.
pub(super) fn preview_of(file: &DraftFile) -> Option<ImageSource> {
    let format = match file.mime_type.as_str() {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        "image/gif" => ImageFormat::Gif,
        "image/webp" => ImageFormat::Webp,
        _ => return None,
    };
    Some(ImageSource::Image(Arc::new(Image::from_bytes(
        format,
        file.bytes.clone(),
    ))))
}

impl ProfileEditForm {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let display_name = text_state(window, cx, false);
        let status = text_state(window, cx, false);
        let bio = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(4, 8)
                .placeholder("Tell people a little about yourself")
        });
        let _subscriptions = vec![
            cx.observe(&display_name, |_, _, cx| cx.notify()),
            cx.observe(&status, |_, _, cx| cx.notify()),
            cx.observe(&bio, |_, _, cx| cx.notify()),
        ];
        Self {
            view: ProfileView::default(),
            edit: ProfileEditView::default(),
            base: None,
            display_name,
            status,
            bio,
            avatar: None,
            banner: None,
            remove_avatar: false,
            remove_banner: false,
            pick_errors: Vec::new(),
            max_file_bytes: None,
            tried: false,
            _subscriptions,
        }
    }

    /// The form as it stands.
    pub fn draft(&self, cx: &App) -> ProfileDraft {
        let change = |picked: &Option<Picked>, remove: bool| match picked {
            Some(picked) => Some(ImageChange::Set {
                file: picked.file.clone(),
            }),
            None if remove => Some(ImageChange::Remove),
            None => None,
        };
        ProfileDraft {
            display_name: self.display_name.read(cx).value().to_string(),
            status: self.status.read(cx).value().to_string(),
            bio: self.bio.read(cx).value().to_string(),
            avatar: change(&self.avatar, self.remove_avatar),
            banner: change(&self.banner, self.remove_banner),
        }
    }

    /// Fills the text fields, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn preset(
        &mut self,
        name: &str,
        status: &str,
        bio: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (name, status, bio) = (name.to_owned(), status.to_owned(), bio.to_owned());
        self.display_name
            .update(cx, |field, cx| field.set_value(name, window, cx));
        self.status
            .update(cx, |field, cx| field.set_value(status, window, cx));
        self.bio
            .update(cx, |field, cx| field.set_value(bio, window, cx));
        cx.notify();
    }

    /// A preview other than the picked bytes' own, for stories (which have no encoded images).
    #[cfg(feature = "stories")]
    pub(crate) fn set_preview(&mut self, slot: ImageSlot, preview: ImageSource) {
        let picked = match slot {
            ImageSlot::Avatar => self.avatar.as_mut(),
            ImageSlot::Banner => self.banner.as_mut(),
        };
        if let Some(picked) = picked {
            picked.preview = Some(preview);
        }
    }

    /// "Save Changes": shows the errors, or emits the patch.
    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if self.is_busy() {
            return;
        }
        self.tried = true;
        let Some(base) = self.base.clone() else {
            return;
        };
        let draft = self.draft(cx);
        if validate_profile(&draft).is_empty() {
            cx.emit(ProfileEditEvent::Save {
                patch: Box::new(draft.patch(&base)),
            });
        }
        cx.notify();
    }

    fn remove(&mut self, slot: ImageSlot, cx: &mut Context<Self>) {
        self.pick_errors.retain(|(at, _)| *at != slot);
        match slot {
            ImageSlot::Avatar => {
                self.avatar = None;
                self.remove_avatar = true;
            }
            ImageSlot::Banner => {
                self.banner = None;
                self.remove_banner = true;
            }
        }
        cx.notify();
    }

    fn pick_error(&self, slot: ImageSlot) -> Option<String> {
        self.pick_errors
            .iter()
            .find(|(at, _)| *at == slot)
            .map(|(_, message)| message.clone())
    }

    /// Whether the slot will have a picture after Save.
    fn has_image(&self, slot: ImageSlot) -> bool {
        let base = self.base.as_ref();
        match slot {
            ImageSlot::Avatar => {
                self.avatar.is_some()
                    || (!self.remove_avatar
                        && base.is_some_and(|b| b.user.avatar_file_id.is_some()))
            }
            ImageSlot::Banner => {
                self.banner.is_some()
                    || (!self.remove_banner && base.is_some_and(|b| b.banner_file_id.is_some()))
            }
        }
    }

    fn picker_buttons(&self, slot: ImageSlot, cx: &mut Context<Self>) -> Div {
        let busy = self.is_busy();
        let key = match slot {
            ImageSlot::Avatar => "avatar",
            ImageSlot::Banner => "banner",
        };
        div()
            .flex()
            .flex_wrap()
            .gap(spacing(1.))
            .child(
                Button::new(
                    SharedString::from(format!("profile-{key}-change")),
                    "Change",
                )
                .outlined()
                .size(ButtonSize::Small)
                .start_icon(if slot == ImageSlot::Avatar {
                    DesignIcon::PhotoCamera
                } else {
                    DesignIcon::Upload
                })
                .disabled(busy)
                .on_click(
                    cx.listener(move |_, _, _, cx| cx.emit(ProfileEditEvent::PickImage { slot })),
                ),
            )
            .when(self.has_image(slot), |row| {
                row.child(
                    Button::new(
                        SharedString::from(format!("profile-{key}-remove")),
                        "Remove",
                    )
                    .size(ButtonSize::Small)
                    .start_icon(DesignIcon::Delete)
                    .disabled(busy)
                    .on_click(cx.listener(move |form, _, _, cx| form.remove(slot, cx))),
                )
            })
    }

    fn pickers(&self, phone: bool, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let base = self.base.clone().unwrap_or_default();
        let banner_file = (!self.remove_banner)
            .then_some(base.banner_file_id.as_deref())
            .flatten();
        let avatar_file = (!self.remove_avatar)
            .then_some(base.user.avatar_file_id.as_deref())
            .flatten();
        let banner_preview = self.banner.as_ref().and_then(|p| p.preview.clone());
        let avatar_preview = self.avatar.as_ref().and_then(|p| p.preview.clone());
        let has_banner = banner_file.is_some() || banner_preview.is_some();
        let name = self.display_name.read(cx).value().to_string();
        let name = if name.trim().is_empty() {
            base.user.username.clone()
        } else {
            name
        };
        let error_line = |message: Option<String>, id: &'static str| {
            message.map(|message| {
                div()
                    .id(id)
                    .test_support()
                    .role(Role::Alert)
                    .text_color(sem.error)
                    .child(text(Variant::Caption, message))
            })
        };
        let banner_box = div()
            .relative()
            .w_full()
            .rounded(px(8.))
            .overflow_hidden()
            .border_1()
            .border_color(sem.divider)
            .child(banner(
                "profile-edit-banner",
                banner_file,
                banner_preview,
                if phone { 120. } else { 140. },
                cx,
            ))
            .when(!has_banner, |frame| {
                // `UserBannerUpload`'s empty state, over the primary colour.
                frame.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .gap(spacing(0.5))
                        .text_color(sem.primary_contrast)
                        .child(design_icon(DesignIcon::Upload, 32., sem.primary_contrast))
                        .child(text(Variant::Body2, "Upload a banner image"))
                        .child(
                            text(Variant::Caption, "Recommended: 600x200px")
                                .text_color(sem.primary_contrast.opacity(0.8)),
                        ),
                )
            });
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .child(text(Variant::Subtitle2, "Banner").text_color(sem.text_secondary))
            .child(banner_box)
            .child(self.picker_buttons(ImageSlot::Banner, cx))
            .children(error_line(
                self.pick_error(ImageSlot::Banner),
                "profile-banner-error",
            ))
            .child(
                div()
                    .mt(spacing(2.))
                    .flex()
                    .items_center()
                    .gap(spacing(2.))
                    .child(ringed_avatar(&name, avatar_file, avatar_preview, 96., cx))
                    .child(
                        div()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(
                                text(Variant::Body2, "Upload a profile picture")
                                    .text_color(sem.text_secondary),
                            )
                            .child(self.picker_buttons(ImageSlot::Avatar, cx))
                            .children(error_line(
                                self.pick_error(ImageSlot::Avatar),
                                "profile-avatar-error",
                            )),
                    ),
            )
    }

    fn bio_field(&self, error: Option<String>, count: usize, window: &Window, cx: &App) -> Div {
        let sem = cx.sem();
        let focused = self.bio.read(cx).focus_handle(cx).is_focused(window);
        let border = if error.is_some() {
            sem.error
        } else if focused {
            sem.input_border_focused
        } else {
            sem.input_border
        };
        let label_color = if error.is_some() {
            sem.error
        } else if focused {
            sem.primary
        } else {
            sem.text_secondary
        };
        let helper = error
            .clone()
            .unwrap_or_else(|| format!("{count}/{BIO_MAX} characters"));
        div()
            .w_full()
            .flex()
            .flex_col()
            .child(notched(
                div()
                    .w_full()
                    .rounded(px(4.))
                    .border_1()
                    .when(focused || error.is_some(), |frame| frame.border_2())
                    .border_color(border)
                    .px(px(10.))
                    .pt(px(14.))
                    .pb(px(10.))
                    .child(
                        Textarea::new(&self.bio)
                            .with_size(gpui_kit::component::Size::XSmall)
                            .text_size(px(16.))
                            .appearance(false)
                            .bordered(false)
                            .disabled(self.is_busy())
                            .aria_label("About Me")
                            .accessibility_id("profile-bio-input"),
                    ),
                floating_label("About Me".into(), false, true, label_color, sem.paper),
            ))
            .child(
                div()
                    .px(px(14.))
                    .pt(px(3.))
                    .text_color(if error.is_some() {
                        sem.error
                    } else {
                        sem.text_secondary
                    })
                    .child(text(Variant::Caption, helper)),
            )
    }

    fn progress(&self, cx: &App) -> Option<impl IntoElement + use<>> {
        let sem = cx.sem();
        let current = self.edit.upload.as_ref()?;
        let upload = &current.upload;
        let label = format!(
            "Uploading {} · {}",
            match current.image {
                ProfileImage::Avatar => "avatar",
                ProfileImage::Banner => "banner",
            },
            upload.name
        );
        let percent = if upload.size_bytes == 0 {
            0.
        } else {
            (upload.sent_bytes as f32 / upload.size_bytes as f32 * 100.).clamp(0., 100.)
        };
        Some(
            div()
                .id("profile-upload")
                .test_support()
                .role(Role::Status)
                .w_full()
                .flex()
                .flex_col()
                .gap(spacing(0.5))
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .gap(spacing(1.))
                        .text_color(sem.text_secondary)
                        .child(text(Variant::Caption, label.clone()).min_w_0().truncate())
                        .child(text(Variant::Caption, format!("{percent:.0}%")).flex_shrink_0()),
                )
                .child(div().w_full().rounded(px(2.)).overflow_hidden().child(
                    LinearProgress::new("profile-upload-bar", Some(percent), label),
                )),
        )
    }
}

impl Render for ProfileEditForm {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let phone = is_phone(window);
        let busy = self.is_busy();
        let back = Button::new("profile-edit-back", "Back")
            .start_icon(DesignIcon::ArrowBack)
            .color(sem.text_primary)
            .on_click(cx.listener(|_, _, _, cx| cx.emit(ProfileEditEvent::Cancel)));
        let body: AnyElement = match (&self.view.state, &self.base) {
            (_, Some(_)) => {
                let draft = self.draft(cx);
                let errors = if self.tried {
                    validate_profile(&draft)
                } else {
                    Vec::new()
                };
                let error_of = |field: ProfileField| {
                    errors
                        .iter()
                        .find(|(at, _)| *at == field)
                        .map(|(_, message)| message.clone())
                };
                let name_error = error_of(ProfileField::DisplayName);
                let status_error = error_of(ProfileField::Status);
                let bio_error = error_of(ProfileField::Bio);
                let save_label = if self.edit.upload.is_some() {
                    "Uploading..."
                } else if self.edit.saving {
                    "Saving..."
                } else {
                    "Save Changes"
                };
                let failure = self.edit.error.as_ref().map(|error| {
                    let upload_failed = self
                        .edit
                        .upload
                        .as_ref()
                        .is_some_and(|current| current.upload.failed.is_some());
                    let message = if upload_failed {
                        format!("File upload failed: {}", error.message)
                    } else if error.message.is_empty() {
                        "Failed to update profile. Please try again.".to_owned()
                    } else {
                        format!("Failed to update profile: {}", error.message)
                    };
                    div()
                        .id("profile-edit-error")
                        .test_support()
                        .w_full()
                        .child(Alert::new(Severity::Error, message))
                });
                let can_save = !busy && !draft.display_name.trim().is_empty();
                let buttons = div()
                    .mt(spacing(1.))
                    .w_full()
                    .flex()
                    .gap(spacing(2.))
                    .child(
                        div().flex_1().flex().child(
                            Button::new("profile-save", save_label)
                                .contained()
                                .size(ButtonSize::Large)
                                .full_width()
                                .loading(busy)
                                .disabled(!can_save)
                                .on_click(cx.listener(|form, _, _, cx| form.submit(cx))),
                        ),
                    )
                    .child(
                        Button::new("profile-cancel", "Cancel")
                            .outlined()
                            .size(ButtonSize::Large)
                            .disabled(busy)
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(ProfileEditEvent::Cancel))),
                    );
                let fields = div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(spacing(2.5))
                    .child(
                        TextField::new("profile-display-name", &self.display_name, "Display Name")
                            .required(true)
                            .disabled(busy)
                            .error(name_error.is_some())
                            .helper(name_error.unwrap_or_else(|| {
                                format!("Your display name (1-{DISPLAY_NAME_MAX} characters)")
                            })),
                    )
                    .child(
                        TextField::new("profile-status", &self.status, "Status")
                            .disabled(busy)
                            .error(status_error.is_some())
                            .helper(status_error.unwrap_or_else(|| {
                                format!("What are you up to? (max {STATUS_MAX} characters)")
                            })),
                    )
                    .child(self.bio_field(bio_error, draft.bio.chars().count(), window, cx))
                    .children(self.progress(cx))
                    .child(buttons);
                let pickers = div().flex_1().min_w_0().child(self.pickers(phone, cx));
                // Wide: the pictures beside the fields, so Save stays on screen.
                let wide = f32::from(window.viewport_size().width) >= WIDE;
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap(spacing(2.5))
                    .children(failure)
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .when(wide, |row| row.gap(spacing(4.)))
                            .when(!wide, |column| column.flex_col().gap(spacing(2.5)))
                            .child(pickers)
                            .child(fields),
                    )
                    .into_any_element()
            }
            (LoadState::Failed { .. }, None) => error_block(
                "profile-edit-retry",
                "Failed to load profile",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(ProfileEditEvent::Retry)),
                cx,
            ),
            _ => div()
                .id("profile-edit-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading profile")
                .w_full()
                .py(spacing(6.))
                .flex()
                .justify_center()
                .child(Spinner::new("profile-edit-spinner").size(40.))
                .into_any_element(),
        };
        div()
            .id("profile-edit")
            .test_support()
            .size_full()
            .font_family(FONT_FAMILY)
            .text_color(sem.text_primary)
            .bg(sem.background_default)
            .overflow_y_scroll()
            .child(
                div()
                    .w_full()
                    .max_w(px(if f32::from(window.viewport_size().width) >= WIDE {
                        1040.
                    } else {
                        720.
                    }))
                    .mx_auto()
                    .p(spacing(if phone { 2. } else { 3. }))
                    .child(div().mb(spacing(3.)).child(back))
                    .child(
                        Paper::new()
                            .radius(8.)
                            .w_full()
                            .p(spacing(if phone { 2. } else { 4. }))
                            .flex()
                            .flex_col()
                            .child(
                                text(Variant::H5, "Edit Profile")
                                    .font_weight(FontWeight(600.))
                                    .mb(spacing(2.)),
                            )
                            .child(body),
                    ),
            )
    }
}
