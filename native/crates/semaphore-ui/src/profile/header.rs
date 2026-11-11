//! The profile's banner, avatar and text, for the modal (small) and the page (large), and their
//! loading skeletons.

use crate::dms::names::user_name;
use crate::kit::{Avatar, AvatarImages, Skeleton, Variant, spacing, text};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::Profile;

/// `(displayName || username).slice(0, 2).toUpperCase()`.
pub fn profile_initials(name: &str) -> String {
    name.chars().take(2).collect::<String>().to_uppercase()
}

/// The two sizes the web draws a profile at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeaderSize {
    /// `UserProfileModal`: a 120 px banner and an 80 px avatar.
    Modal,
    /// `ProfileHeader`: a 200 px banner and a 120 px avatar.
    Page,
}

impl HeaderSize {
    pub fn banner_height(self) -> f32 {
        match self {
            Self::Modal => 120.,
            Self::Page => 200.,
        }
    }

    pub fn avatar(self) -> f32 {
        match self {
            Self::Modal => 80.,
            Self::Page => 120.,
        }
    }
}

/// `BannerContainer`: the primary colour, with the banner over it once the app has its bytes.
pub(crate) fn banner(
    id: &'static str,
    file_id: Option<&str>,
    preview: Option<ImageSource>,
    height: f32,
    cx: &App,
) -> Stateful<Div> {
    let sem = cx.sem();
    let file = file_id.and_then(|file_id| {
        let images = cx.try_global::<AvatarImages>()?;
        Some(((images.resolve)(file_id)?, images.cache.clone()))
    });
    div()
        .id(id)
        .relative()
        .w_full()
        .h(px(height))
        .flex_shrink_0()
        .overflow_hidden()
        .bg(sem.primary)
        .map(|banner| match (preview, file) {
            (Some(source), _) => banner.child(
                img(source)
                    .absolute()
                    .inset_0()
                    .size_full()
                    .object_fit(ObjectFit::Cover),
            ),
            (None, Some((resource, cache))) => banner.child(
                img(ImageSource::Resource(resource))
                    .image_cache(&cache)
                    .absolute()
                    .inset_0()
                    .size_full()
                    .object_fit(ObjectFit::Cover),
            ),
            (None, None) => banner,
        })
}

/// The avatar with its 4 px ring in the paper colour, on the primary colour without a picture.
pub(crate) fn ringed_avatar(
    name: &str,
    file_id: Option<&str>,
    preview: Option<ImageSource>,
    size: f32,
    cx: &App,
) -> Div {
    let sem = cx.sem();
    // The kit's avatar clips a picture to a square: draw a picked one round here.
    let face = match preview {
        Some(source) => img(source)
            .size(px(size))
            .rounded_full()
            .object_fit(ObjectFit::Cover)
            .into_any_element(),
        None => Avatar::new(profile_initials(name))
            .size(size)
            .file(file_id)
            .background(sem.primary)
            .foreground(sem.primary_contrast)
            .text_size_override((size * 0.35).round())
            .into_any_element(),
    };
    div()
        .flex_shrink_0()
        .p(px(4.))
        .rounded_full()
        .bg(sem.paper)
        .child(face)
}

/// Name, @username, the status chip and "About Me". `bio_scroll` caps the bio's height (the modal's
/// `maxHeight: 100`).
pub(crate) fn profile_text(profile: &Profile, size: HeaderSize, cx: &App) -> Div {
    let sem = cx.sem();
    let name = user_name(&profile.user);
    let (name_variant, handle_variant) = match size {
        HeaderSize::Modal => (Variant::H6, Variant::Body2),
        HeaderSize::Page => (Variant::H5, Variant::Body1),
    };
    let bio = profile
        .bio
        .clone()
        .filter(|bio| !bio.trim().is_empty())
        .map(|bio| {
            let label = match size {
                HeaderSize::Modal => {
                    text(Variant::Caption, "ABOUT ME").font_weight(FontWeight(600.))
                }
                HeaderSize::Page => text(Variant::Subtitle2, "About Me"),
            };
            let body = div()
                .id("profile-bio")
                .test_support()
                .mt(spacing(0.5))
                .text_color(sem.text_primary)
                .child(text(Variant::Body2, bio).whitespace_normal())
                .when(size == HeaderSize::Modal, |body| {
                    body.max_h(px(100.)).overflow_y_scroll()
                });
            div()
                .mt(spacing(2.))
                .flex()
                .flex_col()
                .child(label.text_color(sem.text_secondary))
                .child(body)
        });
    div()
        .min_w_0()
        .flex()
        .flex_col()
        .child(
            text(name_variant, name)
                .font_weight(FontWeight(600.))
                .text_color(sem.text_primary)
                .whitespace_normal(),
        )
        .child(
            text(handle_variant, format!("@{}", profile.user.username))
                .text_color(sem.text_secondary)
                .truncate(),
        )
        .children(
            profile
                .status
                .clone()
                .filter(|status| !status.trim().is_empty())
                .map(|status| status_chip(status, cx)),
        )
        .children(bio)
}

/// `ProfileSkeleton` and the modal's loading state: a banner, a round avatar and two lines.
pub(crate) fn profile_skeleton(size: HeaderSize, cx: &App) -> impl IntoElement + use<> {
    let sem = cx.sem();
    let avatar = size.avatar();
    div()
        .id("profile-loading")
        .test_support()
        .role(Role::ProgressIndicator)
        .aria_label("Loading profile")
        .w_full()
        .flex()
        .flex_col()
        .child(
            div()
                .w_full()
                .h(px(size.banner_height()))
                .bg(sem.action_hover),
        )
        .child(
            div()
                .relative()
                .px(spacing(3.))
                .pt(px(avatar * 0.5 + 16.))
                .pb(spacing(3.))
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(
                    div()
                        .absolute()
                        .top(px(-avatar * 0.5))
                        .left(spacing(3.))
                        .p(px(4.))
                        .rounded_full()
                        .bg(sem.paper)
                        .child(Skeleton::circle("profile-loading-avatar", avatar)),
                )
                .child(Skeleton::rect("profile-loading-name", relative(0.6), 24.))
                .child(Skeleton::rect("profile-loading-handle", relative(0.4), 16.)),
        )
}

/// MUI's small `Chip` with the status: one line, cut with an ellipsis at the card's edge.
fn status_chip(status: String, cx: &App) -> Div {
    let sem = cx.sem();
    div().mt(spacing(1.)).flex().max_w_full().child(
        div()
            .h(px(24.))
            .max_w_full()
            .min_w_0()
            .px(px(8.))
            .flex()
            .items_center()
            .rounded(px(12.))
            .bg(sem.chip_bg)
            .text_color(sem.chip_text)
            .child(text(Variant::Caption, status).text_size(px(13.)).truncate()),
    )
}
