//! The profile stories: the modal over a page, the page, and the edit form in each state.

use super::{FriendAction, ImageSlot, ProfileActions, ProfileEditForm, ProfileModal, ProfilePage};
use crate::dms::stories::dialog_framed;
use crate::stories::Story;
use gpui_kit::*;
use image::{Frame, RgbaImage};
use semaphore_core::model::{
    DraftFile, ErrorView, LoadState, Profile, ProfileEditView, ProfileView, UploadView, UserView,
};
use std::sync::Arc;

pub(crate) fn person(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

pub(crate) fn me() -> Profile {
    Profile {
        user: UserView {
            avatar_file_id: Some("file-avatar-me".into()),
            ..person("u-me", "mike", Some("Mike"))
        },
        bio: Some("Building the native client. Ask me about GPUI.".into()),
        status: Some("Shipping wave 3".into()),
        banner_file_id: Some("file-banner-me".into()),
        is_me: true,
    }
}

pub(crate) fn ava() -> Profile {
    Profile {
        user: UserView {
            avatar_file_id: Some("file-avatar-ava".into()),
            ..person("u-ava", "ava_chen", Some("Ava Chen"))
        },
        bio: Some("Voice channel regular.\nLikes synths and long walks.".into()),
        status: Some("In the studio".into()),
        banner_file_id: Some("file-banner-ava".into()),
        is_me: false,
    }
}

pub(crate) fn plain() -> Profile {
    Profile {
        user: person("u-dev", "dev", None),
        bio: None,
        status: None,
        banner_file_id: None,
        is_me: false,
    }
}

pub(crate) fn long() -> Profile {
    let bio = "I write long bios. ".repeat(26);
    Profile {
        user: person(
            "u-long",
            "someone_with_a_really_long_username_that_keeps_going",
            Some("A Person With An Unreasonably Long Display Name"),
        ),
        bio: Some(bio.trim_end().to_owned()),
        status: Some(
            "A status line long enough that it has to stop somewhere before the edge of the card"
                .into(),
        ),
        banner_file_id: None,
        is_me: false,
    }
}

fn ready(profile: Profile) -> ProfileView {
    ProfileView {
        state: LoadState::Ready,
        profile: Some(profile),
    }
}

fn failed(code: &str) -> ProfileView {
    ProfileView {
        state: LoadState::Failed {
            error: ErrorView {
                code: code.into(),
                message: "Request failed".into(),
                retryable: code != "NOT_FOUND",
                retry_after_ms: None,
            },
        },
        profile: None,
    }
}

/// A smooth two-colour picture, as decoded bytes would give: stories have no encoded images.
pub(crate) fn picture(width: u32, height: u32, from: [u8; 3], to: [u8; 3]) -> ImageSource {
    let buffer = RgbaImage::from_fn(width, height, |x, y| {
        let t = (x + y) as f32 / (width + height) as f32;
        let mix = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t) as u8;
        // GPUI's RenderImage frames are BGRA.
        image::Rgba([
            mix(from[2], to[2]),
            mix(from[1], to[1]),
            mix(from[0], to[0]),
            255,
        ])
    });
    ImageSource::Render(Arc::new(RenderImage::new(vec![Frame::new(buffer)])))
}

fn avatar_picture() -> ImageSource {
    picture(96, 96, [0xf5, 0x9e, 0x0b], [0xdb, 0x27, 0x77])
}

fn banner_picture() -> ImageSource {
    picture(600, 200, [0x0e, 0xa5, 0xe9], [0x7c, 0x3a, 0xed])
}

fn modal(view: ProfileView, actions: ProfileActions, images: bool, cx: &mut App) -> AnyView {
    let modal = cx.new(|cx| {
        let mut modal = ProfileModal::new("u-ava", cx);
        modal.set_view(view, cx);
        modal.set_actions(actions, cx);
        if images {
            modal.set_images(Some(avatar_picture()), Some(banner_picture()));
        }
        modal
    });
    dialog_framed(modal.into(), cx)
}

fn page(view: ProfileView, actions: ProfileActions, images: bool, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut page = ProfilePage::new("u-ava", cx);
        page.set_view(view, cx);
        page.set_actions(actions, cx);
        if images {
            page.set_images(Some(avatar_picture()), Some(banner_picture()));
        }
        page
    })
    .into()
}

const MESSAGE: ProfileActions = ProfileActions {
    can_message: true,
    friend: FriendAction::None,
};

fn image_file(name: &str, bytes: usize) -> DraftFile {
    DraftFile {
        name: name.into(),
        mime_type: "image/png".into(),
        bytes: vec![0; bytes],
    }
}

fn form(
    window: &mut Window,
    cx: &mut App,
    setup: impl FnOnce(&mut ProfileEditForm, &mut Window, &mut Context<ProfileEditForm>),
) -> AnyView {
    cx.new(|cx| {
        let mut form = ProfileEditForm::new(window, cx);
        form.set_max_file_bytes(Some(8 * 1024 * 1024), cx);
        setup(&mut form, window, cx);
        form
    })
    .into()
}

fn with_picks(form: &mut ProfileEditForm, cx: &mut Context<ProfileEditForm>) {
    form.set_picked(ImageSlot::Avatar, image_file("me.png", 2048), cx);
    form.set_picked(ImageSlot::Banner, image_file("mountains.png", 4096), cx);
    form.set_preview(ImageSlot::Avatar, avatar_picture());
    form.set_preview(ImageSlot::Banner, banner_picture());
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("profile-modal-own", |_, _, cx| {
            modal(ready(me()), ProfileActions::default(), true, cx)
        }),
        Story::new("profile-modal-other", |_, _, cx| {
            modal(ready(ava()), MESSAGE, true, cx)
        }),
        Story::new("profile-modal-add-friend", |_, _, cx| {
            modal(
                ready(ava()),
                ProfileActions {
                    can_message: true,
                    friend: FriendAction::Add,
                },
                true,
                cx,
            )
        }),
        Story::new("profile-modal-no-images", |_, _, cx| {
            modal(ready(plain()), MESSAGE, false, cx)
        }),
        Story::new("profile-modal-long", |_, _, cx| {
            modal(ready(long()), MESSAGE, false, cx)
        }),
        Story::new("profile-modal-loading", |_, _, cx| {
            modal(ProfileView::default(), MESSAGE, false, cx)
        }),
        Story::new("profile-modal-failed", |_, _, cx| {
            modal(failed("NETWORK"), MESSAGE, false, cx)
        }),
        Story::new("profile-modal-not-found", |_, _, cx| {
            modal(failed("NOT_FOUND"), MESSAGE, false, cx)
        }),
        Story::new("profile-page-own", |_, _, cx| {
            page(ready(me()), ProfileActions::default(), true, cx)
        }),
        Story::new("profile-page-other", |_, _, cx| {
            page(
                ready(ava()),
                ProfileActions {
                    can_message: true,
                    friend: FriendAction::Pending,
                },
                true,
                cx,
            )
        }),
        Story::new("profile-page-no-images", |_, _, cx| {
            page(ready(plain()), MESSAGE, false, cx)
        }),
        Story::new("profile-page-long", |_, _, cx| {
            page(
                ready(long()),
                ProfileActions {
                    can_message: true,
                    friend: FriendAction::Friends,
                },
                false,
                cx,
            )
        }),
        Story::new("profile-page-loading", |_, _, cx| {
            page(ProfileView::default(), MESSAGE, false, cx)
        }),
        Story::new("profile-page-failed", |_, _, cx| {
            page(failed("NETWORK"), MESSAGE, false, cx)
        }),
        Story::new("profile-page-not-found", |_, _, cx| {
            page(failed("NOT_FOUND"), MESSAGE, false, cx)
        }),
        Story::new("profile-edit", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(ready(me()), window, cx)
            })
        }),
        Story::new("profile-edit-no-images", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                let mut profile = me();
                profile.user.avatar_file_id = None;
                profile.banner_file_id = None;
                profile.bio = None;
                profile.status = None;
                form.set_view(ready(profile), window, cx)
            })
        }),
        Story::new("profile-edit-picked", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(ready(me()), window, cx);
                with_picks(form, cx);
            })
        }),
        Story::new("profile-edit-errors", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(ready(me()), window, cx);
                form.preset(
                    "",
                    &"Too long a status. ".repeat(8),
                    &"Far too long a bio. ".repeat(30),
                    window,
                    cx,
                );
                form.tried = true;
            })
        }),
        Story::new("profile-edit-image-rejected", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(ready(me()), window, cx);
                form.set_picked(
                    ImageSlot::Banner,
                    image_file("huge-banner.png", 12 * 1024 * 1024),
                    cx,
                );
                form.set_picked(
                    ImageSlot::Avatar,
                    DraftFile {
                        name: "notes.pdf".into(),
                        mime_type: "application/pdf".into(),
                        bytes: vec![0; 10],
                    },
                    cx,
                );
            })
        }),
        Story::new("profile-edit-uploading", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(ready(me()), window, cx);
                with_picks(form, cx);
                form.set_edit(
                    ProfileEditView {
                        saving: true,
                        upload: Some(UploadView {
                            name: "mountains.png".into(),
                            size_bytes: 4096,
                            sent_bytes: 1638,
                            failed: None,
                        }),
                        error: None,
                    },
                    cx,
                );
            })
        }),
        Story::new("profile-edit-saving", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(ready(me()), window, cx);
                form.set_edit(
                    ProfileEditView {
                        saving: true,
                        upload: None,
                        error: None,
                    },
                    cx,
                );
            })
        }),
        Story::new("profile-edit-failed", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(ready(me()), window, cx);
                form.set_edit(
                    ProfileEditView {
                        saving: false,
                        upload: None,
                        error: Some(ErrorView {
                            code: "BAD_REQUEST".into(),
                            message: "Display name is already taken".into(),
                            retryable: false,
                            retry_after_ms: None,
                        }),
                    },
                    cx,
                );
            })
        }),
        Story::new("profile-edit-loading", |_, window, cx| {
            form(window, cx, |_, _, _| {})
        }),
        Story::new("profile-edit-load-failed", |_, window, cx| {
            form(window, cx, |form, window, cx| {
                form.set_view(failed("NETWORK"), window, cx)
            })
        }),
    ]
}
